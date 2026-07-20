// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy, IAutoPausePayer} from "./interfaces/IVaultPolicy.sol";

/// @notice The deterministic, non-AI gate every proposed vault decision must
/// pass before MandateVault builds a transaction. Fully immutable except the
/// `paused` flag, a materially different risk profile means a new
/// Vault+Policy pair via the factory, never a parameter change on a live one.
/// No AI involvement anywhere: validateDecision is a pure view function with
/// no string/reasoning parameter, so reasoning text is structurally incapable
/// of influencing this contract.
///
/// Oracle feed addresses are deliberately NOT stored here, price data is
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

    // v3 (yield-seeking LP vault) only. Always unreachable for v1/v2:
    // their VaultState.currentLpPositions is always empty (no LP
    // positions ever held), and their Decision.action is never one of the
    // LP_* values, so none of these five checks ever fire for them.
    bytes32 public constant VIOLATION_LP_POSITION_VALUE_LOSS_EXCEEDED = "LP_POSITION_VALUE_LOSS_EXCEEDED";
    bytes32 public constant VIOLATION_LP_OUT_OF_RANGE_TOO_LONG = "LP_OUT_OF_RANGE_TOO_LONG";
    bytes32 public constant VIOLATION_LP_POOL_LIQUIDITY_DROPPED = "LP_POOL_LIQUIDITY_DROPPED";
    bytes32 public constant VIOLATION_LP_RANGE_TOO_NARROW = "LP_RANGE_TOO_NARROW";
    bytes32 public constant VIOLATION_LP_MAX_ALLOCATION_EXCEEDED = "LP_MAX_ALLOCATION_EXCEEDED";

    // v4 (cross-chain lending vault) only. Always unreachable for
    // v1/v2/v3: their VaultState.currentLendingPositions is always empty
    // and their Decision.action is never BRIDGE_DEPOSIT/BRIDGE_WITHDRAW.
    // Deliberately no LENDING_REPORT_DEVIATION_EXCEEDED code here: that
    // check is not a decision-time validation, it is a hard revert inside
    // MandateVault.reportLendingPosition itself (rejecting a bad write
    // outright, before it ever becomes state this contract could read),
    // same reasoning payAutoPauseBounty's cap is enforced directly on
    // MandateVault rather than routed through a VaultPolicy check.
    bytes32 public constant VIOLATION_LENDING_POSITION_STALE = "LENDING_POSITION_STALE";
    bytes32 public constant VIOLATION_LENDING_MAX_ALLOCATION_EXCEEDED = "LENDING_MAX_ALLOCATION_EXCEEDED";

    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev The MandateVault this policy governs. Never holds funds itself;
    /// only calls back into this address to request the auto-pause bounty
    /// payout, which the vault (which does hold funds) actually executes.
    address public immutable vault;
    address public immutable roles;

    uint256 public immutable maxDrawdownBps;
    uint256 public immutable maxTradesPerDay;
    uint256 public immutable minStableAllocationBps;

    /// @dev Two genuinely different things, do not conflate them:
    /// - The THRESHOLDS below (how much staleness/deviation is tolerated)
    ///   are immutable, exactly like every other limit in this contract.
    ///   There is no setter for either, ever, on a live policy.
    /// - The oracle FEED ADDRESS (which price source to read) is NOT stored
    ///   here at all. It is owned by a separate, future OracleRegistry.sol,
    ///   deliberately kept out of VaultPolicy so this contract's only
    ///   mutable field remains `paused`. See docs/architecture.md, "Where
    ///   the current feed address actually lives."
    uint256 public immutable oracleMaxStalenessSeconds;
    uint256 public immutable oracleMaxDeviationBps;

    uint256 public immutable maxDrawdownSpeedBpsPerWindow;
    uint256 public immutable drawdownSpeedWindowSeconds;
    // No autoPauseBountyAmount here on purpose: the bounty is an economic
    // incentive, not a risk limit, so unlike everything else in this
    // contract it may need to move over time (gas costs, USDC value
    // context). It lives as a GOVERNANCE-adjustable value on MandateVault
    // instead. See IAutoPausePayer in interfaces/IVaultPolicy.sol.

    // v3 (yield-seeking LP vault) only. Left at 0 for v1/v2's
    // ConstructorLimits (harmless: their currentLpPositions is always
    // empty and their Decision.action is never LP_OPEN, so these are
    // simply never evaluated for them, same as any other immutable a
    // vault's real strategy doesn't need).
    /// @dev Minimum width (tickUpper - tickLower) VaultPolicy accepts for
    /// an LP_OPEN proposal, rejecting a pathologically narrow range that
    /// maximizes manipulation/IL exposure for minimal capital. A starting
    /// placeholder (not yet calibrated against real observed volatility
    /// for any specific pair), see this project's v3 design doc.
    int24 public immutable minLpTickRangeWidth;
    /// @dev The value-drawdown-since-open-value proxy threshold (not
    /// textbook IL-vs-HODL), see LpPositionHolding's doc comment in
    /// IVaultPolicy.sol for why. 300 = 3%, Randy's own concrete trigger.
    uint256 public immutable maxLpPositionValueLossBps;
    /// @dev How long a position may sit outside its own tick range before
    /// this blocks further non-exit action on it. 48 hours, Randy's own
    /// concrete trigger.
    uint256 public immutable maxLpOutOfRangeSeconds;
    /// @dev The floor, as a fraction of the pool's own liquidity() at the
    /// moment this vault's position was opened, below which the pool is
    /// considered to have thinned out too much to keep adding to. 5000 =
    /// 50%, Randy's own concrete trigger.
    uint256 public immutable minLpPoolLiquidityRatioBps;
    /// @dev Cap on total value locked across every held LP position
    /// combined, as bps of NAV. A position isn't a single registered
    /// asset, so this is a dedicated cap, not reused from
    /// maxAllocationBpsPerAsset.
    uint256 public immutable maxLpAllocationBps;

    // v4 (cross-chain lending vault) only. Left at 0 for v1/v2/v3's
    // ConstructorLimits, same harmless-when-unused convention as the LP
    // fields above.
    /// @dev Past this many seconds since a position's lastReportedAt (set
    /// at BRIDGE_DEPOSIT time as the initial clock anchor, before any real
    /// report has arrived, then updated by every real
    /// reportLendingPosition call), MandateVault's totalAssets() applies a
    /// conservative valuation haircut to that position specifically (falls
    /// back to principalUSDC instead of trusting the stale
    /// currentValueUSDC). NOT itself a validateDecision violation -- a
    /// haircut is a pure accounting adjustment, not a reason to block an
    /// otherwise-unrelated decision. 86400 = 24h, Randy's own confirmed
    /// starting placeholder, revisit with real data same as
    /// minLpTickRangeWidth.
    uint256 public immutable lendingReportStaleAfterSeconds;
    /// @dev The maximum a single reportLendingPosition call may move a
    /// position's value versus its baseline (principalUSDC for the first
    /// report, the previous report's value afterward) before
    /// MandateVault reverts the call outright. Read by MandateVault only,
    /// never evaluated in validateDecision below, see
    /// VIOLATION_LENDING_POSITION_STALE's own doc comment for why this
    /// class of check lives as a revert, not a code. 200 = 2%, Randy's own
    /// confirmed starting placeholder.
    uint256 public immutable lendingReportMaxDeviationBps;
    /// @dev Past this many seconds since lastReportedAt, a position is
    /// treated as failed, not just stale: validateDecision blocks every
    /// new decision touching it except BRIDGE_WITHDRAW targeting that same
    /// position (mirrors the LP loop's isTargetOfReduceOrClose exemption),
    /// AND MandateVault's permissionless checkAndInitiateStaleWithdrawal
    /// becomes callable by anyone regardless of whether the agent ever
    /// proposes that withdrawal itself, same "anyone can escalate, the
    /// contract enforces the real condition" pattern as checkAndAutoPause.
    /// 604800 = 7 days, Randy's own confirmed starting placeholder.
    uint256 public immutable lendingPositionForceUnwindSeconds;
    /// @dev Cap on total value locked across every held cross-chain
    /// lending position combined, as bps of NAV. Mirrors maxLpAllocationBps
    /// exactly: a lending position isn't a single registered asset, so
    /// this is a dedicated cap, not reused from maxAllocationBpsPerAsset.
    /// This is the concrete onchain backstop V4_LENDING_STRATEGY_TEXT's
    /// concentration criterion refers to -- added specifically so that
    /// text describes a mechanism that actually exists, not an aspiration.
    uint256 public immutable maxLendingAllocationBps;

    /// @dev Set once in the constructor. No setter exists anywhere in this
    /// contract, loosening a limit always means deploying a new
    /// Vault+Policy pair, never mutating a live one.
    mapping(address asset => uint256 maxBps) public maxAllocationBpsPerAsset;
    mapping(address asset => bool isStable) public isStableAsset;

    bool public paused;

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AutoPaused(address indexed triggeredBy, bytes32 code);
    // No amount here, VaultPolicy no longer knows it. MandateVault emits
    // its own AutoPauseBountyPaid event with the real amount actually paid.
    event AutoPauseBountyCallFailed(address indexed to);

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
        address[] assets;
        uint256[] maxAllocationBps;
        address[] stableAssets;
        // v3 only, zero-valued for v1/v2/v4, see the immutables' own doc
        // comments above.
        int24 minLpTickRangeWidth;
        uint256 maxLpPositionValueLossBps;
        uint256 maxLpOutOfRangeSeconds;
        uint256 minLpPoolLiquidityRatioBps;
        uint256 maxLpAllocationBps;
        // v4 only, zero-valued for v1/v2/v3, see the immutables' own doc
        // comments above.
        uint256 lendingReportStaleAfterSeconds;
        uint256 lendingReportMaxDeviationBps;
        uint256 lendingPositionForceUnwindSeconds;
        uint256 maxLendingAllocationBps;
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
        minLpTickRangeWidth = limits.minLpTickRangeWidth;
        maxLpPositionValueLossBps = limits.maxLpPositionValueLossBps;
        maxLpOutOfRangeSeconds = limits.maxLpOutOfRangeSeconds;
        minLpPoolLiquidityRatioBps = limits.minLpPoolLiquidityRatioBps;
        maxLpAllocationBps = limits.maxLpAllocationBps;
        lendingReportStaleAfterSeconds = limits.lendingReportStaleAfterSeconds;
        lendingReportMaxDeviationBps = limits.lendingReportMaxDeviationBps;
        lendingPositionForceUnwindSeconds = limits.lendingPositionForceUnwindSeconds;
        maxLendingAllocationBps = limits.maxLendingAllocationBps;

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

    /// @notice Human, subjective pause path. Never blocks withdrawals, only
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
    /// caller (the keeper/MandateVault), this contract only ever validates
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

        // +7 fixed-count possible codes: VAULT_PAUSED, MAX_TRADES_PER_DAY_EXCEEDED,
        // LP_RANGE_TOO_NARROW, MIN_STABLE_ALLOCATION_VIOLATED, MAX_DRAWDOWN_EXCEEDED,
        // LP_MAX_ALLOCATION_EXCEEDED, LENDING_MAX_ALLOCATION_EXCEEDED (each fires
        // at most once per call). currentLendingPositions contributes at most
        // one code per position (LENDING_POSITION_STALE only).
        bytes32[] memory codes = new bytes32[](
            state.prices.length * 2 + state.currentHoldings.length + state.currentLpPositions.length * 3
                + state.currentLendingPositions.length + 7
        );
        uint256 count = 0;

        if (paused) {
            codes[count++] = VIOLATION_VAULT_PAUSED;
        }

        if (decision.action != DecisionAction.HOLD && state.tradesToday >= maxTradesPerDay) {
            codes[count++] = VIOLATION_MAX_TRADES_PER_DAY_EXCEEDED;
        }

        // Only needs decision's own proposed fields, no live state: an
        // LP_OPEN proposing a pathologically narrow range is rejected
        // regardless of anything else about current holdings.
        if (decision.action == DecisionAction.LP_OPEN) {
            int24 width = decision.tickUpper - decision.tickLower;
            if (width < minLpTickRangeWidth) {
                codes[count++] = VIOLATION_LP_RANGE_TOO_NARROW;
            }
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

        // REBALANCE toward the vault's own configured target is exempt from
        // this check (Randy's own explicit design decision, 2026-07-19,
        // replacing an earlier, rejected approach of raising maxDrawdownBps
        // itself for the whole vault): a REBALANCE's resulting allocation is
        // still fully, unconditionally bounded by maxAllocationBpsPerAsset/
        // minStableAllocationBps above (never exempted), so REBALANCE can
        // never push the vault into an allocation riskier than those caps
        // already permit, regardless of the vault's currently realized
        // drawdown. This keeps the drawdown circuit breaker meaningfully
        // protective against abnormal conditions (bugs, oracle manipulation,
        // a genuine catastrophic event) for every OTHER action (ENTER, EXIT,
        // HOLD), rather than diluting it vault-wide to accommodate one
        // strategy's own expected, in-band volatility. Residual, accepted
        // risk: during a real abnormal drawdown (e.g. a manipulated price),
        // REBALANCE itself is no longer blocked by this specific check --
        // oracleMaxDeviationBps and the maxDrawdownSpeedBpsPerWindow
        // auto-pause remain the backstops for that scenario, deliberately
        // left unchanged. Only takes effect for a vault deployed from this
        // source onward (v5+); v1-v4's real, already-deployed VaultPolicy
        // contracts have this check compiled unconditionally and are
        // entirely unaffected by this source change.
        if (decision.action != DecisionAction.REBALANCE && state.currentDrawdownBps > maxDrawdownBps) {
            codes[count++] = VIOLATION_MAX_DRAWDOWN_EXCEEDED;
        }

        // v3 only: always a no-op loop for v1/v2 (currentLpPositions is
        // always empty for them). A breached position blocks every action
        // except reducing/closing THAT SAME position (LP_DECREASE/
        // LP_COLLECT/LP_CLOSE targeting its own tokenId via decision.lpTokenId)
        // or EMERGENCY_EXIT_TO_STABLE (already bypassed above). Found and
        // fixed 2026-07-14: this used to be claimed as "enforced
        // structurally, not by special-casing here," which was not actually
        // true -- the loop had no decision-aware exemption at all, so a
        // breached position's own LP_DECREASE/LP_COLLECT/LP_CLOSE was
        // rejected by the very pre-check meant to let it through, the same
        // breach blocking the only targeted action that could fix it
        // (leaving EMERGENCY_EXIT_TO_STABLE, a strictly bigger hammer, as
        // the sole remaining path). The exemption below applies only to the
        // exact position named by decision.lpTokenId, for exactly these
        // three actions: every OTHER open position in the same vault is
        // still evaluated in full, and a fully-closed position is simply
        // absent from currentLpPositions on the next call regardless.
        uint256 lpBps = 0;
        for (uint256 i = 0; i < state.currentLpPositions.length; i++) {
            LpPositionHolding calldata p = state.currentLpPositions[i];
            lpBps += p.currentAllocationBps;

            bool isTargetOfReduceOrClose = (
                decision.action == DecisionAction.LP_DECREASE || decision.action == DecisionAction.LP_COLLECT
                    || decision.action == DecisionAction.LP_CLOSE
            ) && p.tokenId == decision.lpTokenId;
            if (isTargetOfReduceOrClose) continue;

            if (p.openValueUSDC > 0) {
                uint256 floor = (p.openValueUSDC * (10_000 - maxLpPositionValueLossBps)) / 10_000;
                if (p.currentValueUSDC < floor) {
                    codes[count++] = VIOLATION_LP_POSITION_VALUE_LOSS_EXCEEDED;
                }
            }

            if (!p.inRange && p.outOfRangeSince != 0 && block.timestamp > p.outOfRangeSince
                && block.timestamp - p.outOfRangeSince > maxLpOutOfRangeSeconds) {
                codes[count++] = VIOLATION_LP_OUT_OF_RANGE_TOO_LONG;
            }

            if (p.poolLiquidityAtOpen > 0) {
                uint256 ratioBps = (uint256(p.currentPoolLiquidity) * 10_000) / uint256(p.poolLiquidityAtOpen);
                if (ratioBps < minLpPoolLiquidityRatioBps) {
                    codes[count++] = VIOLATION_LP_POOL_LIQUIDITY_DROPPED;
                }
            }
        }
        if (lpBps > maxLpAllocationBps) {
            codes[count++] = VIOLATION_LP_MAX_ALLOCATION_EXCEEDED;
        }

        // v4 only: always a no-op loop for v1/v2/v3 (currentLendingPositions
        // is always empty for them). Positions already in
        // WITHDRAWAL_PENDING/IN_TRANSIT_BACK are already being unwound (via
        // MandateVault's _initiateCrossChainWithdrawal, the single path
        // used by both EMERGENCY_EXIT_TO_STABLE -- already bypassed above
        // -- and the permissionless 7-day staleness trigger) and are exempt
        // from further checks here unconditionally: unlike the LP loop's
        // per-action exemption (LP_DECREASE/LP_COLLECT/LP_CLOSE), there is
        // only one narrowing action here (BRIDGE_WITHDRAW), and a position
        // already mid-unwind can never be the target of a new one.
        // IN_TRANSIT_OUT is included in the staleness check, not just OPEN:
        // a position whose very first report never arrives within
        // lendingPositionForceUnwindSeconds of BRIDGE_DEPOSIT is at least as
        // concerning as one that stopped reporting after being confirmed
        // open, and deserves the same forced-unwind treatment, not a gap.
        uint256 lendingBps = 0;
        for (uint256 i = 0; i < state.currentLendingPositions.length; i++) {
            LendingPositionHolding calldata p = state.currentLendingPositions[i];
            lendingBps += p.currentAllocationBps;

            bool alreadyUnwinding = p.status == LendingPositionStatus.WITHDRAWAL_PENDING
                || p.status == LendingPositionStatus.IN_TRANSIT_BACK;
            if (alreadyUnwinding) continue;

            bool isTargetOfWithdraw =
                decision.action == DecisionAction.BRIDGE_WITHDRAW && p.positionId == decision.lendingPositionId;
            if (isTargetOfWithdraw) continue;

            bool awaitingConfirmation =
                p.status == LendingPositionStatus.OPEN || p.status == LendingPositionStatus.IN_TRANSIT_OUT;
            if (
                awaitingConfirmation && block.timestamp > p.lastReportedAt
                    && block.timestamp - p.lastReportedAt > lendingPositionForceUnwindSeconds
            ) {
                codes[count++] = VIOLATION_LENDING_POSITION_STALE;
            }
        }
        if (lendingBps > maxLendingAllocationBps) {
            codes[count++] = VIOLATION_LENDING_MAX_ALLOCATION_EXCEEDED;
        }

        return (count == 0, _trim(codes, count));
    }

    /// @notice Free (view-only) check a bot can call via eth_call before
    /// spending gas on the real checkAndAutoPause transaction.
    function previewAutoPause(VaultState calldata state) external view returns (bool triggered, bytes32 code) {
        return _evaluateAutoPause(state);
    }

    /// @notice Permissionless, anyone can call this, mirroring the
    /// permissionless-escalation pattern already proven in P2PMarket.sol's
    /// expire(). Only actually pauses if an objective condition is true.
    /// Triggers MandateVault's bounty payout to whoever's call triggers the
    /// pause, so the mechanism stays real even if the team's own watcher
    /// bot is down. This contract never decides or knows the amount, that
    /// is MandateVault's own GOVERNANCE-adjustable value, see
    /// IAutoPausePayer in interfaces/IVaultPolicy.sol for why.
    /// @dev No ReentrancyGuard here, deliberately, not an oversight: this
    /// contract never holds funds, so there is nothing here for a
    /// reentrant call to drain. The only state this function mutates is
    /// `paused`, and that is set BEFORE the external call (checks-effects-
    /// interactions), so even a malicious recipient that reenters
    /// checkAndAutoPause during the payout hits `require(!paused)` and
    /// reverts immediately, that reverts only the reentrant attempt,
    /// which the outer call's try/catch simply records as a failed payout,
    /// exactly like any other payout failure. The actual token transfer
    /// happens inside MandateVault.payAutoPauseBounty, which DOES hold
    /// funds and is responsible for its own reentrancy protection there.
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

        // A failed payout (e.g. the caller is somehow an address the
        // vault's asset refuses, per the live-verified zero-address revert
        // behavior, or MandateVault's own current bounty amount is 0) must
        // never undo the pause. Emitting an event on failure also lets the
        // monitoring/indexer track it (see docs/threat-model.md) instead of
        // it vanishing silently. MandateVault emits its own event on
        // success, since it is the only contract that knows the amount.
        try IAutoPausePayer(vault).payAutoPauseBounty(msg.sender) {} catch Error(string memory) {
            emit AutoPauseBountyCallFailed(msg.sender);
        } catch (bytes memory) {
            emit AutoPauseBountyCallFailed(msg.sender);
        }

        return (true, code);
    }

    function _evaluateAutoPause(VaultState calldata state) private view returns (bool triggered, bytes32 code) {
        for (uint256 i = 0; i < state.prices.length; i++) {
            AssetPrice calldata p = state.prices[i];
            // Staleness must also trigger auto-pause, not just deviation.
            // Without this, an oracle that simply stops updating (no new
            // reading, so nothing to "deviate" from) would never
            // proactively pause the vault, only silently block new trades
            // one at a time through validateDecision's own staleness check.
            if (block.timestamp > p.updatedAt && block.timestamp - p.updatedAt > oracleMaxStalenessSeconds) {
                return (true, VIOLATION_ORACLE_STALE);
            }
            if (_deviationBps(p.price, p.referencePrice) > oracleMaxDeviationBps) {
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
