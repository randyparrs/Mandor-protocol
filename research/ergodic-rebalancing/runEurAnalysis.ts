// Thin entrypoint: EUR/USDC-specific config for the shared analysis runner
// (analysisRunner.ts). See that file for the actual orchestration logic,
// and backtest.ts for the actual strategy/stats/regime logic -- both are
// asset-agnostic and shared unchanged with runBtcAnalysis.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFullAnalysis } from "./analysisRunner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Cost model, honestly documented, not silently assumed, and DELIBERATELY
// DIFFERENT from the BTC/USDC cost model, not reused verbatim:
//
// EURC/USDC is a correlated cross-currency stablecoin pair (EUR-pegged vs
// USD-pegged), not a volatile-asset pair like BTC/USDC and not a same-peg
// arbitrage pair like USDC/USDT either -- real Uniswap-V3-style venues
// typically price this class of pair at a lower fee tier than a volatile
// pair (much lower IL risk for LPs, since both sides track relatively
// stable, correlated real-world currencies) but not as low as a same-peg
// pair (EUR/USD still moves several percent a year, unlike a true 1:1 peg).
//   - fee 5 bps (0.05%), the standard Uniswap V3 fee tier real venues use
//     for exactly this class of correlated-but-distinct-currency
//     stablecoin pair, distinctly lower than BTC/USDC's 30bps volatile-pair
//     tier.
//   - slippage 2 bps (0.02%), a reasonable assumption reflecting the much
//     lower price-impact profile of a correlated FX-stable pair versus a
//     volatile crypto pair at a comparable rebalancing trade size.
//   - gas $0.01 fixed per trade, unchanged from the BTC analysis (the same
//     underlying chain's gas cost does not depend on which asset is being
//     traded).
// This project has no real, live-verified EURC/USDC pool of its own to
// cite a fee tier from (unlike BTC/USDC's real UnitFlowV3 cirBTC pool), so
// this is a documented, standard-venue assumption, to be revisited once a
// real pool is chosen for v5, same "disclosed, not asserted as fact"
// treatment as the BTC cost model.
runFullAnalysis({
  assetLabel: "EUR/USDC",
  dataPath: path.join(HERE, "data", "eur-usd-daily.json"),
  resultsPath: path.join(HERE, "data", "results-eur.json"),
  chartsDir: path.join(HERE, "charts"),
  priceChartFileName: "eur-price.svg",
  costModel: { totalCostBps: 7, gasCostUsdPerTrade: 0.01 },
  costModelDescription:
    "5bps DEX fee (standard Uniswap V3 tier for a correlated cross-currency stablecoin pair, no real EURC/USDC pool exists in this project to cite instead) + 2bps slippage (reasonable assumption, much lower price-impact than a volatile crypto pair) + $0.01 fixed gas per trade (same as the BTC analysis).",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
