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
    lpPositions: [],
    currentLendingPositions: [],
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
    minLpTickRangeWidth: 0,
    maxLpPositionValueLossBps: 0,
    maxLpOutOfRangeSeconds: 0,
    minLpPoolLiquidityRatioBps: 0,
    maxLpAllocationBps: 0,
    lendingReportStaleAfterSeconds: 0,
    lendingReportMaxDeviationBps: 0,
    lendingPositionForceUnwindSeconds: 0,
    maxLendingAllocationBps: 0,
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

  describe("rebalanceExemptFromMaxDrawdown (v5's opt-in REBALANCE exemption, mirrors VaultPolicy.sol's own onchain exemption)", () => {
    it("REBALANCE passes during high drawdown when rebalanceExemptFromMaxDrawdown is true", () => {
      const result = checkPolicyOffchain({
        decision: decision({
          action: "REBALANCE",
          targetAllocations: [
            { asset: "USDC", targetWeightBps: 8000 },
            { asset: "cirBTC", targetWeightBps: 2000 },
          ],
        }),
        vaultState: vaultState({ currentDrawdownBps: 1500 }),
        policyLimits: policyLimits({ maxDrawdownBps: 1000, maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 }, minStableAllocationBps: 7000 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
        rebalanceExemptFromMaxDrawdown: true,
      });
      assert.ok(!result.violations.some((v) => v.code === "MAX_DRAWDOWN_EXCEEDED"));
    });

    it("a non-REBALANCE action still flags MAX_DRAWDOWN_EXCEEDED during the same drawdown, even with the flag set (exemption is scoped to REBALANCE only)", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "HOLD" }),
        vaultState: vaultState({ currentDrawdownBps: 1500 }),
        policyLimits: policyLimits({ maxDrawdownBps: 1000 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
        rebalanceExemptFromMaxDrawdown: true,
      });
      assert.ok(result.violations.some((v) => v.code === "MAX_DRAWDOWN_EXCEEDED"));
    });

    it("REBALANCE still flags MAX_DRAWDOWN_EXCEEDED during high drawdown when rebalanceExemptFromMaxDrawdown is omitted (v1-v4's real, unchanged calling convention)", () => {
      const result = checkPolicyOffchain({
        decision: decision({
          action: "REBALANCE",
          targetAllocations: [
            { asset: "USDC", targetWeightBps: 8000 },
            { asset: "cirBTC", targetWeightBps: 2000 },
          ],
        }),
        vaultState: vaultState({ currentDrawdownBps: 1500 }),
        policyLimits: policyLimits({ maxDrawdownBps: 1000, maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 }, minStableAllocationBps: 7000 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
        // rebalanceExemptFromMaxDrawdown intentionally omitted
      });
      assert.ok(result.violations.some((v) => v.code === "MAX_DRAWDOWN_EXCEEDED"));
    });
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

  it("flags IMPLAUSIBLE_ALLOCATION_MAGNITUDE for a unit-mismatched ENTER amount, alongside MAX_ALLOCATION_EXCEEDED", () => {
    const result = checkPolicyOffchain({
      // Mirrors the real bug this test guards against: the model meant
      // "30% allocation" but wrote amount as if it were a literal cirBTC
      // unit count, at cirBTC's real order-of-magnitude price. Should
      // never silently collapse into a plain MAX_ALLOCATION_EXCEEDED,
      // since that message alone doesn't point at a likely unit mismatch.
      decision: decision({ action: "ENTER", asset: "cirBTC", amount: "30.00" }),
      vaultState: vaultState(),
      policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 3000 } }),
      marketData: marketData({
        prices: [
          { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
          { asset: "cirBTC", priceUSDC: "276073", referencePriceUSDC: "276073", updatedAt: NOW.toISOString() },
        ],
      }),
      assets: ASSETS,
      now: NOW,
    });
    assert.ok(result.violations.some((v) => v.code === "MAX_ALLOCATION_EXCEEDED" && v.detail.includes("cirBTC")));
    assert.ok(
      result.violations.some((v) => v.code === "IMPLAUSIBLE_ALLOCATION_MAGNITUDE" && v.detail.includes("cirBTC") && v.detail.includes("unit mismatch")),
    );
  });

  it("does not flag IMPLAUSIBLE_ALLOCATION_MAGNITUDE for a real, merely over-cap trade", () => {
    const result = checkPolicyOffchain({
      // 0.1 * 60000 = 6000 USDC into a 10000 USDC vault = 6000bps: a
      // legitimate, sane trade that happens to exceed a 3000bps cap, not
      // a unit-mismatch bug. Must not trip the magnitude guard.
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
    assert.ok(result.violations.some((v) => v.code === "MAX_ALLOCATION_EXCEEDED"));
    assert.ok(!result.violations.some((v) => v.code === "IMPLAUSIBLE_ALLOCATION_MAGNITUDE"));
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

  describe("INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY (mirrors the keeper's own requireIndependentReferencePriceToBuy)", () => {
    it("flags an ENTER buying cirBTC (no independent reference price source)", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "ENTER", asset: "cirBTC", amount: "0.01" }),
        vaultState: vaultState(),
        policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 } }),
        marketData: marketData({
          prices: [
            { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
            { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
          ],
        }),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY" && v.detail.includes("cirBTC")));
    });

    it("flags a REBALANCE whose target weight for cirBTC exceeds its current weight (a net buy)", () => {
      const result = checkPolicyOffchain({
        decision: decision({
          action: "REBALANCE",
          targetAllocations: [
            { asset: "USDC", targetWeightBps: 5000 },
            { asset: "cirBTC", targetWeightBps: 5000 },
          ],
        }),
        vaultState: vaultState(), // cirBTC currently 0
        policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 }, minStableAllocationBps: 0 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY" && v.detail.includes("cirBTC")));
    });

    it("does NOT flag a REBALANCE whose target weight for cirBTC is below its current weight (a sell)", () => {
      const result = checkPolicyOffchain({
        decision: decision({
          action: "REBALANCE",
          targetAllocations: [
            { asset: "USDC", targetWeightBps: 8000 },
            { asset: "cirBTC", targetWeightBps: 2000 },
          ],
        }),
        vaultState: vaultState({
          totalAssetsUSDC: "10000",
          holdings: [
            { asset: "USDC", ledgerAmount: "5000", valueUSDC: "5000" },
            { asset: "cirBTC", ledgerAmount: "0.083", valueUSDC: "5000" },
          ],
        }),
        policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 }, minStableAllocationBps: 0 }),
        marketData: marketData({
          prices: [
            { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
            { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
          ],
        }),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY"));
    });

    it("does NOT flag an EXIT (always a sell), even out of cirBTC", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "EXIT", asset: "cirBTC", amount: "0.01" }),
        vaultState: vaultState({
          totalAssetsUSDC: "10000",
          holdings: [
            { asset: "USDC", ledgerAmount: "5000", valueUSDC: "5000" },
            { asset: "cirBTC", ledgerAmount: "0.083", valueUSDC: "5000" },
          ],
        }),
        policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 }, minStableAllocationBps: 0 }),
        marketData: marketData({
          prices: [
            { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
            { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
          ],
        }),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY"));
    });

    it("does NOT flag buying USDC (the base asset always has an independent reference price)", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "EXIT", asset: "cirBTC", amount: "0.01" }), // credits USDC as a side effect
        vaultState: vaultState({
          totalAssetsUSDC: "10000",
          holdings: [
            { asset: "USDC", ledgerAmount: "5000", valueUSDC: "5000" },
            { asset: "cirBTC", ledgerAmount: "0.083", valueUSDC: "5000" },
          ],
        }),
        policyLimits: policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 10_000 }, minStableAllocationBps: 0 }),
        marketData: marketData({
          prices: [
            { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: NOW.toISOString() },
            { asset: "cirBTC", priceUSDC: "60000", referencePriceUSDC: "60000", updatedAt: NOW.toISOString() },
          ],
        }),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY" && v.detail.includes("USDC")));
    });
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

  // Regression tests for the 2026-07-14 fix: this loop must mirror
  // VaultPolicy.sol's own currentLpPositions exemption exactly, or the
  // offchain pre-check would reject a decision the real contract now
  // accepts (a targeted LP_DECREASE/LP_COLLECT/LP_CLOSE on the exact
  // breached position it targets).
  describe("LP position health checks (v3)", () => {
    const breachedPosition = {
      tokenId: "1",
      pool: "0x4444444444444444444444444444444444444444" as const,
      valueUSDC: "0",
      openValueUSDC: "1000",
      inRange: true,
      outOfRangeSince: null,
      poolLiquidityAtOpen: "0",
      currentPoolLiquidity: "0",
    };

    it("LP_DECREASE targeting the exact breached position is allowed through", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "LP_DECREASE", lpTokenId: "1", liquidityFractionBps: 5000 }),
        vaultState: vaultState({ lpPositions: [breachedPosition] }),
        policyLimits: policyLimits({ maxLpPositionValueLossBps: 300 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "LP_POSITION_VALUE_LOSS_EXCEEDED"));
    });

    it("a different, non-targeted breached position still blocks the decision", () => {
      const otherPosition = { ...breachedPosition, tokenId: "2" };
      const result = checkPolicyOffchain({
        decision: decision({ action: "LP_DECREASE", lpTokenId: "1", liquidityFractionBps: 5000 }),
        vaultState: vaultState({ lpPositions: [{ ...breachedPosition, tokenId: "1" }, otherPosition] }),
        policyLimits: policyLimits({ maxLpPositionValueLossBps: 300 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "LP_POSITION_VALUE_LOSS_EXCEEDED"));
    });

    it("HOLD does not get the reduce/close exemption, even if the vault happens to hold a breached position", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "HOLD" }),
        vaultState: vaultState({ lpPositions: [breachedPosition] }),
        policyLimits: policyLimits({ maxLpPositionValueLossBps: 300 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "LP_POSITION_VALUE_LOSS_EXCEEDED"));
    });
  });

  describe("Lending position health checks (v4)", () => {
    const stalePosition = {
      positionId: "1",
      chainId: "421614",
      status: "OPEN" as const,
      currentAllocationBps: 1000,
      principalUSDC: "1000",
      currentValueUSDC: "1000",
      lastReportedAt: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString(), // 8 days ago
    };

    it("flags LENDING_POSITION_STALE once lastReportedAt exceeds lendingPositionForceUnwindSeconds", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "HOLD" }),
        vaultState: vaultState({ currentLendingPositions: [stalePosition] }),
        policyLimits: policyLimits({ lendingPositionForceUnwindSeconds: 7 * 24 * 3600 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "LENDING_POSITION_STALE"));
    });

    it("BRIDGE_WITHDRAW targeting the exact stale position is exempt from LENDING_POSITION_STALE", () => {
      const result = checkPolicyOffchain({
        decision: decision({ action: "BRIDGE_WITHDRAW", bridgePositionId: "1" }),
        vaultState: vaultState({ currentLendingPositions: [stalePosition] }),
        policyLimits: policyLimits({ lendingPositionForceUnwindSeconds: 7 * 24 * 3600 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "LENDING_POSITION_STALE"));
    });

    it("a position already WITHDRAWAL_PENDING is unconditionally exempt, even for an unrelated HOLD", () => {
      const unwindingPosition = { ...stalePosition, status: "WITHDRAWAL_PENDING" as const };
      const result = checkPolicyOffchain({
        decision: decision({ action: "HOLD" }),
        vaultState: vaultState({ currentLendingPositions: [unwindingPosition] }),
        policyLimits: policyLimits({ lendingPositionForceUnwindSeconds: 7 * 24 * 3600 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.ok(!result.violations.some((v) => v.code === "LENDING_POSITION_STALE"));
    });

    it("flags LENDING_MAX_ALLOCATION_EXCEEDED once total lending exposure exceeds the cap", () => {
      const freshPosition = { ...stalePosition, lastReportedAt: NOW.toISOString(), currentAllocationBps: 6000 };
      const result = checkPolicyOffchain({
        decision: decision({ action: "HOLD" }),
        vaultState: vaultState({ currentLendingPositions: [freshPosition] }),
        policyLimits: policyLimits({ maxLendingAllocationBps: 5000, lendingPositionForceUnwindSeconds: 7 * 24 * 3600 }),
        marketData: marketData(),
        assets: ASSETS,
        now: NOW,
      });
      assert.equal(result.passed, false);
      assert.ok(result.violations.some((v) => v.code === "LENDING_MAX_ALLOCATION_EXCEEDED"));
    });
  });
});
