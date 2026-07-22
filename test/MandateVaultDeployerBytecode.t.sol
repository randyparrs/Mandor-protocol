// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {VaultFactory} from "../contracts/VaultFactory.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {MandateVaultDeployer} from "../contracts/MandateVaultDeployer.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {CapitalLimitRegistry} from "../contracts/CapitalLimitRegistry.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

/// @notice Dedicated coverage for MandateVaultDeployer's 2026-07-16 rewrite
/// (BytecodePointer + CREATE2 instead of `new MandateVault(...)`, later
/// fragmented across multiple BytecodePointer instances once a single
/// instance was discovered live to hit EIP-170's 24,576-byte limit itself
/// -- MandateVault's real creation code, 26,576 bytes, is over that limit,
/// confirmed via a real `cast run` CreateContractSizeLimit revert, not a
/// gas problem). This low-level deployment mechanism deliberately gets
/// the same rigor as anything else trusted in
/// this project, not just "existing tests still pass." See
/// MandateVaultDeployer.sol's own top-of-file comment and
/// docs/deployments.md's v4 section for the full numbers and diagnostic
/// trail.
contract MandateVaultDeployerBytecodeTest is Test {
    uint256 internal constant DEFAULT_MAX_TOTAL_ASSETS = 10_000e18;
    uint256 internal constant MAX_FRAGMENT_SIZE = 24_000;

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
        roles.grantRole(roles.KEEPER_ROLE(), address(this));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockSwapRouter();
        vaultDeployer = new MandateVaultDeployer(_chunkBytecode(vm.getCode("MandateVault.sol:MandateVault"), MAX_FRAGMENT_SIZE));
        capitalLimitRegistry = new CapitalLimitRegistry(address(roles), DEFAULT_MAX_TOTAL_ASSETS);

        factory = new VaultFactory(address(roles), treasury, vaultDeployer, address(capitalLimitRegistry));
        vaultDeployer.setFactory(address(factory));

        usdc.mint(address(this), 1_000_000e18);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _params() internal view returns (VaultFactory.CreateVaultParams memory) {
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
                maxLendingAllocationBps: 0
            }),
            seedAmount: 100e18,
            cctpTokenMessenger: address(0)
        });
    }

    /// @dev Splits arbitrary bytes into fragments no larger than
    /// maxChunkSize, in order. Deliberately independent from whatever the
    /// real deploy script's own chunkBytecode() implementation does --
    /// MandateVaultDeployer doesn't care how chunking happened, only that
    /// fragments are correct and in order, so this test-side chunker
    /// proves the mechanism works for ANY correct chunking, not just the
    /// one real script's specific implementation.
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

    // -----------------------------------------------------------------
    // 1. Byte-identity: reading every fragment back independently (never
    // via the contract's own mandateVaultCreationCode() helper for this
    // part -- an independent reconstruction, not trusting the contract to
    // grade its own homework) and concatenating reproduces MandateVault's
    // real creation code EXACTLY, not merely "the same length." The
    // convenience view is checked separately, as a consistency check on
    // top of the independent proof, not instead of it.
    // -----------------------------------------------------------------
    function test_fragmentsReconstructByteIdenticalMandateVaultCreationCode() public view {
        bytes memory expected = vm.getCode("MandateVault.sol:MandateVault");

        uint256 count = vaultDeployer.fragmentCount();
        assertGt(count, 1, "sanity: MandateVault's real size must actually require more than one fragment for this test to mean anything");

        bytes memory reconstructed;
        for (uint256 i = 0; i < count; i++) {
            address pointer = vaultDeployer.mandateVaultCodePointers(i);
            reconstructed = bytes.concat(reconstructed, pointer.code);
        }
        assertEq(reconstructed, expected, "independently reconstructed fragments must be byte-identical to the real MandateVault creation code");

        // Consistency check: the contract's own convenience view must
        // agree with this independent reconstruction.
        assertEq(vaultDeployer.mandateVaultCreationCode(), expected, "mandateVaultCreationCode() view must match the independent reconstruction");
    }

    // -----------------------------------------------------------------
    // 2. Meta-test: fragment ORDER must matter. Deploying with the same
    // fragments reversed must produce a DIFFERENT reconstructed result --
    // proving the byte-identity test above actually has teeth (would
    // catch a real ordering bug), not just passing because the happy path
    // works.
    // -----------------------------------------------------------------
    function test_fragmentOrderMatters_reversedOrderProducesDifferentBytecode() public {
        bytes memory real = vm.getCode("MandateVault.sol:MandateVault");
        bytes[] memory correctOrder = _chunkBytecode(real, MAX_FRAGMENT_SIZE);
        assertGt(correctOrder.length, 1, "sanity: need at least 2 fragments for order to matter");

        bytes[] memory reversedOrder = new bytes[](correctOrder.length);
        for (uint256 i = 0; i < correctOrder.length; i++) {
            reversedOrder[i] = correctOrder[correctOrder.length - 1 - i];
        }

        MandateVaultDeployer reversedDeployer = new MandateVaultDeployer(reversedOrder);
        bytes memory reversedReconstruction = reversedDeployer.mandateVaultCreationCode();

        assertNotEq(reversedReconstruction, real, "reversed fragment order must NOT reconstruct the real creation code");
        assertNotEq(reversedReconstruction, vaultDeployer.mandateVaultCreationCode(), "reversed-order deployer must differ from the correctly-ordered one");
        assertEq(reversedReconstruction.length, real.length, "sanity: total length is order-independent, only content should differ");
    }

    // -----------------------------------------------------------------
    // 3. A fragment over MAX_FRAGMENT_SIZE must revert with the explicit
    // FragmentTooLarge error, not an opaque low-level EVM revert (the
    // exact CreateContractSizeLimit failure mode that took real
    // diagnostic work to identify against the live chain, see
    // docs/deployments.md's v4 section) -- a future script bug that
    // miscalculates chunk size should fail loudly and specifically.
    // -----------------------------------------------------------------
    function test_oversizedFragmentRevertsWithExplicitError() public {
        bytes memory oversized = new bytes(MAX_FRAGMENT_SIZE + 1);
        bytes[] memory fragments = new bytes[](1);
        fragments[0] = oversized;

        vm.expectRevert(abi.encodeWithSelector(MandateVaultDeployer.FragmentTooLarge.selector, 0, MAX_FRAGMENT_SIZE + 1));
        new MandateVaultDeployer(fragments);
    }

    // -----------------------------------------------------------------
    // 4. No-embedding proof: MandateVaultDeployer's own runtime size stays
    // small and fixed regardless of MandateVault's real size or fragment
    // count. Before the original rewrite, `new MandateVault(...)` made
    // this contract's own runtime track MandateVault's creation-code size
    // almost 1:1 (measured 27,905 bytes, -3,329 under EIP-170); if that
    // embedding were ever silently reintroduced, this contract's runtime
    // would balloon back past this threshold.
    // -----------------------------------------------------------------
    function test_deployerOwnRuntimeStaysSmall_confirmsNoEmbedding() public view {
        uint256 realVaultCreationCodeSize = vm.getCode("MandateVault.sol:MandateVault").length;
        assertGt(
            realVaultCreationCodeSize,
            10_000,
            "sanity check: MandateVault's real creation code must actually be large for this test to mean anything"
        );
        assertLt(
            address(vaultDeployer).code.length,
            3_000,
            "MandateVaultDeployer's own runtime must stay small, proving MandateVault's bytecode is not embedded in it"
        );
    }

    // -----------------------------------------------------------------
    // 5. Marker-substitution proof: MandateVaultDeployer never falls back
    // to a compiled-in reference (e.g. type(MandateVault).creationCode).
    // Feeding it deliberately fake, non-MandateVault fragments proves the
    // reconstruction holds EXACTLY the supplied constructor arguments and
    // nothing else -- a standing test guarantee, not something that only
    // holds because someone remembers this contract doesn't import
    // MandateVault.sol. Split across 2 small fragments, not 1, so this
    // also exercises the concatenation path, not just single-pointer
    // storage.
    // -----------------------------------------------------------------
    function test_fragmentsStoreExactlyTheSuppliedConstructorArguments_notAnyHardcodedFallback() public {
        bytes memory markerPart1 = "THIS_IS_DEFINITELY_NOT_REAL_MANDATEVAULT_BYTECODE_PART_ONE_";
        bytes memory markerPart2 = "JUST_A_TEST_MARKER_STRING_PART_TWO_1234567890_ABCDEF";
        bytes[] memory fragments = new bytes[](2);
        fragments[0] = markerPart1;
        fragments[1] = markerPart2;

        MandateVaultDeployer markerDeployer = new MandateVaultDeployer(fragments);
        bytes memory expected = bytes.concat(markerPart1, markerPart2);
        assertEq(
            markerDeployer.mandateVaultCreationCode(),
            expected,
            "reconstruction must store exactly the supplied constructor arguments, in order, proving no alternate/hardcoded source exists"
        );
    }

    // -----------------------------------------------------------------
    // 6. Distinct address per deploy, even with identical constructor
    // arguments -- proves the deployCount-based CREATE2 salt actually
    // prevents collisions, rather than relying on argument diversity.
    // -----------------------------------------------------------------
    function test_distinctAddressPerDeploy_evenWithIdenticalConstructorArgs() public {
        (address vault1,) = factory.createVault(_params());
        (address vault2,) = factory.createVault(_params());
        assertTrue(vault1 != vault2, "two deployments must never collide, even with identical constructor arguments");
    }

    // -----------------------------------------------------------------
    // 7. Adversarial: the validations that already existed (registered
    // assets, correct roles/factory wiring, otherAssets well-formed) must
    // still apply exactly as before -- not assumed to carry over just
    // because the deployment mechanism changed underneath them.
    // -----------------------------------------------------------------
    function test_deployedVaultHasCorrectRolesFactoryAndRegisteredAssets() public {
        (address vaultAddr,) = factory.createVault(_params());
        MandateVault v = MandateVault(vaultAddr);

        assertEq(v.factory(), address(factory), "factory must be the real, known VaultFactory, not spoofable");
        assertEq(v.roles(), address(roles), "roles must be wired to the real MandateRoles contract");
        assertTrue(v.isRegisteredAsset(address(usdc)), "base asset must be registered");
        assertTrue(v.isRegisteredAsset(address(eurc)), "otherAssets must be correctly registered, not silently dropped");
        assertEq(v.registeredAssets(0), address(usdc), "registeredAssets must be well-formed and in the expected order");
        assertEq(v.registeredAssets(1), address(eurc), "registeredAssets must include otherAssets exactly as supplied");
        assertTrue(v.allowedRouters(address(router)), "initialSwapRouter must be allowlisted");
        assertEq(v.cctpTokenMessenger(), address(0), "cctpTokenMessenger must match what CreateVaultParams supplied");
    }

    // -----------------------------------------------------------------
    // 8. Functional equivalence: a vault deployed through the new,
    // fragmented BytecodePointer/CREATE2 mechanism is not merely
    // constructible, it actually behaves like a real MandateVault -- real
    // deposits work, and executeDecision's real access control
    // (onlyKeeper) is enforced.
    // -----------------------------------------------------------------
    function test_deployedVaultAcceptsRealDepositsAndTracksNavCorrectly() public {
        (address vaultAddr,) = factory.createVault(_params());
        MandateVault v = MandateVault(vaultAddr);

        uint256 navAfterSeed = v.totalAssets();
        assertEq(navAfterSeed, 100e18, "seed deposit must be reflected in totalAssets immediately");

        address depositor = address(0xD00D);
        usdc.mint(depositor, 50e18);
        vm.startPrank(depositor);
        usdc.approve(vaultAddr, 50e18);
        v.deposit(50e18, depositor);
        vm.stopPrank();

        assertEq(v.totalAssets(), 150e18, "a real deposit through the new mechanism's vault must update NAV correctly");
        assertGt(v.balanceOf(depositor), 0, "the depositor must actually receive real shares");
    }

    function test_deployedVaultExecuteDecisionEnforcesKeeperOnlyAccessControl() public {
        (address vaultAddr,) = factory.createVault(_params());
        MandateVault v = MandateVault(vaultAddr);

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);
        IVaultPolicy.Decision memory holdDecision = IVaultPolicy.Decision({
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

        // Real, unauthorized caller (KEEPER_ROLE not granted here) must be
        // rejected, same access control every v1/v2/v3 vault already
        // enforces -- confirming the new deployment mechanism did not
        // accidentally weaken it.
        address strangerCaller = address(0xBAD);
        vm.prank(strangerCaller);
        vm.expectRevert();
        v.executeDecision(holdDecision, prices, swaps, emptyLpLeg, emptyBridgeLeg);

        // The real, granted KEEPER_ROLE holder (this test contract, see
        // setUp) must succeed.
        bool ok = v.executeDecision(holdDecision, prices, swaps, emptyLpLeg, emptyBridgeLeg);
        assertTrue(ok, "a properly-authorized keeper must be able to execute a real HOLD decision");
    }
}
