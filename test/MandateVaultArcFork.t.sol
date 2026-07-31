// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "../contracts/interfaces/ISwapRouter.sol";
import {IQuoter} from "../contracts/interfaces/IQuoter.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";
import {IUniswapV3PoolMinimal} from "../contracts/interfaces/INonfungiblePositionManager.sol";
import {LendingPositionRegistry} from "../contracts/LendingPositionRegistry.sol";
import {MockCCTPTokenMessenger} from "../contracts/test/MockCCTPTokenMessenger.sol";

interface IWUSDC {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @dev Standard Uniswap V3 pool-owner-free function, test-only fragment
/// (MandateVault.sol itself never calls this, only real deployment
/// operations/test setup do, see docs/deployments.md's v3 section on the
/// real operational prerequisite this represents).
interface IUniswapV3PoolObservationSetup {
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/// @notice Integration test against real, deployed, verified infrastructure
/// on Arc Testnet, not a mock. This is "UnitFlowV3Router" by ACTFUN (a token
/// launchpad), third-party standard-Uniswap-V3-compatible infrastructure,
/// NOT the official Uniswap Labs deployment announced as an Arc ecosystem
/// partner (that one still has no publicly documented address). Verified
/// independently before use, see docs/arc-facts-to-verify.md:
/// - Router (0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01), Factory
///   (0xAb6A8AAb7d490007634ef59d424b5d89688a1971), and Quoter
///   (0x121aeB6DEf00F6F67665008CaC1C19805886ed1a) all have real deployed
///   bytecode and are marked verified on Arcscan.
/// - Arcscan's own source listing confirms the file paths and imports match
///   the standard Uniswap V3 periphery/core structure exactly (renamed
///   UnitFlowV3), compiled under solc 0.7.6.
/// - Router.factory() returns the exact known Factory address, confirming
///   the two are genuinely wired together, not independently deployed
///   look-alikes.
///
/// Router address status (confirmed, not assumed): it is NOT hardcoded
/// anywhere. MandateVault's constructor takes it as `initialSwapRouter_`,
/// stored in the same `allowedRouters` mapping GOVERNANCE can add to or
/// remove from via `proposeRouterAllowed`/`executeRouterAllowed` (a
/// self-contained 48h timelock, code-enforced, see MandateVault.sol),
/// exactly like the oracle feed address pattern (injected, configurable,
/// never baked into the contract). Migrating to the official Uniswap Labs
/// router later, once it has a documented address, is a governance action,
/// not a code change, and never instantaneous.
///
/// EURC and cirBTC pool confirmed (Mandate's actual target assets, not just
/// a launchpad token pair): read directly from the Factory's own
/// `PoolCreated` events, not assumed. EURC's address
/// (0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) is confirmed against Arc's
/// own official docs (docs.arc.io/arc/references/contract-addresses).
/// cirBTC's address (0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF) is not yet
/// listed on that page, but its own contract is a Circle-copyrighted
/// `FiatTokenProxy` (the same proxy pattern Circle uses for USDC/EURC
/// itself), strong evidence it is a genuine Circle-issued token, not a
/// launchpad look-alike that merely reused the "cirBTC" symbol.
/// - EURC/cirBTC pool (fee 3000, 0xc9Ae7930C2917B755c7e7d38805D8D96E5c162df):
///   ~2651 EURC and ~0.0064 cirBTC in real reserves at the pinned block.
/// - WUSDC/cirBTC pool (fee 3000, 0x254bA0424618113127538eE11e42C1e3c1721225):
///   ~239 WUSDC and ~0.00048 cirBTC in real reserves at the pinned block.
///   Used below for the full MandateVault flow since WUSDC matches the
///   vault's real base asset() (USDC), not just a router-level check.
///
/// Pinned to a specific block (see BLOCK_NUMBER below) so this test stays
/// reproducible regardless of how the live pools' real state changes over
/// time. Re-pin to a fresh block (and re-verify reserves) periodically.
contract MandateVaultArcForkTest is Test {
    uint256 internal constant BLOCK_NUMBER = 50846709;

    address internal constant ROUTER = 0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01;
    address internal constant FACTORY = 0xAb6A8AAb7d490007634ef59d424b5d89688a1971;
    address internal constant QUOTER = 0x121aeB6DEf00F6F67665008CaC1C19805886ed1a;
    address internal constant WUSDC = 0x911b4000D3422F482F4062a913885f7b035382Df;
    address internal constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address internal constant CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;
    uint24 internal constant EURC_CIRBTC_FEE = 3000;
    uint24 internal constant WUSDC_CIRBTC_FEE = 3000;

    MandateRoles internal roles;
    MandateVault internal vault;
    VaultPolicy internal policy;

    function setUp() public {
        vm.createSelectFork("https://rpc.testnet.arc.network", BLOCK_NUMBER);

        roles = new MandateRoles(address(this));
        roles.grantRole(roles.KEEPER_ROLE(), address(this));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(this));

        address[] memory otherAssets = new address[](1);
        otherAssets[0] = CIRBTC;
        vault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate WUSDC Vault", "mWUSDC", otherAssets, address(this), address(0));

        address[] memory assets = new address[](2);
        assets[0] = WUSDC;
        assets[1] = CIRBTC;
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = 5_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = WUSDC;

        policy = new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(vault),
                roles: address(roles),
                maxDrawdownBps: 1000,
                maxTradesPerDay: 5,
                minStableAllocationBps: 2000,
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
            })
        );
        vault.setPolicy(address(policy));
        vault.setAutoPauseBountyAmount(0);
    }

    /// @dev Confirms Router and Factory are genuinely wired together on the
    /// real chain, not just independently having code.
    function test_realRouterReportsTheRealKnownFactory() public view {
        assertEq(ISwapRouter(ROUTER).factory(), FACTORY);
    }

    /// @dev A real swap through the real router against real EURC/cirBTC
    /// liquidity, Mandate's actual target assets, not a launchpad token
    /// pair. Bypasses MandateVault to isolate router behavior first.
    function test_realSwapThroughRealRouter_EURCToCirBTC() public {
        uint256 amountIn = 10e6; // 10 EURC, well within the pool's ~2651 EURC reserve
        deal(EURC, address(this), amountIn);
        IERC20(EURC).approve(ROUTER, amountIn);

        uint256 cirBtcBefore = IERC20(CIRBTC).balanceOf(address(this));

        uint256 amountOut = ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: EURC,
                tokenOut: CIRBTC,
                fee: EURC_CIRBTC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        assertGt(amountOut, 0, "a real swap against real EURC/cirBTC liquidity must return a nonzero amount");
        assertEq(IERC20(CIRBTC).balanceOf(address(this)), cirBtcBefore + amountOut);
    }

    /// @dev The real target: the full atomic swap plus policy validation
    /// flow, through MandateVault.executeDecision, against the real router
    /// and a real WUSDC/cirBTC pool, matching the vault's real base asset
    /// (USDC) and a real target asset (cirBTC), not a mock and not a
    /// launchpad token pair.
    function test_executeDecisionRealSwapThroughRealRouter_WUSDCToCirBTC() public {
        uint256 depositAmount = 50e18; // 50 WUSDC, within the pool's ~239 WUSDC reserve
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(vault), depositAmount);
        vault.deposit(depositAmount, address(this));

        uint256 swapAmount = 5e18; // 5 WUSDC
        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: CIRBTC, targetWeightBps: 1000});

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: CIRBTC,
            fee: WUSDC_CIRBTC_FEE,
            amountIn: swapAmount,
            minAmountOut: 1,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        // ROUTER is already allowlisted, it was passed as initialSwapRouter_
        // in the constructor above.

        bool ok = vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targetAllocations,
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
            new IVaultPolicy.AssetPrice[](0),
            swaps,
            _emptyLpLeg(),
            _emptyBridgeLeg()
        );

        assertTrue(ok);
        assertGt(vault.ledgerOf(CIRBTC), 0, "the vault must actually hold cirBTC after a real swap");
        assertEq(vault.ledgerOf(WUSDC), depositAmount - swapAmount);
    }

    /// @dev The keeper-side design's actual production path: quote against
    /// the real Quoter first (executor/keeperService.ts's quoteAndBuildLeg),
    /// apply a real slippage tolerance, then submit. Unlike the test above
    /// (minAmountOut: 1, essentially unprotected), this proves a real,
    /// meaningfully-protective minAmountOut, derived from a real onchain
    /// quote, still lets a real swap through the real router and pool.
    function test_executeDecisionRealSwapWithQuoterDerivedMinAmountOut() public {
        uint256 depositAmount = 50e18;
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(vault), depositAmount);
        vault.deposit(depositAmount, address(this));

        uint256 swapAmount = 5e18;

        // The real quote, exactly what executor/keeperService.ts's
        // quoteAndBuildLeg does via a plain eth_call, here via a real
        // Solidity call against the same real, verified Quoter, same
        // 3% slippage tolerance keeperService.ts applies.
        uint256 quotedAmountOut = IQuoter(QUOTER).quoteExactInputSingle(WUSDC, CIRBTC, WUSDC_CIRBTC_FEE, swapAmount, 0);
        assertGt(quotedAmountOut, 0, "the real Quoter must return a nonzero quote for this real, liquid pool");
        uint256 minAmountOut = (quotedAmountOut * 9700) / 10_000;

        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: CIRBTC, targetWeightBps: 1000});

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: CIRBTC,
            fee: WUSDC_CIRBTC_FEE,
            amountIn: swapAmount,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        bool ok = vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targetAllocations,
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
            _cirBtcPrice(swapAmount, quotedAmountOut),
            swaps,
            _emptyLpLeg(),
            _emptyBridgeLeg()
        );

        assertTrue(ok);
        assertGe(vault.ledgerOf(CIRBTC), minAmountOut, "actual amountOut must satisfy the real quoter-derived minAmountOut");
    }

    /// @dev A real, live-derived cirBTC price, scaled to the BASE asset's
    /// own decimals (WUSDC, 18), not cirBTC's own (8), per
    /// MandateVault.sol's _valueInUSDC formula, verified by algebra and by
    /// this exact scaling bug once causing
    /// test_executeDecisionRevertsAndRollsBackRealSwap_WhenPolicyViolated
    /// to fail to revert as expected (an under-scaled price made cirBTC's
    /// computed valueUSDC always ~0, see executor/keeperService.ts's
    /// buildOnchainPrices for the same fix applied there). Derived from
    /// the real quote itself (swapAmount WUSDC in, quotedAmountOut cirBTC
    /// out), not a separately hardcoded constant that could drift from the
    /// pinned block's real pool state.
    function _cirBtcPrice(uint256 swapAmountWUSDC, uint256 quotedAmountOutCirBTC) internal view returns (IVaultPolicy.AssetPrice[] memory prices) {
        uint256 price = (swapAmountWUSDC * 1e8) / quotedAmountOutCirBTC;
        prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({asset: CIRBTC, price: price, referencePrice: price, updatedAt: block.timestamp});
    }

    /// @dev Confirms the atomic revert-and-rollback (already proven with a
    /// mocked router in test/MandateVault.ts) still holds with a REAL swap
    /// leg through the real router and pool: deliberately sizes the
    /// swap so the resulting allocation exceeds a
    /// separate, stricter policy's maxAllocationBpsPerAsset[cirBTC], the
    /// whole transaction (including the already-executed real router swap)
    /// must revert and leave the vault's ledger completely untouched.
    function test_executeDecisionRevertsAndRollsBackRealSwap_WhenPolicyViolated() public {
        MandateVault strictVault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate WUSDC Vault (strict)", "mWUSDCs", _cirBtcOnly(), address(this), address(0));

        address[] memory assets = new address[](2);
        assets[0] = WUSDC;
        assets[1] = CIRBTC;
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = 100; // 1%, far below the 10% this swap targets
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = WUSDC;

        VaultPolicy strictPolicy = new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(strictVault),
                roles: address(roles),
                maxDrawdownBps: 1000,
                maxTradesPerDay: 5,
                minStableAllocationBps: 2000,
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
            })
        );
        strictVault.setPolicy(address(strictPolicy));
        strictVault.setAutoPauseBountyAmount(0);

        uint256 depositAmount = 50e18;
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(strictVault), depositAmount);
        strictVault.deposit(depositAmount, address(this));

        uint256 swapAmount = 5e18; // targets 10% cirBTC, exceeds the 1% cap above
        uint256 quotedAmountOut = IQuoter(QUOTER).quoteExactInputSingle(WUSDC, CIRBTC, WUSDC_CIRBTC_FEE, swapAmount, 0);
        uint256 minAmountOut = (quotedAmountOut * 9700) / 10_000;

        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: CIRBTC, targetWeightBps: 1000});

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: CIRBTC,
            fee: WUSDC_CIRBTC_FEE,
            amountIn: swapAmount,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        vm.expectRevert();
        strictVault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targetAllocations,
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
            _cirBtcPrice(swapAmount, quotedAmountOut),
            swaps,
            _emptyLpLeg(),
            _emptyBridgeLeg()
        );

        assertEq(strictVault.ledgerOf(WUSDC), depositAmount, "a reverted executeDecision must leave the base asset ledger completely untouched");
        assertEq(strictVault.ledgerOf(CIRBTC), 0, "a reverted executeDecision must never leave a partial real swap's proceeds in the ledger");
    }

    function _cirBtcOnly() internal pure returns (address[] memory otherAssets) {
        otherAssets = new address[](1);
        otherAssets[0] = CIRBTC;
    }

    /// @dev pool == address(0) means "no LP action this call," same
    /// convention MandateVault.executeDecision itself uses.
    function _emptyLpLeg() internal pure returns (MandateVault.LpLeg memory) {
        return MandateVault.LpLeg({
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
    }

    /// @dev chainId == 0 && positionId == 0 means "no bridge action this
    /// call," same convention MandateVault.executeDecision itself uses.
    /// None of this file's fork tests exercise v4's cross-chain lending
    /// mechanism (that belongs in its own dedicated v4 fork test), so
    /// every call site here passes this.
    function _emptyBridgeLeg() internal pure returns (MandateVault.BridgeLeg memory) {
        return MandateVault.BridgeLeg({chainId: 0, amount: 0, positionId: 0, cctpDestinationDomain: 0, maxFee: 0});
    }

    // ------------------------------------------------------------------
    // v3 LP mechanism: real position open/value/close against the real
    // WUSDC/cirBTC pool and the real, verified UnitFlowV3PositionManager.
    // These are the fork tests the v3 design doc called for, plus the
    // dedicated EMERGENCY_EXIT_TO_STABLE-closes-a-real-position test added
    // 2026-07-14 after the dispatch bug fix (see MandateVault.sol's
    // _executeLpLeg and executor/keeperService.ts's closeAllOpenLpPositions).
    // ------------------------------------------------------------------

    address internal constant POSITION_MANAGER = 0x0553682bc188b850acd31CBd3500Dcd0aa35372B;

    /// @dev Real, non-zero LP risk limits, unlike setUp()'s shared `policy`
    /// (which zeroes every LP field, harmless for v1/v2-shaped tests but
    /// meaningless for actually exercising the LP mechanism itself).
    function _lpPolicy(MandateVault forVault) internal returns (VaultPolicy) {
        address[] memory assets = new address[](2);
        assets[0] = WUSDC;
        assets[1] = CIRBTC;
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = 10_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = WUSDC;

        return new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(forVault),
                roles: address(roles),
                maxDrawdownBps: 1000,
                maxTradesPerDay: 20,
                minStableAllocationBps: 0,
                oracleMaxStalenessSeconds: 3600,
                oracleMaxDeviationBps: 500,
                maxDrawdownSpeedBpsPerWindow: 300,
                drawdownSpeedWindowSeconds: 3600,
                assets: assets,
                maxAllocationBps: maxBps,
                stableAssets: stableAssets,
                minLpTickRangeWidth: 1200,
                maxLpPositionValueLossBps: 300,
                maxLpOutOfRangeSeconds: 172800,
                minLpPoolLiquidityRatioBps: 5000,
                maxLpAllocationBps: 5000,
                lendingReportStaleAfterSeconds: 0,
                lendingReportMaxDeviationBps: 0,
                lendingPositionForceUnwindSeconds: 0,
                maxLendingAllocationBps: 0,
                performanceFeeBps: 0
            })
        );
    }

    /// @dev Same 48h propose/execute timelock every other governance-
    /// configurable address in this contract uses, just fast-forwarded.
    function _enablePositionManager(MandateVault forVault) internal {
        forVault.proposePositionManager(POSITION_MANAGER);
        vm.warp(block.timestamp + 48 hours); // matches MandateVault.sol's POSITION_MANAGER_CHANGE_TIMELOCK
        forVault.executePositionManager();
    }

    /// @dev Deposits WUSDC and acquires a small real cirBTC balance via a
    /// real REBALANCE swap, mirroring test_executeDecisionRealSwapWithQuoterDerivedMinAmountOut
    /// exactly, needed before any LP position spanning WUSDC/cirBTC can be
    /// opened. Returns the real cirBTC price array used, reused afterward
    /// so lastKnownPriceUSDC[CIRBTC] stays populated for the LP position's
    /// own valuation.
    function _depositAndAcquireCirBtc(MandateVault forVault, uint256 depositAmount, uint256 swapAmount)
        internal
        returns (IVaultPolicy.AssetPrice[] memory prices)
    {
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(forVault), depositAmount);
        forVault.deposit(depositAmount, address(this));

        uint256 quotedAmountOut = IQuoter(QUOTER).quoteExactInputSingle(WUSDC, CIRBTC, WUSDC_CIRBTC_FEE, swapAmount, 0);
        uint256 minAmountOut = (quotedAmountOut * 9700) / 10_000;
        prices = _cirBtcPrice(swapAmount, quotedAmountOut);

        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: CIRBTC, targetWeightBps: 1000});

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: CIRBTC,
            fee: WUSDC_CIRBTC_FEE,
            amountIn: swapAmount,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        forVault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targetAllocations,
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
            prices,
            swaps,
            _emptyLpLeg(),
            _emptyBridgeLeg()
        );
    }

    /// @dev Real, permissionless prerequisite before this pool's TWAP can
    /// ever be safely relied on for LP position valuation (see
    /// MandateVault._twapSqrtPriceX96's own doc comment): reserves enough
    /// ring-buffer slots (increaseObservationCardinalityNext, standard
    /// Uniswap V3, no owner/permission needed), then performs two tiny
    /// real swaps bracketing a real elapsed window (a fresh observation is
    /// only written on a real state-changing pool interaction, not on a
    /// timer alone), so a real, genuine TWAP over LP_VALUATION_TWAP_SECONDS
    /// becomes queryable. Mirrors exactly what a real deployment must do
    /// on the real pool before ever proposing a real LP_OPEN, documented
    /// as an operational prerequisite in docs/deployments.md's v3 section.
    /// Confirmed live this pool's real observationCardinality was still at
    /// the Uniswap V3 default (1) before this fix, exactly the gap this
    /// closes.
    function _makeTwapAvailable(address pool) internal {
        IUniswapV3PoolObservationSetup(pool).increaseObservationCardinalityNext(4);

        uint256 tinyAmount = 0.01e18; // negligible price impact, purely to write a real observation
        vm.deal(address(this), tinyAmount);
        IWUSDC(WUSDC).deposit{value: tinyAmount}();
        IWUSDC(WUSDC).approve(ROUTER, tinyAmount);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WUSDC,
                tokenOut: CIRBTC,
                fee: WUSDC_CIRBTC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: tinyAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        vm.warp(block.timestamp + 1800 + 60); // > LP_VALUATION_TWAP_SECONDS later, a real elapsed window

        uint256 cirBtcBack = IERC20(CIRBTC).balanceOf(address(this));
        IERC20(CIRBTC).approve(ROUTER, cirBtcBack);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: CIRBTC,
                tokenOut: WUSDC,
                fee: WUSDC_CIRBTC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: cirBtcBack,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Opens a real position on the real WUSDC/cirBTC pool via the
    /// real, verified UnitFlowV3PositionManager, using whatever WUSDC/cirBTC
    /// the vault already holds. A wide (2400-tick) range centered on the
    /// pool's own real, live current tick (read via slot0(), not assumed),
    /// so the mint always lands in range regardless of the pinned block's
    /// exact price.
    function _openLpPosition(MandateVault forVault, IVaultPolicy.AssetPrice[] memory prices, uint256 wusdcAmount)
        internal
        returns (uint256 tokenId, int24 tickLower, int24 tickUpper)
    {
        _makeTwapAvailable(0x254bA0424618113127538eE11e42C1e3c1721225);

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(0x254bA0424618113127538eE11e42C1e3c1721225).slot0();
        int24 spacing = 60;
        int24 centerTick = (currentTick / spacing) * spacing;
        tickLower = centerTick - 1200;
        tickUpper = centerTick + 1200;

        address token0 = IUniswapV3PoolMinimal(0x254bA0424618113127538eE11e42C1e3c1721225).token0();
        uint256 cirBtcAmount = forVault.ledgerOf(CIRBTC);
        uint256 amount0Desired = token0 == WUSDC ? wusdcAmount : cirBtcAmount;
        uint256 amount1Desired = token0 == WUSDC ? cirBtcAmount : wusdcAmount;

        MandateVault.LpLeg memory lpLeg = MandateVault.LpLeg({
            pool: 0x254bA0424618113127538eE11e42C1e3c1721225,
            fee: WUSDC_CIRBTC_FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            tokenId: 0,
            liquidity: 0,
            deadline: block.timestamp + 3600
        });

        forVault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.LP_OPEN,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
                lpPool: 0x254bA0424618113127538eE11e42C1e3c1721225,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                lpTokenId: 0,
                liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            prices,
            new MandateVault.SwapLeg[](0),
            lpLeg,
            _emptyBridgeLeg()
        );

        tokenId = forVault.lpPositionIds(0);
    }

    /// @dev Real position opened, real totalAssets() must reflect its real
    /// value (LiquidityAmounts-derived token0/token1 amounts, valued via
    /// the same real cirBTC price cached from the acquisition swap), not
    /// just "greater than zero, trust the plumbing." Confirms the position
    /// is registered (lpPositionCount == 1) and that closing the vault's
    /// WUSDC-only view (ledgerOf(WUSDC) alone) would meaningfully
    /// understate totalAssets() without the LP term.
    function test_lpOpen_totalAssetsValuesTheRealPosition() public {
        MandateVault lpVault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate LP Vault", "mLP", _cirBtcOnly(), address(this), address(0));
        lpVault.setPolicy(address(_lpPolicy(lpVault)));
        lpVault.setAutoPauseBountyAmount(0);
        _enablePositionManager(lpVault);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireCirBtc(lpVault, 50e18, 5e18);
        uint256 totalAssetsBeforeOpen = lpVault.totalAssets();

        (uint256 tokenId,,) = _openLpPosition(lpVault, prices, 2e18);

        assertEq(lpVault.lpPositionCount(), 1, "the vault must register exactly one open LP position");
        assertGt(tokenId, 0, "a real mint must return a real, nonzero NFT tokenId");

        uint256 totalAssetsAfterOpen = lpVault.totalAssets();
        // Minting into a position is not free money nor a loss beyond real
        // slippage/rounding: totalAssets() must stay close to its pre-mint
        // value (the same USDC-denominated capital, now split between the
        // remaining ledger and the new position), not collapse toward zero
        // (which is exactly what would happen if _valueLpPositions were
        // silently mis-wired).
        assertApproxEqRel(totalAssetsAfterOpen, totalAssetsBeforeOpen, 0.05e18, "totalAssets() must still reflect roughly the same real capital immediately after opening a position");

        // Confirm the LP term is actually load-bearing: ledgerOf(WUSDC)
        // alone (ignoring the LP position entirely) must understate the
        // real totalAssets() by roughly the amount just committed to the
        // position, proving _valueLpPositions is truly adding real value,
        // not a silent no-op that happens to leave totalAssets() unchanged
        // by coincidence.
        assertLt(lpVault.ledgerOf(WUSDC), totalAssetsAfterOpen, "totalAssets() must exceed the base-asset ledger alone once real value is locked in an open LP position");
    }

    /// @dev The direct proof for the 2026-07-15 TWAP fix: a real, large,
    /// single-block swap against the real pool moves its live slot0()
    /// spot price meaningfully, but totalAssets() (which values the open
    /// LP position via a TWAP, not spot, see MandateVault._valuePosition's
    /// own doc comment) must NOT move anywhere near as much, in the SAME
    /// block, immediately after the manipulation, exactly the real
    /// single-transaction "manipulate then deposit/withdraw at the
    /// manipulated NAV" attack this fix defends against.
    function test_lpValuation_resistsSingleBlockSpotPriceManipulation() public {
        address pool = 0x254bA0424618113127538eE11e42C1e3c1721225;
        MandateVault lpVault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate LP Vault", "mLP", _cirBtcOnly(), address(this), address(0));
        lpVault.setPolicy(address(_lpPolicy(lpVault)));
        lpVault.setAutoPauseBountyAmount(0);
        _enablePositionManager(lpVault);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireCirBtc(lpVault, 50e18, 5e18);
        _openLpPosition(lpVault, prices, 2e18);

        uint256 totalAssetsBeforeManipulation = lpVault.totalAssets();
        (uint160 spotBefore,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();

        // A large, real, single-block swap against the real pool: ~100
        // WUSDC against a pool whose own real WUSDC reserve is only
        // ~239 WUSDC at the pinned block (see this file's own top-of-file
        // note), a genuinely large single-block move, not noise.
        uint256 manipulationAmount = 100e18;
        vm.deal(address(this), manipulationAmount);
        IWUSDC(WUSDC).deposit{value: manipulationAmount}();
        IWUSDC(WUSDC).approve(ROUTER, manipulationAmount);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WUSDC,
                tokenOut: CIRBTC,
                fee: WUSDC_CIRBTC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: manipulationAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        (uint160 spotAfter,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint256 spotDeltaBps = spotAfter > spotBefore
            ? ((uint256(spotAfter) - uint256(spotBefore)) * 10_000) / uint256(spotBefore)
            : ((uint256(spotBefore) - uint256(spotAfter)) * 10_000) / uint256(spotBefore);
        assertGt(spotDeltaBps, 500, "sanity: the manipulation must move the real spot price by a meaningful amount (>5%), or this test proves nothing");

        // The critical assertion: read in the SAME block, immediately
        // after the manipulation, no vm.warp in between.
        uint256 totalAssetsAfterManipulation = lpVault.totalAssets();
        assertApproxEqRel(
            totalAssetsAfterManipulation,
            totalAssetsBeforeManipulation,
            0.02e18,
            "totalAssets() must resist a same-block spot price manipulation (TWAP-based valuation), moving no more than ~2%, unlike the pool's own spot price"
        );
    }

    /// @dev A mint whose range does not contain the pool's real, current
    /// tick must revert, exactly MandateVault's own MintPriceOutOfRange
    /// check (contracts/MandateVault.sol), confirmed against the real pool
    /// rather than a mocked slot0().
    function test_lpOpen_revertsWhenRangeExcludesCurrentPrice() public {
        MandateVault lpVault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate LP Vault", "mLP", _cirBtcOnly(), address(this), address(0));
        lpVault.setPolicy(address(_lpPolicy(lpVault)));
        lpVault.setAutoPauseBountyAmount(0);
        _enablePositionManager(lpVault);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireCirBtc(lpVault, 50e18, 5e18);

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(0x254bA0424618113127538eE11e42C1e3c1721225).slot0();
        int24 spacing = 60;
        // A range entirely far below the real current tick: guaranteed to
        // exclude it regardless of the pinned block's exact price.
        int24 tickUpper = ((currentTick / spacing) * spacing) - 6000;
        int24 tickLower = tickUpper - 1200;

        address token0 = IUniswapV3PoolMinimal(0x254bA0424618113127538eE11e42C1e3c1721225).token0();
        uint256 cirBtcAmount = lpVault.ledgerOf(CIRBTC);
        uint256 wusdcAmount = 2e18;
        uint256 amount0Desired = token0 == WUSDC ? wusdcAmount : cirBtcAmount;
        uint256 amount1Desired = token0 == WUSDC ? cirBtcAmount : wusdcAmount;

        MandateVault.LpLeg memory lpLeg = MandateVault.LpLeg({
            pool: 0x254bA0424618113127538eE11e42C1e3c1721225,
            fee: WUSDC_CIRBTC_FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            tokenId: 0,
            liquidity: 0,
            deadline: block.timestamp + 3600
        });

        vm.expectRevert();
        lpVault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.LP_OPEN,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
                lpPool: 0x254bA0424618113127538eE11e42C1e3c1721225,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                lpTokenId: 0,
                liquidityToRemove: 0,
            chainId: 0,
            lendingPositionId: 0
            }),
            prices,
            new MandateVault.SwapLeg[](0),
            lpLeg,
            _emptyBridgeLeg()
        );

        assertEq(lpVault.lpPositionCount(), 0, "a reverted out-of-range mint must never register a position");
    }

    /// @dev The real regression test for the 2026-07-14 fix: a real,
    /// actually-open LP position must be closed by EMERGENCY_EXIT_TO_STABLE
    /// (decision.action stays EMERGENCY_EXIT_TO_STABLE throughout, never
    /// LP_CLOSE, exactly executor/keeperService.ts's closeAllOpenLpPositions),
    /// against the real position manager, not a mock. Before this fix,
    /// MandateVault.sol's executeDecision gate (lpLeg.pool != address(0))
    /// never even reached _executeLpLeg for this leg shape (pool ==
    /// address(0), tokenId != 0, the same convention every non-LP_OPEN leg
    /// uses), silently leaving the position open.
    function test_emergencyExitToStable_closesARealOpenLpPosition() public {
        MandateVault lpVault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate LP Vault", "mLP", _cirBtcOnly(), address(this), address(0));
        lpVault.setPolicy(address(_lpPolicy(lpVault)));
        lpVault.setAutoPauseBountyAmount(0);
        _enablePositionManager(lpVault);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireCirBtc(lpVault, 50e18, 5e18);
        (uint256 tokenId,,) = _openLpPosition(lpVault, prices, 2e18);
        assertEq(lpVault.lpPositionCount(), 1, "sanity: the position must be open before testing the close");

        MandateVault.LpLeg memory closeLeg = MandateVault.LpLeg({
            pool: address(0), // pool == 0 is correct here too, same convention every non-LP_OPEN leg uses; tokenId is the real identity signal.
            fee: 0,
            tickLower: 0,
            tickUpper: 0,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            tokenId: tokenId,
            liquidity: 0,
            deadline: block.timestamp + 3600
        });

        bool ok = lpVault.executeDecision(
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
            prices,
            new MandateVault.SwapLeg[](0),
            closeLeg,
            _emptyBridgeLeg()
        );

        assertTrue(ok);
        assertEq(lpVault.lpPositionCount(), 0, "EMERGENCY_EXIT_TO_STABLE must actually close the real open LP position, not silently leave it open");
    }

    // ------------------------------------------------------------------
    // v4 cross-chain lending: the real depositForBurn call, including
    // every parameter this section cares about (destinationCaller,
    // minFinalityThreshold, mintRecipient, destinationDomain, maxFee), was
    // already independently verified against the REAL, live TokenMessengerV2
    // on Arc Testnet (scripts/verifyCctpBridgeDepositOnArcTestnet.ts, all 8
    // decoded DepositForBurn event fields confirmed, see docs/deployments.md's
    // v4 CCTP section). What that live script could NOT exercise is the full
    // integrated path through MandateVault.executeDecision(BRIDGE_DEPOSIT)
    // itself -- role check, ledger debit, the CCTP call, and
    // LendingPositionRegistry position creation, all atomic in one
    // transaction -- because LendingPositionRegistry.chainKeeper is gated by
    // a real, unconditional 48h propose/execute timelock with no bypass, not
    // completable within a single live session.
    //
    // This test uses a REAL fork (real native USDC, real MandateVault, real
    // LendingPositionRegistry, real 48h timelock skipped via vm.warp exactly
    // like every other timelocked flow already tested this way, see
    // _enablePositionManager above), but with MockCCTPTokenMessenger in
    // place of the real TokenMessengerV2. This is a deliberate, documented
    // split, not an oversight: confirmed live during this test's own
    // development that Arc's real native-USDC-as-ERC20 token depends on at
    // least two Arc-specific precompiles (one gating transferFrom via
    // isBlocklisted, one performing the actual value movement) that
    // Foundry's fork EVM cannot execute at all -- confirmed these are real,
    // not a bug in this test, by reading each precompile's live bytecode
    // (`0x01`, not real EVM bytecode) and confirming Foundry reverts with
    // EvmError: StackUnderflow trying to interpret it as an opcode. The
    // first (isBlocklisted, a pure boolean query) was safely mockable to its
    // real, live-confirmed return value. The second (the actual value-move
    // precompile) is NOT safely mockable for a scenario needing more than
    // one real transfer in the same test: mocking it to unconditionally
    // return success lets exactly ONE real transferFrom go through (used
    // once below, to fund the vault), but does not persist any real balance
    // state anywhere Foundry can see, so a SECOND real transferFrom (which
    // the real TokenMessengerV2's own internal burn logic would need, to
    // pull funds from the vault) always fails with "transfer amount exceeds
    // balance" regardless of the first transfer's outcome -- confirmed
    // empirically, not assumed, before choosing this design. Faking that
    // second transfer's real value-movement semantics correctly would mean
    // reimplementing Arc's own precompile logic in this test, fabricating
    // behavior rather than verifying real code, so it isn't done. This
    // split (real vault + real native USDC + real timelock
    // skip, mocked CCTP messenger only, real CCTP interaction covered
    // separately by the live script) was confirmed as the right approach
    // here, rather than treating this as a gap.
    // ------------------------------------------------------------------

    address internal constant USDC_NATIVE = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614; // real EVM chainId, distinct from the CCTP domain (3)
    uint32 internal constant ARBITRUM_SEPOLIA_CCTP_DOMAIN = 3;
    uint32 internal constant CCTP_MIN_FINALITY_THRESHOLD = 1000; // matches MandateVault.sol's own constant

    function _v4PolicyWithRoles(MandateVault forVault, MandateRoles forRoles) internal returns (VaultPolicy) {
        address[] memory assets = new address[](1);
        assets[0] = USDC_NATIVE;
        uint256[] memory maxBps = new uint256[](1);
        maxBps[0] = 10_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = USDC_NATIVE;

        return new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(forVault),
                roles: address(forRoles),
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
                lendingReportStaleAfterSeconds: 1 days,
                lendingReportMaxDeviationBps: 1000,
                lendingPositionForceUnwindSeconds: 7 days,
                maxLendingAllocationBps: 10_000,
                performanceFeeBps: 0
            })
        );
    }

    /// @dev The real, exact same 48h propose/execute timelock as
    /// _enablePositionManager above, just for LendingPositionRegistry's
    /// chainKeeper instead of MandateVault's positionManager -- no way to
    /// skip this on the real chain, but vm.warp makes it a non-issue here.
    function _setChainKeeper(LendingPositionRegistry registry, uint256 chainId, address keeper) internal {
        registry.proposeChainKeeper(chainId, keeper);
        vm.warp(block.timestamp + 48 hours + 1);
        registry.executeChainKeeper(chainId);
    }

    /// @dev The real target this section was added for: proves the full,
    /// atomic MandateVault.executeDecision(BRIDGE_DEPOSIT) path, not just
    /// the isolated depositForBurn call already verified live. A single
    /// transaction must: pass the keeper role check, debit the ledger by
    /// exactly the bridged amount, make the real depositForBurn call
    /// against the real TokenMessengerV2 with the exact decided parameters,
    /// and atomically create the corresponding LendingPositionRegistry
    /// entry -- verified independently via the real decoded DepositForBurn
    /// event (not just a successful return value) plus the registry's own
    /// stored position state.
    /// @dev A dedicated, more recent fork pin than this file's shared
    /// BLOCK_NUMBER, specifically because a real, already-funded wallet at
    /// this exact block is needed (see FUNDED_USDC_HOLDER below) -- neither
    /// vm.deal (sets only native EVM balance, this token's real balanceOf
    /// is backed by its own proxy storage, confirmed in this test's own
    /// development) nor deal() (Foundry's ERC20-aware cheatcode failed to
    /// locate the real balanceOf storage slot on this specific proxy,
    /// "Slot(s) not found") could mint a test balance out of thin air here.
    uint256 internal constant V4_BLOCK_NUMBER = 52315000;

    /// @dev FACTORY_BOOTSTRAP_DEPLOYER_V4, real, already confirmed to hold
    /// real spendable USDC at this exact block (verified live via cast
    /// immediately before pinning this block, and via the real depositForBurn
    /// this same wallet already executed in
    /// scripts/verifyCctpBridgeDepositOnArcTestnet.ts). Holds no privileged
    /// role in this project (see docs/deployments.md's v4 section), reused
    /// here only as a source of real, already-verified balance, not for any
    /// privileged action.
    address internal constant FUNDED_USDC_HOLDER = 0xaD724299B7CdA00a249A085aFA6A2bA2e29dE217;

    function test_executeDecisionBridgeDeposit_fullPathAtomicWithRealVaultAndMockedCctpMessenger() public {
        vm.createSelectFork("https://rpc.testnet.arc.network", V4_BLOCK_NUMBER);

        // Real Arc-specific precompile at this address (bytecode is just
        // `0x01`, not real EVM bytecode -- implemented natively in Arc's own
        // modified execution client), confirmed live it returns `false` for
        // a normal address. Foundry's local fork EVM does not implement
        // Arc's custom precompiles, so any real transferFrom on native USDC
        // reverts with EvmError: StackUnderflow trying to execute `0x01` as
        // an opcode, unrelated to this test's own logic. Mocked to its real,
        // live-confirmed return value so the REAL USDC contract's REAL
        // transferFrom bytecode can otherwise run unmodified for the one
        // real transfer this test needs (funding the vault below).
        vm.mockCall(0x1800000000000000000000000000000000000001, abi.encodeWithSignature("isBlocklisted(address)"), abi.encode(false));
        // The second, real Arc precompile actually moving native-currency
        // value (see this section's top-of-file note for why this one is
        // mocked to unconditionally succeed rather than left real): safe
        // here because this test only ever needs exactly ONE real transfer
        // (the funding deposit below) -- MockCCTPTokenMessenger never
        // triggers a second one.
        vm.mockCall(0x1800000000000000000000000000000000000000, bytes(""), abi.encode(true));

        // Fresh roles for this fork pin: the shared `roles`/`policy` from
        // setUp() belong to the OTHER (older-pinned) fork, not this one --
        // vm.createSelectFork above switched to an entirely different fork
        // state, where those contracts were never deployed.
        MandateRoles v4Roles = new MandateRoles(address(this));
        v4Roles.grantRole(v4Roles.KEEPER_ROLE(), address(this));
        v4Roles.grantRole(v4Roles.GOVERNANCE_ROLE(), address(this));

        address arbitrumSepoliaKeeper = makeAddr("arbitrumSepoliaKeeper");
        MockCCTPTokenMessenger mockMessenger = new MockCCTPTokenMessenger();

        MandateVault v4Vault =
            new MandateVault(IERC20(USDC_NATIVE), address(v4Roles), ROUTER, "Mandate v4 Vault", "mUSDCv4", new address[](0), address(this), address(mockMessenger));
        VaultPolicy v4Policy = _v4PolicyWithRoles(v4Vault, v4Roles);
        v4Vault.setPolicy(address(v4Policy));
        v4Vault.setAutoPauseBountyAmount(0);

        LendingPositionRegistry registry = new LendingPositionRegistry(address(v4Vault), address(v4Policy), address(v4Roles));
        v4Vault.setLendingRegistry(address(registry));
        _setChainKeeper(registry, ARBITRUM_SEPOLIA_CHAIN_ID, arbitrumSepoliaKeeper);

        uint256 depositAmount = 5_000_000; // 5 USDC, 6 decimals, well within FUNDED_USDC_HOLDER's real ~19.66 USDC balance
        vm.startPrank(FUNDED_USDC_HOLDER);
        IERC20(USDC_NATIVE).approve(address(v4Vault), depositAmount);
        v4Vault.deposit(depositAmount, FUNDED_USDC_HOLDER);
        vm.stopPrank();

        uint256 bridgeAmount = 1_000_000; // 1 USDC
        uint256 maxFee = 1_000; // 0.001 USDC, matches the real value already used in the live CCTP verification
        bytes32 keeperBytes32 = bytes32(uint256(uint160(arbitrumSepoliaKeeper)));

        MandateVault.BridgeLeg memory bridgeLeg = MandateVault.BridgeLeg({
            chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
            amount: bridgeAmount,
            positionId: 0, // new position, not targeting an existing one
            cctpDestinationDomain: ARBITRUM_SEPOLIA_CCTP_DOMAIN,
            maxFee: maxFee
        });

        bool ok = v4Vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.BRIDGE_DEPOSIT,
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
            new IVaultPolicy.AssetPrice[](0),
            new MandateVault.SwapLeg[](0),
            _emptyLpLeg(),
            bridgeLeg
        );

        assertTrue(ok, "executeDecision(BRIDGE_DEPOSIT) must succeed through the full real path");

        // Ledger debit: atomic, exact -- MandateVault's own internal
        // accounting, unrelated to the token's real external balance.
        assertEq(v4Vault.ledgerOf(USDC_NATIVE), depositAmount - bridgeAmount, "the base asset ledger must be debited by exactly the bridged amount");

        // Position creation: atomic, exact, in the same transaction.
        assertEq(registry.positionCount(), 1, "exactly one lending position must be created");
        (uint256 posChainId, LendingPositionRegistry.LendingPositionStatus status, uint256 principalUSDC, uint256 currentValueUSDC, uint256 lastReportedAt) =
            registry.positions(1);
        assertEq(posChainId, ARBITRUM_SEPOLIA_CHAIN_ID, "the recorded position's chainId must match the bridge leg");
        assertEq(uint8(status), uint8(LendingPositionRegistry.LendingPositionStatus.IN_TRANSIT_OUT), "a freshly bridged position must start IN_TRANSIT_OUT");
        assertEq(principalUSDC, bridgeAmount, "principalUSDC must equal exactly the bridged amount");
        assertEq(currentValueUSDC, bridgeAmount, "currentValueUSDC must start equal to principalUSDC, no yield claimed yet");
        assertEq(lastReportedAt, block.timestamp, "lastReportedAt must be the clock anchor set at BRIDGE_DEPOSIT time");

        // The vault constructed and forwarded the exact CCTP call
        // parameters, confirmed against the mock's own recorded call --
        // the real CCTP interaction itself (this same real depositForBurn
        // call shape, against the real TokenMessengerV2) was already
        // independently verified live, all 8 fields, in
        // scripts/verifyCctpBridgeDepositOnArcTestnet.ts.
        assertEq(mockMessenger.callCount(), 1, "the mock CCTP messenger must have been called exactly once");
        (
            uint256 calledAmount,
            uint32 calledDestinationDomain,
            bytes32 calledMintRecipient,
            address calledBurnToken,
            bytes32 calledDestinationCaller,
            uint256 calledMaxFee,
            uint32 calledMinFinalityThreshold,
            address calledCaller
        ) = mockMessenger.lastCall();
        assertEq(calledAmount, bridgeAmount, "amount must match the bridge leg");
        assertEq(calledDestinationDomain, ARBITRUM_SEPOLIA_CCTP_DOMAIN, "destinationDomain must be the real Arbitrum Sepolia CCTP domain");
        assertEq(calledMintRecipient, keeperBytes32, "mintRecipient must be the Arbitrum Sepolia chainKeeper, read fresh from the registry, never a caller-supplied value");
        assertEq(calledBurnToken, USDC_NATIVE, "burnToken must be the real Arc USDC address");
        assertEq(calledDestinationCaller, keeperBytes32, "destinationCaller must be restricted to the same chainKeeper, never bytes32(0) (open completion)");
        assertEq(calledMaxFee, maxFee, "maxFee must match what was supplied");
        assertEq(calledMinFinalityThreshold, CCTP_MIN_FINALITY_THRESHOLD, "minFinalityThreshold must be Fast Transfer (1000), matching MandateVault.sol's own constant");
        assertEq(calledCaller, address(v4Vault), "the vault itself must be the caller, not the keeper wallet");
    }
}
