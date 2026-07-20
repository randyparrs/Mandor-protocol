// Fetches real historical daily EUR/USD prices as EURC's proxy, same logic
// this project already uses BTC/USD as cirBTC's proxy for (EURC itself
// doesn't have a long enough real trading history yet). Caches the result
// to data/eur-usd-daily.json so backtest.ts never needs a live network call
// to re-run.
//
// Source: Frankfurter (https://frankfurter.dev), a free, no-API-key service
// republishing the European Central Bank's own real, official daily
// reference rates -- not a crypto exchange proxy pair (an EURC/USDC or
// EURUSDT pair would have far too short a real trading history and would
// reflect DEX/CEX liquidity conditions, not the actual EUR/USD exchange
// rate this project needs as a reference). Confirmed live: data is
// available back to 1999-01-04 (the Euro's introduction), one single
// request returns the ENTIRE real history (7051 points to date), no
// pagination needed.
//
// Real, disclosed data-shape difference from the BTC series: ECB reference
// rates are only published on TARGET2 business days (no weekends, no ECB
// holidays), so this series has gaps on those dates, unlike BTC's genuine
// 7-day-a-week series. This is normal, expected FX data behavior, not a
// data quality problem -- documented here so backtest.ts's regime window
// (a count of OBSERVATIONS, not calendar days) is never misread as
// spanning the same calendar duration as it would for the BTC series.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PricePoint } from "./fetchBtcHistory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HERE, "data", "eur-usd-daily.json");
const EARLIEST_AVAILABLE = "1999-01-04"; // the Euro's introduction, Frankfurter's own real earliest data

async function fetchEurHistory(): Promise<PricePoint[]> {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://api.frankfurter.app/${EARLIEST_AVAILABLE}..${today}?from=EUR&to=USD`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch EUR/USD historical rates from Frankfurter: HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { rates: Record<string, { USD: number }> };
  const dates = Object.keys(body.rates ?? {});
  if (dates.length === 0) {
    throw new Error(`Frankfurter returned no usable rates: ${JSON.stringify(body).slice(0, 500)}`);
  }

  return dates
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({ date, priceUSD: body.rates[date].USD }));
}

async function main() {
  console.log(`Fetching the full real EUR/USD daily history from Frankfurter (ECB reference rates), from ${EARLIEST_AVAILABLE}...`);
  const series = await fetchEurHistory();
  console.log(`Got ${series.length} daily price points, from ${series[0].date} to ${series[series.length - 1].date}.`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(series, null, 2), "utf-8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
