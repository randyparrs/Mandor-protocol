// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {CapitalLimitRegistry} from "../contracts/CapitalLimitRegistry.sol";

contract CapitalLimitRegistryTest is Test {
    MandateRoles internal roles;
    CapitalLimitRegistry internal registry;

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.ADMIN_ROLE(), address(this));
        roles.grantRole(roles.PAUSER_ROLE(), address(this));
        registry = new CapitalLimitRegistry(address(roles), 10_000e18);
    }

    function test_constructorSetsInitialValue() public view {
        assertEq(registry.maxTotalAssetsValue(), 10_000e18);
    }

    /// @dev Phase 2 stub: one global value applies uniformly, regardless of
    /// which vault asks, until Phase 4's per-vault scoring exists.
    function testFuzz_maxTotalAssetsIsTheSameForAnyVault(address vaultA, address vaultB) public view {
        assertEq(registry.maxTotalAssets(vaultA), registry.maxTotalAssets(vaultB));
        assertEq(registry.maxTotalAssets(vaultA), 10_000e18);
    }

    function testFuzz_onlyAdminCanProposeMaxTotalAssets(address caller, uint256 value) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        registry.proposeMaxTotalAssets(value);
    }

    /// @dev Applies to both a raise and a lower, same symmetric treatment as
    /// the router allowlist: raising the cap is the exact action progressive
    /// trust is meant to gate, so it never executes instantly.
    function testFuzz_maxTotalAssetsNeverExecutesBeforeTimelockElapses(uint256 value, uint256 elapsed) public {
        elapsed = bound(elapsed, 0, registry.MAX_TOTAL_ASSETS_TIMELOCK() - 1);
        registry.proposeMaxTotalAssets(value);

        vm.warp(block.timestamp + elapsed);
        vm.expectRevert();
        registry.executeMaxTotalAssets();
        assertEq(registry.maxTotalAssetsValue(), 10_000e18, "must never take effect before the timelock elapses");
    }

    /// @dev Once ready, execution is permissionless, same pattern as
    /// executeRouterAllowed.
    function testFuzz_maxTotalAssetsExecutesAfterTimelockByAnyCaller(uint256 value, address executor) public {
        vm.assume(executor != address(0));
        registry.proposeMaxTotalAssets(value);
        vm.warp(block.timestamp + registry.MAX_TOTAL_ASSETS_TIMELOCK() + 1);

        vm.prank(executor);
        registry.executeMaxTotalAssets();
        assertEq(registry.maxTotalAssetsValue(), value);
    }

    /// @dev PAUSER_ROLE, a different role than ADMIN which proposes, can
    /// cancel a pending change at any point before it executes, so a
    /// compromised ADMIN key raising the cap can actually be stopped, not
    /// just watched.
    function testFuzz_pauserCanCancelPendingChangeAtAnyPointBeforeExecution(uint256 value, uint256 elapsed) public {
        elapsed = bound(elapsed, 0, registry.MAX_TOTAL_ASSETS_TIMELOCK() * 10);
        registry.proposeMaxTotalAssets(value);
        vm.warp(block.timestamp + elapsed);

        registry.cancelMaxTotalAssets();
        assertEq(registry.maxTotalAssetsExecutableAt(), 0);

        vm.expectRevert();
        registry.executeMaxTotalAssets();
        assertEq(registry.maxTotalAssetsValue(), 10_000e18, "a cancelled change must never take effect, timelock or not");
    }

    function testFuzz_onlyPauserCanCancelMaxTotalAssets(address caller) public {
        vm.assume(caller != address(this));
        registry.proposeMaxTotalAssets(5_000e18);

        vm.prank(caller);
        vm.expectRevert();
        registry.cancelMaxTotalAssets();
    }

    function test_cancellingWithNoPendingChangeReverts() public {
        vm.expectRevert();
        registry.cancelMaxTotalAssets();
    }
}
