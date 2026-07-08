// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {MockVault} from "../contracts/test/MockVault.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

/// @notice Property-based fuzz and invariant tests for VaultPolicy, per the
/// project's own rule that the policy contract gets this coverage starting
/// in Phase 2, not deferred to a later phase.
contract VaultPolicyTest is Test {
    address internal constant USDC = address(0x1111);
    address internal constant EURC = address(0x2222);

    uint256 internal constant MAX_DRAWDOWN_BPS = 1000;
    uint256 internal constant MAX_ALLOCATION_BPS_EURC = 5000;
    uint256 internal constant MIN_STABLE_BPS = 2000;

    MandateRoles internal roles;
    MockVault internal mockVault;
    VaultPolicy internal policy;

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.PAUSER_ROLE(), address(this));
        mockVault = new MockVault();

        address[] memory assets = new address[](2);
        assets[0] = USDC;
        assets[1] = EURC;
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = MAX_ALLOCATION_BPS_EURC;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = USDC;

        VaultPolicy.ConstructorLimits memory limits = VaultPolicy.ConstructorLimits({
            vault: address(mockVault),
            roles: address(roles),
            maxDrawdownBps: MAX_DRAWDOWN_BPS,
            maxTradesPerDay: 5,
            minStableAllocationBps: MIN_STABLE_BPS,
            oracleMaxStalenessSeconds: 3600,
            oracleMaxDeviationBps: 500,
            maxDrawdownSpeedBpsPerWindow: 300,
            drawdownSpeedWindowSeconds: 3600,
            autoPauseBountyAmount: 10,
            assets: assets,
            maxAllocationBps: maxBps,
            stableAssets: stableAssets
        });
        policy = new VaultPolicy(limits);
    }

    /// @dev No decision that puts EURC above its immutable cap ever passes,
    /// no matter what other otherwise-compliant values surround it.
    function testFuzz_neverPassesWhenAllocationExceedsCap(uint16 eurcBps) public view {
        eurcBps = uint16(bound(eurcBps, uint16(MAX_ALLOCATION_BPS_EURC) + 1, 10_000));

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](2);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: 10_000 - eurcBps});
        holdings[1] = IVaultPolicy.AssetHolding({asset: EURC, currentAllocationBps: eurcBps});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: holdings,
            prices: new IVaultPolicy.AssetPrice[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0)
            }),
            state
        );

        assertFalse(passed, "a decision exceeding the immutable allocation cap must never pass");
    }

    /// @dev No decision ever passes while drawdown exceeds the immutable
    /// maxDrawdownBps, regardless of anything else in the state, except the
    /// EMERGENCY_EXIT_TO_STABLE safety valve (tested separately below).
    function testFuzz_neverPassesWhenDrawdownExceedsLimit(uint16 drawdownBps) public view {
        drawdownBps = uint16(bound(drawdownBps, uint16(MAX_DRAWDOWN_BPS) + 1, type(uint16).max));

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0)
            }),
            state
        );

        assertFalse(passed, "a decision must never pass while drawdown exceeds the immutable limit");
    }

    /// @dev EMERGENCY_EXIT_TO_STABLE always passes regardless of how bad
    /// currentDrawdownBps is — the safety valve is unconditional, by design.
    function testFuzz_emergencyExitAlwaysPassesRegardlessOfDrawdown(uint16 drawdownBps) public view {
        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            drawdownBpsAtWindowStart: 0,
            tradesToday: type(uint256).max,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0)
        });

        (bool passed, bytes32[] memory codes) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0)
            }),
            state
        );

        assertTrue(passed);
        assertEq(codes.length, 0);
    }

    /// @dev The core property from this round's live-verified fix: whether
    /// the bounty payout succeeds or reverts must never change whether the
    /// pause itself takes effect.
    function testFuzz_autoPausePausesRegardlessOfPayoutOutcome(bool payoutReverts, address caller) public {
        vm.assume(caller != address(0));
        mockVault.setShouldRevertPayout(payoutReverts);

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 500,
            drawdownBpsAtWindowStart: 0, // speed 500 > maxDrawdownSpeedBpsPerWindow (300)
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0)
        });

        vm.prank(caller);
        policy.checkAndAutoPause(state);

        assertTrue(policy.paused(), "pause must stand regardless of the bounty payout outcome");
    }

    function test_pauseRejectsNonPauser(address caller) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        policy.pause();
    }
}
