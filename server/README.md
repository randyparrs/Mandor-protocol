# server/

Express app: orchestration and API. Never the signer.

- `api.ts`, public read routes: vaults, timeline, reports, follow. No auth.
- `decisionPipeline.ts`, propose -> offchain pre-check -> rate-limit/anomaly
  flag -> ops confirmation queue. Every queued decision (`QueuedDecision` in
  `shared/decision.ts`) carries a hard `expiresAt`; this module is what
  auto-marks an unconfirmed decision `"expired"` once that time passes, it
  is never confirmable late.
- `ops/`, internal, auth-gated, team-only in Phase 1: confirm or reject a
  proposed decision, trigger Paper Vault runs, publish reports.
- `reports/`, monthly AI report generator. A separate Claude call path with
  its own system prompt and no wiring whatsoever to the `proposeDecision`
  tool, it cannot produce a `VaultDecision`, even in principle.
- `indexer/`, listens to Vault/Policy contract events, writes
  `DecisionRecord` rows, feeds the monitoring/alerting hook.
- `db/`, off-chain persistence for everything that is not on-chain source of
  truth (see `docs/architecture.md` section 6).

## Must never do

- Never hold the keeper signing key or the Anthropic API key outside its own
  isolated module. The Anthropic key lives only where `agent/core` runs
  (invoked from here, but never exposed to the frontend).
- Never be in the deposit/withdraw signing path. Those are ordinary
  user-signed ERC-4626 transactions through the frontend; this module only
  indexes the resulting events.

## Built

`decisionPipeline.ts` (`DecisionPipeline` class). `proposeAndQueue` is the
real path: calls `agent/core`'s `proposeDecision` (real Claude call), then
`agent/policy`'s `checkPolicyOffchain`, computes anomaly flags, and queues
the result as a `QueuedDecision` with a hard `expiresAt`
(`DECISION_CONFIRMATION_TIMEOUT_SECONDS`, `shared/decision.ts`, currently 15
minutes). `enqueue` is the pure half of that same path (decision + pre-check
result already in hand), split out so the queue/confirm/reject/expire logic
is unit-testable without a real API call, see `test/decisionPipeline.ts`.
`confirm`/`reject` refuse (throw) on an entry that is not still
`pending_confirmation`, including one already past `expiresAt`,
`sweepExpired` flips any stale entry to `"expired"` and runs at the start of
every read/mutation, so a decision can never be confirmed late regardless of
whether an external cron has swept it yet, matching
`docs/architecture.md`'s "Ops confirmation has a hard expiration" exactly.

**Anomaly flags, `computeAnomalyFlags`,** advisory only, never a reason to
block queuing on their own (the real gate is `VaultPolicy.sol`, not this
pipeline): `POLICY_PRECHECK_VIOLATION` when the offchain pre-check predicts
an onchain rejection, `LOW_CONFIDENCE` below `0.5` (matching
`systemPrompt.ts`'s own "genuinely uncertain" calibration threshold), and
`HIGH_PROPOSAL_RATE` once this pipeline has already queued
`maxTradesPerDay` decisions for the same vault within 24h, tied to the
vault's own real onchain daily trade cap rather than an arbitrary constant.
`server/README.md`'s original "rate-limit/anomaly flag" line in the pipeline
diagram was not otherwise specified anywhere in the docs; this is a
deliberately minimal, documented interpretation of it, extend
`computeAnomalyFlags` if a real incident shows it needs more.

**`db/decisionStore.ts` (built): real, durable persistence, `DecisionPipeline`
no longer loses everything on a restart.** Uses `node:sqlite`
(`DatabaseSync`, built into Node 22.5+, confirmed available in this
project's Node version, no native build step, no external DB server to
provision, same "solo/small-team pace" pragmatism `docs/threat-model.md`
already applies to the keeper key's own storage). One table, each
`DecisionPipelineEntry` stored as a JSON blob plus a couple of indexed
columns (`vaultId`, `status`), deliberately not a normalized relational
schema or an ORM, that would be schema-migration overhead this stage
doesn't need yet. `DecisionPipeline`'s constructor takes an optional
`DecisionStore`: passing one hydrates the in-memory Map from it at
construction and persists every mutation to it; passing none (the default,
and what every existing fast test still uses) behaves exactly as before,
in-memory only, zero risk to already-passing tests. `test/decisionStore.ts`
proves durability for real: two separate `DecisionPipeline`/`DecisionStore`
instances against the same on-disk file, simulating an actual process
restart, confirm a "confirmed" decision survives it intact.
`scripts/testDecisionPipelineAgainstRealVault.ts` runs the full real path
end to end against the live deployed vault: a real Claude proposal, a real
onchain-limits pre-check, queuing, and confirmation.

**Extended for `executor/keeperService.ts`.** `DecisionPipelineEntry` now
also carries the exact `marketData` `proposeDecision` used (so the keeper
can reuse the price rather than refetch, see `executor/README.md`) and a
`priority: "normal" | "high"` field. Three new methods:
`listConfirmedUnexecuted(vaultId)` (what the keeper polls),
`markExecuted(decisionId, txHash)` (the one terminal, success-only
transition, only ever called after a real transaction receipt comes back
`status: "success"`), and `returnToQueueForReview(decisionId, flag)` (only
for the keeper's `EMERGENCY_EXIT_TO_STABLE` self-consistency gate: flips an
already-confirmed entry back to `"pending_confirmation"` with a fresh
`expiresAt` and `priority: "high"` when fresh proposals disagree, rather
than executing on stale ops authorization or silently discarding a
disagreement that is itself meaningful signal). Also gained
`findByTxHash(txHash)` and `listAllForVault(vaultId)`, both for
`indexer/eventIndexer.ts` to correlate onchain events back to the offchain
decision that produced them.

**`indexer/eventIndexer.ts` (built): `EventIndexer` polls
`MandateVault`/`VaultPolicy` for their real events** (`DecisionExecuted`,
`Paused`/`Unpaused`/`AutoPaused`, `SwapExecuted`, router/sweep
propose/cancel/execute, bounty events), persists them via
`db/eventStore.ts` (same `node:sqlite` pattern as `decisionStore.ts`, one
`events` table plus a per-contract `indexer_cursor` table so a restart
resumes from the last indexed block, not genesis or "now"). Polls rather
than subscribes: Arc Testnet's RPC (`https://rpc.testnet.arc.network`) is
plain HTTP, no websocket filter subscriptions available. Resumes from a
persisted per-contract cursor (`db/eventStore.ts`'s `indexer_cursor`
table), never genesis, and re-scans a small overlap window
(`RESTART_OVERLAP_BLOCKS`, currently 5) on every poll, not just after a
restart, since a short reorg could otherwise silently orphan an
already-indexed block, Arc Testnet's own reorg depth isn't verified
anywhere in this project. `insertIfNew`'s dedup key means the overlap
window never duplicates a row or re-fires an already-sent alert.
`Paused`/`AutoPaused`/`AutoPauseBountyCallFailed` fire a `"critical"` alert
unconditionally, per `docs/threat-model.md`'s "pause/unpause events...
alert always"; a `DecisionExecuted` with no matching
`DecisionPipelineEntry` (matched by `transactionHash`, the only key shared
between the offchain pipeline and an onchain log) fires a `"warning"`.
`buildDecisionTimeline(pipeline, eventStore, vaultId)` is the actual AI
Decision Timeline: every decision this pipeline ever produced, joined
against its correlated onchain result at read time, not a third persisted
table duplicating both stores. Verified against the real deployed vault
(`scripts/testEventIndexerAgainstRealVault.ts`, read-only): correctly
found and decoded the real `DecisionExecuted` event from the keeper's
first real transaction.

**`scripts/runDecisionCycle.ts` (built): the real, unattended
propose -> auto-confirm-if-HOLD -> keeper -> indexer cycle**, run for
every vault in its `VAULTS` list (currently v1 USDC-only and v2
USDC+cirBTC, see `docs/deployments.md`), sharing the same real
`data/mandate.db`. Never a long-running loop itself, invoked periodically
by Windows Task Scheduler (one scheduled task, extended to cover both
vaults rather than one task per vault). `autoConfirmIfHold` on
`DecisionPipeline` is the only auto-confirmation path this system has,
deliberately narrow: HOLD never moves funds or changes state, every other
action always requires a real human `confirmedBy`, no exceptions,
confirmed explicitly with Randy.
