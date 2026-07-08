# agent/core/

Framework-agnostic reasoning module. Mirrors Vpay's `agent/core` in spirit.

`proposeDecision()` reads vault state and market data, then asks Claude to
produce a structured `VaultDecision` (see `shared/decision.ts`). That is all
this module does.

## Must never do

- Never import or construct a signer. Never read a private key or a keeper
  credential, from env or anywhere else.
- Never build a transaction. Only `shared/decision.ts` shapes leave this
  module.
- Never concatenate strategy configuration text into the system prompt
  string. It is always injected as a separate, clearly labeled context block
  (`systemPrompt.ts` stays a single constant). Even though Phase 1's strategy
  text is always team-authored, this separation is what keeps the door open
  for stricter handling later without a rearchitecture.
- Never treat market data as trusted. Wrap any free-text field (e.g. a news
  headline) in an explicit untrusted-data block before it reaches the model.

## Planned files (not yet implemented)

`index.ts` (barrel), `loop.ts` (`proposeDecision`), `context.ts`, `types.ts`,
`schemas.ts` (generated from `shared/decision.ts`, not hand-written), `systemPrompt.ts`,
`modelPin.ts` (per-vault pinned Claude model version, no silent migration),
`validate.ts`, `tools/` (`getVaultState.ts`, `getMarketData.ts`,
`proposeDecision.ts`).
