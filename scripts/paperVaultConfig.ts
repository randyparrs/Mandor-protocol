// Dedicated demo/paper configuration, deliberately separate from v1/v2's
// real, conservative policies (see scripts/runDecisionCycle.ts). No real
// contract exists for this "vault": PAPER_VAULT_ID is a synthetic,
// obviously-fake identifier, never a deployed address, so it can never be
// confused with v1/v2 in the timeline UI or anywhere else. Real market
// data still feeds it (real cirBTC/USDC pricing, same tools/ modules v1/v2
// use), only the vault's own existence and holdings are simulated.
import type { AssetSymbol } from "../shared/decision.js";
import type { PolicyLimits } from "../shared/policyTypes.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";
import { V3_YIELD_STRATEGY_TEXT } from "./v3StrategyText.js";
import { PAPER_TEST_TOKEN_ASSETS } from "./paperVaultTestTokens.js";

// Recognizably synthetic (real Arc addresses are effectively random
// 160-bit values; this one is not), never a real deployed contract.
export const PAPER_VAULT_ID = "0x000000000000000000000000000000000000f0" as const;

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as const;

// The 4 team-created test tokens (docs/deployments.md, "Team-created test
// tokens and pools") are added here as additional candidate LP
// opportunities, alongside the existing real cirBTC pool, so the Paper
// Vault can demonstrate decision variety without waiting for the real v3
// vault's deployment. Never wired into v1/v2's real config or the real
// v3 vault's own asset list once deployed, see
// scripts/paperVaultTestTokens.ts's own doc comment.
export const PAPER_VAULT_ASSETS: KnownAsset[] = [
  { symbol: "USDC", address: USDC_ADDRESS, isBaseAsset: true },
  { symbol: "cirBTC", address: CIRBTC_ADDRESS },
  ...PAPER_TEST_TOKEN_ASSETS,
];
export const PAPER_STABLE_ASSETS: AssetSymbol[] = ["USDC"];

// Deliberately more permissive than v1 (100% USDC only) or v2
// (cirBTC capped at 2000bps/20%, see docs/deployments.md): nothing real is
// ever at risk in paper mode, so this exists specifically to generate a
// richer variety of ENTER/EXIT/REBALANCE decisions for the hackathon demo,
// not just a HOLD-heavy history. requireIndependentReferencePriceToBuy
// (executor/keeperService.ts) never applies here: that hard block guards
// the real execution path only, and PaperExecutor never calls it, see
// scripts/paperVaultCycle.ts's own doc comment.
export const PAPER_POLICY_LIMITS: PolicyLimits = {
  maxAllocationBpsPerAsset: {
    USDC: 10_000,
    cirBTC: 4_500,
    // Same generous, demo-only caps as cirBTC: real variety is the point,
    // not a realistic risk budget, see this file's own top-of-file note.
    "MANDORTEST-STABLE": 3_000,
    "MANDORTEST-RWA": 3_000,
    "MANDORTEST-EQUITY": 3_000,
    "MANDORTEST-YIELD": 3_000,
  },
  isStableAsset: {
    USDC: true,
    cirBTC: false,
    // Deliberately NOT marked stable even for MANDORTEST-STABLE: these are
    // candidate LP opportunities to evaluate, not a safe-haven bucket, so
    // none of them should count toward minStableAllocationBps.
    "MANDORTEST-STABLE": false,
    "MANDORTEST-RWA": false,
    "MANDORTEST-EQUITY": false,
    "MANDORTEST-YIELD": false,
  },
  maxDrawdownBps: 2_000,
  maxTradesPerDay: 10,
  minStableAllocationBps: 5_000,
  oracleMaxStalenessSeconds: 3_600,
  oracleMaxDeviationBps: 500,
  maxDrawdownSpeedBpsPerWindow: 1_000,
  drawdownSpeedWindowSeconds: 3_600,
  autoPauseBountyAmount: "0",
  // The Paper Vault never simulates real LP_* actions or holds a real
  // position (see shared/paperVaultState.ts's own doc comment), so these
  // are simply never evaluated, same "harmless zero" treatment v1/v2 get.
  minLpTickRangeWidth: 0,
  maxLpPositionValueLossBps: 0,
  maxLpOutOfRangeSeconds: 0,
  minLpPoolLiquidityRatioBps: 0,
  maxLpAllocationBps: 0,
  // Same reasoning: the Paper Vault never simulates real cross-chain
  // lending positions either (see shared/paperVaultState.ts), harmless
  // zero.
  lendingReportStaleAfterSeconds: 0,
  lendingReportMaxDeviationBps: 0,
  lendingPositionForceUnwindSeconds: 0,
  maxLendingAllocationBps: 0,
};

/// @notice No real VaultPolicy contract exists to read this from (unlike
/// agent/core/context.ts's buildPolicyLimitsText, which reads v1/v2's real
/// immutable limits live), so this hand-formats the same text shape from
/// PAPER_POLICY_LIMITS directly, kept in the same format the model
/// already expects from systemPrompt.ts.
export function buildPaperPolicyLimitsText(): string {
  const perAsset = PAPER_VAULT_ASSETS.map(
    (a) => `${a.symbol}: maxAllocationBps=${PAPER_POLICY_LIMITS.maxAllocationBpsPerAsset[a.symbol] ?? 0}, isStable=${PAPER_POLICY_LIMITS.isStableAsset[a.symbol] ?? false}`,
  );
  return [
    `maxDrawdownBps: ${PAPER_POLICY_LIMITS.maxDrawdownBps}`,
    `maxTradesPerDay: ${PAPER_POLICY_LIMITS.maxTradesPerDay}`,
    `minStableAllocationBps: ${PAPER_POLICY_LIMITS.minStableAllocationBps}`,
    `oracleMaxStalenessSeconds: ${PAPER_POLICY_LIMITS.oracleMaxStalenessSeconds}`,
    `oracleMaxDeviationBps: ${PAPER_POLICY_LIMITS.oracleMaxDeviationBps}`,
    `maxDrawdownSpeedBpsPerWindow: ${PAPER_POLICY_LIMITS.maxDrawdownSpeedBpsPerWindow}`,
    `drawdownSpeedWindowSeconds: ${PAPER_POLICY_LIMITS.drawdownSpeedWindowSeconds}`,
    ...perAsset,
  ].join("\n");
}

export const PAPER_STRATEGY_VERSION = "paper-demo-v1";

// v3's real yield-seeking strategy text (see this project's v3 design
// doc), reused here rather than duplicated: the Paper Vault demonstrates
// the same liquidity-curator narrative the real v3 vault uses, just via
// the existing ENTER/EXIT/REBALANCE action vocabulary (no NFT/tick
// simulation here, see shared/paperVaultState.ts's own doc comment), and
// with simulated liquidity conditions deliberately more favorable than
// real Arc testnet conditions today, since nothing here is ever at risk.
// This is deliberately different framing from v1/v2's conservative
// "prefer HOLD absent a clear reason" text (scripts/runDecisionCycle.ts).
export const PAPER_STRATEGY_CONFIG_TEXT =
  "SIMULATED demo vault, no real funds are ever at risk (nothing here executes onchain). " +
  "Simulated liquidity conditions here are deliberately more favorable than real Arc testnet conditions today, " +
  "so you can demonstrate a richer variety of decisions than the real vault's own current constraints allow. " +
  V3_YIELD_STRATEGY_TEXT;
