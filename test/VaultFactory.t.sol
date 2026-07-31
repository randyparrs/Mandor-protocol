// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../contracts/VaultFactory.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {MandateVaultDeployer} from "../contracts/MandateVaultDeployer.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {CapitalLimitRegistry} from "../contracts/CapitalLimitRegistry.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";

contract VaultFactoryTest is Test {
    uint256 internal constant DEFAULT_MAX_TOTAL_ASSETS = 10_000e18;

    MandateRoles internal roles;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockSwapRouter internal router;
    MandateVaultDeployer internal vaultDeployer;
    CapitalLimitRegistry internal capitalLimitRegistry;
    VaultFactory internal factory;
    address internal treasury = address(0x7EA5);

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.ADMIN_ROLE(), address(this));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockSwapRouter();
        // See test/MandateVaultDeployerBytecode.t.sol for why this takes
        // fragmented constructor arguments now: MandateVault's real
        // creation code (26,576 bytes) is itself over the 24,576-byte
        // EIP-170 limit that each individual BytecodePointer fragment must
        // respect, discovered live (docs/deployments.md's v4 section).
        // Foundry resolves MandateVault's real library linking
        // (TickMath/LiquidityAmounts) transparently for local test/script
        // bytecode, same as it always has for `new MandateVault(...)`
        // elsewhere in this suite, so vm.getCode here returns real,
        // ready-to-deploy creation bytecode, not a placeholder.
        vaultDeployer = new MandateVaultDeployer(_chunkBytecode(vm.getCode("MandateVault.sol:MandateVault"), 24_000));
        capitalLimitRegistry = new CapitalLimitRegistry(address(roles), DEFAULT_MAX_TOTAL_ASSETS);

        factory = new VaultFactory(address(roles), treasury, vaultDeployer, address(capitalLimitRegistry));
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
            }),
            seedAmount: seedAmount,
            cctpTokenMessenger: address(0)
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
        vaultDeployer.deploy(IERC20(address(usdc)), address(roles), address(router), "Rogue Vault", "rUSDC", otherAssets, address(0));
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

    function test_createVaultRevertsWhenCapitalLimitRegistryUnset() public {
        MandateVaultDeployer freshDeployer = new MandateVaultDeployer(_chunkBytecode(vm.getCode("MandateVault.sol:MandateVault"), 24_000));
        VaultFactory factoryWithoutRegistry = new VaultFactory(address(roles), treasury, freshDeployer, address(0));
        freshDeployer.setFactory(address(factoryWithoutRegistry));
        usdc.approve(address(factoryWithoutRegistry), type(uint256).max);

        vm.expectRevert();
        factoryWithoutRegistry.createVault(_params(100e18));
    }

    /// @dev The exact scenario the capital-limit gate exists for: a freshly
    /// created vault already enforces the registry's cap against the very
    /// first external deposit attempt, no separate call needed after
    /// createVault returns.
    function test_freshlyCreatedVaultRejectsDepositAboveRegistryCapWithNoExtraSetup() public {
        (address vaultAddr,) = factory.createVault(_params(100e18));
        MandateVault v = MandateVault(vaultAddr);
        assertEq(v.capitalLimitRegistry(), address(capitalLimitRegistry), "the cap must already be wired");

        uint256 room = DEFAULT_MAX_TOTAL_ASSETS - v.totalAssets();
        address depositor = address(0xD00D);
        usdc.mint(depositor, room + 1);
        vm.startPrank(depositor);
        usdc.approve(address(v), room + 1);
        vm.expectRevert();
        v.deposit(room + 1, depositor);
        vm.stopPrank();
    }

    /// @dev Splits arbitrary bytes into fragments no larger than
    /// maxChunkSize, in order -- the contract under test doesn't care how
    /// chunking happened, only that fragments are correct and in order
    /// (see MandateVaultDeployer's own doc comment), so this test-side
    /// chunker is deliberately independent from whatever the real deploy
    /// script's own chunkBytecode() does, not required to match it byte
    /// for byte in implementation.
    function _chunkBytecode(bytes memory data, uint256 maxChunkSize) internal pure returns (bytes[] memory chunks) {
        uint256 total = data.length;
        uint256 count = (total + maxChunkSize - 1) / maxChunkSize;
        chunks = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 start = i * maxChunkSize;
            uint256 end = start + maxChunkSize;
            if (end > total) end = total;
            bytes memory chunk = new bytes(end - start);
            for (uint256 j = start; j < end; j++) {
                chunk[j - start] = data[j];
            }
            chunks[i] = chunk;
        }
    }
}
