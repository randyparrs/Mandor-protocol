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
/// - Router.factory() returns the exact known Factory address, confirming
///   the two are genuinely wired together, not independently deployed
///   look-alikes.
///
/// Router address status (confirmed, not assumed): it is NOT hardcoded
/// anywhere. MandateVault's constructor takes it as `initialSwapRouter_`,
/// stored in the same `allowedRouters` mapping GOVERNANCE can add to or
/// remove from at any time via `setRouterAllowed`, exactly like the oracle
/// feed address pattern (injected, configurable, never baked into the
/// contract). Migrating to the official Uniswap Labs router later, once it
/// has a documented address, is a governance action, not a code change.
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
        vault = new MandateVault(IERC20(WUSDC), address(roles), ROUTER, "Mandate WUSDC Vault", "mWUSDC", otherAssets, address(this));

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
                stableAssets: stableAssets
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
        assertGt(vault.ledgerOf(CIRBTC), 0, "the vault must actually hold cirBTC after a real swap");
        assertEq(vault.ledgerOf(WUSDC), depositAmount - swapAmount);
    }
}
