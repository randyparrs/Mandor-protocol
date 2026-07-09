// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../contracts/VaultFactory.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {MandateVaultDeployer} from "../contracts/MandateVaultDeployer.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";

contract VaultFactoryTest is Test {
    MandateRoles internal roles;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockSwapRouter internal router;
    MandateVaultDeployer internal vaultDeployer;
    VaultFactory internal factory;
    address internal treasury = address(0x7EA5);

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.ADMIN_ROLE(), address(this));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockSwapRouter();
        vaultDeployer = new MandateVaultDeployer();

        factory = new VaultFactory(address(roles), treasury, vaultDeployer);
        vaultDeployer.setFactory(address(factory));

        usdc.mint(address(this), 1_000_000e18);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _params(uint256 seedAmount) internal view returns (VaultFactory.CreateVaultParams memory) {
        address[] memory assets = new address[](2);
        assets[0] = address(usdc);
        assets[1] = address(eurc);
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = 5_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = address(usdc);
        address[] memory otherAssets = new address[](1);
        otherAssets[0] = address(eurc);

        return VaultFactory.CreateVaultParams({
            usdc: IERC20(address(usdc)),
            initialSwapRouter: address(router),
            name: "Mandate USDC Vault",
            symbol: "mUSDC",
            otherAssets: otherAssets,
            limits: VaultPolicy.ConstructorLimits({
                vault: address(0),
                roles: address(0),
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
            }),
            seedAmount: seedAmount
        });
    }

    function testFuzz_seedDepositAlwaysMatchesRequestedAmount(uint256 seedAmount) public {
        seedAmount = bound(seedAmount, 1, 1_000_000e18);
        (address vault,) = factory.createVault(_params(seedAmount));
        assertEq(MandateVault(vault).totalAssets(), seedAmount);
    }

    function testFuzz_onlyAdminCanCreateVault(address caller) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        factory.createVault(_params(100e18));
    }

    /// @dev MandateVaultDeployer.deploy must reject every caller except the
    /// real, wired VaultFactory, with no parameter left for an attacker to
    /// spoof their way past that check.
    function testFuzz_vaultDeployerRejectsAnyCallerOtherThanFactory(address caller) public {
        vm.assume(caller != address(factory));
        address[] memory otherAssets = new address[](0);
        vm.prank(caller);
        vm.expectRevert();
        vaultDeployer.deploy(IERC20(address(usdc)), address(roles), address(router), "Rogue Vault", "rUSDC", otherAssets);
    }

    /// @dev No matter the seed amount, there is never a window where the
    /// vault has shares outstanding but zero backing assets, since the
    /// deploy and the seed deposit happen in one atomic transaction.
    function testFuzz_createdVaultNeverHasNearZeroSharesWindow(uint256 seedAmount) public {
        seedAmount = bound(seedAmount, 1, 1_000_000e18);
        (address vault,) = factory.createVault(_params(seedAmount));
        MandateVault v = MandateVault(vault);
        assertGt(v.totalSupply(), 0, "seed shares must exist immediately");
        assertGt(v.totalAssets(), 0, "seed assets must back those shares immediately");
        assertEq(v.balanceOf(treasury), v.totalSupply(), "treasury must hold exactly the seed shares");
    }
}
