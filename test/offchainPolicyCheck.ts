import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPolicyOffchain } from "../agent/policy/offchainPolicyCheck.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyLimits } from "../shared/policyTypes.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";
import type { MarketData, VaultState } from "../agent/core/types.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const USDC = "0x3600000000000000000000000000000000000000" as const;
const CIRBTC = "0x0000000000000000000000000000000000000099" as const;

const ASSETS: KnownAsset[] = [
  { symbol: "USDC", address: USDC, isBaseAsset: true },
  { symbol: "cirBTC", address: CIRBTC },
];

function decision(overrides: Partial<VaultDecision> = {}): VaultDecision {
  return {
    vaultId: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    strategyVersion: "v1",
    modelId: "claude-sonnet-5",
    action: "HOLD",
    confidence: 0.9,
    reasoning: "test fixture",
    proposedAt: NOW.toISOString(),
    ...overrides,
  };
}

function vaultState(overrides: Partial<VaultState> = {}): VaultState {
  return {
    vaultId: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    totalAssetsUSDC: "10000",
    holdings: [
      { asset: "USDC", ledgerAmount: "10000", valueUSDC: "10000" },
      { asset: "cirBTC", ledgerAmount: "0", valueUSDC: "0" },
    ],
    paused: false,
    tradesToday: 0,
    highWaterMarkUSDC: "10000",
    currentDrawdownBps: 0,
    ...overrides,
  };
}

function policyLimits(overrides: Partial<PolicyLimits> = {}): PolicyLimits {
  return {
    maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 },
    isStableAsset: { USDC: true, cirBTC: false },
    maxDrawdownBps: 1000,
    maxTradesPerDay: 5,
    minStableAllocationBps: 7000,
    oracleMaxStalenessSeconds: 3600,
    oracleMaxDeviationBps: 500,
    maxDrawdownSpeedBpsPerWindow: 300,
    drawdownSpeedWindowSeconds: 3600,
    autoPauseBountyAmount: "0",
    ...overrides,
  };
}

function marketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    prices: [{ asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() }],
    ...overrides,
  };
}

describe("checkPolicyOffchain", () => {
  it("passes a clean HOLD with no violations", () => {
    const result = checkPolicyOffchain({
      decision: decision(),
      vaultState: vaultState(),
      policyLimits: policyLimits(),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
    assert.equal(result.source, "offchain-precheck");
  });

  it("flags VAULT_PAUSED when the vault reports paused, even for HOLD", () => {
    const result = checkPolicyOffchain({
      decision: decision(),
      vaultState: vaultState({ paused: true }),
      policyLimits: policyLimits(),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.equal(result.passed, false);
    assert.ok(result.violations.some((v) => v.code === "VAULT_PAUSED"));
  });

  it("flags MAX_TRADES_PER_DAY_EXCEEDED for a non-HOLD action at the daily cap", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "EXIT", asset: "USDC", amount: "0" }),
      vaultState: vaultState({ tradesToday: 5 }),
      policyLimits: policyLimits({ maxTradesPerDay: 5 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "MAX_TRADES_PER_DAY_EXCEEDED"));
  });

  it("never flags MAX_TRADES_PER_DAY_EXCEEDED for HOLD, matching VaultPolicy.sol's own guard", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "HOLD" }),
      vaultState: vaultState({ tradesToday: 999 }),
      policyLimits: policyLimits({ maxTradesPerDay: 5 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(!result.violations.some((v) => v.code === "MAX_TRADES_PER_DAY_EXCEEDED"));
  });

  it("flags ORACLE_STALE when a price is older than oracleMaxStalenessSeconds", () => {
    const staleTime = new Date(NOW.getTime() - 2 * 3600 * 1000);
    const result = checkPolicyOffchain({
      decision: decision(),
      vaultState: vaultState(),
      policyLimits: policyLimits({ oracleMaxStalenessSeconds: 3600 }),
      marketData: marketData({ prices: [{ asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: staleTime.toISOString() }] }),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "ORACLE_STALE"));
  });

  it("flags ORACLE_DEVIATION_EXCEEDED when price deviates beyond oracleMaxDeviationBps", () => {
    const result = checkPolicyOffchain({
      decision: decision(),
      vaultState: vaultState(),
      policyLimits: policyLimits({ oracleMaxDeviationBps: 500 }),
      marketData: marketData({ prices: [{ asset: "USDC", priceUSDC: "0.90", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() }] }),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "ORACLE_DEVIATION_EXCEEDED"));
  });

  it("flags MAX_ALLOCATION_EXCEEDED for a REBALANCE that overshoots an asset's cap", () => {
    const result = checkPolicyOffchain({
      decision: decision({
        action: "REBALANCE",
        targetAllocations: [
          { asset: "USDC", targetWeightBps: 5000 },
          { asset: "cirBTC", targetWeightBps: 5000 },
        ],
      }),
      vaultState: vaultState(),
      policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 } }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "MAX_ALLOCATION_EXCEEDED" && v.detail.includes("cirBTC")));
  });

  it("flags MIN_STABLE_ALLOCATION_VIOLATED when a REBALANCE pushes stable share too low", () => {
    const result = checkPolicyOffchain({
      decision: decision({
        action: "REBALANCE",
        targetAllocations: [
          { asset: "USDC", targetWeightBps: 5000 },
          { asset: "cirBTC", targetWeightBps: 5000 },
        ],
      }),
      vaultState: vaultState(),
      policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 }, minStableAllocationBps: 7000 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "MIN_STABLE_ALLOCATION_VIOLATED"));
  });

  it("flags MAX_DRAWDOWN_EXCEEDED using the vault's current drawdown", () => {
    const result = checkPolicyOffchain({
      decision: decision(),
      vaultState: vaultState({ currentDrawdownBps: 1500 }),
      policyLimits: policyLimits({ maxDrawdownBps: 1000 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "MAX_DRAWDOWN_EXCEEDED"));
  });

  it("EMERGENCY_EXIT_TO_STABLE always passes, bypassing every other check", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "EMERGENCY_EXIT_TO_STABLE" }),
      vaultState: vaultState({ paused: true, tradesToday: 999, currentDrawdownBps: 9999 }),
      policyLimits: policyLimits({ maxTradesPerDay: 5, maxDrawdownBps: 1000 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
  });

  it("projects an ENTER into a new asset as funded from the base asset", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "ENTER", asset: "cirBTC", amount: "0.1" }),
      vaultState: vaultState(),
      policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 } }),
      marketData: marketData({
        prices: [
          { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
          { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
        ],
      }),
      assets: ASSETS,
      now: NOW,
    });
    // 0.1 * 60000 = 6000 USDC entered against a 10000 USDC vault = 6000bps,
    // above the configured 3000bps cap for cirBTC.
    assert.ok(result.violations.some((v) => v.code === "MAX_ALLOCATION_EXCEEDED" && v.detail.includes("cirBTC")));
  });

  it("projects an EXIT as crediting the base asset, bounded at the existing holding", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "EXIT", asset: "cirBTC", amount: "1" }),
      vaultState: vaultState({
        totalAssetsUSDC: "10000",
        holdings: [
          { asset: "USDC", ledgerAmount: "8000", valueUSDC: "8000" },
          { asset: "cirBTC", ledgerAmount: "1", valueUSDC: "2000" },
        ],
      }),
      policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 }, minStableAllocationBps: 9000 }),
      marketData: marketData({
        prices: [
          { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
          { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
        ],
      }),
      assets: ASSETS,
      now: NOW,
    });
    // Exiting far more cirBTC than held (amount 1 at 60000 >> 2000 USDC
    // held) is capped at the existing holding: cirBTC goes to 0, USDC
    // absorbs the full 2000 USDC, landing at 100% stable, above the 9000bps
    // minimum, so no MIN_STABLE_ALLOCATION_VIOLATED.
    assert.ok(!result.violations.some((v) => v.code === "MIN_STABLE_ALLOCATION_VIOLATED"));
  });

  it("throws for REBALANCE missing targetAllocations rather than guessing a projection", () => {
    assert.throws(() =>
      checkPolicyOffchain({
        decision: decision({ action: "REBALANCE" }),
        vaultState: vaultState(),
        policyLimits: policyLimits(),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      }),
    );
  });

  it("throws for ENTER missing asset/amount rather than guessing a projection", () => {
    assert.throws(() =>
      checkPolicyOffchain({
        decision: decision({ action: "ENTER" }),
        vaultState: vaultState(),
        policyLimits: policyLimits(),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      }),
    );
  });

  it("throws for ENTER into a non-base asset with no configured market price", () => {
    assert.throws(() =>
      checkPolicyOffchain({
        decision: decision({ action: "ENTER", asset: "cirBTC", amount: "0.1" }),
        vaultState: vaultState(),
        policyLimits: policyLimits(),
        marketData: marketData(), // only has a USDC price, no cirBTC entry
        assets: ASSETS,
        now: NOW,
      }),
    );
  });

  it("collects multiple simultaneous violations rather than short-circuiting on the first", () => {
    const result = checkPolicyOffchain({
      decision: decision({ action: "EXIT", asset: "USDC", amount: "0" }),
      vaultState: vaultState({ paused: true, tradesToday: 999, currentDrawdownBps: 9999 }),
      policyLimits: policyLimits({ maxTradesPerDay: 5, maxDrawdownBps: 1000 }),
      marketData: marketData(),
      assets: ASSETS,
      now: NOW,
    });
    assert.equal(result.passed, false);
    const codes = result.violations.map((v) => v.code);
    assert.ok(codes.includes("VAULT_PAUSED"));
    assert.ok(codes.includes("MAX_TRADES_PER_DAY_EXCEEDED"));
    assert.ok(codes.includes("MAX_DRAWDOWN_EXCEEDED"));
  });
});
