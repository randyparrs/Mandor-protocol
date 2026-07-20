// Shared orchestration: loads a cached real daily price series, runs the
// rebalancing strategy at each threshold plus the buy-and-hold baseline,
// computes performance stats and regime-conditional performance, writes a
// results JSON file (machine-readable, for REPORT.md to cite exact numbers
// from) and a set of SVG charts. Identical logic for every asset this
// research covers (see runBtcAnalysis.ts / runEurAnalysis.ts) -- only the
// data file, cost model, and labels differ between them, so the actual
// backtest/regime/stats code is never duplicated or allowed to drift
// between the two.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PricePoint } from "./fetchBtcHistory.js";
import {
  runRebalancingStrategy,
  runBuyAndHold,
  computeStats,
  classifyRegimes,
  computeRegimeConditionalReturns,
  REGIME_WINDOW_DAYS,
  REGIME_TRENDING_CUTOFF,
  START_VALUE_USD,
  type CostModel,
} from "./backtest.js";

const THRESHOLDS = [0.03, 0.05, 0.08];

function buildLineChartSvg(opts: {
  title: string;
  series: Array<{ label: string; color: string; values: number[] }>;
  width?: number;
  height?: number;
}): string {
  const width = opts.width ?? 900;
  const height = opts.height ?? 400;
  const padding = { top: 65, right: 30, bottom: 40, left: 70 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allValues = opts.series.flatMap((s) => s.values);
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const n = opts.series[0].values.length;

  const x = (i: number) => padding.left + (i / (n - 1)) * plotWidth;
  const y = (v: number) => padding.top + plotHeight - ((v - minV) / (maxV - minV)) * plotHeight;

  const paths = opts.series
    .map((s) => {
      const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" />`;
    })
    .join("\n  ");

  const legend = opts.series
    .map(
      (s, idx) =>
        `<circle cx="${padding.left + idx * 180}" cy="${46}" r="5" fill="${s.color}" /><text x="${padding.left + idx * 180 + 12}" y="50" font-size="12" font-family="sans-serif" fill="#333">${s.label}</text>`,
    )
    .join("\n  ");

  const gridLines = 5;
  const gridAndLabels = Array.from({ length: gridLines + 1 }, (_, i) => {
    const v = minV + ((maxV - minV) * i) / gridLines;
    const yy = y(v);
    return `<line x1="${padding.left}" y1="${yy.toFixed(1)}" x2="${width - padding.right}" y2="${yy.toFixed(1)}" stroke="#eee" stroke-width="1" />
  <text x="${padding.left - 8}" y="${(yy + 4).toFixed(1)}" font-size="10" text-anchor="end" font-family="sans-serif" fill="#666">${v.toFixed(0)}</text>`;
  }).join("\n  ");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <text x="${padding.left}" y="20" font-size="15" font-weight="bold" fill="#111">${opts.title}</text>
  ${legend}
  ${gridAndLabels}
  ${paths}
  <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#999" stroke-width="1" />
</svg>`;
}

export interface AnalysisConfig {
  assetLabel: string; // e.g. "BTC/USDC" or "EUR/USDC"
  dataPath: string;
  resultsPath: string;
  chartsDir: string;
  priceChartFileName: string; // e.g. "btc-price.svg"
  costModel: CostModel;
  costModelDescription: string; // human-readable, embedded in results.json for the report to quote verbatim
}

export async function runFullAnalysis(config: AnalysisConfig): Promise<void> {
  const raw = await readFile(config.dataPath, "utf-8");
  const prices: PricePoint[] = JSON.parse(raw);
  const dates = prices.map((p) => p.date);
  console.log(`Loaded ${prices.length} real daily ${config.assetLabel} price points, ${prices[0].date} to ${prices[prices.length - 1].date}.`);

  const buyHold = runBuyAndHold(prices);
  const buyHoldStats = computeStats(buyHold.dailyValues, dates);
  const regimeLabels = classifyRegimes(prices);
  const trendingDays = regimeLabels.filter((r) => r === "trending").length;
  const choppyDays = regimeLabels.filter((r) => r === "choppy").length;

  const thresholdResults = THRESHOLDS.map((threshold) => {
    const strategy = runRebalancingStrategy(prices, threshold, config.costModel);
    const stats = computeStats(strategy.dailyValues, dates);
    const regimeConditional = computeRegimeConditionalReturns(strategy.dailyReturns, buyHold.dailyReturns, regimeLabels);
    return {
      thresholdPct: threshold * 100,
      numRebalances: strategy.rebalanceEvents.length,
      totalCostUSD: strategy.totalCostUSD,
      totalCostAsPctOfStartValue: (strategy.totalCostUSD / START_VALUE_USD) * 100,
      stats,
      outperformanceVsBuyHoldPct: stats.totalReturnPct - buyHoldStats.totalReturnPct,
      regimeConditional,
      dailyValues: strategy.dailyValues,
    };
  });

  const results = {
    assetLabel: config.assetLabel,
    generatedAt: new Date().toISOString(),
    dataRange: { from: prices[0].date, to: prices[prices.length - 1].date, numDays: prices.length },
    costModel: { ...config.costModel, description: config.costModelDescription },
    regimeMethod: { windowDays: REGIME_WINDOW_DAYS, trendingCutoff: REGIME_TRENDING_CUTOFF, trendingDays, choppyDays },
    startValueUsd: START_VALUE_USD,
    buyHold: { stats: buyHoldStats },
    thresholds: thresholdResults.map(({ dailyValues: _dailyValues, ...rest }) => rest),
  };

  await mkdir(path.dirname(config.resultsPath), { recursive: true });
  await writeFile(config.resultsPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Wrote ${config.resultsPath}`);

  // Charts.
  await mkdir(config.chartsDir, { recursive: true });

  const equityCurveSvg = buildLineChartSvg({
    title: `Portfolio value: rebalancing strategy (net of cost) vs buy-and-hold, ${config.assetLabel}, ${prices[0].date} to ${prices[prices.length - 1].date}`,
    series: [
      { label: "Buy-and-hold 50/50", color: "#888888", values: buyHold.dailyValues },
      ...thresholdResults.map((r, i) => ({
        label: `Rebalance @ ${r.thresholdPct}%`,
        color: ["#2563eb", "#16a34a", "#dc2626"][i],
        values: r.dailyValues,
      })),
    ],
  });
  const equityChartFileName = config.priceChartFileName.replace("-price.svg", "-equity-curves.svg");
  await writeFile(path.join(config.chartsDir, equityChartFileName), equityCurveSvg, "utf-8");

  const priceChartSvg = buildLineChartSvg({
    title: `Real ${config.assetLabel} daily close, ${prices[0].date} to ${prices[prices.length - 1].date}`,
    series: [{ label: config.assetLabel, color: "#f59e0b", values: prices.map((p) => p.priceUSD) }],
  });
  await writeFile(path.join(config.chartsDir, config.priceChartFileName), priceChartSvg, "utf-8");

  console.log(`Wrote charts to ${config.chartsDir}`);

  // Console summary.
  console.log("\n=== SUMMARY ===");
  console.log(`Buy-and-hold: final $${buyHoldStats.finalValue.toFixed(2)}, total return ${buyHoldStats.totalReturnPct.toFixed(2)}%, CAGR ${buyHoldStats.cagrPct.toFixed(2)}%, max drawdown ${buyHoldStats.maxDrawdownPct.toFixed(2)}%, Sharpe ${buyHoldStats.sharpe.toFixed(2)}`);
  for (const r of thresholdResults) {
    console.log(
      `\nThreshold ${r.thresholdPct}%: final $${r.stats.finalValue.toFixed(2)}, total return ${r.stats.totalReturnPct.toFixed(2)}%, CAGR ${r.stats.cagrPct.toFixed(2)}%, max drawdown ${r.stats.maxDrawdownPct.toFixed(2)}%, Sharpe ${r.stats.sharpe.toFixed(2)}`,
    );
    console.log(`  rebalances: ${r.numRebalances}, total cost $${r.totalCostUSD.toFixed(2)} (${r.totalCostAsPctOfStartValue.toFixed(3)}% of start value)`);
    console.log(`  outperformance vs buy-and-hold (net of cost): ${r.outperformanceVsBuyHoldPct.toFixed(2)}pp`);
    console.log(
      `  trending days (${r.regimeConditional.trending.daysInRegime}): strategy ${r.regimeConditional.trending.strategyCumulativeReturnPct.toFixed(2)}% vs buy-hold ${r.regimeConditional.trending.buyHoldCumulativeReturnPct.toFixed(2)}% (outperf ${r.regimeConditional.trending.strategyOutperformancePct.toFixed(2)}pp)`,
    );
    console.log(
      `  choppy days (${r.regimeConditional.choppy.daysInRegime}): strategy ${r.regimeConditional.choppy.strategyCumulativeReturnPct.toFixed(2)}% vs buy-hold ${r.regimeConditional.choppy.buyHoldCumulativeReturnPct.toFixed(2)}% (outperf ${r.regimeConditional.choppy.strategyOutperformancePct.toFixed(2)}pp)`,
    );
  }
}
