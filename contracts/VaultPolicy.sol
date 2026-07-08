// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy, IAutoPausePayer} from "./interfaces/IVaultPolicy.sol";

/// @notice The deterministic, non-AI gate every proposed vault decision must
/// pass before MandateVault builds a transaction. Fully immutable except the
/// `paused` flag — a materially different risk profile means a new
/// Vault+Policy pair via the factory, never a parameter change on a live one.
/// No AI involvement anywhere: validateDecision is a pure view function with
/// no string/reasoning parameter, so reasoning text is structurally incapable
/// of influencing this contract.
///
/// Oracle feed addresses are deliberately NOT stored here — price data is
/// supplied per call as part of VaultState, so this contract's only mutable
/// storage is `paused`. See docs/architecture.md for the reasoning.
contract VaultPolicy is IVaultPolicy {
    bytes32 public constant VIOLATION_MAX_ALLOCATION_EXCEEDED = "MAX_ALLOCATION_EXCEEDED";
    bytes32 public constant VIOLATION_MAX_DRAWDOWN_EXCEEDED = "MAX_DRAWDOWN_EXCEEDED";
    bytes32 public constant VIOLATION_MAX_TRADES_PER_DAY_EXCEEDED = "MAX_TRADES_PER_DAY_EXCEEDED";
    bytes32 public constant VIOLATION_MIN_STABLE_ALLOCATION_VIOLATED = "MIN_STABLE_ALLOCATION_VIOLATED";
    bytes32 public constant VIOLATION_ORACLE_STALE = "ORACLE_STALE";
    bytes32 public constant VIOLATION_ORACLE_DEVIATION_EXCEEDED = "ORACLE_DEVIATION_EXCEEDED";
    bytes32 public constant VIOLATION_VAULT_PAUSED = "VAULT_PAUSED";
    bytes32 public constant TRIGGER_DRAWDOWN_SPEED_EXCEEDED = "DRAWDOWN_SPEED_EXCEEDED";

    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev The MandateVault this policy governs. Never holds funds itself;
    /// only calls back into this address to request the auto-pause bounty
    /// payout, which the vault (which does hold funds) actually executes.
    address public immutable vault;
    address public immutable roles;

    uint256 public immutable maxDrawdownBps;
    uint256 public immutable maxTradesPerDay;
    uint256 public immutable minStableAllocationBps;
    uint256 public immutable oracleMaxStalenessSeconds;
    uint256 public immutable oracleMaxDeviationBps;
    uint256 public immutable maxDrawdownSpeedBpsPerWindow;
    uint256 public immutable drawdownSpeedWindowSeconds;
    uint256 public immutable autoPauseBountyAmount;

    /// @dev Set once in the constructor. No setter exists anywhere in this
    /// contract — loosening a limit always means deploying a new
    /// Vault+Policy pair, never mutating a live one.
    mapping(address asset => uint256 maxBps) public maxAllocationBpsPerAsset;
    mapping(address asset => bool isStable) public isStableAsset;

    bool public paused;

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AutoPaused(address indexed triggeredBy, bytes32 code);
    event AutoPauseBountyPaid(address indexed to, uint256 amount);
    event AutoPauseBountyFailed(address indexed to, uint256 amount);

    struct ConstructorLimits {
        address vault;
        address roles;
        uint256 maxDrawdownBps;
        uint256 maxTradesPerDay;
        uint256 minStableAllocationBps;
        uint256 oracleMaxStalenessSeconds;
        uint256 oracleMaxDeviationBps;
        uint256 maxDrawdownSpeedBpsPerWindow;
        uint256 drawdownSpeedWindowSeconds;
        uint256 autoPauseBountyAmount;
        address[] assets;
        uint256[] maxAllocationBps;
        address[] stableAssets;
    }

    constructor(ConstructorLimits memory limits) {
        require(limits.vault != address(0), "vault required");
        require(limits.roles != address(0), "roles required");
        require(limits.assets.length == limits.maxAllocationBps.length, "length mismatch");

        vault = limits.vault;
        roles = limits.roles;
        maxDrawdownBps = limits.maxDrawdownBps;
        maxTradesPerDay = limits.maxTradesPerDay;
        minStableAllocationBps = limits.minStableAllocationBps;
        oracleMaxStalenessSeconds = limits.oracleMaxStalenessSeconds;
        oracleMaxDeviationBps = limits.oracleMaxDeviationBps;
        maxDrawdownSpeedBpsPerWindow = limits.maxDrawdownSpeedBpsPerWindow;
        drawdownSpeedWindowSeconds = limits.drawdownSpeedWindowSeconds;
        autoPauseBountyAmount = limits.autoPauseBountyAmount;

        for (uint256 i = 0; i < limits.assets.length; i++) {
            maxAllocationBpsPerAsset[limits.assets[i]] = limits.maxAllocationBps[i];
        }
        for (uint256 i = 0; i < limits.stableAssets.length; i++) {
            isStableAsset[limits.stableAssets[i]] = true;
        }
    }

    modifier onlyPauser() {
        require(IAccessControl(roles).hasRole(PAUSER_ROLE, msg.sender), "not pauser");
        _;
    }

    /// @notice Human, subjective pause path. Never blocks withdrawals — only
    /// the code that gates new deposits/new decision execution checks this.
    function pause() external onlyPauser {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyPauser {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice The deterministic gate. `currentHoldings` and
    /// `currentDrawdownBps` in `state` represent the vault's projected
    /// allocation and drawdown AS IF this decision executes, supplied by the
    /// caller (the keeper/MandateVault) — this contract only ever validates
    /// a resulting state against immutable limits, it never computes trade
    /// deltas itself.
    function validateDecision(Decision calldata decision, VaultState calldata state)
        external
        view
        returns (bool passed, bytes32[] memory violationCodes)
    {
        if (decision.action == DecisionAction.EMERGENCY_EXIT_TO_STABLE) {
            // The safety valve: always allowed, same principle as
            // withdrawals never being blocked by pause.
            return (true, new bytes32[](0));
        }

        bytes32[] memory codes = new bytes32[](state.prices.length * 2 + state.currentHoldings.length + 4);
        uint256 count = 0;

        if (paused) {
            codes[count++] = VIOLATION_VAULT_PAUSED;
        }

        if (decision.action != DecisionAction.HOLD && state.tradesToday >= maxTradesPerDay) {
            codes[count++] = VIOLATION_MAX_TRADES_PER_DAY_EXCEEDED;
        }

        for (uint256 i = 0; i < state.prices.length; i++) {
            AssetPrice calldata p = state.prices[i];
            if (block.timestamp > p.updatedAt && block.timestamp - p.updatedAt > oracleMaxStalenessSeconds) {
                codes[count++] = VIOLATION_ORACLE_STALE;
            }
            if (_deviationBps(p.price, p.referencePrice) > oracleMaxDeviationBps) {
                codes[count++] = VIOLATION_ORACLE_DEVIATION_EXCEEDED;
            }
        }

        uint256 stableBps = 0;
        for (uint256 i = 0; i < state.currentHoldings.length; i++) {
            AssetHolding calldata h = state.currentHoldings[i];
            if (h.currentAllocationBps > maxAllocationBpsPerAsset[h.asset]) {
                codes[count++] = VIOLATION_MAX_ALLOCATION_EXCEEDED;
            }
            if (isStableAsset[h.asset]) {
                stableBps += h.currentAllocationBps;
            }
        }
        if (stableBps < minStableAllocationBps) {
            codes[count++] = VIOLATION_MIN_STABLE_ALLOCATION_VIOLATED;
        }

        if (state.currentDrawdownBps > maxDrawdownBps) {
            codes[count++] = VIOLATION_MAX_DRAWDOWN_EXCEEDED;
        }

        return (count == 0, _trim(codes, count));
    }

    /// @notice Free (view-only) check a bot can call via eth_call before
    /// spending gas on the real checkAndAutoPause transaction.
    function previewAutoPause(VaultState calldata state) external view returns (bool triggered, bytes32 code) {
        return _evaluateAutoPause(state);
    }

    /// @notice Permissionless — anyone can call this, mirroring the
    /// permissionless-escalation pattern already proven in P2PMarket.sol's
    /// expire(). Only actually pauses if an objective condition is true.
    /// Pays autoPauseBountyAmount to whoever's call triggers the pause, so
    /// the mechanism stays real even if the team's own watcher bot is down.
    function checkAndAutoPause(VaultState calldata state) external returns (bool triggered, bytes32 code) {
        require(!paused, "already paused");
        (triggered, code) = _evaluateAutoPause(state);
        if (!triggered) {
            return (false, bytes32(0));
        }

        // Effects before interaction: the pause itself must stand no matter
        // what happens to the bounty payout below.
        paused = true;
        emit AutoPaused(msg.sender, code);

        if (autoPauseBountyAmount > 0) {
            // A failed payout (e.g. the caller is somehow an address the
            // vault's asset refuses, per the live-verified zero-address
            // revert behavior) must never undo the pause. Emitting an event
            // in each branch also lets the monitoring/indexer track failed
            // payouts (see docs/threat-model.md) instead of them vanishing
            // silently.
            try IAutoPausePayer(vault).payAutoPauseBounty(msg.sender, autoPauseBountyAmount) {
                emit AutoPauseBountyPaid(msg.sender, autoPauseBountyAmount);
            } catch Error(string memory) {
                emit AutoPauseBountyFailed(msg.sender, autoPauseBountyAmount);
            } catch (bytes memory) {
                emit AutoPauseBountyFailed(msg.sender, autoPauseBountyAmount);
            }
        }

        return (true, code);
    }

    function _evaluateAutoPause(VaultState calldata state) private view returns (bool triggered, bytes32 code) {
        for (uint256 i = 0; i < state.prices.length; i++) {
            if (_deviationBps(state.prices[i].price, state.prices[i].referencePrice) > oracleMaxDeviationBps) {
                return (true, VIOLATION_ORACLE_DEVIATION_EXCEEDED);
            }
        }
        if (state.currentDrawdownBps > state.drawdownBpsAtWindowStart) {
            uint256 speed = state.currentDrawdownBps - state.drawdownBpsAtWindowStart;
            if (speed > maxDrawdownSpeedBpsPerWindow) {
                return (true, TRIGGER_DRAWDOWN_SPEED_EXCEEDED);
            }
        }
        return (false, bytes32(0));
    }

    function _deviationBps(uint256 price, uint256 referencePrice) private pure returns (uint256) {
        if (referencePrice == 0) return 0;
        uint256 diff = price > referencePrice ? price - referencePrice : referencePrice - price;
        return (diff * 10_000) / referencePrice;
    }

    function _trim(bytes32[] memory arr, uint256 len) private pure returns (bytes32[] memory) {
        bytes32[] memory trimmed = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            trimmed[i] = arr[i];
        }
        return trimmed;
    }
}
