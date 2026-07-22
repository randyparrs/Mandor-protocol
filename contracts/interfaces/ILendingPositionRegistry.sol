// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVaultPolicy} from "./IVaultPolicy.sol";

/// @notice The external interface of LendingPositionRegistry: the v4
/// satellite contract that tracks cross-chain lending position state and
/// enforces reporting/staleness rules, same "separate deployed contract,
/// no funds of its own" shape as VaultPolicy. Split out from MandateVault
/// specifically to relieve EIP-170 pressure on MandateVaultDeployer (which
/// embeds MandateVault's full creation bytecode) -- see docs/deployments.md's
/// v4 section for the real, measured numbers that made this necessary, not
/// a stylistic choice.
interface ILendingPositionRegistry {
    /// @notice Called only by the vault, at BRIDGE_DEPOSIT execution time,
    /// after the real depositForBurn call and ledger debit already
    /// happened. Assigns a new positionId and records it as
    /// IN_TRANSIT_OUT, principalUSDC = the exact amount just burned,
    /// lastReportedAt = now (the clock anchor for staleness before any
    /// real report exists, see IVaultPolicy.sol's lendingPositionForceUnwindSeconds
    /// doc comment).
    function recordNewPosition(uint256 chainId, uint256 principalUSDC) external returns (uint256 positionId);

    /// @notice Called by the vault (agent-proposed BRIDGE_WITHDRAW, or the
    /// EMERGENCY_EXIT_TO_STABLE unwind loop in executor/keeperService.ts,
    /// same single path per position either way) or by anyone via
    /// checkAndInitiateStaleWithdrawal below. Idempotent: a position
    /// already WITHDRAWAL_PENDING/IN_TRANSIT_BACK/CLOSED is left
    /// unchanged, not reverted, since both triggers can race harmlessly.
    function initiateWithdrawal(uint256 positionId, bytes32 reason) external;

    /// @notice Permissionless, mirrors VaultPolicy.checkAndAutoPause's
    /// "anyone can escalate, the contract enforces the real condition"
    /// pattern, scoped to one position rather than the whole vault (see
    /// docs/deployments.md's v4 section for why a full pause would be
    /// disproportionate here). Reverts if the position is not actually
    /// past lendingPositionForceUnwindSeconds. Pays the caller via
    /// IStaleWithdrawalBountyPayer, a duplicated-by-design mirror of
    /// IAutoPausePayer, never the same mechanism (a deliberate
    /// decision: different trigger, likely different economics over
    /// time, not worth coupling).
    function checkAndInitiateStaleWithdrawal(uint256 positionId) external;

    /// @notice Called by the vault's keeper once CCTP funds land back on
    /// this chain and the vault's own ledger has already been credited
    /// (see MandateVault.confirmCrossChainWithdrawalComplete). Removes the
    /// position from tracking entirely; a CLOSED position is never
    /// visible in currentPositions() afterward, its value has already
    /// returned to the vault's own ledger by then.
    function markClosed(uint256 positionId) external;

    /// @notice Sum of every tracked position's current accounting value,
    /// see IVaultPolicy.LendingPositionHolding's own doc comment for the
    /// per-status valuation rules (principal while in transit, last
    /// report while open and fresh, a conservative floor once stale or
    /// mid-unwind). Called by MandateVault.totalAssets().
    function totalValueUSDC() external view returns (uint256);

    /// @notice Every tracked position's full state, for VaultPolicy's
    /// validateDecision. Called by MandateVault._buildState().
    function currentPositions(uint256 nav) external view returns (IVaultPolicy.LendingPositionHolding[] memory);

    /// @notice The dedicated keeper wallet authorized to call
    /// reportLendingPosition for this chain, and the address MandateVault
    /// derives depositForBurn's mintRecipient from at BRIDGE_DEPOSIT time
    /// -- never a keeper-supplied value, always read fresh from here, same
    /// "never trust a caller-supplied destination for where funds go"
    /// discipline as every other real transfer in MandateVault.sol.
    function chainKeeper(uint256 chainId) external view returns (address);
}

/// @notice The one function MandateVault must expose so
/// LendingPositionRegistry can trigger the stale-withdrawal bounty payout
/// out of the vault's own assets. Deliberately a SEPARATE interface and a
/// separate, duplicated cap/payout mechanism from IAutoPausePayer, not a
/// generalization of it -- a deliberate decision (this trigger
/// compensates for initiating a withdrawal whose real execution happens on
/// a different chain, with different gas economics than an Arc-local
/// auto-pause; coupling them now risks having to split them apart again
/// later at higher cost than the duplication costs today).
interface IStaleWithdrawalBountyPayer {
    function payStaleWithdrawalBounty(address to) external;
}
