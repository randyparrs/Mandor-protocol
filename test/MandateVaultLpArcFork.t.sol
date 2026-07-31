// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "../contracts/interfaces/ISwapRouter.sol";
import {IQuoter} from "../contracts/interfaces/IQuoter.sol";
import {MandateVaultLp} from "../contracts/MandateVaultLp.sol";
import {LpPositionRegistry} from "../contracts/LpPositionRegistry.sol";
import {ILpPositionRegistry} from "../contracts/interfaces/ILpPositionRegistry.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";
import {IUniswapV3PoolMinimal} from "../contracts/interfaces/INonfungiblePositionManager.sol";

interface IWUSDC {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IUniswapV3PoolObservationSetup {
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/// @notice Integration test for v7 (LP yield vault, WUSDC/EURC) against
/// real, deployed, verified infrastructure on Arc Testnet, not a mock or
/// the v3-only WUSDC/cirBTC pool test/MandateVaultArcFork.t.sol already
/// covers. Same real Router/Factory/Quoter/positionManager already
/// verified there, targeting a DIFFERENT, previously-unexplored real pool:
/// WUSDC/EURC (fee 3000, 0x13873aD4296AC255361BeA54681FdCC55eF9c316),
/// confirmed live 2026-07-27 via the real Factory's own getPool() (a
/// non-zero return only ever happens for a pool the Factory itself really
/// created) and real balanceOf reads against the pool address: ~184,470
/// WUSDC and ~146,787 EURC in real reserves, orders of magnitude deeper
/// than either of v3's own real-liquidity pools (WUSDC/cirBTC ~239 WUSDC,
/// EURC/cirBTC ~2651 EURC). Both WUSDC and EURC are independently
/// confirmed real (EURC against docs.arc.io, WUSDC as a deterministic 1:1
/// wrapper of Arc's own native gas currency), unlike cirBTC -- this is the
/// first LP vault design in this project not blocked by
/// requireIndependentReferencePriceForLp/ToBuy pending an unavailable
/// oracle.
///
/// Exercises the split MandateVaultLp/LpPositionRegistry architecture (see
/// LpPositionRegistry.sol's own top-of-file comment for why v7 needed this
/// split and v3 never did): the vault only validates/dispatches/holds the
/// ledger, LpPositionRegistry owns the real NFT custody and
/// mint/increase/decrease/collect/close mechanics.
///
/// Pinned to a specific block so this test stays reproducible regardless
/// of how the live pool's real state changes over time. Re-pin (and
/// re-verify reserves) periodically, same convention
/// test/MandateVaultArcFork.t.sol already follows.
contract MandateVaultLpArcForkTest is Test {
    uint256 internal constant BLOCK_NUMBER = 53960000;

    address internal constant ROUTER = 0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01;
    address internal constant QUOTER = 0x121aeB6DEf00F6F67665008CaC1C19805886ed1a;
    address internal constant WUSDC = 0x911b4000D3422F482F4062a913885f7b035382Df;
    address internal constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address internal constant WUSDC_EURC_POOL = 0x13873aD4296AC255361BeA54681FdCC55eF9c316;
    uint24 internal constant WUSDC_EURC_FEE = 3000;
    address internal constant POSITION_MANAGER = 0x0553682bc188b850acd31CBd3500Dcd0aa35372B;

    MandateRoles internal roles;

    function setUp() public {
        vm.createSelectFork("https://rpc.testnet.arc.network", BLOCK_NUMBER);

        roles = new MandateRoles(address(this));
        roles.grantRole(roles.KEEPER_ROLE(), address(this));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(this));
    }

    function _emptyBridgeLeg() internal pure returns (MandateVaultLp.BridgeLeg memory) {
        return MandateVaultLp.BridgeLeg({chainId: 0, amount: 0, positionId: 0, cctpDestinationDomain: 0, maxFee: 0});
    }

    function _emptyLpLeg() internal pure returns (ILpPositionRegistry.LpLeg memory) {
        return ILpPositionRegistry.LpLeg({
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

    /// @dev Deploys a fresh vault+policy+registry triple, wires
    /// lpRegistry, and enables the real positionManager (same 48h
    /// propose/execute timelock every governance-configurable address in
    /// this project uses, just fast-forwarded).
    function _deployLpVault(uint256 maxLpAllocationBps) internal returns (MandateVaultLp vault, VaultPolicy policy, LpPositionRegistry registry) {
        address[] memory otherAssets = new address[](1);
        otherAssets[0] = EURC;
        vault = new MandateVaultLp(IERC20(WUSDC), address(roles), ROUTER, "Mandate WUSDC/EURC LP Vault", "mLPv7", otherAssets, address(this), address(0));

        address[] memory assets = new address[](2);
        assets[0] = WUSDC;
        assets[1] = EURC;
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = 10_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = WUSDC;

        policy = new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(vault),
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
                maxLpAllocationBps: maxLpAllocationBps,
                lendingReportStaleAfterSeconds: 0,
                lendingReportMaxDeviationBps: 0,
                lendingPositionForceUnwindSeconds: 0,
                maxLendingAllocationBps: 0,
                performanceFeeBps: 0
            })
        );
        vault.setPolicy(address(policy));
        vault.setAutoPauseBountyAmount(0);

        registry = new LpPositionRegistry(address(vault), address(policy), address(roles));
        vault.setLpRegistry(address(registry));

        registry.proposePositionManager(POSITION_MANAGER);
        vm.warp(block.timestamp + 48 hours);
        registry.executePositionManager();
    }

    /// @dev A real, live-derived EURC price, scaled to the BASE asset's own
    /// decimals (WUSDC, 18), matching MandateVaultLp._valueInUSDC's formula
    /// exactly, same pattern test/MandateVaultArcFork.t.sol already uses
    /// for cirBTC.
    function _eurcPrice(uint256 swapAmountWUSDC, uint256 quotedAmountOutEURC) internal view returns (IVaultPolicy.AssetPrice[] memory prices) {
        uint256 price = (swapAmountWUSDC * 1e6) / quotedAmountOutEURC;
        prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({asset: EURC, price: price, referencePrice: price, updatedAt: block.timestamp});
    }

    /// @dev Deposits WUSDC and acquires a real EURC balance via a real
    /// REBALANCE swap against the real WUSDC/EURC pool, mirroring
    /// test/MandateVaultArcFork.t.sol's own _depositAndAcquireCirBtc.
    function _depositAndAcquireEURC(MandateVaultLp vault, uint256 depositAmount, uint256 swapAmount) internal returns (IVaultPolicy.AssetPrice[] memory prices) {
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(vault), depositAmount);
        vault.deposit(depositAmount, address(this));

        uint256 quotedAmountOut = IQuoter(QUOTER).quoteExactInputSingle(WUSDC, EURC, WUSDC_EURC_FEE, swapAmount, 0);
        uint256 minAmountOut = (quotedAmountOut * 9700) / 10_000;
        prices = _eurcPrice(swapAmount, quotedAmountOut);

        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: EURC, targetWeightBps: 1000});

        MandateVaultLp.SwapLeg[] memory swaps = new MandateVaultLp.SwapLeg[](1);
        swaps[0] = MandateVaultLp.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: EURC,
            fee: WUSDC_EURC_FEE,
            amountIn: swapAmount,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        vault.executeDecision(
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

    /// @dev Real, permissionless TWAP warm-up prerequisite, same reasoning
    /// and same mechanism as test/MandateVaultArcFork.t.sol's own
    /// _makeTwapAvailable, applied to the WUSDC/EURC pool instead.
    function _makeTwapAvailable() internal {
        IUniswapV3PoolObservationSetup(WUSDC_EURC_POOL).increaseObservationCardinalityNext(4);

        uint256 tinyAmount = 0.01e18;
        vm.deal(address(this), tinyAmount);
        IWUSDC(WUSDC).deposit{value: tinyAmount}();
        IWUSDC(WUSDC).approve(ROUTER, tinyAmount);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WUSDC,
                tokenOut: EURC,
                fee: WUSDC_EURC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: tinyAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        vm.warp(block.timestamp + 1800 + 60);

        uint256 eurcBack = IERC20(EURC).balanceOf(address(this));
        IERC20(EURC).approve(ROUTER, eurcBack);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: EURC,
                tokenOut: WUSDC,
                fee: WUSDC_EURC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: eurcBack,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Opens a real position on the real WUSDC/EURC pool via the
    /// real, verified UnitFlowV3PositionManager. A wide (2400-tick) range
    /// centered on the pool's own real, live current tick, so the mint
    /// always lands in range regardless of the pinned block's exact price.
    function _openLpPosition(MandateVaultLp vault, LpPositionRegistry registry, IVaultPolicy.AssetPrice[] memory prices, uint256 wusdcAmount)
        internal
        returns (uint256 tokenId)
    {
        _makeTwapAvailable();

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).slot0();
        int24 spacing = 60;
        int24 centerTick = (currentTick / spacing) * spacing;
        int24 tickLower = centerTick - 1200;
        int24 tickUpper = centerTick + 1200;

        address token0 = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).token0();
        uint256 eurcAmount = vault.ledgerOf(EURC);
        uint256 amount0Desired = token0 == WUSDC ? wusdcAmount : eurcAmount;
        uint256 amount1Desired = token0 == WUSDC ? eurcAmount : wusdcAmount;

        ILpPositionRegistry.LpLeg memory lpLeg = ILpPositionRegistry.LpLeg({
            pool: WUSDC_EURC_POOL,
            fee: WUSDC_EURC_FEE,
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

        vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.LP_OPEN,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
                lpPool: WUSDC_EURC_POOL,
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
            new MandateVaultLp.SwapLeg[](0),
            lpLeg,
            _emptyBridgeLeg()
        );

        tokenId = registry.lpPositionIds(0);
    }

    /// @dev Real position opened, real totalAssets() must reflect its real
    /// value, not just "greater than zero." Same structure as
    /// test/MandateVaultArcFork.t.sol's own test_lpOpen_totalAssetsValuesTheRealPosition.
    function test_lpOpen_totalAssetsValuesTheRealPosition() public {
        (MandateVaultLp vault,, LpPositionRegistry registry) = _deployLpVault(5000);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireEURC(vault, 50e18, 5e18);
        uint256 totalAssetsBeforeOpen = vault.totalAssets();

        uint256 tokenId = _openLpPosition(vault, registry, prices, 2e18);

        assertEq(registry.positionCount(), 1, "the registry must hold exactly one open LP position");
        assertGt(tokenId, 0, "a real mint must return a real, nonzero NFT tokenId");

        uint256 totalAssetsAfterOpen = vault.totalAssets();
        assertApproxEqRel(totalAssetsAfterOpen, totalAssetsBeforeOpen, 0.05e18, "totalAssets() must still reflect roughly the same real capital immediately after opening a position");
        assertLt(vault.ledgerOf(WUSDC), totalAssetsAfterOpen, "totalAssets() must exceed the base-asset ledger alone once real value is locked in an open LP position");
    }

    /// @dev Same manipulation-resistance proof as
    /// test/MandateVaultArcFork.t.sol's own test_lpValuation_resistsSingleBlockSpotPriceManipulation,
    /// against the WUSDC/EURC pool instead.
    function test_lpValuation_resistsSingleBlockSpotPriceManipulation() public {
        (MandateVaultLp vault,, LpPositionRegistry registry) = _deployLpVault(5000);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireEURC(vault, 50e18, 5e18);
        _openLpPosition(vault, registry, prices, 2e18);

        uint256 totalAssetsBeforeManipulation = vault.totalAssets();
        (uint160 spotBefore,,,,,,) = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).slot0();

        // A real, single-block swap large enough to move this deep pool's
        // (~184K WUSDC) spot price meaningfully still requires real size;
        // ~20,000 WUSDC (~11% of real reserves) is deliberately large.
        uint256 manipulationAmount = 20_000e18;
        vm.deal(address(this), manipulationAmount);
        IWUSDC(WUSDC).deposit{value: manipulationAmount}();
        IWUSDC(WUSDC).approve(ROUTER, manipulationAmount);
        ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WUSDC,
                tokenOut: EURC,
                fee: WUSDC_EURC_FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: manipulationAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        (uint160 spotAfter,,,,,,) = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).slot0();
        uint256 spotDeltaBps = spotAfter > spotBefore
            ? ((uint256(spotAfter) - uint256(spotBefore)) * 10_000) / uint256(spotBefore)
            : ((uint256(spotBefore) - uint256(spotAfter)) * 10_000) / uint256(spotBefore);
        assertGt(spotDeltaBps, 300, "sanity: the manipulation must move the real spot price by a meaningful amount, or this test proves nothing");

        uint256 totalAssetsAfterManipulation = vault.totalAssets();
        assertApproxEqRel(
            totalAssetsAfterManipulation,
            totalAssetsBeforeManipulation,
            0.02e18,
            "totalAssets() must resist a same-block spot price manipulation (TWAP-based valuation), moving no more than ~2%, unlike the pool's own spot price"
        );
    }

    /// @dev A mint whose range does not contain the pool's real, current
    /// tick must revert, exactly LpPositionRegistry's own
    /// MintPriceOutOfRange check, confirmed against the real pool.
    function test_lpOpen_revertsWhenRangeExcludesCurrentPrice() public {
        (MandateVaultLp vault,, LpPositionRegistry registry) = _deployLpVault(5000);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireEURC(vault, 50e18, 5e18);

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).slot0();
        int24 spacing = 60;
        int24 tickUpper = ((currentTick / spacing) * spacing) - 6000;
        int24 tickLower = tickUpper - 1200;

        address token0 = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).token0();
        uint256 eurcAmount = vault.ledgerOf(EURC);
        uint256 wusdcAmount = 2e18;
        uint256 amount0Desired = token0 == WUSDC ? wusdcAmount : eurcAmount;
        uint256 amount1Desired = token0 == WUSDC ? eurcAmount : wusdcAmount;

        ILpPositionRegistry.LpLeg memory lpLeg = ILpPositionRegistry.LpLeg({
            pool: WUSDC_EURC_POOL,
            fee: WUSDC_EURC_FEE,
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

        uint256 ledgerWusdcBefore = vault.ledgerOf(WUSDC);
        uint256 ledgerEurcBefore = vault.ledgerOf(EURC);
        uint256 registryWusdcBefore = IERC20(WUSDC).balanceOf(address(registry));
        uint256 registryEurcBefore = IERC20(EURC).balanceOf(address(registry));

        vm.expectRevert();
        vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.LP_OPEN,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
                lpPool: WUSDC_EURC_POOL,
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
            new MandateVaultLp.SwapLeg[](0),
            lpLeg,
            _emptyBridgeLeg()
        );

        assertEq(registry.positionCount(), 0, "a reverted out-of-range mint must never register a position");
        // The dedicated proof this project's own custody-touching-mechanism
        // rigor requires (same standard applied to the BytecodePointer
        // extraction and MandateVaultLending's equivalence tests): a
        // reverted LP_OPEN must leave BOTH the vault's ledger AND the
        // registry's real token balances completely untouched, not just
        // "no position was registered." Confirms the push-then-refund
        // custody sequence (MandateVaultLp._executeLpLeg's safeTransfer
        // into the registry, then LpPositionRegistry.openPosition's real
        // mint attempt) is genuinely atomic: nothing is left stranded in
        // the registry without a backing NFT position, not even for one
        // block, when the real positionManager.mint() call itself reverts.
        assertEq(vault.ledgerOf(WUSDC), ledgerWusdcBefore, "vault's WUSDC ledger must be exactly unchanged after a reverted LP_OPEN");
        assertEq(vault.ledgerOf(EURC), ledgerEurcBefore, "vault's EURC ledger must be exactly unchanged after a reverted LP_OPEN");
        assertEq(IERC20(WUSDC).balanceOf(address(registry)), registryWusdcBefore, "registry must hold zero leftover WUSDC after a reverted LP_OPEN, nothing stranded without a backing position");
        assertEq(IERC20(EURC).balanceOf(address(registry)), registryEurcBefore, "registry must hold zero leftover EURC after a reverted LP_OPEN, nothing stranded without a backing position");
    }

    /// @dev The dedicated atomicity/revert-safety test explicitly requested
    /// before implementation: forces the REAL positionManager.mint() call
    /// to revert for a real, disclosed reason (amount0Min/amount1Min set
    /// above what the real mint will actually produce, tripping Uniswap's
    /// own "Price slippage check"), against the real pool, not a mock --
    /// proving the push-then-refund custody sequence is atomic in
    /// practice, not just by theoretical EVM guarantee. Confirms all four
    /// invariants: vault ledger unchanged, registry balances zero, no
    /// tokenId registered, and the whole transaction genuinely reverted
    /// (not a silent partial success).
    function test_lpOpen_revertsAndLeavesNoStrandedFunds_WhenMintSlippageCheckFails() public {
        (MandateVaultLp vault,, LpPositionRegistry registry) = _deployLpVault(5000);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireEURC(vault, 50e18, 5e18);

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).slot0();
        int24 spacing = 60;
        int24 centerTick = (currentTick / spacing) * spacing;
        int24 tickLower = centerTick - 1200;
        int24 tickUpper = centerTick + 1200;

        address token0 = IUniswapV3PoolMinimal(WUSDC_EURC_POOL).token0();
        uint256 wusdcAmount = 2e18;
        uint256 eurcAmount = vault.ledgerOf(EURC);
        uint256 amount0Desired = token0 == WUSDC ? wusdcAmount : eurcAmount;
        uint256 amount1Desired = token0 == WUSDC ? eurcAmount : wusdcAmount;

        ILpPositionRegistry.LpLeg memory lpLeg = ILpPositionRegistry.LpLeg({
            pool: WUSDC_EURC_POOL,
            fee: WUSDC_EURC_FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            // Impossible minimums: no real mint at this tick range can ever
            // consume the FULL Desired amount of BOTH sides simultaneously
            // (a wide range always leans one-sided), so requiring the
            // entire Desired amount as the floor guarantees Uniswap's own
            // slippage check reverts the real mint call.
            amount0Min: amount0Desired,
            amount1Min: amount1Desired,
            tokenId: 0,
            liquidity: 0,
            deadline: block.timestamp + 3600
        });

        uint256 ledgerWusdcBefore = vault.ledgerOf(WUSDC);
        uint256 ledgerEurcBefore = vault.ledgerOf(EURC);
        uint256 vaultRealWusdcBefore = IERC20(WUSDC).balanceOf(address(vault));
        uint256 vaultRealEurcBefore = IERC20(EURC).balanceOf(address(vault));

        vm.expectRevert();
        vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.LP_OPEN,
                asset: address(0),
                amount: 0,
                targetAllocations: new IVaultPolicy.TargetAllocation[](0),
                lpPool: WUSDC_EURC_POOL,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: amount0Desired,
                amount1Min: amount1Desired,
                lpTokenId: 0,
                liquidityToRemove: 0,
                chainId: 0,
                lendingPositionId: 0
            }),
            prices,
            new MandateVaultLp.SwapLeg[](0),
            lpLeg,
            _emptyBridgeLeg()
        );

        // Invariant 1: no position was ever registered.
        assertEq(registry.positionCount(), 0, "a reverted mint must never register a position");
        // Invariant 2: the vault's own internal ledger is exactly
        // unchanged -- the debit lines in MandateVaultLp._executeLpLeg
        // are only reached AFTER openPosition returns successfully, so a
        // revert inside openPosition (or the real mint it calls) never
        // executes them at all.
        assertEq(vault.ledgerOf(WUSDC), ledgerWusdcBefore, "vault's WUSDC ledger must be exactly unchanged after a reverted mint");
        assertEq(vault.ledgerOf(EURC), ledgerEurcBefore, "vault's EURC ledger must be exactly unchanged after a reverted mint");
        // Invariant 3: the vault's REAL token balances are exactly
        // unchanged too -- the safeTransfer push into the registry
        // happened earlier in the SAME transaction as the reverting mint,
        // so standard EVM atomicity rolls it back along with everything
        // else, not just the ledger's internal bookkeeping.
        assertEq(IERC20(WUSDC).balanceOf(address(vault)), vaultRealWusdcBefore, "vault's real WUSDC balance must be exactly unchanged, the pushed transfer must be rolled back with everything else");
        assertEq(IERC20(EURC).balanceOf(address(vault)), vaultRealEurcBefore, "vault's real EURC balance must be exactly unchanged, the pushed transfer must be rolled back with everything else");
        // Invariant 4: nothing is left stranded in the registry, not even
        // dust -- the exact property this test was written to prove.
        assertEq(IERC20(WUSDC).balanceOf(address(registry)), 0, "registry must hold zero WUSDC after a reverted mint, nothing stranded without a backing position");
        assertEq(IERC20(EURC).balanceOf(address(registry)), 0, "registry must hold zero EURC after a reverted mint, nothing stranded without a backing position");
    }

    /// @dev Same regression coverage as
    /// test/MandateVaultArcFork.t.sol's own test_emergencyExitToStable_closesARealOpenLpPosition,
    /// confirming the split architecture still routes
    /// EMERGENCY_EXIT_TO_STABLE through LpPositionRegistry.closePosition
    /// correctly (decision.action stays EMERGENCY_EXIT_TO_STABLE
    /// throughout, never LP_CLOSE).
    function test_emergencyExitToStable_closesARealOpenLpPosition() public {
        (MandateVaultLp vault,, LpPositionRegistry registry) = _deployLpVault(5000);

        IVaultPolicy.AssetPrice[] memory prices = _depositAndAcquireEURC(vault, 50e18, 5e18);
        uint256 tokenId = _openLpPosition(vault, registry, prices, 2e18);
        assertEq(registry.positionCount(), 1, "sanity: the position must be open before testing the close");

        ILpPositionRegistry.LpLeg memory closeLeg = ILpPositionRegistry.LpLeg({
            pool: address(0),
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

        bool ok = vault.executeDecision(
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
            new MandateVaultLp.SwapLeg[](0),
            closeLeg,
            _emptyBridgeLeg()
        );

        assertTrue(ok);
        assertEq(registry.positionCount(), 0, "EMERGENCY_EXIT_TO_STABLE must actually close the real open LP position via the registry, not silently leave it open");
    }
}
