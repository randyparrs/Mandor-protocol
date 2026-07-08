// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "../contracts/interfaces/ISwapRouter.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

interface IWUSDC {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
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
/// - Router.factory() returns the exact known Factory address above,
///   confirming the two are genuinely wired together, not independently
///   deployed look-alikes.
/// - A real pool with real, non-zero liquidity was found by reading the
///   Factory's own PoolCreated events (not assumed): WUSDC / "SAM"
///   (0xEd890417Ac6bF8ec4a096294d7D714E4E15C27FE), fee tier 3000, pool
///   0xf8181Ce99783943B7c67467789984a68e8AeaD5d.
///
/// Runs against a fork of Arc Testnet, so it needs no real gas or a funded
/// wallet, but it executes against the router's actual deployed bytecode
/// and the pool's actual real state, revealing real fee/slippage/revert
/// behavior a mock cannot.
contract MandateVaultArcForkTest is Test {
    address internal constant ROUTER = 0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01;
    address internal constant FACTORY = 0xAb6A8AAb7d490007634ef59d424b5d89688a1971;
    address internal constant WUSDC = 0x911b4000D3422F482F4062a913885f7b035382Df;
    address internal constant SAM = 0xEd890417Ac6bF8ec4a096294d7D714E4E15C27FE;
    uint24 internal constant FEE = 3000;

    MandateRoles internal roles;
    MandateVault internal vault;
    VaultPolicy internal policy;

    function setUp() public {
        vm.createSelectFork("https://rpc.testnet.arc.network");

        roles = new MandateRoles(address(this));
        roles.grantRole(roles.KEEPER_ROLE(), address(this));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(this));

        address[] memory otherAssets = new address[](1);
        otherAssets[0] = SAM;
        vault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate WUSDC Vault", "mWUSDC", otherAssets, address(this));

        address[] memory assets = new address[](2);
        assets[0] = WUSDC;
        assets[1] = SAM;
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
                autoPauseBountyAmount: 0,
                assets: assets,
                maxAllocationBps: maxBps,
                stableAssets: stableAssets
            })
        );
        vault.setPolicy(address(policy));
    }

    /// @dev Confirms Router and Factory are genuinely wired together on the
    /// real chain, not just independently having code (the actual
    /// cross-check this project's own review asked for before trusting
    /// them).
    function test_realRouterReportsTheRealKnownFactory() public view {
        assertEq(ISwapRouter(ROUTER).factory(), FACTORY);
    }

    /// @dev A real swap through the real router against the real pool with
    /// real liquidity, bypassing MandateVault entirely, to isolate router
    /// behavior (does exactInputSingle work at all against this specific
    /// deployment, does it honor amountOutMinimum, etc.) before trusting it
    /// inside the full vault flow below.
    function test_realSwapThroughRealRouterAgainstRealLiquidity() public {
        uint256 amountIn = 1e15; // small, well within the pool's real reserves
        vm.deal(address(this), amountIn);
        IWUSDC(WUSDC).deposit{value: amountIn}();
        IWUSDC(WUSDC).approve(ROUTER, amountIn);

        uint256 samBefore = IERC20(SAM).balanceOf(address(this));

        uint256 amountOut = ISwapRouter(ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: WUSDC,
                tokenOut: SAM,
                fee: FEE,
                recipient: address(this),
                deadline: block.timestamp + 3600,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        assertGt(amountOut, 0, "a real swap against real liquidity must return a nonzero amount");
        assertEq(IERC20(SAM).balanceOf(address(this)), samBefore + amountOut);
    }

    /// @dev The real target: the full atomic swap plus policy validation
    /// flow, through MandateVault.executeDecision, against the real router
    /// and real pool, not a mock. Proves the interface adopted in
    /// ISwapRouter.sol and MandateVault's SwapLeg struct actually match
    /// what the real, deployed router expects, end to end.
    function test_executeDecisionRealSwapThroughRealRouter() public {
        uint256 depositAmount = 1e16;
        vm.deal(address(this), depositAmount);
        IWUSDC(WUSDC).deposit{value: depositAmount}();
        IWUSDC(WUSDC).approve(address(vault), depositAmount);
        vault.deposit(depositAmount, address(this));

        uint256 swapAmount = 1e15;
        IVaultPolicy.TargetAllocation[] memory targetAllocations = new IVaultPolicy.TargetAllocation[](2);
        targetAllocations[0] = IVaultPolicy.TargetAllocation({asset: WUSDC, targetWeightBps: 9000});
        targetAllocations[1] = IVaultPolicy.TargetAllocation({asset: SAM, targetWeightBps: 1000});

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: ROUTER,
            tokenIn: WUSDC,
            tokenOut: SAM,
            fee: FEE,
            amountIn: swapAmount,
            minAmountOut: 1,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        vault.setRouterAllowed(ROUTER, true);

        bool ok = vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targetAllocations
            }),
            new IVaultPolicy.AssetPrice[](0),
            swaps
        );

        assertTrue(ok);
        assertGt(vault.ledgerOf(SAM), 0, "the vault must actually hold SAM after a real swap");
        assertEq(vault.ledgerOf(WUSDC), depositAmount - swapAmount);
    }
}
