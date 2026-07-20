// Fetches real historical daily ETH/USDC prices, same source and pattern as
// fetchBtcHistory.ts (Binance's public klines endpoint, no API key
// required). ETH fills the gap between BTC's high volatility and EUR/USD's
// low volatility, so this asset's own real volatility profile (roughly
// similar order of magnitude to BTC's, historically somewhat lower) is
// worth testing on its own real data, not assumed to behave like BTC.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PricePoint } from "./fetchBtcHistory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HERE, "data", "eth-usd-daily.json");
const FETCH_LIMIT = 1000;

async function fetchEthHistory(): Promise<PricePoint[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDC&interval=1d&limit=${FETCH_LIMIT}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ETH historical prices from Binance: HTTP ${response.status} ${await response.text()}`);
  }
  const rows = (await response.json()) as Array<[number, string, string, string, string, string, number, ...unknown[]]>;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Binance returned no usable kline data: ${JSON.stringify(rows).slice(0, 500)}`);
  }

  return rows.map(([openTime, , , , close]) => ({
    date: new Date(openTime).toISOString().slice(0, 10),
    priceUSD: Number(close),
  }));
}

async function main() {
  console.log(`Fetching up to ${FETCH_LIMIT} days of real ETHUSDC daily closes from Binance...`);
  const series = await fetchEthHistory();
  console.log(`Got ${series.length} daily price points, from ${series[0].date} to ${series[series.length - 1].date}.`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(series, null, 2), "utf-8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
