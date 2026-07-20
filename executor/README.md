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
appends one JSON line per decision to `data/paperVaultDecisions.jsonl`,
via `shared/paths.ts`'s `projectDataPath` so the log always lands in the
same place regardless of the process's launch directory, so
Paper Vault decision history can accumulate before `server/`'s real
`DecisionRecord` store exists), and `keeperService.ts` (`KeeperService`,
the real signer, design reviewed with Randy before writing any code, see
the plan file this session produced). "The one module that holds a signing
key" below refers specifically to `keeperService.ts`, not this file's
`Executor` interface or `PaperExecutor`. `AlertSink`/`AlertEvent`/
`ConsoleAlertSink` moved to `shared/alertSink.ts` once `server/indexer/`
needed the same interface, no notification channel (Slack/PagerDuty/
webhook) exists anywhere in this repo yet, a richer one is additive later.

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

**Real swap-leg construction, built:** `buildSwapLegs` now sizes and
executes real `ENTER`/`EXIT`/`REBALANCE` swaps.
- **Quote before building:** `IQuoter.quoteExactInputSingle`
  (`contracts/interfaces/IQuoter.sol`, the real UnitFlowV3 Quoter's
  verified interface, not assumed from a generic Uniswap V3 template),
  called fresh via a plain `eth_call` right before building the leg,
  never reusing the reasoning-time price for this step, `minAmountOut`
  must reflect the pool's current state at submission time.
- **Price reuse, not re-fetch:** `amountIn` sizing (how much of the base
  asset an `ENTER` spends, how much of the target asset a `REBALANCE`
  delta implies) is always derived from the SAME `MarketData` price
  already reused elsewhere in this file, never a second, independently
  fetched value. `agent/core/tools/getMarketData.ts`'s
  `getVolatileAssetPriceUSDC` closes the pricing gap for cirBTC (no CEX/
  oracle source exists), reading the real pool's `slot0()` directly for a
  zero-price-impact spot price.
- **Slippage tolerance:** 3% (`SLIPPAGE_TOLERANCE_BPS`), deliberately more
  generous than mainnet-depth assumptions, the only real pool this has
  ever been verified against (WUSDC/cirBTC) is extremely thin (~0.00048
  cirBTC total reserve).
- **Two real bugs found and fixed while building this:**
  1. `getVolatileAssetPriceUSDC` originally quoted "1 whole cirBTC" as a
     probe amount, which for this thin pool means simulating a sell 2000x
     its real liquidity, crashing the quoted price to a small fraction of
     reality (confirmed live: ~$304 instead of the real ~$276,073 spot
     price). Fixed by reading the pool's `slot0()` `sqrtPriceX96` directly
     instead, a genuine zero-price-impact spot price.
  2. `buildOnchainPrices` scaled every cached price by the PRICED asset's
     own decimals, but `MandateVault.sol`'s `_valueInUSDC` formula
     requires scaling by the BASE asset's decimals instead. This was
     latent and harmless as long as only the base asset itself was ever
     priced (its own cached price is never read by `_valueInUSDC`), and
     went live and wrong the moment cirBTC needed pricing, caught by a
     new Foundry fork test failing to revert as expected (an under-scaled
     price made cirBTC's computed `valueUSDC` always ~0, trivially
     passing any allocation cap). Both fixes documented in
     `keeperService.ts`'s own comments at the fix site.
- **REBALANCE** reduces to one leg per non-base asset whose target bps
  differs from current, reusing the same per-asset quote-and-build helper
  ENTER/EXIT use; today's real vaults hold at most one non-base asset, so
  this only ever produces 0 or 1 legs in practice, written generally
  rather than hardcoded to that shape.
- **Not yet built:** an abnormal-delta bound specifically for
  `ENTER`/`EXIT`/`REBALANCE` (swaps.length > 0), beyond what
  `minAmountOut`/slippage tolerance and `VaultPolicy`'s own pre/post
  `validateDecision` calls already enforce.
- **Two different "prices" in this file, by design, not an
  inconsistency:** (1) the reasoning/sizing price (`marketData.prices`,
  reused from proposal time, refreshed only once stale relative to the
  vault's own `oracleMaxStalenessSeconds`) decides how much to trade, and
  must stay stable between proposal and execution so ops confirms the same
  numbers the keeper later acts on; (2) the slippage-protection quote
  (`quoteAndBuildLeg`'s fresh `IQuoter.quoteExactInputSingle` call, always
  refetched, never reused) decides `minAmountOut`, and must reflect the
  pool's actual state at submission time, which by definition cannot come
  from an earlier moment. Reusing (1) for `minAmountOut` would
  under-protect a swap against a pool that moved since proposal;
  re-fetching for (2) would defeat proposal-time price consistency. See
  the doc comment directly above `quoteAndBuildLeg` in `keeperService.ts`
  for the same statement kept next to the code it describes.

**A real oracle-manipulation gap found and hard-blocked, not just
documented:** the same `slot0()`-derived spot price
`getVolatileAssetPriceUSDC` (`agent/core/tools/getMarketData.ts`) returns
for cirBTC flows, unmodified, into `buildOnchainPrices`'s output, which
becomes `executeDecision`'s real `prices` argument, which `VaultPolicy.sol`
uses for both its `maxAllocationBpsPerAsset[cirBTC]` cap check and its
`oracleMaxDeviationBps` anti-manipulation check
(`_deviationBps(price, referencePrice)`). Because
`getVolatileAssetPriceUSDC` sets `referencePriceUSDC` equal to `priceUSDC`
itself (no genuinely independent second source exists for cirBTC, see
below), that deviation check is a permanent no-op for this asset, the
asset with the thinnest, most manipulable liquidity in the project
(~0.00048 cirBTC pool reserve). Confirmed live: no real Chainlink Data
Feed exists on Arc today despite the "Chainlink Scale" partnership
announcement (`docs/arc-facts-to-verify.md`), so there is no drop-in real
independent reference price to wire in instead, yet.

**Fix, a hard check/require, not just a comment:**
`agent/core/tools/getMarketData.ts`'s `hasIndependentReferencePrice(asset)`
returns `false` for any asset without a genuinely independent reference
source (fails closed; only `STABLE_ASSET_CONFIG` entries like USDC return
`true` today, cirBTC returns `false`). `keeperService.ts`'s
`requireIndependentReferencePriceToBuy(symbol)` throws before building any
swap leg that would BUY such an asset, refusing `ENTER` into cirBTC and any
`REBALANCE` leg that increases cirBTC's target weight. **Selling is
deliberately not blocked**: `EXIT`, a `REBALANCE` leg that decreases
cirBTC's target, and `EMERGENCY_EXIT_TO_STABLE` (which already skips
`VaultPolicy`'s allocation/deviation checks entirely via its own early
return, and must keep working unconditionally as the safety valve) all
still execute normally, since reducing exposure to an asset can never be
the harmful direction for this specific manipulation (spoofing a price to
make an over-cap allocation look compliant only matters when new
allocation is being authorized, not removed). Revisit once
`hasIndependentReferencePrice` can honestly return `true` for cirBTC, e.g.
a real Chainlink BTC/USD feed goes live on Arc (verified live, not from an
announcement).

**A real, verified liquidity blocker, not a code gap, documented plainly
per Randy's explicit ask:** querying the real UnitFlowV3 Factory live
found no pool at any fee tier pairing native USDC (the real v2 vault's
actual base asset) with cirBTC, and the one USDC/EURC pool that exists has
zero real liquidity (`liquidity() == 0`). The only pool with real,
substantial liquidity anywhere in this project's verified inventory is
WUSDC/cirBTC, and WUSDC is a different token from native USDC. **The real
v2 vault (`0x6a00e9de0b830Fd2Bc37db7C19Ae8b67a0df1862`) cannot execute a
real swap into cirBTC today, full stop.** The mechanism itself is real and
verified against real onchain infrastructure (two new Foundry fork tests
in `test/MandateVaultArcFork.t.sol`, against the real WUSDC/cirBTC pool,
the only one with real liquidity), the live v2 vault specifically just has
nothing to trade into. `scripts/runDecisionCycle.ts`'s hourly cycle
continuing to propose against v2 and occasionally landing on a non-HOLD
action that then sits pending, or fails cleanly at the keeper's
pre-execution offchain re-check, is expected, correct behavior given
today's real testnet liquidity, not a bug to chase. A v3 vault using WUSDC
as its base asset was explicitly considered and rejected: WUSDC is not the
decided production base asset (native USDC is, per the earlier decimals
investigation), not worth another deployment to test against an asset
already ruled out as the real path.

`KeeperServiceConfig` exposes injectable seams
(`getVaultStateFn`/`buildPolicyLimitsStructFn`/`getMarketDataFn`/
`buildProposeDecisionInputFn`/`proposeDecisionFn`/`keeperAccount`/
`walletClient`) so `test/keeperService.ts` can exercise nonce sequencing,
no-retry behavior, and self-consistency branching with fixtures, without a
real signer, a real Anthropic API call, or a live chain. A real end-to-end
run against the live vault is
`scripts/testKeeperServiceAgainstRealVault.ts` instead.

## v3's LP mechanism (`buildLpLeg`, `requireIndependentReferencePriceForLp`)

Alongside `buildSwapLegs`, `keeperService.ts` has an LP-position
counterpart, `buildLpLeg`, for `LP_OPEN`/`LP_INCREASE`/`LP_DECREASE`/
`LP_COLLECT`/`LP_CLOSE`. `requireIndependentReferencePriceForLp` is the
exact same hard block as `requireIndependentReferencePriceToBuy` above,
extended to opening/increasing a position: refuses before ever building a
leg if either token in the pool lacks an independent reference price.
Today this blocks real `LP_OPEN`/`LP_INCREASE` entirely (both of this
project's real-liquidity pools involve cirBTC), same disclosed situation
as v2's cirBTC `ENTER` restriction. `LP_DECREASE`/`LP_COLLECT`/`LP_CLOSE`
are never gated by this, reducing exposure is always allowed.

**`EMERGENCY_EXIT_TO_STABLE` covers open LP positions too, not just
ledger holdings**, `executeWithLpUnwind`/`closeAllOpenLpPositions`: before
sweeping simple holdings to stable, every currently-open LP position gets
closed first, each as its own `executeDecision` call with
`decision.action` kept as `EMERGENCY_EXIT_TO_STABLE` throughout (never
`LP_CLOSE`), so every single transaction in the sequence keeps the
unconditional `VaultPolicy` bypass this safety valve depends on. Found
and fixed 2026-07-14: before this, the base contract's own LP-leg dispatch
gate had a latent bug (checked `lpLeg.pool != address(0)`, but every
non-`LP_OPEN` leg sets `pool == address(0)` by convention, identity comes
from `tokenId` instead) that made the entire post-open LP lifecycle,
including this safety-valve path, silently unreachable. See
`docs/deployments.md`'s v3 section for the full writeup and the fork/unit
tests that prove it now.

**LP position valuation uses a TWAP, not the live spot price.** Unlike a
simple ERC-20 holding (valued from `lastKnownPriceUSDC`, cached only from
the keeper's own last executed decision), `totalAssets()` is read live
and fully permissionlessly by `deposit()`/`withdraw()`/`mint()`/`redeem()`
(standard, un-overridden ERC-4626), in the same transaction as any
caller's own call, so valuing an open LP position from the pool's live
`slot0()` would have let a single-block spot-price manipulation extract
value from other depositors. `requireIndependentReferencePriceForLp`
above does not protect this: it only gates the keeper's own
`LP_OPEN`/`LP_INCREASE` proposals, `deposit`/`withdraw` never go through
the keeper at all. Found and fixed 2026-07-15, before any real deposit
could ever reach a vault holding an open position; see
`docs/deployments.md`'s v3 section for the full writeup and the real fork
test proving `totalAssets()` resists a same-block manipulation that moves
the pool's own spot price by a large amount.

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

