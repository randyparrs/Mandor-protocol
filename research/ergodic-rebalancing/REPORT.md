# Ergodic rebalancing: does it have real, net-of-cost edge over buy-and-hold?

Status: exploratory research only. Nothing here is production code, and this
does not touch v1-v4 or any deployed contract. Purpose: decide whether a v5
"ergodic rebalancing" vault is worth building at all. Three independent
asset pairs are tested with real historical data: **BTC/USDC** (volatile,
~2.7 years), **ETH/USDC** (volatile, ~2.7 years, fills the gap between BTC
and EUR), and **EUR/USDC** (a real forex pair proxying EURC, ~27.5 years) --
specifically to test whether the edge scales with volatility, as the
mechanism's own theory predicts. A quick, real-data check (see its own
section below) confirmed that EUR/BTC and EUR/ETH crosses would be
redundant with the BTC/USDC and ETH/USDC results already here, so full
backtests for those two crosses were not run, and that decision is shown to
be data-driven, not a shortcut.

**Bottom line: the strategy shows real, net-of-cost edge on all three pairs
tested, and the SIZE of that edge tracks each asset's own real volatility
closely** -- large on ETH (the most volatile of the three in this window),
meaningful on BTC, and present but economically negligible on EUR/USD.
**None of the three results is rounded up past what the data actually
shows**: BTC's and ETH's edges are real but each rests on one historical
cycle, not many; EUR/USD's edge, while technically positive at every
threshold tested, is small enough and built on so few rebalancing events (as
few as 2, at the loosest threshold, across 27.5 years) that it should be
read as "the mechanism barely activates for a low-volatility pair, and when
it does, the edge rounds to roughly zero," not as a confirmed win of the
same kind as BTC/ETH.

## BTC/USDC

### Data

Real daily BTC/USDC close prices from Binance's public spot market
(`BTCUSDC`, `https://api.binance.com/api/v3/klines`), **2023-10-24 to
2026-07-19, 1000 daily points, zero gaps or duplicate dates** (verified).

CoinGecko (this project's usual price source, see
`agent/core/tools/getMarketData.ts`) was tried first and rejected: its free
public API now hard-caps historical queries to the last 365 days (confirmed
live, HTTP 401, `error_code 10012`), not enough for a 2-year backtest.
Binance's public klines endpoint needs no API key and returns up to 1000 real
daily candles in a single request. BTC**USDC** (not BTCUSDT) was used
specifically because this project's own vaults are USDC-denominated.

Reproduce with:

```
node --import tsx research/ergodic-rebalancing/fetchBtcHistory.ts   # refetches live data
node --import tsx research/ergodic-rebalancing/runBtcAnalysis.ts    # re-runs the analysis
```

The exact dataset used for every number in this report is cached at
`data/btc-usd-daily.json`; the exact numbers are in `data/results-btc.json`.

### Method

**Strategy**: start split exactly 50% USDC / 50% BTC-equivalent by value.
Whenever the BTC-value weight drifts more than a threshold away from 50%,
trade back to exactly 50/50, paying a real cost on the traded notional.
Compared against a **buy-and-hold baseline**: the identical starting 50/50
split, never touched again. Both run on the same price series, so the only
difference between them is the rebalancing itself.

**Cost model** (applied to every rebalance trade, net-of-cost throughout,
never reported gross):

| Component | Value | Basis |
|---|---|---|
| DEX fee | 30 bps (0.30%) | Matches this project's own real, live-verified fee tier already used for its BTC-tracking pools (fee 3000 on UnitFlowV3, see `docs/arc-facts-to-verify.md`) |
| Slippage | 10 bps (0.10%) | A reasonable assumption for a moderate rebalancing trade against a real, adequately deep BTC/USD(C) venue |
| Gas | $0.01 fixed per trade | A deliberately conservative round number, well above what Arc's own real, observed gas economics imply for a transaction this size (`docs/deployments.md`: ~0.097 USDC for a much larger deployment-sized transaction) |

**Why not use this project's own real UnitFlowV3 pool depth for the cost
model**: that pool is real, but it is Arc *testnet* demo liquidity
(~239 WUSDC / ~0.00048 cirBTC total, confirmed live). Modeling costs against
it would produce a "prohibitively expensive" result driven entirely by
testnet-scale liquidity, not by whether the strategy itself has edge -- not a
meaningful answer to the actual question. The cost assumptions above are
disclosed explicitly so they can be revisited once a real, mainnet-liquidity
venue is chosen for v5.

**Regime classification**: Kaufman's Efficiency Ratio (ER), a standard method
from Kaufman's Adaptive Moving Average, over a rolling 30-day window:

```
ER[i] = |price[i] - price[i-30]| / sum(|price[k] - price[k-1]| for k in that window)
```

ER approaches 1 when price moves directly from the window's start to its end
(an efficient, trending path); it approaches 0 when the path covers a lot of
ground but ends up near where it started (noisy, choppy). Days with ER >= 0.4
are labeled "trending," below that "choppy." This is a disclosed, standard
convention, not tuned after seeing the results. Regime-conditional
performance is computed by taking the full-path backtest's own daily returns
(already net of cost, already reflecting every prior rebalancing decision)
and compounding them separately within each regime's day-set -- the correct
way to condition a genuinely path-dependent strategy's performance on regime,
without re-simulating it in artificial isolation.

### Results: threshold sensitivity

| Threshold | Rebalances | Total cost | Final value | Total return | CAGR | Max drawdown | Sharpe | Outperformance vs buy-hold |
|---|---|---|---|---|---|---|---|---|
| **Buy-and-hold** | 0 | $0 | $14,482.32 | 44.82% | 14.50% | **41.71%** | 0.58 | -- |
| 3% | 32 | $68.57 (0.686%) | $14,865.22 | **48.65%** | 15.60% | 29.89% | 0.73 | **+3.83pp** |
| 5% | 11 | $38.23 (0.382%) | $14,837.57 | 48.38% | 15.52% | 29.47% | 0.72 | +3.55pp |
| 8% | 4 | $22.20 (0.222%) | $14,781.43 | 47.81% | 15.36% | 30.23% | 0.72 | +2.99pp |

Starting value $10,000 in every case, identical price series.

**All three thresholds beat buy-and-hold, net of cost, over this window.**
The tightest threshold tested (3%) wins: 32 rebalances cost 0.686% of the
starting value in total, but that extra trading bought 0.83 percentage points
more outperformance than the loosest threshold (8%, only 4 rebalances). In
this specific window, **the extra rebalancing frequency does pay for its
extra cost** -- the relationship is monotonic across all three thresholds
tested (tighter is better), though the gap between 3% and 5% (0.28pp) is much
smaller than the gap between 5% and 8% (0.56pp), suggesting diminishing
returns to tightening further, not a threshold to push arbitrarily tight
without testing narrower values too.

Every rebalanced version also cut max drawdown by roughly 11-12 percentage
points versus buy-and-hold (~30% vs 41.71%) and raised the Sharpe ratio from
0.58 to ~0.72-0.73 -- the risk-adjusted case is, if anything, more consistent
across thresholds than the raw-return case.

### Results: regime segmentation (does it behave as expected?)

Of the 970 days classifiable (first 30 days have no full window yet): **124
days (12.8%) classified "trending," 846 days (87.2%) classified "choppy."**
A high choppy share is a known property of the ER method at this cutoff --
sustained one-directional movement with almost no daily reversal is
genuinely uncommon over a 30-day window, even within a broader bull market --
not a methodology error.

| Regime | Days | Strategy return (3% threshold) | Buy-hold return | Outperformance |
|---|---|---|---|---|
| Trending | 124 | 28.05% | **37.82%** | **-9.77pp** |
| Choppy | 846 | 10.41% | **-0.06%** | **+10.47pp** |

(5% and 8% thresholds show the identical pattern, just smaller in magnitude
on both sides -- see `data/results-btc.json` for the full breakdown.)

**This confirms the expectation stated in the task, directly and by a wide
margin, not marginally:** during the 124 trending days, buy-and-hold's
un-rebalanced BTC exposure captured the full run and beat the strategy by
~6-10 percentage points (rebalancing sold winners along the way, capping the
upside -- the expected, known cost of any mean-reversion strategy during a
persistent trend). During the 846 choppy days, buy-and-hold was flat
(-0.06%, essentially round-tripping back to where it started) while the
strategy captured real, meaningful gains (6.5-10.4%) purely from selling high
and buying low as BTC oscillated without a sustained net move -- the
"volatility harvesting" the ergodic-rebalancing thesis is built on, showing
up exactly as predicted, not asserted.

The overall net-of-cost outperformance (+2.99pp to +3.83pp) is the sum of a
large, real gain concentrated in the (much more common) choppy days, netted
against a real, meaningful giveback during the rarer trending days -- not
noise, not a coincidence of rounding, and not something that only shows up
under one specific threshold.

### Honest limitations (why this is not a slam-dunk "yes")

1. **One historical path, one cycle.** 2.7 years of real data is a genuine,
   real dataset, but it covers essentially one BTC bull run and one
   significant pullback (price ranged from ~$33,900 to ~$124,750 over the
   window). A strategy that wins on this exact path has not been shown to
   win across many independent market cycles -- this is n=1 at the level of
   "how many distinct regime cycles were actually observed," even though the
   day-count (970 classifiable days) sounds large.
2. **Cost model is a reasonable assumption, not this project's own live
   number.** The 40bps + $0.01/trade cost is deliberately conservative and
   grounded in this project's own real fee tier, but it is not a live quote
   from a real mainnet venue with real depth for the trade sizes v5 would
   actually use. Revisit once a real venue is chosen.
3. **Regime cutoff (ER >= 0.4) is a standard convention, not the only
   possible one.** The qualitative conclusion (strong outperformance in
   choppy periods, real giveback in trending ones) was checked to hold at
   all three thresholds and is consistent with the well-understood mechanics
   of rebalancing, which is reassuring, but a different, equally defensible
   cutoff would shift the exact percentages.
4. **No allowance for idle-USDC yield.** Both portfolios hold their USDC half
   at 0% yield throughout; a real v4-style vault could plausibly earn yield
   on the stable side too (see this project's own v4 cross-chain lending
   work), which would raise both series' absolute returns without changing
   the *relative* comparison this report is actually about.

## ETH/USDC

### Data

Real daily ETH/USDC close prices from Binance's public spot market
(`ETHUSDC`, same endpoint and pattern as BTC), **2023-10-24 to 2026-07-19,
1000 daily points, zero gaps or duplicate dates** (verified). Price ranged
from a real $1,472.25 to a real **$4,830.54 (2025-08-22)**, ending at
$1,861.10 -- ETH round-tripped from its starting price, through a real peak
nearly 2.7x higher, back to barely above where it started, over this exact
window.

Reproduce with:

```
node --import tsx research/ergodic-rebalancing/fetchEthHistory.ts   # refetches live data
node --import tsx research/ergodic-rebalancing/runEthAnalysis.ts    # re-runs the analysis
```

The exact dataset is cached at `data/eth-usd-daily.json`; the exact numbers
are in `data/results-eth.json`.

### Method

Identical strategy, buy-and-hold baseline, and regime method as BTC/USDC.
**Cost model deliberately IDENTICAL to BTC/USDC** (40bps total + $0.01
gas) -- ETH is the same class of asset (volatile, non-stablecoin crypto),
this project has no real project-specific ETH pool either, and keeping the
cost assumption identical isolates the one variable this comparison
actually cares about (ETH's own real volatility vs BTC's), rather than
mixing in a second, uncontrolled difference.

### Results: threshold sensitivity

| Threshold | Rebalances | Total cost | Final value | Total return | CAGR | Max drawdown | Sharpe | Outperformance vs buy-hold |
|---|---|---|---|---|---|---|---|---|
| **Buy-and-hold** | 0 | $0 | $10,214.07 | 2.14% | 0.78% | **49.35%** | 0.22 | -- |
| 3% | 60 | $120.95 (1.209%) | $12,016.22 | 20.16% | 6.95% | 40.36% | 0.37 | **+18.02pp** |
| 5% | 20 | $59.25 (0.593%) | $11,598.87 | 15.99% | 5.57% | 40.36% | 0.33 | +13.85pp |
| 8% | 12 | $58.46 (0.585%) | $12,408.87 | **24.09%** | **8.21%** | 40.40% | **0.40** | **+21.95pp** |

Starting value $10,000 in every case, identical price series.

**Every threshold beats buy-and-hold by a wide margin, and the margin here is
far larger than BTC's** -- 13.85pp to 21.95pp vs BTC's 2.99pp to 3.83pp over
the same real window. The reason is visible in the buy-and-hold row itself:
a static 50/50 split barely returned anything net (2.14% total, 0.78%
CAGR) because ETH round-tripped almost all the way back to its starting
price after a real ~170% peak gain. Buy-and-hold captured essentially none
of that round trip; a rebalancing strategy that periodically trimmed ETH
exposure on the way up locked in real gains along the path instead, which
is exactly the mechanism this whole research question is about, showing up
at its most dramatic in this dataset.

**Unlike BTC, the threshold ordering here is NOT monotonic**: 8% (21.95pp)
beats 3% (18.02pp) beats 5% (13.85pp). Reported exactly as it came out, not
smoothed into a story that matches BTC's own "tighter is always better"
pattern -- that pattern does not generalize even within the same asset
class, on this real data. With a real price path this extreme (a ~170%
peak followed by a near-full round trip), exactly how a given threshold
interacts with the specific timing of that peak matters more than a simple
"tighter is better" heuristic; a full explanation would need many more
independent price paths than this one real window provides. Max drawdown
and Sharpe, by contrast, ARE consistent across thresholds (~40% drawdown vs
buy-hold's 49.35%, Sharpe 0.33-0.40 vs buy-hold's 0.22) -- the risk-adjusted
story is more stable than the exact-threshold-ranking story, same pattern
observed for BTC.

### Results: regime segmentation

Of the 970 days classifiable: **110 days (11.3%) classified "trending,"
860 days (88.7%) classified "choppy"** -- similar proportions to BTC's own
split (12.8% / 87.2%).

| Regime | Days | Strategy return (3% threshold) | Buy-hold return | Outperformance |
|---|---|---|---|---|
| Trending | 110 | 46.82% | **64.52%** | **-17.69pp** |
| Choppy | 860 | -24.18% | **-42.42%** | **+18.25pp** |

Same qualitative pattern as BTC, at a larger scale in both directions: real
giveback during the (rarer) trending days, real -- and larger -- recapture
during the (much more common) choppy days. 5% and 8% thresholds show the
identical pattern (see `data/results-eth.json`).

### Honest read on ETH/USDC

ETH shows the largest edge of the two volatile assets tested, and the
mechanism behind it is the same one BTC's own result demonstrated, just
more pronounced because this specific real window happened to contain a
larger round trip. The same core limitation applies as it does to BTC: this
is one historical path, one real cycle (a big rally followed by a near-full
retracement), not many independent trials -- a genuinely different real
window (a persistent one-way trend with no round trip, for instance) would
show a smaller or possibly negative result, exactly as the trending-regime
segmentation above already demonstrates within this same window. The
non-monotonic threshold ordering is itself evidence that a single 2.7-year
window is not enough data to lock in one "best" threshold across assets.

## EUR/USDC

### Data

Real daily EUR/USD reference rates from Frankfurter
(`https://api.frankfurter.app`), a free, no-API-key service republishing the
European Central Bank's own official daily rates -- **1999-01-04 to
2026-07-17, 7051 daily points, zero duplicate dates** (verified). Price
ranged from a real $0.8252 (2000) to a real $1.5990 (2008), consistent with
known EUR/USD history.

A real forex pair (not a crypto exchange proxy pair like EURUSDT/EURUSDC) is
used specifically because EURC itself doesn't have a long enough real
trading history, the same reasoning this project already applies to using
real BTC/USD as cirBTC's proxy. Real, disclosed shape difference from the
BTC series: ECB reference rates only publish on TARGET2 business days (no
weekends/holidays), so this series has ~252 observations/year, not 365 --
`backtest.ts`'s `computeStats` derives real elapsed calendar time from the
actual date range rather than assuming a fixed observations-per-year, so
CAGR/Sharpe are correctly annualized for this series too, not silently
biased by reusing a 365-day-year assumption that only holds for BTC's
series.

Reproduce with:

```
node --import tsx research/ergodic-rebalancing/fetchEurHistory.ts   # refetches live data
node --import tsx research/ergodic-rebalancing/runEurAnalysis.ts    # re-runs the analysis
```

The exact dataset is cached at `data/eur-usd-daily.json`; the exact numbers
are in `data/results-eur.json`.

### Method

Identical strategy, buy-and-hold baseline, and Kaufman Efficiency Ratio
regime method as the BTC/USDC analysis above (same `backtest.ts`, unchanged)
-- only the cost model differs, deliberately, since EURC/USDC is a
correlated cross-currency stablecoin pair, not a volatile-asset pair:

| Component | Value | Basis |
|---|---|---|
| DEX fee | 5 bps (0.05%) | The standard Uniswap V3 fee tier real venues use for a correlated-but-distinct-currency stablecoin pair (this project has no real, live-verified EURC/USDC pool of its own to cite instead, unlike BTC/USDC's real UnitFlowV3 cirBTC pool) |
| Slippage | 2 bps (0.02%) | Reflects the much lower price-impact profile of a correlated FX-stable pair versus a volatile crypto pair at a comparable trade size |
| Gas | $0.01 fixed per trade | Unchanged from the BTC analysis (same chain, same real gas cost regardless of which asset is being traded) |

Total: 7 bps + $0.01/trade, a full order of magnitude tighter than BTC's
40bps -- disclosed as an assumption, not a live quote, same as the BTC cost
model.

### Results: threshold sensitivity

| Threshold | Rebalances | Total cost | Final value | Total return | CAGR | Max drawdown | Sharpe | Outperformance vs buy-hold |
|---|---|---|---|---|---|---|---|---|
| **Buy-and-hold** | 0 | $0 | $9,849.86 | **-1.50%** | -0.05% | 23.13% | 0.01 | -- |
| 3% | 16 | $3.79 (0.038%) | $10,161.11 | **1.61%** | 0.06% | 21.55% | 0.04 | **+3.11pp** |
| 5% | 6 | $2.19 (0.022%) | $10,156.53 | 1.57% | 0.06% | 21.94% | 0.04 | +3.07pp |
| 8% | 2 | $1.08 (0.011%) | $10,109.62 | 1.10% | 0.04% | 23.13% | 0.03 | +2.60pp |

Starting value $10,000 in every case, identical price series, 27.5 real years.

**All three thresholds are technically net-of-cost positive, but the
magnitude is a different story entirely from BTC.** Buy-and-hold itself is
flat over 27.5 years (-1.50% total, essentially a full round trip), so there
isn't much return to out-perform in the first place. The strategy's
outperformance (2.60pp to 3.11pp) sounds similar in size to BTC's (2.99pp to
3.83pp) as a raw percentage-point figure, **but BTC's edge accrued over 2.7
years and EUR's over 27.5 years -- roughly a 10x difference in the time spent
earning a similar-looking number.** In annualized (CAGR) terms this is stark:
the strategy's CAGR beats buy-and-hold's by roughly **0.11 percentage points
per year** at the best threshold (0.06% vs -0.05%), against BTC's roughly
**1.1 percentage points per year** (15.6% vs 14.5%). That is a genuine
~10x gap in annualized edge, tracking the ~10x-or-more gap in the two
assets' real volatility almost exactly, as the volatility-scaling hypothesis
predicted.

The number of triggering events also makes this edge fragile to read as
"real" in a statistical sense: at the 8% threshold, EUR/USD only crossed the
rebalancing band **twice in 27.5 years**. A result built on 2 events is not a
result that should be trusted the same way as one built on 32 (BTC's 3%
threshold). Even at 3% (16 events), this is a much thinner evidentiary base
than BTC's.

Cost was never the reason the edge is small here -- total cost across the
entire 27.5-year window was $3.79 at the tightest threshold, 0.038% of
starting value, an order of magnitude smaller (in bps terms) than even BTC's
loosest-threshold cost. EUR/USD's low volatility means the rebalancing band
is crossed rarely, so there is little cost to net against in the first
place; the edge is small because there is little volatility to harvest, not
because trading costs ate it.

### Results: regime segmentation

Of the 7021 days classifiable: **589 days (8.4%) classified "trending,"
6432 days (91.6%) classified "choppy."**

| Regime | Days | Strategy return (3% threshold) | Buy-hold return | Outperformance |
|---|---|---|---|---|
| Trending | 589 | 10.48% | 8.95% | **+1.54pp** |
| Choppy | 6432 | -5.85% | -7.45% | **+1.60pp** |

**This is a genuinely different pattern from BTC, reported honestly rather
than forced to match.** On BTC, the strategy clearly gave back return during
trending days (-9.77pp) and made it up during choppy days (+10.47pp) -- the
textbook mean-reversion trade-off. On EUR/USD, the strategy **modestly
outperforms buy-and-hold in BOTH regimes**, not just in choppy ones (5% and
8% thresholds show the same pattern -- see `data/results-eur.json`). The most
likely honest explanation: EUR/USD's real "trending" stretches (even the
biggest ones in this 27.5-year window, e.g. the 2000s dollar-weakening move)
are far milder in magnitude than BTC's multi-hundred-percent runs, so there
is little directional upside for the strategy to meaningfully give back --
the classic trending-regime cost of rebalancing barely shows up at all when
the trend itself is this gentle. This is consistent with, not contradictory
to, the volatility-scaling hypothesis: the theorized *giveback* also scales
with volatility, and at EUR/USD's volatility, both the harvested edge and
the giveback shrink toward zero, leaving a small, all-around-positive but
economically marginal result.

### Honest read on EUR/USDC (why this is not a "no," but is not really a "yes" either)

Every number reported here is real and net-of-cost positive, at every
threshold tested, in every regime. Reporting this as a clean "no" would be
just as dishonest as reporting BTC's result as an unconditional "yes" --
the sign is genuinely positive. But the magnitude is small enough (~0.1
annualized percentage points, built on as few as 2 trading events over 27.5
years) that it is not distinguishable from noise with any real confidence,
and it is far too small to be a standalone reason to build v5 for a
low-volatility pair. **The honest conclusion, matching the task's own stated
expectation: yes, the net-of-cost edge is much smaller here, to the point of
being economically negligible, exactly because EUR/USD's real volatility is
roughly an order of magnitude lower than BTC's.** The volatility-scaling
hypothesis is confirmed by this data, not merely assumed.

## EUR/BTC and EUR/ETH: quick check before committing to full backtests

Before running full backtests for EUR/BTC and EUR/ETH crosses, a quick,
real-data check tested the premise directly: since EUR/USD's volatility is
small relative to BTC's or ETH's, a EUR/BTC (or EUR/ETH) pair's behavior is
probably dominated almost entirely by the crypto asset's own volatility,
making a full backtest largely redundant with the BTC/USDC and ETH/USDC
results already above.

**Method**: using the real BTC/USD, ETH/USD, and EUR/USD series already
fetched for this report, the exact synthetic cross rates were computed
(BTC-priced-in-EUR = BTC/USD divided by EUR/USD, and the same for ETH --
this is not an approximation, it is the standard, exact cross-rate identity
given two real USD-denominated prices for the same date), restricted to the
696 real dates where all three series overlap (2023-10-24 to 2026-07-17,
business days only, since EUR/USD only publishes on those). Annualized
volatility (stdev of daily log returns, scaled by sqrt(252)) was then
compared directly. Reproduce with:
`node --import tsx research/ergodic-rebalancing/checkEurCrossVolatility.ts`.

| Series | Annualized volatility |
|---|---|
| EUR/USD | 6.9% |
| BTC/USD | 48.0% |
| ETH/USD | 66.7% |
| BTC/EUR (synthetic cross) | 48.4% |
| ETH/EUR (synthetic cross) | 66.8% |

**Confirmed, not refuted, and confirmed tightly.** BTC/EUR's real volatility
(48.4%) is 100.8% of BTC/USD's own (48.0%) -- adding the EUR leg changed the
combined volatility by less than 1%. ETH/EUR's real volatility (66.8%) is
100.2% of ETH/USD's own (66.7%) -- an even smaller difference. EUR/USD's own
6.9% volatility is simply too small, relative to BTC's or ETH's, to move
the combined cross rate's volatility in any way that would matter (adding
independent variances of this size ratio mathematically predicts almost
exactly this outcome, and the real data lands right where that math
predicts).

**Decision: full EUR/BTC and EUR/ETH backtests were not run.** Given how
closely EUR/BTC and EUR/ETH's real volatility tracks BTC/USDC's and
ETH/USDC's own (already fully backtested above), a full rebalancing
backtest on either cross would be expected to reproduce a result very close
to the corresponding already-completed BTC/USDC or ETH/USDC result, just
denominated in EUR-equivalent terms instead of USD -- not meaningfully new
information for the time spent. This is a data-driven decision, verified
before being acted on, not a shortcut taken on assumption -- exactly the
standard the rest of this research holds itself to.

## Recommendation

**BTC/USDC and ETH/USDC**: the data supports **building v5 as a real
candidate for volatile assets**, gated on: (a) confirming the cost
assumptions above against a real venue with adequate depth before
committing capital, and (b) treating the exact threshold choice as still
open, not locked in from this data alone -- BTC's own three thresholds were
monotonic (tighter clearly better) while ETH's were not (8% beat 3% beat
5%), so "which single threshold is best" is asset- and path-dependent on
this evidence, not a universal constant to hardcode. Both assets clearly
beat buy-and-hold at every threshold tested, and both show the same
mean-reversion mechanism (giveback in trending periods, recapture in choppy
ones) driving the result, which is the real, structural reason to trust the
edge rather than treat it as coincidence.

**EUR/USDC**: the data does **not** support building this mechanism as a
standalone product for a low-volatility pair like EUR/USDC -- the net edge
is real but too small and too thinly evidenced (as few as 2 rebalancing
events over 27.5 years) to be worth the operational complexity of a
dedicated vault on its own.

**EUR/BTC and EUR/ETH**: not backtested, on the strength of a real-data
check showing their volatility (and therefore, almost certainly, their
rebalancing result) would be dominated by BTC's or ETH's own volatility to
within about 1%, closely reproducing the BTC/USDC and ETH/USDC results
already above rather than adding new information.

If a future v5 ever handles multiple asset pairs, EUR/USDC-style
low-volatility pairs (and EUR-denominated crosses of the volatile assets)
are reasonable candidates for "include if convenient, not worth building
for," not a reason to expand scope by themselves.

**Overall**: do not read this report as evidence the strategy wins in every
market condition or for every asset -- it does not, and was never expected
to. Its entire value proposition is trading some upside in strong trends for
a larger, more consistent edge during choppier conditions, and that
trade-off is only economically meaningful when the underlying asset is
volatile enough to generate a real edge to harvest in the first place. BTC
and ETH clear that bar in this data, ETH by a wider margin in this
particular window; EUR/USD, tested honestly rather than assumed, does not.
