// Thin entrypoint: ETH/USDC-specific config for the shared analysis runner
// (analysisRunner.ts). See that file for the actual orchestration logic,
// and backtest.ts for the actual strategy/stats/regime logic -- all three
// are asset-agnostic and shared unchanged with runBtcAnalysis.ts /
// runEurAnalysis.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFullAnalysis } from "./analysisRunner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Cost model: same 40bps (30bps fee + 10bps slippage) + $0.01 gas as the
// BTC/USDC analysis, NOT a fresh/different assumption -- ETH is the same
// class of asset (a volatile, non-stablecoin crypto asset), this project
// has no real, project-specific ETH pool of its own to cite a different
// number from (same situation BTC's own cost model would be in if
// UnitFlowV3's real cirBTC pool didn't exist), and real-world ETH/USDC
// DEX fee tiers on major venues are the same order of magnitude as
// BTC/USDC's. Reusing BTC's number here is a deliberate, disclosed choice,
// not an oversight -- it keeps the two volatile-asset results comparable
// on a like-for-like cost basis, isolating the actual variable this
// comparison cares about (ETH's own real volatility vs BTC's), rather than
// mixing in a second, uncontrolled variable (a different cost assumption).
runFullAnalysis({
  assetLabel: "ETH/USDC",
  dataPath: path.join(HERE, "data", "eth-usd-daily.json"),
  resultsPath: path.join(HERE, "data", "results-eth.json"),
  chartsDir: path.join(HERE, "charts"),
  priceChartFileName: "eth-price.svg",
  costModel: { totalCostBps: 40, gasCostUsdPerTrade: 0.01 },
  costModelDescription:
    "30bps DEX fee + 10bps slippage + $0.01 fixed gas per trade, deliberately IDENTICAL to the BTC/USDC cost model (same asset class, no real project-specific ETH pool exists either, kept identical so the BTC-vs-ETH comparison isolates real volatility, not a second uncontrolled cost-assumption variable).",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
