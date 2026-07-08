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
