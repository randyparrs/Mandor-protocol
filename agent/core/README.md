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
- Never pin only `modelId` and treat the system prompt text as exempt from
  the same discipline. A prompt edit is the same class of behavioral risk as
  a model change. `modelId` plus a hash of the exact rendered system prompt
  (after vault-specific variables are substituted) both go into every
  `DecisionRecord`, see `docs/architecture.md`.
- Never let extended thinking content carry more authority than `reasoning`
  does. Same status: explainability and audit value only, zero execution
  authority, `VaultPolicy`'s onchain gate does not care what either field
  says.

## Built

`index.ts` (barrel), `loop.ts` (`proposeDecision`, real `@anthropic-ai/sdk`
call via `client.messages.parse`), `types.ts`, `schemas.ts` (Zod, generated
from `shared/decision.ts`'s shape, not hand-written, using `zod/v4`
specifically since `zodOutputFormat`'s internal `z.toJSONSchema` call only
accepts `zod/v4`-shaped schemas), `systemPrompt.ts`, `modelPin.ts` (per-vault
pinned Claude model version, no silent migration).

Model: pinned per vault via `modelPin.ts`, never hardcoded in `loop.ts`
itself. Currently pinned to `claude-sonnet-5` for this stage, an explicit
cost-driven choice, not `claude-opus-4-8`. Structured output via
`output_config.format` (not tool use), adaptive thinking (`thinking: {type:
"adaptive"}`) rather than a manual budget or an explicit per-action branch:
the action is exactly what `proposeDecision` is deciding, so a branch keyed
on the action can't run before the action exists. Adaptive thinking has no
budget parameter at all, unlike the older `enabled`/`budget_tokens` mode,
Claude decides organically whether and how much to think, per request, with
no dial to set.

**Worst-case cost per decision is bounded, verified against the code, not
assumed:** `loop.ts` sets `max_tokens: 8000`, the hard ceiling shared by
thinking and output text together on a single call. At Sonnet 5 output
pricing that is at most roughly $0.12 per decision (or ~$0.08 at the
introductory rate through 2026-08-31), regardless of how much the model
decides to think. `proposeDecision` returns the actual `thinkingTokens`
spent (from the API's own `usage.output_tokens_details`, not estimated), so
real cost per action type can be measured empirically once there is real
usage, rather than assumed.

**Permanent regression test, scope stated plainly:** `promptInjection.test.ts`
covers a small, explicit library of injection patterns (currently: a blunt
override demand, a conversational confidence nudge, and a fake system-tag
escape attempt inside `untrustedContext`), not prompt injection resistance
in general. Passing it is evidence those specific patterns don't work, not
proof the problem is solved. `VARIANTS` in that file is the intended
extension point, grow it over time as new patterns are worth guarding
against (subtler value nudges, other tag-escape shapes, roleplay-style
framing), rather than treating the current three as a ceiling.

Each scenario (clean and every variant) runs 3 trials, not 1, since these
are real, non-deterministic API calls, a single sample per side risks
confusing ordinary model variance with an actual injection success or
failure. Assertions compare majority action and median confidence across
trials, and, for variants demanding a specific literal value, require that
at most a minority of trials hit that exact value. Not part of the free,
fast `npx hardhat test` suite (real API cost, non-deterministic LLM output,
~12 calls per run at 3 variants), run explicitly with `npm run test:agent`
whenever `systemPrompt.ts` or a model pin changes.

**Truncation cannot silently produce an accepted decision, verified against
the installed SDK's own source
(`node_modules/@anthropic-ai/sdk/src/lib/parser.ts`), not assumed.** If
`max_tokens` cuts the response off before the structured JSON completes,
`JSON.parse` throws inside `zodOutputFormat`'s parse callback; if it lands on
syntactically valid but schema-incomplete JSON instead, `zodObject.safeParse`
fails. Either way `client.messages.parse` rejects, `loop.ts` catches this and
rethrows with a clear message rather than relying on the SDK's own generic
error text. This propagates exactly like any other failed proposal:
discarded, never accepted partially, never auto-retried by `proposeDecision`
itself. A future caller (the decision pipeline that doesn't exist yet) is
what decides whether to log/alert on a failure and whether a human proposes
again, not this function looping on its own.

**Reminder for whenever `DecisionRecord` is actually built (Phase 3
backend, `server/`, not this module):** it must persist `promptHash`
alongside `modelId`, and `thinkingText`/`thinkingTokens` with the same
zero-authority status as `reasoning`. `proposeDecision` already returns all
four fields today, so `DecisionRecord` only needs to store them, not derive
them.

**`context.ts` and `tools/getVaultState.ts`/`getMarketData.ts`, built and
verified against the real deployed vault** (`docs/deployments.md`), not a
mock. `getVaultState` reads `MandateVault`'s own ledger and
`VaultPolicy.paused()` live, framework-agnostic (a minimal inline ABI, not a
Hardhat artifact import, so this runs outside a Hardhat project too, same
requirement as the rest of this module). `context.ts`'s
`buildPolicyLimitsText` reads `VaultPolicy`'s immutable limits live too,
rather than a hand-copied string that could drift from what the contract
actually enforces; `buildPolicyLimitsStruct` reads the same data as a
structured `PolicyLimits` object instead of prompt text, for
`agent/policy/offchainPolicyCheck.ts`. `scripts/testContextAgainstRealVault.ts`
runs the full pipeline for real: real vault state, through a real Claude
call, to a structured decision, confirmed working end to end against the
live USDC-only vault.

**Real bug found and fixed while building `agent/policy/offchainPolicyCheck.ts`
against this same live vault: `getVaultState` was returning
`totalAssetsUSDC`/`ledgerAmount`/`valueUSDC` as raw, unformatted integers**
(the vault's native on-chain decimals for `totalAssetsUSDC`/`ledgerAmount`,
an internally-rescaled 18-decimal fixed-point integer for `valueUSDC`),
**not the human-readable decimal strings every consumer of `VaultState`
already assumes** (`loop.ts` puts `JSON.stringify(vaultState)` straight into
Claude's prompt; `scripts/testProposeDecision.ts` and
`promptInjection.test.ts`'s own fixtures both use plain decimals like
`"9000.00"`). A real 5 USDC seed deposit was coming back as
`totalAssetsUSDC: "5000000"` (raw 6-decimal integer) instead of `"5"`, and
`valueUSDC: "5000000000000000000"` (18-decimal wei-style) instead of `"5"`,
meaning every real `proposeDecision` call made against this vault before
this fix showed Claude a vault size many orders of magnitude off from
reality. `HOLD` was still the obviously correct action regardless, so no
past decision was wrong in outcome, but the reasoning was built on wrong
numbers, exactly the kind of thing this project's discipline exists to
catch before it matters. Fixed by scaling every raw on-chain read
(including `totalAssets()`/`highWaterMarkUSDC`, confirmed by reading
`MandateVault.sol`'s own `totalAssets()` to be denominated in the base
asset's native decimals, not a fixed 18-decimal figure as a stale comment
in this file used to claim) to 18-decimal internally, then formatting with
viem's `formatUnits` before it ever leaves this function. Re-verified against
the real vault after the fix: `totalAssetsUSDC`/`valueUSDC` both now read
`"5"`, and a real `proposeDecision` call's reasoning now explicitly says
"With only $5 total assets", matching reality.

**This was the second real decimals/units bug in this project** (after an
earlier native-18-vs-ERC20-6-decimals issue), so the raw formatUnits/scaling
math this file used to do inline has been pulled out into `shared/money.ts`
(`formatRawAmount`, `parseRawAmount`, `scaleToInternalFixedPoint`,
`assertHumanDecimalString`), a single, unit-tested place for this
conversion, reused here and by `agent/policy/offchainPolicyCheck.ts` rather
than each file re-implementing its own scaling. `test/getVaultState.ts` is a
permanent regression test, deliberately using a 6-decimal USDC mock (not
this repo's usual 18-decimal one, which makes the scaling step a no-op and
is exactly how this bug went unnoticed for so long): it asserts the exact
expected human-decimal string against a real local vault, so a regression
back to a raw/unformatted amount fails loudly instead of Claude silently
reasoning on wrong magnitudes again.

**`getMarketData` reads a real, current price for stable assets, never a
hardcoded constant.** A stablecoin's value is not a fact, it holds its peg
only as long as the market keeps it there (USDC itself briefly depegged in
March 2023). An earlier version of this function priced every stable asset
at a flat 1.00 USDC, which would have made a real depeg invisible to the
agent entirely, exactly the kind of anomaly an AI decision-maker should add
value catching, `VaultPolicy`'s own oracle deviation check protects
execution but never gave the agent itself anything to reason about or react
to. Fixed by reading the real, current USD price from CoinGecko's public
API (no API key required, rate-limited but acceptable at one call per
`proposeDecision`, not a hot loop) as a genuine external market signal,
until a real onchain oracle exists on Arc to read instead (still unverified,
see `docs/arc-facts-to-verify.md`). `priceUSDC` is what the market actually
says right now, `referencePriceUSDC` is the peg target, both visible to the
agent and to `VaultPolicy`'s own deviation check. Throws rather than
fabricate a price for any asset without a configured real source (see
`STABLE_ASSET_CONFIG`), same discipline as before.

**Requirement for whenever the keeper/executor is actually built (noted now
so it is not forgotten, same pattern already used for `VaultRegistry.sol`'s
`strategyAuthor` field): the price data `executeDecision`'s `AssetPrice[]`
parameter is populated with must be the same price `getMarketData` already
fetched for the proposal, not a second, independently-fetched value.**
`VaultPolicy.sol` deliberately never stores an oracle feed address (there is
no Chainlink or any other onchain oracle integrated in this codebase today,
confirmed by reading the contract's own comments and
`docs/arc-facts-to-verify.md`, "Chainlink oracle feed availability on Arc"
is still unverified), it validates staleness/deviation against whatever
price the caller supplies. If the keeper fetched its own price independently
instead of reusing the one the agent already reasoned over, that would
recreate the exact two-sources-of-truth problem this design already avoids
everywhere else, not between an external source and an onchain oracle
(none exists), but between two separate calls to the same kind of external
source at two different moments. If enough time has passed between proposal
and execution to justify refreshing the price, refresh it from the same
source and method, don't introduce a second one.

## Not yet implemented

`validate.ts` and `tools/getMarketData.ts`'s real price-feed path (anything
beyond stable assets) remain open: the former hasn't been designed yet, the
latter needs a verified oracle on Arc Testnet, which does not exist yet (see
`docs/arc-facts-to-verify.md`). Self-consistency (multiple `proposeDecision`
calls, requiring agreement before proceeding) is deliberately deferred until
the executor/keeper service exists, that is the layer that would actually
call `proposeDecision` more than once and decide what to do with
disagreement, building it now would mean building it without its real
consumer.
