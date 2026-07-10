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

No real database yet (`db/` is not built): `DecisionPipeline` is an
in-memory store, a single process instance is the source of truth for
pending confirmations, a restart loses anything still pending. Acceptable
for now, this module never signs or moves funds either way, see
`docs/threat-model.md`'s "ops-confirmation account compromised" row.
`scripts/testDecisionPipelineAgainstRealVault.ts` runs the full real path
end to end against the live deployed vault: a real Claude proposal, a real
onchain-limits pre-check, queuing, and confirmation.
