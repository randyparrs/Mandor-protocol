# v5: ergodic rebalancing vault (USDC/cirBTC)

Status: **ACTIVE, deployed 2026-07-19.** Real vault: `MandateVault`
`0x95c42f3eBC5c5A5eEc9d716D9aA84aa5EE729667`, `VaultPolicy`
`0xb8A402E5CD24B0358256fA9744838586d9529FcB`, created through the Gen4
`VaultFactory` (`0x361B4CCBaDC0de931C01084EC9511D8a6BfdE83E`, see
`docs/deployments.md`'s "Fourth VaultFactory generation" section).
`maxDrawdownBps` independently re-read as 1000, and the REBALANCE
exemption itself confirmed live via a real functional `validateDecision`
call (REBALANCE passes with zero violations at `currentDrawdownBps=1500`,
HOLD correctly still fails) -- not just by trusting the constructor
argument's value, the same standard that caught a real deploy-time bug
along the way (see below).

**Two earlier deploy attempts are abandoned, never to be used for
anything real**, both created through the stale Gen3 (v4-era) factory
before a fresh factory bootstrap was known to be necessary:
- `0x724C7173584C74342BA9a35c8d15fb5C01cf0CBB` (`VaultPolicy`
  `0x85cC82749C1D7a90cBC421BBCbE129242FB38495`): wrong `maxDrawdownBps`
  (5000/50%, an earlier, rejected design) AND missing the REBALANCE
  exemption entirely.
- `0x0994708126158E0F1e57B80992028440253043Af` (`VaultPolicy`
  `0x74AeDd17257710DEd5e55F56E953A0fb5f15B7c0`): `maxDrawdownBps` correctly
  1000, but still missing the REBALANCE exemption (Gen3's `VaultFactory`
  embeds `VaultPolicy`'s full compiled logic via a direct
  `new VaultPolicy(...)`, frozen from before this session's edit -- see
  `docs/deployments.md` for the full writeup of this bug and its fix).

Both abandoned deploys hold a nominal 5 USDC seed each and are otherwise
inert (Blockers A/B below apply identically to them).

## KNOWN LIMITATIONS -- READ THIS BEFORE ANYTHING ELSE

**A real v5 deployment today would be purely symbolic: it cannot execute a
real rebalance in EITHER direction, not just buying.** This is not a
footnote or an edge case, it is the current, disclosed reality of deploying
this vault with real capital right now, same honesty pattern as v2's and
v3's own prominently-disclosed limitations (`docs/deployments.md`).

### Blocker A: no real UnitFlowV3 pool pairs native USDC with cirBTC at all -- blocks BOTH directions completely

Live-verified 2026-07-19 (`research/ergodic-rebalancing/checkUnitFlowV3Pools.ts`,
read-only, `Factory.getPool(nativeUSDC, cirBTC, fee)` at every standard fee
tier: 100, 500, 3000, 10000): **no pool at any tier.** The only real,
liquid pool involving cirBTC is WUSDC/cirBTC -- WUSDC being a *different*
token from native USDC (v5's own base asset, identical to v2's). This is
the same real gap v2's own "Known limitation" section already disclosed;
re-confirmed live here, not assumed stale from that earlier doc.

This blocker is **more fundamental than any reference-price restriction**:
with no pool at all, `executor/keeperServiceV4.ts`'s swap-leg construction
has no real venue to quote or trade against, in either direction. A v5
vault deployed today would seed with 100% USDC (same as v2's own seeding)
and would be **structurally unable to ever move toward its own stated 50/50
target via any real swap** -- not blocked from buying specifically, blocked
from trading this pair at all. Reducing an existing cirBTC position would
be equally impossible for the same reason, if the vault somehow held any
(there is no path by which it would, absent this same pool existing).

### Blocker B: no genuinely independent reference price exists for cirBTC -- would ADDITIONALLY block buying, even if Blocker A were resolved

Separately, and independently of Blocker A: `agent/core/tools/getMarketData.ts`'s
`getVolatileAssetPriceUSDC` sets cirBTC's `referencePriceUSDC` equal to its
own `priceUSDC` (no independent source exists on Arc, confirmed live
against Chainlink's own official Price Feed page, see
`docs/arc-facts-to-verify.md`). Two real, separate enforcement points:

- `executor/keeperServiceV4.ts`'s `requireIndependentReferencePriceToBuy`
  refuses to build a swap leg that BUYS cirBTC. Selling remains unaffected
  *by this specific check* (though still blocked by Blocker A above).
- `agent/policy/offchainPolicyCheck.ts`'s own
  `INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY` check (added as part of
  this same v5 design work) catches the identical condition earlier, at
  the offchain pre-check stage (ops-review time), instead of letting a
  decision reach "confirmed" only to fail with a late, confusing
  `EXECUTION_FAILED` alert at the keeper's own execution step.

**Even if Blocker A resolved tomorrow** (a real pool appeared), Blocker B
would still, on its own, block every buy-direction rebalance -- meaning the
vault would still degrade into the one-way ratchet described below, just
via a different, independent mechanism.

### Why this is categorically worse for v5 than for v2/v3

v2's own disclosed limitation states plainly, for itself: *"In practice
today, this vault can only hold or reduce cirBTC exposure, never increase
it."* For v2, that is a real but narrow constraint (v2 was never designed
around maintaining a specific weight, and Blocker A already means it can't
trade this pair at all regardless). For v3, the equivalent restriction
only blocks opening new LP positions, not its entire mechanism.

**v5 is different: its entire identity is a symmetric 50/50 target.**
Between Blocker A (blocks everything) and Blocker B (would independently
block buying alone), **real capital deployed to this vault today cannot
complete a single real rebalancing trade in either direction.** Not "the
buy side is blocked" -- the whole mechanism is inert. Both blockers are
real, pre-existing, already-disclosed constraints (neither is introduced
or worsened by v5's own design); v5 simply has no fallback mode that still
does something useful with real capital while they remain open, the way
v2's "just hold or trim" framing does.

`scripts/v5StrategyText.ts`'s own strategy text takes a deliberately
different approach from v2's `V2_CIRBTC_RESTRICTION_NOTE` for exactly this
reason: rather than telling the agent to never propose the buy-side half
(which would hide the ratchet effect behind an artificially "clean"
decision log), it tells the agent to keep proposing the honest, true 50/50
target in both directions, fully transparent about what the real strategy
wants to do, while being told explicitly that real execution cannot
currently follow through in either direction. The decision log stays
honest about the strategy's real intent, even though nothing it proposes
can execute for real today.

### What CAN be demonstrated today: the Paper Vault, using MANDORTEST tokens

Neither blocker applies to the Paper Vault's own simulated pools. The Paper
Vault (`scripts/paperVaultCycle.ts`) can demonstrate the full, bidirectional
mechanism end to end today, using `MANDORTEST-EQUITY` (the "more volatile"
of the four team-created test tokens, see `scripts/paperVaultTestTokens.ts`)
in place of cirBTC, since that token has a genuinely independent reference
price by design (a fixed seed-time target, distinct from its pool's own
live spot price) and trades against a real, team-seeded pool that actually
exists (unlike Blocker A's gap for native USDC/cirBTC).

`scripts/v5StrategyText.ts`'s `V5_ERGODIC_REBALANCING_PAPER_DEMO_TEXT`
mirrors v5's real strategy exactly (50/50 target, 3% threshold), substituting
`MANDORTEST-EQUITY` for cirBTC. **Not wired into
`scripts/paperVaultConfig.ts` by default** -- switching
`PAPER_STRATEGY_CONFIG_TEXT` over to this text is a one-line, deliberate
choice for whenever this specific demo is wanted:

```typescript
// scripts/paperVaultConfig.ts
import { V5_ERGODIC_REBALANCING_PAPER_DEMO_TEXT } from "./v5StrategyText.js";
export const PAPER_STRATEGY_CONFIG_TEXT = V5_ERGODIC_REBALANCING_PAPER_DEMO_TEXT;
```

Deliberately not made this change automatically: the Paper Vault's existing
default demonstrates v3's own yield/LP strategy, and switching its live,
already-scheduled default is an operational choice, not something this
design work should flip on its own.

### Bottom line

Deploying v5 today (per this project's own established precedent of
building real, disclosed-as-blocked mechanisms rather than waiting, same
as v2's cirBTC `ENTER` restriction and v3's cirBTC LP restriction) would
produce a real, correctly-configured, but **completely inert** vault with
respect to its own core strategy, until at least one of Blocker A or
Blocker B resolves (and, for the buy-direction specifically, until BOTH
resolve). This is worth weighing explicitly before deploying: unlike v2/v3,
there is no partial, still-useful mode v5 falls back to in the meantime.

## What this is

A new risk profile, not an extension of v2. v2 already holds USDC + cirBTC,
but its own `VaultPolicy` caps cirBTC at 20% of NAV (`maxAllocationBpsPerAsset[cirBTC]
= 2000`, `minStableAllocationBps = 8000`) -- a hard, structural mismatch with
v5's actual design, which targets 50% USDC / 50% cirBTC and rebalances back
to that target whenever the deviation crosses a threshold ("ergodic
rebalancing"). A 50% cirBTC weight would immediately violate v2's own cap,
so this needs its own `MandateVault`+`VaultPolicy` deployment, same "new risk
profile = new deployment, never mutate a live one" principle already applied
to every prior version.

Reuses the swap+`REBALANCE` mechanism only, deliberately not the LP
mechanism (v3) or cross-chain lending (v4) -- no new Solidity fields are
needed. `REBALANCE` + `SwapLeg`-based execution already exists and is
already live in production (v1/v2's own path), so this vault is built
entirely from mechanisms this project has already shipped and already
operates.

## Where the design comes from

Grounded in `research/ergodic-rebalancing/REPORT.md`'s real, historical
backtest (BTC/USDC, ETH/USDC, EUR/USDC, ~2.7 to ~27.5 years of real data
depending on the asset, net-of-cost, three thresholds tested), not asserted
from theory:

- **Threshold: 3%.** The tightest of the three thresholds tested (3%/5%/8%),
  and the one that produced the best net-of-cost result on real BTC/USDC
  data in that backtest.
- **Net edge is real but conditional, not unconditional.** The backtest's
  own honest conclusion: this strategy is expected to underperform simple
  buy-and-hold during a strong, sustained one-directional trend, and to
  outperform it (by a larger margin) during choppier, sideways conditions.
  `scripts/v5StrategyText.ts`'s own text tells the agent this explicitly, so
  a losing stretch during a real trend is read as expected behavior, not a
  signal something is broken.
- **One real historical cycle, not many.** The backtest's own disclosed
  limitation carries over here directly: this is a real, validated signal,
  not statistical proof the edge holds across every future market regime.

## Policy limits: what changed from v1-v4's shared defaults, and why

| Field | v1-v4 shared value | v5's value | Why |
|---|---|---|---|
| `maxAllocationBpsPerAsset[cirBTC]` | 2000 (v2 only) | **6500** | Real headroom around a 50% target: the vault is only checked when the keeper actually runs a cycle, not continuously, so price can drift further than the exact rebalance threshold before the next cycle executes. 65% leaves room well beyond the loosest threshold tested (8%). |
| `minStableAllocationBps` | 8000 (v2) | **3500** | The exact complement of 6500 -- kept symmetric and consistent with each other, not two independently-chosen numbers that could silently conflict. |
| `maxDrawdownBps` | 1000 (10%) | 1000 (10%, unchanged) | See the dedicated design section below: an earlier 5000 (50%) vault-wide proposal was rejected in favor of a surgical, REBALANCE-specific exemption -- the limit itself stays at v1-v4's original, protective value. |
| `maxTradesPerDay` | 5 | 5 (unchanged) | The validated backtest never came close to this cap even at the tightest (3%) threshold (32 rebalances over ~2.7 years for BTC, ~1 every 4 weeks on average). |
| `oracleMaxStalenessSeconds` / `oracleMaxDeviationBps` | 3600 / 500 | unchanged | Same structural no-op for cirBTC specifically that v2/v3 already disclose above -- not something v5 changes or can fix on its own. |
| `maxDrawdownSpeedBpsPerWindow` / `drawdownSpeedWindowSeconds` | 300 / 3600 | unchanged | A different kind of safety net (a rate-of-change guard against flash-crash/manipulation-like moves, triggering a reviewable pause, not a hard per-action block) -- left as an open item to monitor once live, not presumptively changed without real operational data. |

### `maxDrawdownBps`: REBALANCE-specific exemption (approved and implemented, 2026-07-19)

An earlier draft of this vault raised `maxDrawdownBps` from 10% to 50%
vault-wide, reasoning that this strategy's own 65%-cirBTC cap produces
larger real drawdowns (30-49% per `research/ergodic-rebalancing/REPORT.md`)
that would otherwise trip a 10% circuit breaker constantly, including
blocking the very `REBALANCE` action needed to recover. This approach was
rejected as too blunt: raising `maxDrawdownBps` globally dilutes a safety parameter
meant to catch abnormal conditions (bugs, oracle manipulation, catastrophic
failure), not to accommodate one strategy's own expected behavior.

**Approved design instead**: `REBALANCE` alone is exempt from
`VIOLATION_MAX_DRAWDOWN_EXCEEDED`; `maxDrawdownBps` itself stays at v1-v4's
original 1000 (10%) for every other action (`ENTER`/`EXIT`/`HOLD`). This is
safe specifically because a `REBALANCE`'s resulting allocation remains
fully, unconditionally bounded by `maxAllocationBpsPerAsset`/
`minStableAllocationBps` regardless -- those caps are never exempted, so
`REBALANCE` can never push the vault into an allocation riskier than the
target itself already defines, no matter how large the vault's currently
realized drawdown is.

Implemented in two places, deliberately asymmetric because of how each
layer's code lifecycle differs:

- **Onchain (`contracts/VaultPolicy.sol`)**: the `validateDecision` check
  became `if (decision.action != DecisionAction.REBALANCE && state.currentDrawdownBps > maxDrawdownBps)`,
  a one-line condition change. Solidity bytecode is frozen at each vault's
  own deploy time, so this only affects vaults deployed from this source
  onward (v5+) -- v1-v4's already-deployed `VaultPolicy` contracts have the
  old, unconditional check compiled in and are entirely unaffected.
- **Offchain (`agent/policy/offchainPolicyCheck.ts`)**: since this module
  is a single, shared, LIVE TypeScript file used by every vault version's
  decision pipeline simultaneously (unlike onchain bytecode, edits here
  take effect immediately for all callers, including v1/v2's real,
  scheduled production cycle), the exemption could not simply be hardcoded
  the same way without creating a real behavioral divergence for older
  vaults. Instead, `OffchainPolicyCheckParams` gained a new, opt-in
  `rebalanceExemptFromMaxDrawdown?: boolean` field, defaulting to
  false/undefined. Only v5's own caller passes `true`; v1-v4's callers
  never pass it, so their behavior is completely unchanged.

**Residual, accepted risk** (named plainly, not hidden): once `REBALANCE`
is exempt from this specific check, a `REBALANCE` occurring during a
genuinely abnormal drawdown (e.g. a manipulated oracle price) is no longer
blocked by `maxDrawdownBps` itself. This is mitigated by two other,
deliberately unchanged checks: `oracleMaxDeviationBps` (a structural
no-op for cirBTC specifically, same disclosed limitation as elsewhere in
this doc) and `maxDrawdownSpeedBpsPerWindow`/`drawdownSpeedWindowSeconds`
(a rate-of-change guard that triggers a reviewable auto-pause on
flash-crash/manipulation-like moves, regardless of action type).

Test coverage: `test/VaultPolicy.t.sol` proves `REBALANCE` passes
`validateDecision` during a high `currentDrawdownBps` while `ENTER`/`HOLD`
still correctly fail during the exact same drawdown (proving the exemption
is scoped to one action, not a general bypass). `test/offchainPolicyCheck.ts`
proves the TypeScript equivalent, plus a third case confirming that
omitting `rebalanceExemptFromMaxDrawdown` (v1-v4's real, unchanged calling
convention) still correctly flags `MAX_DRAWDOWN_EXCEEDED` for `REBALANCE`
too, exactly as it always has.

## Operating v5 once deployed

`scripts/deployVaultV5.ts` deploys via the Gen4 `VaultFactory`
(`0x361B4CCBaDC0de931C01084EC9511D8a6BfdE83E`), NOT the v4-generation
(Gen3) factory -- a new factory generation genuinely was needed here,
despite v5 needing no new `ConstructorLimits` field, because
`VaultFactory.sol` embeds `VaultPolicy`'s full compiled logic via a direct
`new VaultPolicy(...)` call, frozen at the factory's own deploy time. See
`docs/deployments.md`'s "Fourth VaultFactory generation (Gen4, for v5)"
section for the full writeup of this (initially missed, then caught and
fixed) lesson.

**Consequence, verified directly against `contracts/MandateVault.sol`**:
that file accumulates every version's fields in one place, so a vault
created through the current factory gets the FULL current `executeDecision`
ABI (`chainId`/`lendingPositionId`/`bridgeLeg` present, same as v4's own
vault), even though v5 never proposes `BRIDGE_*` or `LP_*` actions. **v5
must therefore be operated with `executor/keeperServiceV4.ts`'s
`KeeperServiceV4` class** (configured with v5's own `vaultAddress`/`assets`/
`scripts/v5StrategyText.ts`'s strategy text), not
`executor/keeperService.ts`'s older ABI -- the older module would encode
calldata v5's real deployed bytecode does not expect, and every call would
revert (the same class of ABI mismatch already diagnosed once this
project). No new keeper module is needed: v5 simply never proposes
`BRIDGE_*`/`LP_*` actions, the same way v4's own vault never proposes `LP_*`
despite having that capability compiled in too.

## Not yet done

- Wiring v5 into a scheduled decision cycle (mirrors `scripts/runDecisionCycle.ts`'s
  existing pattern for v1/v2, using `KeeperServiceV4` instead).
- Switching the Paper Vault over to the v5 demo text, if/when that specific
  demo is wanted live.

## Separate finding: an ETH/USDC variant is NOT buildable today (live-verified, not assumed)

Before considering an ETH/USDC version of this same mechanism, live-verified
2026-07-19 whether a real WETH-equivalent token with genuine liquidity
exists on Arc/UnitFlowV3 -- never checked anywhere in this project before
(`research/ergodic-rebalancing/checkUnitFlowV3Pools.ts`, read-only).

**Method**: rather than raw `eth_getLogs` against the public RPC (capped at
a 10,000-block range per call, confirmed live, impractical for a
full-history scan at this chain's real height of ~52.6M blocks), used
`testnet.arcscan.app`'s own real, indexed Blockscout-style v2 API (already
used elsewhere in this project, see `docs/deployments.md`) to paginate
through every real `PoolCreated` event the Factory has ever emitted.

**Result**: **501 real `PoolCreated` events, 233 unique tokens total, across
this Factory's entire history. Not one of them has a symbol matching
WETH/WrappedETH/ETH** (case-insensitive match against `weth`,
`wrapped eth`/`wrappedeth`, or an exact `eth` symbol). No real WETH-like
token has ever been paired with anything on UnitFlowV3, let alone with
real liquidity.

**Conclusion: an ETH/USDC v5 variant is not buildable on Arc/UnitFlowV3
today**, full stop -- there is no real venue at all, not merely a
thin-liquidity one. This is a completely different situation from cirBTC's
own two blockers above (which are real but eventually resolvable: an
independent oracle and/or a real pool could both plausibly appear over
time); here, the underlying asset itself has no real presence on this
DEX's history at all. Revisit only if a real WETH-equivalent token is
deployed and paired on UnitFlowV3 in the future -- re-run
`research/ergodic-rebalancing/checkUnitFlowV3Pools.ts` to check again
before assuming otherwise.
