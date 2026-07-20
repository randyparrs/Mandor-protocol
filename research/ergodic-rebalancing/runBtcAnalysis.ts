// Thin entrypoint: BTC/USDC-specific config for the shared analysis runner
// (analysisRunner.ts). See that file for the actual orchestration logic,
// and backtest.ts for the actual strategy/stats/regime logic -- both are
// asset-agnostic and shared unchanged with runEurAnalysis.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFullAnalysis } from "./analysisRunner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Cost model, honestly documented, not silently assumed:
//
// This project's own real, live-verified UnitFlowV3 pools (see
// docs/arc-facts-to-verify.md) are Arc TESTNET demo liquidity -- the real
// WUSDC/cirBTC pool holds ~239 WUSDC / ~0.00048 cirBTC total, several
// orders of magnitude too thin to model realistic trade sizes for a
// strategy meant to inform a real, capital-bearing v5 decision. Modeling
// costs against that pool's real depth would produce a meaningless
// "prohibitively expensive" result driven entirely by testnet-scale
// liquidity, not by whether the strategy itself has edge. Using a
// reasonable real-world DEX cost assumption instead, as the original task
// explicitly allowed:
//   - fee 30 bps (0.30%), matching this project's own real fee tier
//     already used for its BTC-tracking pools (fee 3000 = 0.30%, confirmed
//     live), a realistic concentrated-liquidity DEX fee tier for a
//     BTC/stablecoin pair.
//   - slippage 10 bps (0.10%), a reasonable assumption for trading a
//     moderate rebalancing notional against a REAL, adequately deep
//     BTC/USD(C) venue (unlike this project's own paper-thin testnet
//     pool).
//   - gas $0.01 fixed per trade, a deliberately conservative round
//     estimate, well above what Arc's own real, observed gas economics
//     imply for a transaction this size (docs/deployments.md: ~0.097 USDC
//     for a much larger deployment-sized transaction).
runFullAnalysis({
  assetLabel: "BTC/USDC",
  dataPath: path.join(HERE, "data", "btc-usd-daily.json"),
  resultsPath: path.join(HERE, "data", "results-btc.json"),
  chartsDir: path.join(HERE, "charts"),
  priceChartFileName: "btc-price.svg",
  costModel: { totalCostBps: 40, gasCostUsdPerTrade: 0.01 },
  costModelDescription:
    "30bps DEX fee (matches this project's real UnitFlowV3 cirBTC pool fee tier) + 10bps slippage (reasonable assumption for a real, adequately deep venue, NOT this project's own paper-thin testnet pool) + $0.01 fixed gas per trade (conservative, above Arc's own real observed gas cost for a transaction this size).",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
