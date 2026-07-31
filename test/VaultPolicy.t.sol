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
            assets: assets,
            maxAllocationBps: maxBps,
            stableAssets: stableAssets,
        minLpTickRangeWidth: 0,
        maxLpPositionValueLossBps: 0,
        maxLpOutOfRangeSeconds: 0,
        minLpPoolLiquidityRatioBps: 0,
        maxLpAllocationBps: 0,
        lendingReportStaleAfterSeconds: 0,
        lendingReportMaxDeviationBps: 0,
        lendingPositionForceUnwindSeconds: 0,
        maxLendingAllocationBps: 0,
        performanceFeeBps: 0
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
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
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
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a decision must never pass while drawdown exceeds the immutable limit");
    }

    /// @dev REBALANCE is the one deliberate exception to the drawdown check
    /// above (an approved 2026-07-19 design, see
    /// docs/v5-ergodic-rebalancing.md): it passes even while drawdown
    /// exceeds the immutable maxDrawdownBps, as long as every OTHER check
    /// (allocation caps, min stable) is still satisfied. This is what lets
    /// v5's ergodic-rebalancing strategy recover the vault during its own
    /// expected, in-band drawdowns instead of getting stuck unable to act.
    function testFuzz_rebalanceExemptFromDrawdownCheck(uint16 drawdownBps) public view {
        drawdownBps = uint16(bound(drawdownBps, uint16(MAX_DRAWDOWN_BPS) + 1, type(uint16).max));

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](2);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: 8000});
        holdings[1] = IVaultPolicy.AssetHolding({asset: EURC, currentAllocationBps: 2000});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: holdings,
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertTrue(passed, "REBALANCE must pass despite drawdown exceeding the immutable limit, as long as every other check is satisfied");
    }

    /// @dev The REBALANCE exemption above is scoped to REBALANCE only, not a
    /// general bypass: ENTER and HOLD must still correctly fail with the
    /// exact same high-drawdown state that the REBALANCE test above passes
    /// with, proving the exemption did not accidentally loosen the check
    /// for every action.
    function testFuzz_nonRebalanceStillBlockedDuringHighDrawdown(uint16 drawdownBps) public view {
        drawdownBps = uint16(bound(drawdownBps, uint16(MAX_DRAWDOWN_BPS) + 1, type(uint16).max));

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](2);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: 8000});
        holdings[1] = IVaultPolicy.AssetHolding({asset: EURC, currentAllocationBps: 2000});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: holdings,
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool holdPassed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );
        assertFalse(holdPassed, "HOLD must still fail during high drawdown, the exemption must not leak beyond REBALANCE");

        (bool enterPassed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.ENTER,
                asset: USDC,
                amount: 1,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );
        assertFalse(enterPassed, "ENTER must still fail during high drawdown, the exemption must not leak beyond REBALANCE");
    }

    /// @dev No non-HOLD action ever passes once tradesToday has reached the
    /// immutable maxTradesPerDay, no matter how large tradesToday gets.
    function testFuzz_neverPassesWhenTradesPerDayExceeded(uint256 tradesToday) public view {
        tradesToday = bound(tradesToday, 5, type(uint256).max); // maxTradesPerDay = 5

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](1);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: 10_000});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: tradesToday,
            currentHoldings: holdings,
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.ENTER,
                asset: USDC,
                amount: 1,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a trade action must never pass once tradesToday reaches the immutable daily cap");
    }

    /// @dev No decision ever passes while the stable-asset weight is below
    /// the immutable minStableAllocationBps, regardless of how the
    /// remaining allocation is otherwise arranged.
    function testFuzz_neverPassesWhenStableAllocationBelowMinimum(uint16 stableBps) public view {
        stableBps = uint16(bound(stableBps, 0, uint16(MIN_STABLE_BPS) - 1));
        // EURC held well within its own 5000 bps cap on purpose, so this
        // test isolates the min-stable check from the max-allocation check
        // above, holdings need not sum to 10000, VaultPolicy only checks
        // each asset against its own cap and sums the stable ones.
        uint16 nonStableBps = 1000;

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](2);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: stableBps});
        holdings[1] = IVaultPolicy.AssetHolding({asset: EURC, currentAllocationBps: nonStableBps});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: holdings,
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a decision must never pass while stable allocation is below the immutable minimum");
    }

    /// @dev No decision ever passes when a supplied price is older than the
    /// immutable oracleMaxStalenessSeconds.
    function testFuzz_neverPassesWhenOracleStale(uint256 staleness) public {
        staleness = bound(staleness, 3601, 365 days); // oracleMaxStalenessSeconds = 3600

        vm.warp(365 days); // headroom so updatedAt below never underflows
        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({
            asset: USDC,
            price: 100,
            referencePrice: 100,
            updatedAt: block.timestamp - staleness
        });

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: prices,
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a decision must never pass on a price staler than the immutable staleness limit");
    }

    /// @dev No decision ever passes when a supplied price deviates from its
    /// reference by more than the immutable oracleMaxDeviationBps.
    function testFuzz_neverPassesWhenOracleDeviationExceeded(uint256 referencePrice, uint256 deviationBps) public
        view
    {
        referencePrice = bound(referencePrice, 1, 1e30); // avoid overflow in price computation below
        deviationBps = bound(deviationBps, 501, 10_000); // oracleMaxDeviationBps = 500
        uint256 price = referencePrice + (referencePrice * deviationBps) / 10_000;

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] =
            IVaultPolicy.AssetPrice({asset: USDC, price: price, referencePrice: referencePrice, updatedAt: block.timestamp});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: prices,
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a decision must never pass when price deviation exceeds the immutable limit");
    }

    /// @dev EMERGENCY_EXIT_TO_STABLE always passes regardless of how bad
    /// currentDrawdownBps is, the safety valve is unconditional, by design.
    function testFuzz_emergencyExitAlwaysPassesRegardlessOfDrawdown(uint16 drawdownBps) public view {
        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            drawdownBpsAtWindowStart: 0,
            tradesToday: type(uint256).max,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed, bytes32[] memory codes) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
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
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
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

    /// @dev A stale oracle reading must trigger auto-pause on its own, not
    /// just block new trades one at a time through validateDecision. Without
    /// this, an oracle that simply stops updating (nothing to "deviate"
    /// from) would never proactively pause the vault.
    function testFuzz_staleOracleTriggersAutoPause(uint256 staleness) public {
        staleness = bound(staleness, 3601, 365 days); // oracleMaxStalenessSeconds = 3600
        vm.warp(365 days);

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({
            asset: USDC,
            price: 100,
            referencePrice: 100, // no deviation, isolates the staleness trigger
            updatedAt: block.timestamp - staleness
        });
        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: prices,
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool triggered, bytes32 code) = policy.previewAutoPause(state);
        assertTrue(triggered, "a stale oracle reading must trigger auto-pause on its own");
        assertEq(code, policy.VIOLATION_ORACLE_STALE());
    }

    /// @dev Spam-calling checkAndAutoPause after the vault is already paused
    /// must never pay the bounty more than once for the same pause
    /// transition. require(!paused) at the top is what enforces this; this
    /// test proves it holds under repeated calls, not just a single retry.
    function testFuzz_bountyPaidExactlyOncePerPauseTransition(uint8 spamAttempts, address caller) public {
        vm.assume(caller != address(0));
        spamAttempts = uint8(bound(spamAttempts, 1, 20));

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 500,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        vm.prank(caller);
        policy.checkAndAutoPause(state);
        assertEq(mockVault.payoutCallCount(), 1);

        for (uint256 i = 0; i < spamAttempts; i++) {
            vm.prank(caller);
            (bool ok,) = address(policy).call(abi.encodeCall(VaultPolicy.checkAndAutoPause, (state)));
            assertFalse(ok, "a spam call once already paused must revert");
        }
        assertEq(mockVault.payoutCallCount(), 1, "the bounty must never be paid more than once per pause transition");
    }

    /// @dev Combined adversarial scenario, not just staleness and deviation
    /// tested in isolation: a price that is both stale (the feed stopped
    /// updating) and, once it does report again, spiked far from its
    /// reference. Both violations must be reported and the decision must
    /// still be rejected, one condition must never mask the other.
    function test_staleThenSpikedOracle_rejectsWithBothViolations() public {
        vm.warp(365 days);
        uint256 referencePrice = 100e18;
        uint256 spikedPrice = referencePrice * 2; // 100% deviation, far past the 5% limit

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({
            asset: USDC,
            price: spikedPrice,
            referencePrice: referencePrice,
            updatedAt: block.timestamp - 7200 // stale: exceeds the 3600s limit
        });

        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](1);
        holdings[0] = IVaultPolicy.AssetHolding({asset: USDC, currentAllocationBps: 10_000});

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: holdings,
            prices: prices,
        currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed, bytes32[] memory codes) = policy.validateDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.HOLD,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: 0,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            state
        );

        assertFalse(passed, "a decision must never pass when the oracle is both stale and spiked");
        bool sawStale;
        bool sawDeviation;
        for (uint256 i = 0; i < codes.length; i++) {
            if (codes[i] == policy.VIOLATION_ORACLE_STALE()) sawStale = true;
            if (codes[i] == policy.VIOLATION_ORACLE_DEVIATION_EXCEEDED()) sawDeviation = true;
        }
        assertTrue(sawStale, "staleness must be reported even when deviation is also present");
        assertTrue(sawDeviation, "deviation must be reported even when staleness is also present");

        // The same combined condition must also trigger auto-pause.
        (bool triggered,) = policy.previewAutoPause(state);
        assertTrue(triggered, "a stale-and-spiked oracle must trigger auto-pause");
    }

    // ------------------------------------------------------------------
    // v3 LP risk limits. The shared `policy` in setUp() zeroes every LP
    // field (harmless for v1/v2-shaped tests above), so these use their
    // own policy instance with real, non-zero LP limits.
    // ------------------------------------------------------------------

    int24 internal constant MIN_LP_TICK_RANGE_WIDTH = 1200;
    uint256 internal constant MAX_LP_POSITION_VALUE_LOSS_BPS = 300;
    uint256 internal constant MAX_LP_OUT_OF_RANGE_SECONDS = 172_800; // 48h
    uint256 internal constant MIN_LP_POOL_LIQUIDITY_RATIO_BPS = 5000;
    uint256 internal constant MAX_LP_ALLOCATION_BPS = 5000;

    function _lpPolicy() internal returns (VaultPolicy) {
        address[] memory assets = new address[](1);
        assets[0] = USDC;
        uint256[] memory maxBps = new uint256[](1);
        maxBps[0] = 10_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = USDC;

        return new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(mockVault),
                roles: address(roles),
                maxDrawdownBps: 10_000,
                maxTradesPerDay: 1000,
                minStableAllocationBps: 0,
                oracleMaxStalenessSeconds: 3600,
                oracleMaxDeviationBps: 500,
                maxDrawdownSpeedBpsPerWindow: 10_000,
                drawdownSpeedWindowSeconds: 3600,
                assets: assets,
                maxAllocationBps: maxBps,
                stableAssets: stableAssets,
                minLpTickRangeWidth: MIN_LP_TICK_RANGE_WIDTH,
                maxLpPositionValueLossBps: MAX_LP_POSITION_VALUE_LOSS_BPS,
                maxLpOutOfRangeSeconds: MAX_LP_OUT_OF_RANGE_SECONDS,
                minLpPoolLiquidityRatioBps: MIN_LP_POOL_LIQUIDITY_RATIO_BPS,
                maxLpAllocationBps: MAX_LP_ALLOCATION_BPS,
                lendingReportStaleAfterSeconds: 0,
                lendingReportMaxDeviationBps: 0,
                lendingPositionForceUnwindSeconds: 0,
                maxLendingAllocationBps: 0,
                performanceFeeBps: 0
            })
        );
    }

    function _decision(IVaultPolicy.DecisionAction action, uint256 lpTokenId, int24 tickLower, int24 tickUpper)
        internal
        pure
        returns (IVaultPolicy.Decision memory)
    {
        return IVaultPolicy.Decision({
            action: action,
            asset: address(0),
            amount: 0,
            targetAllocations: new IVaultPolicy.TargetAllocation[](0),
            lpPool: address(0),
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            lpTokenId: lpTokenId,
            liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
        });
    }

    function _healthyPosition(uint256 tokenId) internal pure returns (IVaultPolicy.LpPositionHolding memory) {
        return IVaultPolicy.LpPositionHolding({
            tokenId: tokenId,
            pool: address(0x4444),
            currentAllocationBps: 1000,
            openValueUSDC: 1000e6,
            currentValueUSDC: 1000e6,
            inRange: true,
            outOfRangeSince: 0,
            poolLiquidityAtOpen: 1_000_000,
            currentPoolLiquidity: 1_000_000
        });
    }

    /// @dev No LP_OPEN proposing a range narrower than the immutable
    /// minLpTickRangeWidth ever passes.
    function testFuzz_neverPassesWhenLpRangeTooNarrow(int24 width) public {
        width = int24(bound(int256(width), 0, int256(MIN_LP_TICK_RANGE_WIDTH) - 1));
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: new IVaultPolicy.LpPositionHolding[](0),
        currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_OPEN, 0, 0, width), state);
        assertFalse(passed, "an LP_OPEN proposing a range narrower than the immutable minimum must never pass");
    }

    /// @dev No decision ever passes while a held position's value has
    /// fallen below its immutable maxLpPositionValueLossBps floor, unless
    /// that exact position is the target of LP_DECREASE/LP_COLLECT/LP_CLOSE
    /// (tested separately below).
    function testFuzz_neverPassesWhenLpPositionValueLossExceeded(uint256 lossBps) public {
        lossBps = bound(lossBps, MAX_LP_POSITION_VALUE_LOSS_BPS + 1, 10_000);
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](1);
        positions[0] = _healthyPosition(1);
        positions[0].currentValueUSDC = (positions[0].openValueUSDC * (10_000 - lossBps)) / 10_000;

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        // HOLD, not one of the reduce/close actions, so no exemption applies.
        (bool passed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.HOLD, 0, 0, 0), state);
        assertFalse(passed, "a decision must never pass while a held LP position's value-loss exceeds the immutable limit");
    }

    /// @dev No decision ever passes while a held position has been out of
    /// its own tick range longer than the immutable maxLpOutOfRangeSeconds.
    function testFuzz_neverPassesWhenLpOutOfRangeTooLong(uint256 extraSeconds) public {
        // Upper bound stops one second short of driving outOfRangeSince to
        // exactly 0: that value is the contract's own sentinel for
        // "currently in range or never observed out of range" (see
        // LpPositionHolding's doc comment), not a real epoch-zero
        // timestamp, so it would wrongly skip the check rather than
        // trigger it.
        extraSeconds = bound(extraSeconds, 1, 365 days - MAX_LP_OUT_OF_RANGE_SECONDS - 1);
        vm.warp(365 days);
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](1);
        positions[0] = _healthyPosition(1);
        positions[0].inRange = false;
        positions[0].outOfRangeSince = block.timestamp - MAX_LP_OUT_OF_RANGE_SECONDS - extraSeconds;

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.HOLD, 0, 0, 0), state);
        assertFalse(passed, "a decision must never pass while a held LP position has been out of range longer than the immutable limit");
    }

    /// @dev No decision ever passes while a held position's own pool
    /// liquidity has dropped below the immutable minLpPoolLiquidityRatioBps
    /// floor since the position was opened.
    function testFuzz_neverPassesWhenLpPoolLiquidityDropped(uint256 ratioBps) public {
        ratioBps = bound(ratioBps, 0, MIN_LP_POOL_LIQUIDITY_RATIO_BPS - 1);
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](1);
        positions[0] = _healthyPosition(1);
        positions[0].poolLiquidityAtOpen = 1_000_000;
        positions[0].currentPoolLiquidity = uint128((uint256(1_000_000) * ratioBps) / 10_000);

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.HOLD, 0, 0, 0), state);
        assertFalse(passed, "a decision must never pass while a held LP position's pool liquidity has dropped below the immutable ratio floor");
    }

    /// @dev No decision ever passes while total value locked across every
    /// held LP position exceeds the immutable maxLpAllocationBps cap.
    function testFuzz_neverPassesWhenLpAllocationExceedsCap(uint16 lpBps) public {
        lpBps = uint16(bound(uint256(lpBps), MAX_LP_ALLOCATION_BPS + 1, 10_000));
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](1);
        positions[0] = _healthyPosition(1);
        positions[0].currentAllocationBps = lpBps;

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.HOLD, 0, 0, 0), state);
        assertFalse(passed, "a decision must never pass while total LP allocation exceeds the immutable cap");
    }

    /// @dev The real regression test for the 2026-07-14 fix: a damaged
    /// position (value-loss exceeded here) must still allow LP_DECREASE/
    /// LP_COLLECT/LP_CLOSE targeting that exact tokenId, since those are
    /// the intended, targeted remediation actions, not a bypass. Before
    /// this fix, the loop had no such exemption, so the very action meant
    /// to reduce/close a breached position was rejected by the breach
    /// itself.
    function test_breachedPosition_stillAllowsDecreaseCollectAndCloseOfThatExactPosition() public {
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](1);
        positions[0] = _healthyPosition(1);
        positions[0].currentValueUSDC = 0; // maximally breached

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool decreasePassed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_DECREASE, 1, 0, 0), state);
        assertTrue(decreasePassed, "LP_DECREASE targeting the exact breached position must be allowed through");

        (bool collectPassed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_COLLECT, 1, 0, 0), state);
        assertTrue(collectPassed, "LP_COLLECT targeting the exact breached position must be allowed through");

        (bool closePassed,) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_CLOSE, 1, 0, 0), state);
        assertTrue(closePassed, "LP_CLOSE targeting the exact breached position must be allowed through");
    }

    /// @dev The other half of the same fix: the exemption is per-tokenId,
    /// not a blanket pass for the whole call. A SEPARATE, undamaged-in-name
    /// but actually-also-breached position must still block the decision,
    /// proving the exemption never leaks beyond the one position actually
    /// named by decision.lpTokenId.
    function test_breachedPosition_exemptionNeverExtendsToADifferentPosition() public {
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](2);
        positions[0] = _healthyPosition(1); // the one LP_DECREASE will target
        positions[0].currentValueUSDC = 0; // breached
        positions[1] = _healthyPosition(2); // a different position, not targeted
        positions[1].currentValueUSDC = 0; // also breached

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed, bytes32[] memory codes) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_DECREASE, 1, 0, 0), state);
        assertFalse(passed, "a different, non-targeted breached position must still block the decision");
        bool sawValueLoss;
        for (uint256 i = 0; i < codes.length; i++) {
            if (codes[i] == lpPolicy.VIOLATION_LP_POSITION_VALUE_LOSS_EXCEEDED()) sawValueLoss = true;
        }
        assertTrue(sawValueLoss, "the non-targeted position's breach must still be reported");
    }

    /// @dev And a plain sanity check the other direction: with only healthy
    /// positions present, a normal reduce/close decision passes cleanly,
    /// the exemption logic itself introduces no false negatives.
    function test_healthyPositions_lpDecreasePassesCleanly() public {
        VaultPolicy lpPolicy = _lpPolicy();

        IVaultPolicy.LpPositionHolding[] memory positions = new IVaultPolicy.LpPositionHolding[](2);
        positions[0] = _healthyPosition(1);
        positions[1] = _healthyPosition(2);

        IVaultPolicy.VaultState memory state = IVaultPolicy.VaultState({
            currentDrawdownBps: 0,
            drawdownBpsAtWindowStart: 0,
            tradesToday: 0,
            currentHoldings: new IVaultPolicy.AssetHolding[](0),
            prices: new IVaultPolicy.AssetPrice[](0),
            currentLpPositions: positions,
            currentLendingPositions: new IVaultPolicy.LendingPositionHolding[](0)
        });

        (bool passed, bytes32[] memory codes) = lpPolicy.validateDecision(_decision(IVaultPolicy.DecisionAction.LP_DECREASE, 1, 0, 0), state);
        assertTrue(passed);
        assertEq(codes.length, 0);
    }
}
