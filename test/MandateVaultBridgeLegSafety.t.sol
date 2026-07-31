// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {LendingPositionRegistry} from "../contracts/LendingPositionRegistry.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

/// @notice Answers a specific correctness question raised after the whole
/// existing test suite was updated to pass an all-zero BridgeLeg (and
/// Decision.chainId/lendingPositionId) for v1/v2/v3-shaped decisions: is
/// "empty" actually safe by construction, or only true because those tests
/// happen to compile and pass? This file proves it empirically against a
/// v4-configured vault that holds a REAL, non-zero-id lending position --
/// the one scenario where an accidental zero/real collision could actually
/// matter, since v1/v2/v3 instances never hold any lending position at all
/// (currentLendingPositions is structurally always empty for them, see
/// MandateVault._buildState).
///
/// The safety argument this proves, not just asserts:
/// 1. MandateVault.executeDecision's bridge gate
///    (`bridgeLeg.chainId != 0 || bridgeLeg.positionId != 0`) reads the
///    BridgeLeg parameter's OWN fields, never Decision.chainId/
///    lendingPositionId -- an all-zero BridgeLeg means _executeBridgeLeg
///    is never invoked at all, for ANY decision.action, not merely
///    rejected once invoked.
/// 2. LendingPositionRegistry.nextPositionId starts at 1
///    (see LendingPositionRegistry.sol), so a real position's id is never
///    0 -- decision.lendingPositionId == 0 (the empty convention) can
///    never alias a real position even in VaultPolicy's own
///    isTargetOfWithdraw check, which is the only place that field is
///    ever compared against a real position id.
contract MandateVaultBridgeLegSafetyTest is Test {
    MandateRoles internal roles;
    MockERC20 internal usdc;
    MockSwapRouter internal router;
    MandateVault internal vault;
    VaultPolicy internal policy;
    LendingPositionRegistry internal registry;

    uint256 internal constant REAL_CHAIN_ID = 421614; // Arbitrum Sepolia
    uint256 internal realPositionId;

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.KEEPER_ROLE(), address(this));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(this));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        router = new MockSwapRouter();

        address[] memory otherAssets = new address[](0);
        vault = new MandateVault(
            IERC20(address(usdc)), address(roles), address(router), "Mandate v4 Vault", "mUSDCv4", otherAssets, address(this), address(0)
        );

        address[] memory assets = new address[](1);
        assets[0] = address(usdc);
        uint256[] memory maxBps = new uint256[](1);
        maxBps[0] = 10_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = address(usdc);

        policy = new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(vault),
                roles: address(roles),
                maxDrawdownBps: 1000,
                maxTradesPerDay: 5,
                minStableAllocationBps: 0,
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
                // Real, non-zero v4 limits -- a zeroed policy would make
                // this test meaningless (see this project's own convention
                // of never testing a real mechanism against harmless
                // placeholder zeros).
                lendingReportStaleAfterSeconds: 86_400,
                lendingReportMaxDeviationBps: 200,
                lendingPositionForceUnwindSeconds: 604_800,
                maxLendingAllocationBps: 10_000,
                performanceFeeBps: 0
            })
        );
        vault.setPolicy(address(policy));

        registry = new LendingPositionRegistry(address(vault), address(policy), address(roles));
        vault.setLendingRegistry(address(registry));

        // Seed the vault with real, ledgered USDC (a real deposit), so
        // totalAssets() reflects a real base to compare the lending
        // position's contribution against.
        usdc.mint(address(this), 10_000e18);
        usdc.approve(address(vault), 10_000e18);
        vault.deposit(10_000e18, address(this));

        // Simulate a real BRIDGE_DEPOSIT having already happened: the real
        // executeDecision path calls this exact function from inside
        // _bridgeDeposit after a real depositForBurn call, see
        // MandateVault.sol. Pranking as the vault reproduces that call
        // without needing a real CCTP TokenMessenger for this test, which
        // is only about post-open dispatch safety, not the bridge leg
        // itself (already covered separately).
        vm.prank(address(vault));
        realPositionId = registry.recordNewPosition(REAL_CHAIN_ID, 1_000e18);
    }

    /// @dev The registry's own id-assignment invariant this whole safety
    /// argument depends on: real positions are never id 0, so the "empty"
    /// convention's lendingPositionId: 0 can never accidentally target one.
    function test_realPositionIdIsNeverZero() public view {
        assertEq(realPositionId, 1, "sanity: first real position must be id 1, matching nextPositionId starting at 1");
        assertGt(realPositionId, 0, "a real position id must never be 0, the sentinel this project's empty convention relies on");
    }

    /// @dev The core proof: executing a HOLD decision with a fully empty
    /// BridgeLeg (and Decision.chainId/lendingPositionId left at 0, same
    /// convention every v1/v2/v3 test in this suite already uses) against
    /// a vault that DOES hold a real, open lending position must never
    /// touch that position in any way. Not inferred from the tests
    /// compiling -- checked field-by-field, before and after.
    function test_emptyBridgeLegNeverAffectsARealOpenLendingPosition() public {
        (uint256 chainIdBefore, LendingPositionRegistry.LendingPositionStatus statusBefore, uint256 principalBefore, uint256 valueBefore, uint256 reportedAtBefore) = registry.positions(realPositionId);

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);
        IVaultPolicy.Decision memory decision = IVaultPolicy.Decision({
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
            // The exact "empty" convention every pre-existing v1/v2/v3 test
            // in this suite now uses.
            chainId: 0,
            lendingPositionId: 0
        });
        MandateVault.LpLeg memory emptyLpLeg = MandateVault.LpLeg({
            pool: address(0),
            fee: 0,
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            tokenId: 0,
            liquidity: 0,
            deadline: 0
        });
        MandateVault.BridgeLeg memory emptyBridgeLeg =
            MandateVault.BridgeLeg({chainId: 0, amount: 0, positionId: 0, cctpDestinationDomain: 0, maxFee: 0});

        uint256 navBefore = vault.totalAssets();
        bool ok = vault.executeDecision(decision, prices, swaps, emptyLpLeg, emptyBridgeLeg);
        assertTrue(ok, "a HOLD decision with an all-zero BridgeLeg must succeed exactly like it does for v1/v2/v3");

        (uint256 chainIdAfter, LendingPositionRegistry.LendingPositionStatus statusAfter, uint256 principalAfter, uint256 valueAfter, uint256 reportedAtAfter) = registry.positions(realPositionId);

        assertEq(chainIdAfter, chainIdBefore, "the real position's chainId must be completely untouched");
        assertEq(uint8(statusAfter), uint8(statusBefore), "the real position's status must not transition, e.g. never WITHDRAWAL_PENDING, from an empty BridgeLeg");
        assertEq(principalAfter, principalBefore, "the real position's principal must be completely untouched");
        assertEq(valueAfter, valueBefore, "the real position's reported value must be completely untouched");
        assertEq(reportedAtAfter, reportedAtBefore, "the real position's lastReportedAt must be completely untouched");
        assertEq(vault.totalAssets(), navBefore, "NAV must be unaffected by a HOLD call with an empty BridgeLeg");
    }

    /// @dev Same proof, for REBALANCE -- a different, more commonly-used
    /// v1/v2/v3 action, confirming this isn't specific to HOLD.
    function test_emptyBridgeLegNeverAffectsARealOpenLendingPosition_onRebalance() public {
        (,, uint256 principalBefore, uint256 valueBefore,) = registry.positions(realPositionId);

        IVaultPolicy.TargetAllocation[] memory targets = new IVaultPolicy.TargetAllocation[](1);
        targets[0] = IVaultPolicy.TargetAllocation({asset: address(usdc), targetWeightBps: 10_000});
        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);
        IVaultPolicy.Decision memory decision = IVaultPolicy.Decision({
            action: IVaultPolicy.DecisionAction.REBALANCE,
            asset: address(0),
            amount: 0,
            targetAllocations: targets,
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
        });
        MandateVault.LpLeg memory emptyLpLeg = MandateVault.LpLeg({
            pool: address(0),
            fee: 0,
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            tokenId: 0,
            liquidity: 0,
            deadline: 0
        });
        MandateVault.BridgeLeg memory emptyBridgeLeg =
            MandateVault.BridgeLeg({chainId: 0, amount: 0, positionId: 0, cctpDestinationDomain: 0, maxFee: 0});

        vault.executeDecision(decision, prices, swaps, emptyLpLeg, emptyBridgeLeg);

        (,, uint256 principalAfter, uint256 valueAfter,) = registry.positions(realPositionId);
        assertEq(principalAfter, principalBefore, "REBALANCE with an empty BridgeLeg must never touch a real lending position's principal");
        assertEq(valueAfter, valueBefore, "REBALANCE with an empty BridgeLeg must never touch a real lending position's value");
    }
}
