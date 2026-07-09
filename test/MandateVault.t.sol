// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {CapitalLimitRegistry} from "../contracts/CapitalLimitRegistry.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

/// @notice Property-based fuzz coverage for MandateVault, matching or
/// exceeding VaultPolicy's rigor since this is the contract that actually
/// custodies funds.
contract MandateVaultTest is Test {
    uint256 internal constant MAX_DRAWDOWN_BPS = 1000;
    uint256 internal constant MAX_ALLOCATION_BPS_EURC = 5000;
    uint256 internal constant MIN_STABLE_BPS = 2000;
    uint256 internal constant AUTO_PAUSE_BOUNTY = 1e18;

    MandateRoles internal roles;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockSwapRouter internal router;
    MandateVault internal vault;
    VaultPolicy internal policy;

    address internal user1 = address(0xA11CE);
    address internal user2 = address(0xB0B);

    function setUp() public {
        roles = new MandateRoles(address(this));
        roles.grantRole(roles.PAUSER_ROLE(), address(this));
        roles.grantRole(roles.KEEPER_ROLE(), address(this));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(this));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockSwapRouter();

        address[] memory otherAssets = new address[](1);
        otherAssets[0] = address(eurc);
        vault = new MandateVault(IERC20(address(usdc)), address(roles), address(router), "Mandate USDC Vault", "mUSDC", otherAssets, address(this));

        address[] memory assets = new address[](2);
        assets[0] = address(usdc);
        assets[1] = address(eurc);
        uint256[] memory maxBps = new uint256[](2);
        maxBps[0] = 10_000;
        maxBps[1] = MAX_ALLOCATION_BPS_EURC;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = address(usdc);

        policy = new VaultPolicy(
            VaultPolicy.ConstructorLimits({
                vault: address(vault),
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
                stableAssets: stableAssets
            })
        );
        vault.setPolicy(address(policy));
        vault.setAutoPauseBountyAmount(AUTO_PAUSE_BOUNTY);
    }

    function _deposit(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, user);
        vm.stopPrank();
    }

    function _emptyDecision(IVaultPolicy.DecisionAction action) internal pure returns (IVaultPolicy.Decision memory) {
        return IVaultPolicy.Decision({
            action: action,
            asset: address(0),
            amount: 0,
            targetAllocations: new IVaultPolicy.TargetAllocation[](0)
        });
    }

    /// @dev A direct, unsolicited token transfer to the vault must never
    /// change totalAssets(), regardless of amount, since totalAssets() reads
    /// the internal ledger, never a live balanceOf.
    function testFuzz_donationNeverChangesTotalAssets(uint256 depositAmount, uint256 donationAmount) public {
        depositAmount = bound(depositAmount, 1, 1e30);
        donationAmount = bound(donationAmount, 1, 1e30);
        _deposit(user1, depositAmount);

        uint256 totalBefore = vault.totalAssets();
        uint256 sharesForOneBefore = vault.convertToShares(1e18);

        usdc.mint(address(this), donationAmount);
        usdc.transfer(address(vault), donationAmount);

        assertEq(vault.totalAssets(), totalBefore, "donation must never change totalAssets");
        assertEq(vault.convertToShares(1e18), sharesForOneBefore, "donation must never change the share price");
    }

    /// @dev The classic ERC-4626 inflation attack: a donation sent before a
    /// second depositor's deposit must never let the first depositor steal
    /// value from the second, thanks to the decimals offset.
    function testFuzz_firstDepositorCannotStealFromSecondDepositor(
        uint256 firstDeposit,
        uint256 donation,
        uint256 secondDeposit
    ) public {
        firstDeposit = bound(firstDeposit, 1, 1e6);
        donation = bound(donation, 1, 1e24);
        secondDeposit = bound(secondDeposit, 1e6, 1e24);

        _deposit(user1, firstDeposit);
        usdc.mint(address(this), donation);
        usdc.transfer(address(vault), donation);

        uint256 sharesBefore = vault.balanceOf(user1);
        uint256 assetsBefore = vault.convertToAssets(sharesBefore);

        _deposit(user2, secondDeposit);

        // The attack succeeds if the first depositor's shares became worth
        // MORE assets than they deposited, at user2's expense. The offset
        // plus the donation being ledger-invisible means this can't happen.
        uint256 assetsAfter = vault.convertToAssets(sharesBefore);
        assertGe(assetsAfter, assetsBefore, "sanity: value cannot decrease from someone else depositing");
        assertLe(
            assetsAfter,
            firstDeposit + 1, // rounding dust tolerance
            "first depositor must never capture value from the second depositor's deposit"
        );
    }

    function testFuzz_pausedAlwaysBlocksDepositAndMint(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        policy.pause();
        assertEq(vault.maxDeposit(user1), 0);
        assertEq(vault.maxMint(user1), 0);

        usdc.mint(user1, amount);
        vm.startPrank(user1);
        usdc.approve(address(vault), amount);
        vm.expectRevert();
        vault.deposit(amount, user1);
        vm.stopPrank();
    }

    function testFuzz_pausedNeverBlocksWithdrawOrRedeem(uint256 depositAmount, uint256 withdrawAmount) public {
        depositAmount = bound(depositAmount, 2, 1e30);
        withdrawAmount = bound(withdrawAmount, 1, depositAmount);
        _deposit(user1, depositAmount);

        policy.pause();

        vm.prank(user1);
        vault.withdraw(withdrawAmount, user1, user1);
        assertEq(vault.totalAssets(), depositAmount - withdrawAmount);
    }

    /// @dev Whenever validateDecision would reject a HOLD (e.g. drawdown
    /// exceeds the immutable limit), executeDecision must revert too, and
    /// leave the ledger and tradesToday untouched.
    function testFuzz_executeDecisionRevertsWheneverValidateDecisionWouldReject(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e18, 1e24);
        _deposit(user1, depositAmount);
        policy.pause();

        uint256 ledgerBefore = vault.ledgerOf(address(usdc));
        uint256 tradesBefore = vault.tradesToday();

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);

        vm.expectRevert();
        vault.executeDecision(_emptyDecision(IVaultPolicy.DecisionAction.HOLD), prices, swaps);

        assertEq(vault.ledgerOf(address(usdc)), ledgerBefore);
        assertEq(vault.tradesToday(), tradesBefore);
    }

    /// @dev EMERGENCY_EXIT_TO_STABLE must succeed via executeDecision no
    /// matter how bad drawdown is or whether the vault is paused.
    function testFuzz_emergencyExitNeverBlockedByPauseOrDrawdown(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e18, 1e24);
        _deposit(user1, depositAmount);
        policy.pause();

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);

        bool ok = vault.executeDecision(_emptyDecision(IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE), prices, swaps);
        assertTrue(ok);
    }

    function testFuzz_bountyPayoutOnlyCallableByConfiguredPolicy(address caller) public {
        vm.assume(caller != address(policy));
        vm.prank(caller);
        vm.expectRevert();
        vault.payAutoPauseBounty(user1);
    }

    /// @dev The vault decides the amount itself (its own current
    /// autoPauseBountyAmount, GOVERNANCE-adjustable), there is no
    /// caller-supplied figure to spoof anymore, this is the whole point of
    /// removing that parameter. When the configured amount is comfortably
    /// within both hard caps, a real payout moves exactly that much, no
    /// more, no less. The caps binding is covered separately below.
    function testFuzz_payoutAlwaysMovesExactlyTheCurrentConfiguredAmount(uint256 depositAmount, uint256 bountyAmount)
        public
    {
        bountyAmount = bound(bountyAmount, 1, vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE());
        // Deposit large enough that 1% of TVL is never the binding
        // constraint, isolating the "no cap involved" case.
        depositAmount = bound(depositAmount, bountyAmount * 100, 1e33);
        vault.setAutoPauseBountyAmount(bountyAmount);
        _deposit(user1, depositAmount);

        uint256 ledgerBefore = vault.ledgerOf(address(usdc));
        vm.prank(address(policy));
        vault.payAutoPauseBounty(user1);

        assertEq(vault.ledgerOf(address(usdc)), ledgerBefore - bountyAmount);
        assertEq(usdc.balanceOf(user1), bountyAmount);
    }

    /// @dev Even if GOVERNANCE sets autoPauseBountyAmount right at the
    /// absolute maximum, a payout on a small vault is still capped at 1% of
    /// its current TVL, never the full configured amount, proving the
    /// percent-of-TVL cap is the one that actually binds on small vaults.
    function testFuzz_payoutCappedByPercentOfTVLOnSmallVaults(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e18, 1e20); // small vault, 1-100 USDC
        vault.setAutoPauseBountyAmount(vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE());
        _deposit(user1, depositAmount);

        uint256 expectedCap = (depositAmount * vault.MAX_AUTO_PAUSE_BOUNTY_BPS()) / 10_000;
        vm.prank(address(policy));
        vault.payAutoPauseBounty(user1);

        assertEq(usdc.balanceOf(user1), expectedCap, "payout must be capped at 1% of current TVL, not the full configured amount");
        assertLt(usdc.balanceOf(user1), vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE(), "sanity: the percent cap must be the binding one here");
    }

    /// @dev On a very large vault, 1% of TVL would exceed the absolute
    /// ceiling, so the fixed MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE must be the one
    /// that binds instead. Even a compromised or mistaken GOVERNANCE can
    /// never push a single payout past this fixed number, no matter how
    /// large the vault or the configured amount.
    function testFuzz_payoutCappedByAbsoluteMaximumOnLargeVaults(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1_000_000e18, 1e33); // large vault
        vm.assume((depositAmount * vault.MAX_AUTO_PAUSE_BOUNTY_BPS()) / 10_000 > vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE());

        vault.setAutoPauseBountyAmount(vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE());
        _deposit(user1, depositAmount);

        vm.prank(address(policy));
        vault.payAutoPauseBounty(user1);

        assertEq(usdc.balanceOf(user1), vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE());
    }

    function test_setAutoPauseBountyAmountRejectsAboveAbsoluteCap() public {
        // Computed before arming expectRevert, otherwise this view call
        // itself (evaluated first, to build the argument below) is the one
        // "next call" gets attached to, not the actual setter call.
        uint256 tooMuch = vault.MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE() + 1;
        vm.expectRevert();
        vault.setAutoPauseBountyAmount(tooMuch);
    }

    /// @dev A bounty amount of 0 (the default until GOVERNANCE opts in) is
    /// a silent no-op, never a revert, so an operator who hasn't configured
    /// a bounty yet doesn't turn every real auto-pause into a failed call.
    /// setUp() already configures a nonzero bounty for the rest of this
    /// file's tests, so this test explicitly resets to 0 first rather than
    /// assuming a fresh-deploy default.
    function test_payoutIsNoOpWhenBountyAmountIsZero() public {
        vault.setAutoPauseBountyAmount(0);
        uint256 ledgerBefore = vault.ledgerOf(address(usdc));
        vm.prank(address(policy));
        vault.payAutoPauseBounty(user1);
        assertEq(vault.ledgerOf(address(usdc)), ledgerBefore);
    }

    function testFuzz_onlyGovernanceCanSetAutoPauseBountyAmount(address caller, uint256 amount) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        vault.setAutoPauseBountyAmount(amount);
    }

    /// @dev Light invariant check: the vault's own ledger for an asset can
    /// never exceed what it actually holds on-chain for that asset.
    function testFuzz_ledgerNeverExceedsActualBalance(uint256 depositAmount, uint256 donation) public {
        depositAmount = bound(depositAmount, 1, 1e30);
        donation = bound(donation, 0, 1e30);
        _deposit(user1, depositAmount);
        if (donation > 0) {
            usdc.mint(address(this), donation);
            usdc.transfer(address(vault), donation);
        }
        assertLe(vault.ledgerOf(address(usdc)), usdc.balanceOf(address(vault)));
    }

    function testFuzz_tradesPerDayResetsAcrossDayBoundary(uint256 warpSeconds) public {
        warpSeconds = bound(warpSeconds, 1 days, 1 days + 365 days);
        _deposit(user1, 1e21);

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](0);
        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](0);
        vault.executeDecision(_emptyDecision(IVaultPolicy.DecisionAction.REBALANCE), prices, swaps);
        assertEq(vault.tradesToday(), 1);

        vm.warp(block.timestamp + warpSeconds);
        vault.executeDecision(_emptyDecision(IVaultPolicy.DecisionAction.REBALANCE), prices, swaps);
        assertEq(vault.tradesToday(), 1, "tradesToday must reset across the day boundary");
    }

    function testFuzz_onlyGovernanceCanProposeRouterChange(address caller, address candidateRouter) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        vault.proposeRouterAllowed(candidateRouter, true);
    }

    /// @dev A malicious router added to the allowlist could redirect swap
    /// proceeds to an attacker-controlled contract, so this must never be
    /// instantaneous, at any elapsed time strictly less than the 48h
    /// timelock, execution must revert.
    function testFuzz_routerChangeNeverExecutesBeforeTimelockElapses(address candidateRouter, uint256 elapsed) public {
        vm.assume(candidateRouter != address(router));
        elapsed = bound(elapsed, 0, vault.ROUTER_CHANGE_TIMELOCK() - 1);

        vault.proposeRouterAllowed(candidateRouter, true);
        assertFalse(vault.allowedRouters(candidateRouter));

        vm.warp(block.timestamp + elapsed);
        vm.expectRevert();
        vault.executeRouterAllowed(candidateRouter);
        assertFalse(vault.allowedRouters(candidateRouter), "must never take effect before the timelock elapses");
    }

    /// @dev Once the timelock has genuinely elapsed, execution is
    /// permissionless, same "anyone can finalize, the contract enforces the
    /// real condition" pattern as checkAndAutoPause, so a change can never
    /// get stuck waiting on GOVERNANCE to remember to finalize it.
    function testFuzz_routerChangeExecutesAfterTimelockByAnyCaller(address candidateRouter, address executor) public {
        vm.assume(candidateRouter != address(router));
        vm.assume(executor != address(0));

        vault.proposeRouterAllowed(candidateRouter, true);
        vm.warp(block.timestamp + vault.ROUTER_CHANGE_TIMELOCK() + 1);

        vm.prank(executor);
        vault.executeRouterAllowed(candidateRouter);
        assertTrue(vault.allowedRouters(candidateRouter));
    }

    /// @dev Removing a router (not just adding one) also goes through the
    /// same timelock, not just additions.
    function testFuzz_routerRemovalAlsoTimelocked(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, vault.ROUTER_CHANGE_TIMELOCK() - 1);
        assertTrue(vault.allowedRouters(address(router)), "sanity: the initial router starts allowed");

        vault.proposeRouterAllowed(address(router), false);
        vm.warp(block.timestamp + elapsed);
        vm.expectRevert();
        vault.executeRouterAllowed(address(router));
        assertTrue(vault.allowedRouters(address(router)), "removal must never take effect before the timelock elapses");
    }

    /// @dev A 48h delay only protects against a compromised GOVERNANCE key
    /// if someone can actually act during the window. PAUSER_ROLE, a
    /// different role than the GOVERNANCE_ROLE that proposes, must be able
    /// to cancel a pending change at any point before it executes, and the
    /// cancelled proposal must then be permanently unexecutable, not just
    /// delayed further.
    function testFuzz_pauserCanCancelPendingRouterChangeAtAnyPointBeforeExecution(address candidateRouter, uint256 elapsed) public {
        vm.assume(candidateRouter != address(router));
        elapsed = bound(elapsed, 0, vault.ROUTER_CHANGE_TIMELOCK() * 10);

        vault.proposeRouterAllowed(candidateRouter, true);
        vm.warp(block.timestamp + elapsed);

        vault.cancelRouterAllowedChange(candidateRouter);
        assertEq(vault.routerChangeExecutableAt(candidateRouter), 0);
        assertFalse(vault.pendingRouterChange(candidateRouter));

        vm.expectRevert();
        vault.executeRouterAllowed(candidateRouter);
        assertFalse(vault.allowedRouters(candidateRouter), "a cancelled proposal must never take effect, timelock or not");
    }

    /// @dev Only PAUSER_ROLE can cancel, not GOVERNANCE (the same role that
    /// proposed) and not an arbitrary caller, otherwise cancellation would
    /// be no real check on a compromised GOVERNANCE key.
    function testFuzz_onlyPauserCanCancelRouterChange(address caller) public {
        vm.assume(caller != address(this));
        vault.proposeRouterAllowed(address(router), false);

        vm.prank(caller);
        vm.expectRevert();
        vault.cancelRouterAllowedChange(address(router));
    }

    /// @dev Cancelling a router with no pending change reverts rather than
    /// silently no-op-ing, so a PAUSER call against the wrong address fails
    /// loudly instead of giving false confidence that something was stopped.
    function testFuzz_cancellingRouterWithNoPendingChangeReverts(address candidateRouter) public {
        vm.assume(candidateRouter != address(0));
        assertEq(vault.routerChangeExecutableAt(candidateRouter), 0, "sanity: nothing pending yet");

        vm.expectRevert();
        vault.cancelRouterAllowedChange(candidateRouter);
    }

    function testFuzz_onlyGovernanceCanProposeSweepDust(address caller) public {
        vm.assume(caller != address(this));
        usdc.mint(address(vault), 1e18);
        vm.prank(caller);
        vm.expectRevert();
        vault.proposeSweepDust(address(usdc), caller);
    }

    /// @dev sweepDust is the one place MandateVault ever reads a live
    /// balanceOf. This is the core guarantee that makes that safe: the swept
    /// amount is always exactly liveBalance - ledger at propose time, so the
    /// vault's real balance can never end up below what the ledger records,
    /// for any deposit or dust amount, meaning a compromised GOVERNANCE
    /// calling this can only ever misdirect unaccounted excess, never
    /// ledgered depositor funds. See docs/architecture.md and
    /// docs/threat-model.md.
    function testFuzz_sweepDustNeverReducesBalanceBelowLedger(uint256 depositAmount, uint256 dustAmount, address to) public {
        vm.assume(to != address(0) && to != address(vault));
        depositAmount = bound(depositAmount, 1, 1e30);
        dustAmount = bound(dustAmount, 1, 1e30);

        _deposit(user1, depositAmount);
        usdc.mint(address(vault), dustAmount);

        uint256 ledgerBefore = vault.ledgerOf(address(usdc));
        vault.proposeSweepDust(address(usdc), to);
        vm.warp(block.timestamp + vault.SWEEP_DUST_TIMELOCK() + 1);
        vault.executeSweepDust(address(usdc));

        assertEq(vault.ledgerOf(address(usdc)), ledgerBefore, "sweepDust must never touch the ledger itself");
        assertEq(usdc.balanceOf(address(vault)), ledgerBefore, "the vault's real balance must equal the ledger exactly after a sweep");
        assertEq(usdc.balanceOf(to), dustAmount, "exactly the dust, no more, no less, must reach the recipient");
    }

    /// @dev Reverts rather than silently no-op-ing when there is nothing
    /// above the ledger to sweep, so a call against a vault with no dust
    /// fails loudly instead of giving false confidence.
    function test_sweepDustRevertsWhenNoDust() public {
        _deposit(user1, 1e21);
        vm.expectRevert();
        vault.proposeSweepDust(address(usdc), address(this));
    }

    /// @dev A large accidental direct transfer also counts as dust under
    /// this definition, so it must never be sweepable instantly: the sender
    /// deserves a real window to notice and ask for it back, matching the
    /// same 48h convention already used for router allowlist changes.
    function testFuzz_sweepDustNeverExecutesBeforeTimelockElapses(uint256 dustAmount, uint256 elapsed) public {
        dustAmount = bound(dustAmount, 1, 1e30);
        elapsed = bound(elapsed, 0, vault.SWEEP_DUST_TIMELOCK() - 1);
        usdc.mint(address(vault), dustAmount);

        vault.proposeSweepDust(address(usdc), address(this));
        vm.warp(block.timestamp + elapsed);
        vm.expectRevert();
        vault.executeSweepDust(address(usdc));
        assertEq(usdc.balanceOf(address(this)), 0, "must never take effect before the timelock elapses");
    }

    /// @dev Once the timelock has genuinely elapsed, execution is
    /// permissionless, same pattern as executeRouterAllowed.
    function testFuzz_sweepDustExecutesAfterTimelockByAnyCaller(uint256 dustAmount, address executor) public {
        vm.assume(executor != address(0));
        dustAmount = bound(dustAmount, 1, 1e30);
        usdc.mint(address(vault), dustAmount);

        vault.proposeSweepDust(address(usdc), address(this));
        vm.warp(block.timestamp + vault.SWEEP_DUST_TIMELOCK() + 1);

        vm.prank(executor);
        vault.executeSweepDust(address(usdc));
        assertEq(usdc.balanceOf(address(this)), dustAmount);
    }

    /// @dev PAUSER_ROLE, a different role than the GOVERNANCE_ROLE that
    /// proposes, can cancel a pending sweep at any point before it executes,
    /// giving a real window to stop an accidental large transfer from being
    /// swept away, not just watch it count down.
    function testFuzz_pauserCanCancelPendingSweepAtAnyPointBeforeExecution(uint256 dustAmount, uint256 elapsed) public {
        dustAmount = bound(dustAmount, 1, 1e30);
        elapsed = bound(elapsed, 0, vault.SWEEP_DUST_TIMELOCK() * 10);
        usdc.mint(address(vault), dustAmount);

        vault.proposeSweepDust(address(usdc), address(this));
        vm.warp(block.timestamp + elapsed);

        vault.cancelSweepDust(address(usdc));
        (, , uint256 executableAt) = vault.pendingSweep(address(usdc));
        assertEq(executableAt, 0);

        vm.expectRevert();
        vault.executeSweepDust(address(usdc));
        assertEq(usdc.balanceOf(address(this)), 0, "a cancelled sweep must never take effect, timelock or not");
    }

    function testFuzz_onlyPauserCanCancelSweepDust(address caller) public {
        vm.assume(caller != address(this));
        usdc.mint(address(vault), 1e18);
        vault.proposeSweepDust(address(usdc), address(this));

        vm.prank(caller);
        vm.expectRevert();
        vault.cancelSweepDust(address(usdc));
    }

    function testFuzz_cancellingSweepWithNoPendingChangeReverts(address asset_) public {
        vm.assume(asset_ != address(0));
        vm.expectRevert();
        vault.cancelSweepDust(asset_);
    }

    /// @dev With no registry set (the default in every other test in this
    /// file), maxDeposit is uncapped except by OZ's own overflow guard,
    /// confirming the capital-limit gate is opt-in, never accidentally
    /// restrictive when unconfigured.
    function test_maxDepositUncappedWhenRegistryUnset() public view {
        assertEq(vault.capitalLimitRegistry(), address(0));
        assertGt(vault.maxDeposit(address(this)), 1_000_000_000e18);
    }

    /// @dev Once a registry is wired, maxDeposit is capped to exactly the
    /// remaining room under the registry's global maxTotalAssets, and a
    /// deposit of that exact remaining room succeeds while one unit more
    /// reverts via OZ's own ERC4626ExceededMaxDeposit error.
    function testFuzz_maxDepositCappedByRegistry(uint256 cap, uint256 alreadyDeposited) public {
        cap = bound(cap, 1, 1e27);
        alreadyDeposited = bound(alreadyDeposited, 0, cap);
        CapitalLimitRegistry registry = new CapitalLimitRegistry(address(roles), cap);
        vault.setCapitalLimitRegistry(address(registry));

        if (alreadyDeposited > 0) {
            _deposit(user1, alreadyDeposited);
        }

        uint256 room = cap - alreadyDeposited;
        assertEq(vault.maxDeposit(user2), room, "maxDeposit must equal exactly the remaining room under the cap");

        usdc.mint(user2, 1);
        vm.startPrank(user2);
        usdc.approve(address(vault), 1);
        vm.expectRevert();
        vault.deposit(room + 1, user2);
        vm.stopPrank();
    }

    function testFuzz_onlyFactoryOrGovernanceCanSetCapitalLimitRegistry(address caller) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        vault.setCapitalLimitRegistry(address(0xCAFE));
    }
}
