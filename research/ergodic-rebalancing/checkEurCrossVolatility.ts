// Quick, standalone check (NOT a full backtest) answering one question
// before committing time to full EUR/BTC and EUR/ETH analyses: is a
// EUR/BTC (or EUR/ETH) pair's volatility dominated almost entirely by
// BTC's (or ETH's) own volatility, given EUR/USD's volatility is small by
// comparison? If so, a full EUR/BTC backtest would likely just reproduce
// BTC/USDC's own result (this project already has), adding little genuinely
// new information for the time spent.
//
// Method: real BTC/USD, ETH/USD, and EUR/USD daily series (already fetched
// and cached) are used to compute the EXACT synthetic cross rates
// (BTC-price-in-EUR = btcUSD / eurUSD, ETH-price-in-EUR = ethUSD / eurUSD)
// -- this is not an approximation, it is the real, standard cross-rate
// identity given two real USD-denominated prices for the same date.
// Annualized volatility (stdev of daily log returns * sqrt(observations
// per year)) is then compared: USD-quoted BTC/ETH vs EUR-quoted BTC/ETH vs
// EUR/USD itself. If EUR-quoted volatility is close to USD-quoted
// volatility (both far higher than EUR/USD's own), that confirms crypto
// volatility dominates the cross pair.
//
// Restricted to the common date range where BOTH series have overlapping
// business-day data (real ECB rates only publish on TARGET2 business
// days), an honest, disclosed restriction -- see fetchEurHistory.ts's own
// doc comment on this real, expected data-shape difference.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PricePoint } from "./fetchBtcHistory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function loadSeries(fileName: string): Promise<Map<string, number>> {
  const raw = await readFile(path.join(HERE, "data", fileName), "utf-8");
  const points: PricePoint[] = JSON.parse(raw);
  return new Map(points.map((p) => [p.date, p.priceUSD]));
}

function annualizedVolatility(prices: number[], observationsPerYear: number): number {
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance) * Math.sqrt(observationsPerYear) * 100;
}

async function main() {
  const [btc, eth, eur] = await Promise.all([loadSeries("btc-usd-daily.json"), loadSeries("eth-usd-daily.json"), loadSeries("eur-usd-daily.json")]);

  // Common dates: EUR only publishes on business days, so intersect with
  // that (BTC/ETH have every calendar day, a strict superset).
  const commonDates = Array.from(eur.keys())
    .filter((d) => btc.has(d) && eth.has(d))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Common business-day dates where BTC, ETH, and EUR all have real data: ${commonDates.length} (${commonDates[0]} to ${commonDates[commonDates.length - 1]})`);

  const btcUSD = commonDates.map((d) => btc.get(d)!);
  const ethUSD = commonDates.map((d) => eth.get(d)!);
  const eurUSD = commonDates.map((d) => eur.get(d)!);
  const btcEUR = commonDates.map((d) => btc.get(d)! / eur.get(d)!); // BTC price, denominated in EUR
  const ethEUR = commonDates.map((d) => eth.get(d)! / eur.get(d)!); // ETH price, denominated in EUR

  // ~252 business days/year, matching EUR/USD's own real observation
  // frequency (the shared date set is entirely business days).
  const OBS_PER_YEAR = 252;

  const volBtcUSD = annualizedVolatility(btcUSD, OBS_PER_YEAR);
  const volEthUSD = annualizedVolatility(ethUSD, OBS_PER_YEAR);
  const volEurUSD = annualizedVolatility(eurUSD, OBS_PER_YEAR);
  const volBtcEUR = annualizedVolatility(btcEUR, OBS_PER_YEAR);
  const volEthEUR = annualizedVolatility(ethEUR, OBS_PER_YEAR);

  console.log("\n=== Annualized volatility (real data, common date range) ===");
  console.log(`EUR/USD:  ${volEurUSD.toFixed(1)}%`);
  console.log(`BTC/USD:  ${volBtcUSD.toFixed(1)}%`);
  console.log(`ETH/USD:  ${volEthUSD.toFixed(1)}%`);
  console.log(`BTC/EUR (synthetic cross): ${volBtcEUR.toFixed(1)}%  (vs BTC/USD ${volBtcUSD.toFixed(1)}%, ratio ${(volBtcEUR / volBtcUSD).toFixed(3)})`);
  console.log(`ETH/EUR (synthetic cross): ${volEthEUR.toFixed(1)}%  (vs ETH/USD ${volEthUSD.toFixed(1)}%, ratio ${(volEthEUR / volEthUSD).toFixed(3)})`);

  console.log("\n=== Verdict ===");
  const btcRatio = volBtcEUR / volBtcUSD;
  const ethRatio = volEthEUR / volEthUSD;
  console.log(
    `BTC/EUR's volatility is ${(btcRatio * 100).toFixed(1)}% of BTC/USD's own volatility -- ${
      Math.abs(btcRatio - 1) < 0.1 ? "CONFIRMS crypto-side domination (within 10%)" : "does NOT closely match BTC/USD alone"
    }.`,
  );
  console.log(
    `ETH/EUR's volatility is ${(ethRatio * 100).toFixed(1)}% of ETH/USD's own volatility -- ${
      Math.abs(ethRatio - 1) < 0.1 ? "CONFIRMS crypto-side domination (within 10%)" : "does NOT closely match ETH/USD alone"
    }.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
