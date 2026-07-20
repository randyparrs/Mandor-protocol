// Fetches real historical daily BTC/USD(C) prices, caches the result to
// data/btc-usd-daily.json so backtest.ts never needs a live network call to
// re-run, and the exact dataset used for the report is reproducible/auditable
// after the fact.
//
// CoinGecko (this project's usual price source, see
// agent/core/tools/getMarketData.ts) was tried first but its free public API
// now hard-caps historical data at the last 365 days (confirmed live,
// error_code 10012, "Public API users are limited to querying historical
// data within the past 365 days"), not enough for this task's "at least 2
// years" requirement. Switched to Binance's public klines endpoint instead
// (https://api.binance.com/api/v3/klines, no API key required, real spot
// market data, up to 1000 daily candles in one request -- 2.7+ years).
// BTCUSDC (Binance's real BTC/USDC spot pair) is used directly rather than
// BTCUSDT, since this project's own vaults are USDC-denominated and USDC is
// itself ~1:1 USD, making BTCUSDC a closer real proxy for "BTC/USD" in this
// project's own context than a USDT-quoted pair would be.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HERE, "data", "btc-usd-daily.json");
// Binance's own real per-request cap for klines is 1000; requesting exactly
// that gets the maximum real history available in a single call.
const FETCH_LIMIT = 1000;

export interface PricePoint {
  date: string; // ISO date, YYYY-MM-DD
  priceUSD: number; // real BTCUSDC daily close
}

async function fetchBtcHistory(): Promise<PricePoint[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDC&interval=1d&limit=${FETCH_LIMIT}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch BTC historical prices from Binance: HTTP ${response.status} ${await response.text()}`);
  }
  // Real Binance kline tuple shape: [openTime, open, high, low, close,
  // volume, closeTime, ...]. Close price (index 4) is this series' own
  // daily close, the real, standard convention for a daily price series.
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
  console.log(`Fetching up to ${FETCH_LIMIT} days of real BTCUSDC daily closes from Binance...`);
  const series = await fetchBtcHistory();
  console.log(`Got ${series.length} daily price points, from ${series[0].date} to ${series[series.length - 1].date}.`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(series, null, 2), "utf-8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
