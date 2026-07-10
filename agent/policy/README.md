# agent/policy/

`offchainPolicyCheck.ts`, a fast, advisory TypeScript re-implementation of
`VaultPolicy.sol`'s validation math. Used before ever touching the chain, so
the decision pipeline gets instant feedback instead of waiting on a
transaction.

## Must never do

- Never treat this check as authoritative. Only the on-chain call inside
  `MandateVault.executeDecision` is the real gate. This module can reject
  early to save gas and give fast feedback, but it can never be the reason a
  decision is allowed to execute.
- Never let this implementation drift from the Solidity version silently.
  Phase 2 must run both against the same fixture set in CI.

## Built

`checkPolicyOffchain` (`offchainPolicyCheck.ts`), a pure function (no
`PublicClient`, no RPC call, so it runs before ever touching the chain and is
unit tested with plain fixtures, see `test/offchainPolicyCheck.ts`).
Deliberately mirrors `contracts/VaultPolicy.sol`'s `validateDecision` check
for check, same order, same conditions, same violation codes
(`shared/policyTypes.ts`'s `PolicyViolationCode`). Callers with a live
`PublicClient` build its `PolicyLimits` input via
`agent/core/context.ts`'s `buildPolicyLimitsStruct`.

**Projection model for the "as if this decision executes" state
`validateDecision` expects** (per that function's own doc comment,
`currentHoldings`/`currentDrawdownBps` are supplied pre-computed by the
caller, `VaultPolicy.sol` never computes trade deltas itself, that is the
keeper's job once built, see `docs/architecture.md`'s pipeline diagram,
"keeper simulates" runs after this pre-check, not before). Since the keeper
does not exist yet, this module's projection is a best-effort approximation,
explicitly not authoritative, same as the check result itself:
- `HOLD`: holdings unchanged.
- `REBALANCE`: `decision.targetAllocations` is already a full target bps
  vector, used directly, nothing to project.
- `ENTER`/`EXIT`: assumes vault NAV is unchanged (a swap into/out of the
  vault's base asset, identified via the `assets: KnownAsset[]` parameter's
  `isBaseAsset` flag, not new deposited/withdrawn capital), crediting or
  debiting the traded amount's USDC value against the base asset. A vault
  funding an `ENTER` from more than one non-base holding at once is not
  modeled. Today's live vault is USDC-only (`docs/deployments.md`), so this
  gap has no live consequence yet; revisit once a second asset is added.
  `MAX_DRAWDOWN_EXCEEDED` is checked against the vault's current
  `currentDrawdownBps` unchanged for the same reason, none of the actions
  this module projects can move NAV.
- `EMERGENCY_EXIT_TO_STABLE`: bypassed entirely, exactly matching
  `VaultPolicy.sol`'s own unconditional bypass for this one action.

Throws rather than guess whenever it cannot safely project (a `REBALANCE`
missing `targetAllocations`, an `ENTER`/`EXIT` missing `asset`/`amount`, or
targeting an asset with no configured market price and no `isBaseAsset`
flag), same "throw rather than fabricate" discipline
`agent/core/tools/getMarketData.ts` already follows.

All decimal/scale conversion here goes through `shared/money.ts`
(`parseRawAmount`, `INTERNAL_FIXED_POINT_DECIMALS`), never a local
`parseUnits` call, see that file and `agent/core/README.md`'s postmortem for
why: the same class of bug already slipped through once via ad-hoc scaling
math duplicated per file.
