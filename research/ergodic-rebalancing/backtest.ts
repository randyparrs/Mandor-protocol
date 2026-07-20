// Core simulation logic: a threshold-based rebalancing strategy (back to a
// 50% USDC / 50% risk-asset-equivalent target whenever the deviation
// crosses a threshold) versus a static buy-and-hold baseline (identical
// starting split, never rebalanced again), both run on the SAME real daily
// price series so the comparison is apples-to-apples. Net-of-cost
// throughout: a real cost is deducted from the portfolio on every rebalance
// trade, never reported as a separate "gross" number presented alongside as
// if it were comparable. Asset-agnostic by design: reused unchanged for both
// the BTC/USDC and EUR/USDC backtests (see runBtcAnalysis.ts /
// runEurAnalysis.ts), each supplying its own cost model appropriate to that
// pair, see CostModel's own doc comment.
import type { PricePoint } from "./fetchBtcHistory.js";

export const START_VALUE_USD = 10_000;

export interface CostModel {
  /// @notice DEX fee + slippage, combined, as bps of the traded notional on
  /// every rebalance. Deliberately a single combined figure per caller
  /// (not further split) since both ultimately apply the same way here;
  /// each caller's own doc comment explains how its specific number was
  /// chosen and why it differs from the other asset's.
  totalCostBps: number;
  /// @notice A fixed, tiny cost per rebalance transaction (gas).
  gasCostUsdPerTrade: number;
}

export interface RebalanceEvent {
  date: string;
  dayIndex: number;
  deviationBeforeRebalance: number; // signed, risk-asset weight minus 0.5
  tradedNotionalUSD: number;
  costUSD: number;
}

export interface StrategyResult {
  dailyValues: number[]; // portfolio value net of cost, one per price point
  dailyReturns: number[]; // dailyValues[i]/dailyValues[i-1] - 1, length dailyValues.length - 1
  rebalanceEvents: RebalanceEvent[];
  totalCostUSD: number;
}

/// @notice Runs the threshold-rebalancing strategy over the full price
/// series. Starts split exactly 50/50 at prices[0] (no cost charged for
/// the initial split: both this strategy and the buy-and-hold baseline
/// start from the identical state, so it nets out of the comparison
/// either way). On any day the risk-asset-value weight deviates from 0.5
/// by more than `thresholdFraction`, trades back to exactly 50/50, paying
/// a real cost (costModel.totalCostBps of the traded notional, plus a
/// fixed gas cost) out of the portfolio before reallocating.
export function runRebalancingStrategy(prices: PricePoint[], thresholdFraction: number, costModel: CostModel): StrategyResult {
  let riskAssetUnits = (START_VALUE_USD * 0.5) / prices[0].priceUSD;
  let usdcValue = START_VALUE_USD * 0.5;
  const dailyValues: number[] = [riskAssetUnits * prices[0].priceUSD + usdcValue];
  const rebalanceEvents: RebalanceEvent[] = [];
  let totalCostUSD = 0;

  for (let i = 1; i < prices.length; i++) {
    const price = prices[i].priceUSD;
    const riskAssetValue = riskAssetUnits * price;
    let total = riskAssetValue + usdcValue;
    const weight = riskAssetValue / total;
    const deviation = weight - 0.5;

    if (Math.abs(deviation) > thresholdFraction) {
      const targetRiskAssetValue = total * 0.5;
      const tradedNotionalUSD = Math.abs(targetRiskAssetValue - riskAssetValue);
      const costUSD = (tradedNotionalUSD * costModel.totalCostBps) / 10_000 + costModel.gasCostUsdPerTrade;
      total -= costUSD;
      totalCostUSD += costUSD;
      rebalanceEvents.push({ date: prices[i].date, dayIndex: i, deviationBeforeRebalance: deviation, tradedNotionalUSD, costUSD });

      usdcValue = total * 0.5;
      riskAssetUnits = (total * 0.5) / price;
    }

    dailyValues.push(riskAssetUnits * price + usdcValue);
  }

  const dailyReturns = computeDailyReturns(dailyValues);
  return { dailyValues, dailyReturns, rebalanceEvents, totalCostUSD };
}

/// @notice The baseline: split 50/50 once at prices[0], then never trade
/// again. No costs at all (nothing is ever traded after the identical
/// starting split both strategies share).
export function runBuyAndHold(prices: PricePoint[]): StrategyResult {
  const riskAssetUnits = (START_VALUE_USD * 0.5) / prices[0].priceUSD;
  const usdcValue = START_VALUE_USD * 0.5;
  const dailyValues = prices.map((p) => riskAssetUnits * p.priceUSD + usdcValue);
  const dailyReturns = computeDailyReturns(dailyValues);
  return { dailyValues, dailyReturns, rebalanceEvents: [], totalCostUSD: 0 };
}

function computeDailyReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push(values[i] / values[i - 1] - 1);
  }
  return returns;
}

export interface PerformanceStats {
  finalValue: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpe: number; // annualized, no risk-free-rate subtraction (immaterial at this scale)
}

/// @notice Real elapsed calendar time is derived from the actual first/last
/// DATE STRINGS, never from `dailyValues.length / 365` -- that assumption
/// only holds for a genuine 7-day-a-week series (BTC). EUR/USD's real ECB
/// reference-rate series only has an observation on TARGET2 business days
/// (~252/year, not 365), so `length / 365` would understate the real years
/// elapsed and silently overstate both CAGR and the annualized Sharpe ratio
/// for that series specifically. Annualization for Sharpe uses the real
/// observed OBSERVATION frequency (`dailyValues.length / yearsElapsed`),
/// not a hardcoded 365, for the same reason.
export function computeStats(dailyValues: number[], dates: string[]): PerformanceStats {
  const finalValue = dailyValues[dailyValues.length - 1];
  const totalReturnPct = (finalValue / dailyValues[0] - 1) * 100;

  const msElapsed = new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime();
  const yearsElapsed = msElapsed / (1000 * 60 * 60 * 24 * 365.25);
  const cagrPct = (Math.pow(finalValue / dailyValues[0], 1 / yearsElapsed) - 1) * 100;

  let peak = dailyValues[0];
  let maxDrawdownPct = 0;
  for (const v of dailyValues) {
    if (v > peak) peak = v;
    const drawdown = ((peak - v) / peak) * 100;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  const returns = computeDailyReturns(dailyValues);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  const observationsPerYear = dailyValues.length / yearsElapsed;
  const sharpe = stdev === 0 ? 0 : (mean / stdev) * Math.sqrt(observationsPerYear);

  return { finalValue, totalReturnPct, cagrPct, maxDrawdownPct, sharpe };
}

// ---------------------------------------------------------------------
// Regime classification: Kaufman's Efficiency Ratio (ER), a standard,
// transparent, well-documented method (from Kaufman's Adaptive Moving
// Average) for distinguishing a directionally efficient (trending) price
// path from a noisy (choppy/sideways) one over a rolling window:
//
//   ER[i] = |price[i] - price[i-N]| / sum_{k=i-N+1..i} |price[k] - price[k-1]|
//
// ER approaches 1 when the price moves directly from its window-start
// value to its window-end value (an efficient, trending path with little
// backtracking); ER approaches 0 when the path covers a lot of distance
// but ends up roughly where it started (a noisy, choppy, sideways path).
// N = 30 OBSERVATIONS (not calendar days -- for BTC's 7-day series that is
// ~30 calendar days; for EUR/USD's business-day-only series it spans ~6
// calendar weeks instead, since weekends/ECB holidays have no observation
// at all, see fetchEurHistory.ts's own doc comment) and the trending/choppy
// cutoff (0.4) are both documented, chosen conventions, applied identically
// to both assets -- not the only defensible choice, but a standard,
// reasonable one, applied uniformly and disclosed here rather than tuned
// after seeing the results.
// ---------------------------------------------------------------------

export const REGIME_WINDOW_DAYS = 30;
export const REGIME_TRENDING_CUTOFF = 0.4;

export type Regime = "trending" | "choppy";

/// @notice Returns one label per price point; the first REGIME_WINDOW_DAYS
/// points have no full window of history yet and are left `null`
/// (excluded from regime-conditional reporting, not guessed).
export function classifyRegimes(prices: PricePoint[]): Array<Regime | null> {
  const labels: Array<Regime | null> = new Array(prices.length).fill(null);
  for (let i = REGIME_WINDOW_DAYS; i < prices.length; i++) {
    const netChange = Math.abs(prices[i].priceUSD - prices[i - REGIME_WINDOW_DAYS].priceUSD);
    let pathLength = 0;
    for (let k = i - REGIME_WINDOW_DAYS + 1; k <= i; k++) {
      pathLength += Math.abs(prices[k].priceUSD - prices[k - 1].priceUSD);
    }
    const er = pathLength === 0 ? 0 : netChange / pathLength;
    labels[i] = er >= REGIME_TRENDING_CUTOFF ? "trending" : "choppy";
  }
  return labels;
}

export interface RegimeConditionalResult {
  daysInRegime: number;
  strategyCumulativeReturnPct: number;
  buyHoldCumulativeReturnPct: number;
  strategyOutperformancePct: number; // strategy - buy-hold, both cumulative within this regime's days only
}

/// @notice Segments the ALREADY-COMPUTED daily returns of a full-path
/// backtest by which regime each day was labeled, then compounds returns
/// within each regime's day-set independently for both series. This is
/// the correct way to report "performance conditional on regime" for a
/// genuinely path-dependent strategy (rebalancing decisions and their
/// costs depend on the full preceding path) without re-running the
/// strategy in artificial isolation per regime, which would silently
/// change what is actually being measured.
export function computeRegimeConditionalReturns(
  strategyDailyReturns: number[],
  buyHoldDailyReturns: number[],
  regimeLabels: Array<Regime | null>,
): Record<Regime, RegimeConditionalResult> {
  const result: Record<Regime, RegimeConditionalResult> = {
    trending: { daysInRegime: 0, strategyCumulativeReturnPct: 0, buyHoldCumulativeReturnPct: 0, strategyOutperformancePct: 0 },
    choppy: { daysInRegime: 0, strategyCumulativeReturnPct: 0, buyHoldCumulativeReturnPct: 0, strategyOutperformancePct: 0 },
  };
  let strategyGrowth: Record<Regime, number> = { trending: 1, choppy: 1 };
  let buyHoldGrowth: Record<Regime, number> = { trending: 1, choppy: 1 };
  let days: Record<Regime, number> = { trending: 0, choppy: 0 };

  // dailyReturns[j] is the return realized ON price-index (j+1), so it is
  // labeled by regimeLabels[j+1] (the regime as of the day that return
  // actually happened on).
  for (let j = 0; j < strategyDailyReturns.length; j++) {
    const regime = regimeLabels[j + 1];
    if (regime === null) continue;
    strategyGrowth[regime] *= 1 + strategyDailyReturns[j];
    buyHoldGrowth[regime] *= 1 + buyHoldDailyReturns[j];
    days[regime]++;
  }

  for (const regime of ["trending", "choppy"] as const) {
    const strategyCumulativeReturnPct = (strategyGrowth[regime] - 1) * 100;
    const buyHoldCumulativeReturnPct = (buyHoldGrowth[regime] - 1) * 100;
    result[regime] = {
      daysInRegime: days[regime],
      strategyCumulativeReturnPct,
      buyHoldCumulativeReturnPct,
      strategyOutperformancePct: strategyCumulativeReturnPct - buyHoldCumulativeReturnPct,
    };
  }
  return result;
}
