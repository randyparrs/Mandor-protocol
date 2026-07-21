// One full unattended Paper Vault cycle: propose (real AI agent call, real
// market data) -> offchain pre-check (against the deliberately permissive
// PAPER_POLICY_LIMITS, see scripts/paperVaultConfig.ts) -> PaperExecutor
// logs it (never onchain, no real funds, ever) -> if the pre-check passed,
// advance the simulated vault state so the NEXT cycle reasons about an
// evolving portfolio, not a static one.
//
// requireIndependentReferencePriceToBuy (executor/keeperService.ts) is
// real-execution-only: it guards buildSwapLegs, which only KeeperService
// ever calls. This script never imports keeperService.ts at all, so that
// hard block structurally cannot apply here, nothing to bypass, exactly
// as intended for a mode where nothing real is ever at risk.
//
// Run with: node --import tsx scripts/paperVaultCycle.ts
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { getMarketData, getVolatileAssetPriceUSDC } from "../agent/core/tools/getMarketData.js";
import { proposeDecision } from "../agent/core/loop.js";
import { setModelPin } from "../agent/core/modelPin.js";
import { checkPolicyOffchain, projectHoldings } from "../agent/policy/offchainPolicyCheck.js";
import { PaperExecutor } from "../executor/paperExecutor.js";
import { loadPaperVaultState, savePaperVaultState } from "../shared/paperVaultState.js";
import { formatRawAmount, parseRawAmount, INTERNAL_FIXED_POINT_DECIMALS } from "../shared/money.js";
import { PAPER_VAULT_ID, PAPER_VAULT_ASSETS, PAPER_STABLE_ASSETS, PAPER_POLICY_LIMITS, PAPER_STRATEGY_VERSION, PAPER_STRATEGY_CONFIG_TEXT, buildPaperPolicyLimitsText } from "./paperVaultConfig.js";
import { getPaperTestTokenPrices, buildLpOpportunitiesText } from "./paperVaultTestTokens.js";

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });

/// @notice Advances the simulated vault state from a passing decision's
/// own projected holdings (projectHoldings, reused verbatim from the same
/// offchain pre-check this script already ran, never reimplemented).
/// tradesToday increments for any non-HOLD action, matching
/// VaultPolicy.sol's own real rule. highWaterMarkUSDC/currentDrawdownBps
/// follow the exact same definition getVaultState.ts's real onchain read
/// would produce for a real vault.
function advanceState(
  decision: Parameters<typeof projectHoldings>[0],
  vaultState: Parameters<typeof projectHoldings>[1],
  marketData: Parameters<typeof projectHoldings>[3],
) {
  const { holdings, totalUSDC } = projectHoldings(decision, vaultState, PAPER_VAULT_ASSETS, marketData);
  const totalUSDCStr = formatRawAmount(totalUSDC, INTERNAL_FIXED_POINT_DECIMALS);
  const highWaterMark = parseRawAmount(vaultState.highWaterMarkUSDC, INTERNAL_FIXED_POINT_DECIMALS);
  const newHighWaterMark = totalUSDC > highWaterMark ? totalUSDC : highWaterMark;
  const drawdownBps = newHighWaterMark > 0n ? Number(((newHighWaterMark - totalUSDC) * 10_000n) / newHighWaterMark) : 0;

  return {
    vaultId: PAPER_VAULT_ID,
    totalAssetsUSDC: totalUSDCStr,
    holdings: holdings.map((h) => ({ asset: h.asset, ledgerAmount: formatRawAmount(h.valueUSDC, INTERNAL_FIXED_POINT_DECIMALS), valueUSDC: formatRawAmount(h.valueUSDC, INTERNAL_FIXED_POINT_DECIMALS) })),
    paused: false,
    tradesToday: decision.action === "HOLD" ? vaultState.tradesToday : vaultState.tradesToday + 1,
    highWaterMarkUSDC: formatRawAmount(newHighWaterMark, INTERNAL_FIXED_POINT_DECIMALS),
    currentDrawdownBps: drawdownBps,
    // The Paper Vault never simulates real LP_* actions, see
    // shared/paperVaultState.ts's own doc comment.
    lpPositions: [],
    // Same reasoning: no real cross-chain lending simulation here either.
    currentLendingPositions: [],
  };
}

async function runPaperVaultCycle(): Promise<void> {
  console.log(`=== paper vault cycle start: ${new Date().toISOString()} ===`);

  // In-memory only (agent/core/modelPin.ts's own doc comment), a fresh
  // process (this script, one full run per invocation, same pattern
  // scripts/runDecisionCycle.ts already uses for v1/v2) must re-set it
  // every time, never a one-time registration.
  setModelPin(PAPER_VAULT_ID, "claude-sonnet-5");

  const vaultState = await loadPaperVaultState();

  // cirBTC keeps using the same shared getVolatileAssetPriceUSDC path v1/v2
  // read from (it is a real asset with a real pool); the 4 MANDORTEST-*
  // tokens are team-created test infrastructure with their own,
  // Paper-Vault-only pricing module (scripts/paperVaultTestTokens.ts),
  // never mixed into the shared VOLATILE_ASSET_QUOTE_CONFIG that a real
  // vault's keeper cycle also reads from.
  const [stablePrices, cirbtcPrice, testTokenPrices, lpOpportunitiesText] = await Promise.all([
    getMarketData(PAPER_STABLE_ASSETS.map((asset) => ({ asset }))),
    getVolatileAssetPriceUSDC(publicClient, "cirBTC"),
    getPaperTestTokenPrices(publicClient),
    buildLpOpportunitiesText(publicClient),
  ]);
  const marketData = { prices: [...stablePrices.prices, cirbtcPrice, ...testTokenPrices], untrustedContext: stablePrices.untrustedContext };

  const input = {
    vaultId: PAPER_VAULT_ID,
    strategyVersion: PAPER_STRATEGY_VERSION,
    // Live, freshly-read pool liquidity appended each cycle: the base
    // strategy text's criterion 1 asks the agent to reason about real pool
    // depth, but MarketData/VaultState only carry per-asset prices, not
    // per-pool liquidity, so this is where that data actually reaches the
    // model (see scripts/paperVaultTestTokens.ts's own doc comment).
    strategyConfigText: `${PAPER_STRATEGY_CONFIG_TEXT}\n\n${lpOpportunitiesText}`,
    policyLimitsText: buildPaperPolicyLimitsText(),
    vaultState,
    marketData,
  };

  console.log("--- proposeDecision (real AI agent call, real market data) ---");
  const { decision, thinkingText, thinkingTokens } = await proposeDecision(input);
  console.log(`Proposed ${decision.action} (confidence ${decision.confidence})`);

  const policyCheck = checkPolicyOffchain({ decision, vaultState, policyLimits: PAPER_POLICY_LIMITS, marketData, assets: PAPER_VAULT_ASSETS });

  const executor = new PaperExecutor();
  await executor.execute(decision, policyCheck, thinkingText, thinkingTokens);

  if (policyCheck.passed) {
    const nextState = advanceState(decision, vaultState, marketData);
    await savePaperVaultState(nextState);
    console.log(`State advanced: totalAssets=${nextState.totalAssetsUSDC}, holdings=${JSON.stringify(nextState.holdings)}`);
  } else {
    console.log(`Pre-check failed (${policyCheck.violations.map((v) => v.code).join(", ")}), state left unchanged, same as a real rejected decision.`);
  }

  console.log(`=== paper vault cycle complete: ${new Date().toISOString()} ===`);
}

runPaperVaultCycle().catch((error) => {
  console.error(`Paper vault cycle failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
