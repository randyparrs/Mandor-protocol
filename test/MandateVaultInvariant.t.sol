// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateVault} from "../contracts/MandateVault.sol";
import {VaultPolicy} from "../contracts/VaultPolicy.sol";
import {MandateRoles} from "../contracts/access/MandateRoles.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";
import {MockSwapRouter} from "../contracts/test/MockSwapRouter.sol";
import {IVaultPolicy} from "../contracts/interfaces/IVaultPolicy.sol";

/// @notice Wraps MandateVault's real entry points behind bounded,
/// always-valid-shaped calls. This is the standard forge-std invariant
/// pattern: the fuzzer only ever calls functions here, never the vault
/// directly with unconstrained calldata, since almost all such calls would
/// just revert on type/shape mismatches without exercising any real state
/// transition.
contract MandateVaultHandler is Test {
    MandateVault public vault;
    VaultPolicy public policy;
    MockERC20 public usdc;
    MockERC20 public eurc;
    MockSwapRouter public router;

    address[] internal actors;

    constructor(MandateVault vault_, VaultPolicy policy_, MockERC20 usdc_, MockERC20 eurc_, MockSwapRouter router_) {
        vault = vault_;
        policy = policy_;
        usdc = usdc_;
        eurc = eurc_;
        router = router_;
        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xC0FFEE));
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        address user = _actor(actorSeed);
        amount = bound(amount, 1, 1_000_000e18);
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        try vault.deposit(amount, user) returns (uint256) {} catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 actorSeed, uint256 amount) public {
        address user = _actor(actorSeed);
        amount = bound(amount, 0, 1_000_000e18);
        vm.startPrank(user);
        try vault.withdraw(amount, user, user) returns (uint256) {} catch {}
        vm.stopPrank();
    }

    /// @dev Deliberately NOT wrapped in try/catch, unlike every other action
    /// here: withdrawing exactly up to maxWithdraw must always succeed, no
    /// matter what sequence of deposits, donations, rebalances, sweeps,
    /// pause toggles, or time advancement came before it, matching the rule
    /// that withdrawals are never pausable (see docs/architecture.md). If
    /// this ever reverts, that is a genuine property violation, not an
    /// expected/tolerated failure like an over-large withdraw request would
    /// be, so it must actually fail the invariant run rather than being
    /// silently discarded.
    function withdrawUpToMaxNeverReverts(uint256 actorSeed) public {
        address user = _actor(actorSeed);
        uint256 maxW = vault.maxWithdraw(user);
        if (maxW == 0) return;

        vm.prank(user);
        (bool success,) = address(vault).call(abi.encodeWithSelector(vault.withdraw.selector, maxW, user, user));
        assertTrue(success, "withdrawing up to maxWithdraw must never revert, regardless of prior actions");
    }

    /// @dev An unsolicited direct transfer, the exact "USDC donation attack"
    /// shape documented in docs/architecture.md: native USDC and its ERC-20
    /// interface share one balance on Arc, so anyone can inflate what
    /// balanceOf(vault) shows, at any time, not just at first deposit.
    function donate(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);
        usdc.mint(address(vault), amount);
    }

    /// @dev A bounded, policy-shaped REBALANCE into EURC. Bounded to a small
    /// fraction of the current USDC ledger so it has a real chance of
    /// passing VaultPolicy's allocation/drawdown limits instead of reverting
    /// on every single call, while still genuinely exercising the swap path
    /// that moves the ledger for two assets at once.
    function rebalanceIntoEurc(uint256 amountSeed) public {
        uint256 ledgerUsdc = vault.ledgerOf(address(usdc));
        if (ledgerUsdc == 0) return;
        uint256 amountIn = bound(amountSeed, 1, ledgerUsdc / 10 + 1);

        eurc.mint(address(router), type(uint128).max);

        IVaultPolicy.TargetAllocation[] memory targets = new IVaultPolicy.TargetAllocation[](2);
        targets[0] = IVaultPolicy.TargetAllocation({asset: address(usdc), targetWeightBps: 9000});
        targets[1] = IVaultPolicy.TargetAllocation({asset: address(eurc), targetWeightBps: 1000});

        IVaultPolicy.AssetPrice[] memory prices = new IVaultPolicy.AssetPrice[](1);
        prices[0] = IVaultPolicy.AssetPrice({
            asset: address(eurc),
            price: 1e18,
            referencePrice: 1e18,
            updatedAt: block.timestamp
        });

        MandateVault.SwapLeg[] memory swaps = new MandateVault.SwapLeg[](1);
        swaps[0] = MandateVault.SwapLeg({
            router: address(router),
            tokenIn: address(usdc),
            tokenOut: address(eurc),
            fee: 500,
            amountIn: amountIn,
            minAmountOut: 0,
            deadline: block.timestamp + 3600,
            sqrtPriceLimitX96: 0
        });

        try vault.executeDecision(
            IVaultPolicy.Decision({
                action: IVaultPolicy.DecisionAction.REBALANCE,
                asset: address(0),
                amount: 0,
                targetAllocations: targets
            }),
            prices,
            swaps
        ) returns (bool) {} catch {}
    }

    /// @dev sweepDust is now a propose/execute pair behind a 48h timelock
    /// (see contracts/MandateVault.sol), not a single instant call, so this
    /// warps forward past the timelock itself to actually exercise the full
    /// cycle within one action, rather than relying on the separate warp
    /// action to happen to land far enough ahead by chance.
    function sweepDust(uint256 actorSeed) public {
        address to = _actor(actorSeed);
        _proposeAndExecuteSweep(address(usdc), to);
        _proposeAndExecuteSweep(address(eurc), to);
    }

    function _proposeAndExecuteSweep(address asset_, address to) internal {
        try vault.proposeSweepDust(asset_, to) {
            vm.warp(block.timestamp + vault.SWEEP_DUST_TIMELOCK() + 1);
            try vault.executeSweepDust(asset_) {} catch {}
        } catch {}
    }

    /// @dev Lets time-dependent logic (day-boundary trade resets, the
    /// router-change timelock) actually get exercised across a run, not
    /// just accounting logic at a frozen timestamp.
    function warp(uint256 secondsForward) public {
        secondsForward = bound(secondsForward, 0, 2 days);
        vm.warp(block.timestamp + secondsForward);
    }

    /// @dev Without this, the vault would never actually get paused during a
    /// run, making any invariant conditioned on paused() vacuously true (the
    /// branch never taken). checkAndAutoPause's real trigger conditions
    /// (oracle deviation/staleness/drawdown speed) are deliberately not
    /// reproduced here, this is a direct PAUSER_ROLE toggle instead, so
    /// pause/unpause actually happens throughout the random sequence.
    function togglePause(bool shouldPause) public {
        bool currentlyPaused = policy.paused();
        if (shouldPause && !currentlyPaused) {
            policy.pause();
        } else if (!shouldPause && currentlyPaused) {
            policy.unpause();
        }
    }
}

/// @notice Real forge invariant tests: multi-call, stateful fuzzing across
/// arbitrary sequences of the handler's actions. Closes the gap between what
/// README.md's Phase 2 plan promised ("Foundry test coverage and invariant
/// tests started immediately, not deferred") and what existed before this
/// file, per-function property fuzz tests only, each a single isolated call,
/// never a sequence.
contract MandateVaultInvariantTest is Test {
    MandateRoles internal roles;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockSwapRouter internal router;
    MandateVault internal vault;
    VaultPolicy internal policy;
    MandateVaultHandler internal handler;

    function setUp() public {
        roles = new MandateRoles(address(this));

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
        maxBps[1] = 5_000;
        address[] memory stableAssets = new address[](1);
        stableAssets[0] = address(usdc);

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

        handler = new MandateVaultHandler(vault, policy, usdc, eurc, router);

        // The handler calls the vault directly (no vm.prank inside those
        // handler functions), so msg.sender at the vault is the handler
        // contract itself, it needs KEEPER_ROLE (executeDecision) and
        // GOVERNANCE_ROLE (sweepDust) to have any chance of those calls
        // succeeding rather than always reverting on the role check first.
        roles.grantRole(roles.KEEPER_ROLE(), address(handler));
        roles.grantRole(roles.GOVERNANCE_ROLE(), address(handler));
        roles.grantRole(roles.PAUSER_ROLE(), address(handler));

        targetContract(address(handler));
    }

    /// @dev The core property the whole ledger-based accounting design
    /// exists for (see docs/architecture.md, "USDC donation attack" and "the
    /// same donation risk applies to any ERC20 the vault holds, not just
    /// USDC"): no sequence of deposits, withdrawals, swaps, donations, or
    /// dust sweeps can ever make the internal ledger overstate what the
    /// vault actually holds.
    function invariant_ledgerNeverExceedsRealBalanceForAnyRegisteredAsset() public view {
        assertLe(vault.ledgerOf(address(usdc)), usdc.balanceOf(address(vault)));
        assertLe(vault.ledgerOf(address(eurc)), eurc.balanceOf(address(vault)));
    }

    /// @dev Pause must block new deposits/mints regardless of what sequence
    /// of actions led to the paused state, not just in the single-call fuzz
    /// test already covering this in MandateVault.t.sol.
    function invariant_pausedAlwaysBlocksNewDepositsAndMints() public view {
        if (policy.paused()) {
            assertEq(vault.maxDeposit(address(0)), 0);
            assertEq(vault.maxMint(address(0)), 0);
        }
    }

    /// @dev Share accounting consistency, flagged in an earlier review as a
    /// testing goal: converting shares -> assets -> shares must never
    /// increase the share count, whatever the current totalSupply/
    /// totalAssets ratio happens to be after the random history so far. This
    /// is the concrete meaning of "no precision drift that could be
    /// exploited by many small repeated operations": OZ's ERC4626 rounds
    /// against the user on every conversion by construction, so a round trip
    /// must never be profitable. Checked against the actual live state after
    /// every call in the sequence, not just at a single fixed point.
    function invariant_shareToAssetRoundTripNeverProfitable() public view {
        uint256 supply = vault.totalSupply();
        if (supply == 0) return;
        uint256 sampleShares = supply / 7 + 1;
        uint256 assets = vault.convertToAssets(sampleShares);
        uint256 sharesBack = vault.convertToShares(assets);
        assertLe(sharesBack, sampleShares, "shares -> assets -> shares must never yield more shares than started with");
    }

    /// @dev The other direction of the same guarantee: assets -> shares ->
    /// assets must never yield more assets than started with, so a user
    /// cannot extract value purely through repeated small round trips.
    function invariant_assetToShareRoundTripNeverProfitable() public view {
        uint256 totalAssets_ = vault.totalAssets();
        if (totalAssets_ == 0) return;
        uint256 sampleAssets = totalAssets_ / 7 + 1;
        uint256 shares = vault.convertToShares(sampleAssets);
        uint256 assetsBack = vault.convertToAssets(shares);
        assertLe(assetsBack, sampleAssets, "assets -> shares -> assets must never yield more assets than started with");
    }
}
