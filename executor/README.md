# executor/

The keeper/executor service. The one module in the whole repo that holds a
signing key. Mirrors Vpay's `server/swapExecutor.ts` isolation pattern:
single-purpose, imported by nothing else, exposed through one narrow
interface.

`keeperService.ts` takes a confirmed decision and: re-runs the offchain
pre-check as a final sanity guard, simulates the transaction, submits it to
`MandateVault.executeDecision(...)`, and does nothing else.

**Built:** `types.ts` (`Executor` interface, the swappable seam),
`paperExecutor.ts` (`PaperExecutor`, holds no key, makes no onchain call,
appends one JSON line per decision to `data/paperVaultDecisions.jsonl` so
Paper Vault decision history can accumulate before `server/`'s real
`DecisionRecord` store exists), `alertSink.ts` (`AlertSink`/`KeeperEvent`,
`ConsoleAlertSink` the real Phase 1 implementation, no notification channel
exists anywhere in this repo yet, a richer webhook/Slack sink is additive
later), and `keeperService.ts` (`KeeperService`, the real signer, design
reviewed with Randy before writing any code, see the plan file this session
produced). "The one module that holds a signing key" below refers
specifically to `keeperService.ts`, not this file's `Executor` interface or
`PaperExecutor`.

**`KeeperService`, built this round, covers:**
- **Key handling:** `KEEPER_PRIVATE_KEY` read once from `process.env` inside
  a private `loadKeeperAccount()`, never hardcoded, never included in any
  thrown error's message, never exported.
- **Price reuse:** reuses the exact `MarketData` `server/decisionPipeline.ts`
  stored at proposal time (`DecisionPipelineEntry.marketData`), refreshing
  only if a price is older than the vault's own `oracleMaxStalenessSeconds`.
- **Simulate + abnormal-delta check:** `publicClient.simulateContract`
  before ever submitting (a revert aborts cleanly with the decoded reason);
  a post-transaction NAV comparison flags (does not block, the tx already
  landed) a `"critical"` alert if `totalAssets` moved despite zero swap
  legs, which should never happen for `HOLD`/`EMERGENCY_EXIT_TO_STABLE` on
  today's USDC-only vault. A real threshold for `ENTER`/`EXIT`/`REBALANCE`
  (which do move NAV on purpose) isn't built yet, see the next point.
- **Sequential nonce handling:** `runOnce()` processes every confirmed,
  not-yet-executed decision one at a time, `await`-ing each submission's
  receipt before starting the next, same pattern
  `scripts/deployArcTestnet.ts`'s `confirm()` helper already established.
- **Never auto-retries:** any failure (stale precheck, simulate revert, a
  reverted receipt) logs, alerts, and leaves the entry `"confirmed"`
  (still visibly stuck), never retried automatically.
- **Heartbeat and monitoring:** an `"info"` heartbeat every `runOnce()`
  call, a `"warning"` alert for any confirmed entry stuck past
  `EXECUTION_STUCK_TIMEOUT_SECONDS`.
- **Self-consistency for `EMERGENCY_EXIT_TO_STABLE` only:** 3 fresh
  `proposeDecision` samples against current state, unanimous 3/3 agreement
  required (Randy's explicit call, this action bypasses every onchain
  allocation/drawdown check). Any dissent returns the entry to
  `"pending_confirmation"` with `priority: "high"` and a
  `SELF_CONSISTENCY_DISAGREEMENT` anomaly flag via
  `DecisionPipeline.returnToQueueForReview`, and fires a `"critical"`
  alert, never executes on stale ops authorization.

**Explicitly out of scope this round:** real swap-leg construction (router
quoting via the real Quoter, slippage tolerance) for
`ENTER`/`EXIT`/`REBALANCE`. Today's live vault is USDC-only, so `HOLD` and
`EMERGENCY_EXIT_TO_STABLE` never need a swap leg, same "no live consequence
yet" reasoning already used for `agent/policy/offchainPolicyCheck.ts`'s
ENTER/EXIT projection gap. `buildSwapLegs` throws a clear error rather than
guess a swap if a confirmed decision ever actually needs one.

`KeeperServiceConfig` exposes injectable seams
(`getVaultStateFn`/`buildPolicyLimitsStructFn`/`getMarketDataFn`/
`buildProposeDecisionInputFn`/`proposeDecisionFn`/`keeperAccount`/
`walletClient`) so `test/keeperService.ts` can exercise nonce sequencing,
no-retry behavior, and self-consistency branching with fixtures, without a
real signer, a real Anthropic API call, or a live chain. A real end-to-end
run against the live vault is
`scripts/testKeeperServiceAgainstRealVault.ts` instead.

## Must never do

- Never custody vault assets, even transiently. Swaps execute atomically
  inside the vault contract itself; the keeper only assembles and submits the
  transaction.
- Never let the keeper key do anything beyond calling `executeDecision`. It
  has no role authority to pause, change roles, or withdraw funds.
- Never skip simulation before submission.
- Never let the keeper run without a heartbeat. It is not a fund-safety
  single point of failure (withdrawals never route through it), but it is an
  availability one, a confirmed decision sitting unexecuted, or missed
  heartbeats, must alert into the same monitoring channel as everything else
  in `docs/threat-model.md`.

