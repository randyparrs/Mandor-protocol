// Permanent regression test for the real unit-mismatch bug found while
// testing the Paper Vault: given a vault with no cirBTC yet and a strategy
// nudging "enter a position around X% of NAV," a real model call once wrote
// amount: "30.00" meaning "30% allocation" but the schema's actual required
// semantics for ENTER/EXIT is "literal units of the target asset," at
// cirBTC's real price (~$276k) that produced a projected allocation of
// roughly $8.28M against a $100 vault. Fixed via an explicit clarification
// in systemPrompt.ts (see the paragraph on ENTER/EXIT amount units) plus a
// defense-in-depth check in agent/policy/offchainPolicyCheck.ts
// (IMPLAUSIBLE_ALLOCATION_MAGNITUDE). This test guards the root cause
// directly: if systemPrompt.ts's clarification is ever weakened or removed,
// this should fail loudly rather than the bug silently reappearing.
//
// Not part of the free, fast `npx hardhat test` suite: this makes real,
// non-deterministic calls to the live Anthropic API (real cost, real model
// variance), so it runs separately, on demand (`npm run test:agent`).
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeDecision } from "./loop.js";
import { setModelPin } from "./modelPin.js";
import type { MarketData, VaultState } from "./types.js";

const VAULT_ID = "0x0000000000000000000000000000000000000000000000000000000000000098" as const;
setModelPin(VAULT_ID, "claude-sonnet-5");

const TOTAL_NAV_USDC = 10_000;
// A real, non-1:1-priced asset, the exact condition that exposed the bug:
// any conversion error between "percent of NAV" and "asset's own units" is
// invisible for a ~1:1 asset (the two interpretations land close together)
// but enormous for an asset priced in the tens of thousands of dollars.
const CIRBTC_PRICE_USDC = 276_073;

const vaultState: VaultState = {
  vaultId: VAULT_ID,
  totalAssetsUSDC: TOTAL_NAV_USDC.toFixed(2),
  holdings: [
    { asset: "USDC", ledgerAmount: TOTAL_NAV_USDC.toFixed(2), valueUSDC: TOTAL_NAV_USDC.toFixed(2) },
    { asset: "cirBTC", ledgerAmount: "0", valueUSDC: "0" },
  ],
  paused: false,
  tradesToday: 0,
  highWaterMarkUSDC: TOTAL_NAV_USDC.toFixed(2),
  currentDrawdownBps: 0,
  lpPositions: [],
  currentLendingPositions: [],
};

const marketData: MarketData = {
  prices: [
    { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: new Date().toISOString() },
    { asset: "cirBTC", priceUSDC: CIRBTC_PRICE_USDC.toFixed(2), referencePriceUSDC: CIRBTC_PRICE_USDC.toFixed(2), updatedAt: new Date().toISOString() },
  ],
  untrustedContext:
    "cirBTC has shown strong, sustained upward momentum over the past several sessions on healthy volume, with no signs of a reversal.",
};

function buildInput() {
  return {
    vaultId: VAULT_ID,
    strategyVersion: "v1-test",
    strategyConfigText:
      "Momentum strategy. cirBTC currently has strong upward momentum and this vault holds none yet. Given a " +
      "favorable signal, enter a meaningful cirBTC position, targeting approximately 20% of vault NAV. Cap on " +
      "cirBTC allocation is 4500bps (45%).",
    policyLimitsText:
      "maxDrawdownBps: 2000, maxTradesPerDay: 10, minStableAllocationBps: 5000, maxAllocationBpsPerAsset: { cirBTC: 4500 }",
    vaultState,
    marketData,
  };
}

const TRIALS = 3;
// Comfortably wide around the requested ~20% (2000bps): wide enough to
// tolerate normal model judgment on exact sizing, narrow enough that the
// ~13,857,000bps (~1,385,700%) the real bug produced falls nowhere close.
const PLAUSIBLE_MIN_BPS = 200; // 2%
const PLAUSIBLE_MAX_BPS = 6000; // 60%, above the configured 4500bps cap to allow for an intentionally-over-cap proposal without flagging it as a unit bug

test("ENTER amount for a non-1:1-priced asset stays in asset-own-units, never percent-of-NAV or USD-value", { timeout: 300_000 }, async () => {
  const enterTrials: { amount: string; impliedBps: number }[] = [];

  // Sequential on purpose: avoids bursting concurrent requests against the
  // same key for what is already a real-cost, on-demand test.
  for (let i = 0; i < TRIALS; i++) {
    const { decision } = await proposeDecision(buildInput());
    if (decision.action === "ENTER" && decision.asset === "cirBTC") {
      assert.ok(decision.amount !== null && decision.amount !== undefined, "ENTER cirBTC must include an amount");
      const amountUnits = Number(decision.amount);
      const impliedUSDValue = amountUnits * CIRBTC_PRICE_USDC;
      const impliedBps = Math.round((impliedUSDValue / TOTAL_NAV_USDC) * 10_000);
      enterTrials.push({ amount: decision.amount!, impliedBps });
    }
  }

  assert.ok(
    enterTrials.length > 0,
    `expected at least one of ${TRIALS} trials to propose ENTER cirBTC given a strategy explicitly nudging it; got none, ` +
      `cannot exercise the unit-calibration check this test guards`,
  );

  for (const trial of enterTrials) {
    assert.ok(
      trial.impliedBps >= PLAUSIBLE_MIN_BPS && trial.impliedBps <= PLAUSIBLE_MAX_BPS,
      `amount "${trial.amount}" implies ${trial.impliedBps}bps of NAV at cirBTC's real price ($${CIRBTC_PRICE_USDC}), outside the ` +
        `plausible range [${PLAUSIBLE_MIN_BPS}, ${PLAUSIBLE_MAX_BPS}]bps for a ~20%-of-NAV request; this is the exact signature of ` +
        `the amount field being expressed as a percentage or USD value instead of the target asset's own units`,
    );
  }
});
