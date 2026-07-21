// One full unattended cycle, for every configured vault: propose (real
// AI agent call) -> auto-confirm ONLY if HOLD (agreed with Randy: HOLD never
// moves funds, always empty swap legs, so this is functionally equivalent
// to a human clicking confirm every time) -> keeper executes anything
// confirmed -> indexer catches up on real onchain events.
//
// Meant to be invoked periodically by an external scheduler (Windows Task
// Scheduler), never a long-running loop itself: each invocation is a
// fresh, independent process, using the real persisted
// DecisionPipeline/EventStore (data/mandate.db) so state survives across
// invocations, not an in-memory instance that would forget everything
// between scheduled runs. Both vaults below share the same underlying
// data/mandate.db (already vault/contract-scoped internally by every
// query in DecisionPipeline/EventStore), not a separate database each.
//
// ENTER/EXIT/REBALANCE/EMERGENCY_EXIT_TO_STABLE are never auto-confirmed,
// no exceptions, they sit in the queue exactly like any manually-proposed
// decision until a real person confirms or rejects them.
//
// Run with: node --import tsx scripts/runDecisionCycle.ts
import "dotenv/config";
import { createPublicClient, http, type PublicClient } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { setModelPin } from "../agent/core/modelPin.js";
import type { AssetSymbol } from "../shared/decision.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import { DecisionStore } from "../server/db/decisionStore.js";
import { KeeperService } from "../executor/keeperService.js";
import { EventIndexer } from "../server/indexer/eventIndexer.js";
import { EventStore } from "../server/db/eventStore.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as const;

const STRATEGY_VERSION = "v1";
const BASE_STRATEGY_CONFIG_TEXT = "Conservative income strategy. Prefer HOLD unless there is a clear, well-supported reason to rebalance.";

// Told to the agent itself, not just enforced downstream: without this,
// the first time the agent proposed an ENTER/REBALANCE increasing cirBTC,
// it would sail through proposal and ops confirmation only to be hard-
// rejected by executor/keeperService.ts's requireIndependentReferencePriceToBuy
// at execution time, with no obvious explanation to whoever confirmed it.
// Telling the agent up front means it simply won't propose the blocked
// action, matching Randy's own "not a silent surprise" standard, applied
// to the reasoning layer, not just the execution layer.
const V2_CIRBTC_RESTRICTION_NOTE =
  "This vault's strategy allows holding cirBTC, but today you must never propose ENTER into cirBTC or any REBALANCE that increases cirBTC's target allocation: no genuinely independent reference price exists for cirBTC yet (see docs/arc-facts-to-verify.md), so any such action is hard-rejected at execution time regardless of what you propose. Reducing cirBTC exposure (EXIT, REBALANCE decreasing cirBTC's target, EMERGENCY_EXIT_TO_STABLE) remains fully available and unaffected.";

interface VaultCycleConfig {
  label: string;
  vaultAddress: `0x${string}`;
  policyAddress: `0x${string}`;
  // Only consulted by EventIndexer if no cursor has ever been persisted
  // yet for this contract, harmless to leave as-is afterward, see
  // docs/deployments.md for both blocks.
  vaultCreationBlock: bigint;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  // Defaults to BASE_STRATEGY_CONFIG_TEXT when omitted, see runCycleForVault.
  strategyConfigText?: string;
}

const VAULTS: VaultCycleConfig[] = [
  {
    label: "v1 (USDC-only)",
    vaultAddress: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    policyAddress: "0x5285D175849513b5918aaB5c539b5ED79EEF1A1f",
    vaultCreationBlock: 51112175n,
    assets: [{ symbol: "USDC", address: USDC_ADDRESS, isBaseAsset: true }],
    stableAssets: ["USDC"],
  },
  {
    label: "v2 (USDC + cirBTC)",
    vaultAddress: "0x6a00e9de0b830Fd2Bc37db7C19Ae8b67a0df1862",
    policyAddress: "0x676a1dd7CF88C768559d9A3ECC60F5Fc5319b9d5",
    vaultCreationBlock: 51318322n,
    assets: [
      { symbol: "USDC", address: USDC_ADDRESS, isBaseAsset: true },
      { symbol: "cirBTC", address: CIRBTC_ADDRESS },
    ],
    stableAssets: ["USDC"],
    strategyConfigText: `${BASE_STRATEGY_CONFIG_TEXT} ${V2_CIRBTC_RESTRICTION_NOTE}`,
  },
];

async function runCycleForVault(publicClient: PublicClient, decisionStore: DecisionStore, eventStore: EventStore, config: VaultCycleConfig): Promise<void> {
  console.log(`\n=== ${config.label}: ${config.vaultAddress} ===`);
  const pipeline = new DecisionPipeline(decisionStore);

  const strategyConfigText = config.strategyConfigText ?? BASE_STRATEGY_CONFIG_TEXT;
  const policyLimits = await buildPolicyLimitsStruct(publicClient, config.vaultAddress, config.policyAddress, config.assets);
  const input = await buildProposeDecisionInput({
    publicClient,
    vaultAddress: config.vaultAddress,
    strategyVersion: STRATEGY_VERSION,
    strategyConfigText,
    assets: config.assets,
    stableAssets: config.stableAssets,
  });

  setModelPin(config.vaultAddress, "claude-sonnet-5");

  console.log("--- proposeAndQueue ---");
  const entry = await pipeline.proposeAndQueue(input, { vaultState: input.vaultState, policyLimits, marketData: input.marketData, assets: config.assets });
  console.log(`Proposed ${entry.queued.decision.action} (confidence ${entry.queued.decision.confidence}), decisionId ${entry.decisionId}`);

  const autoConfirmed = pipeline.autoConfirmIfHold(entry.decisionId);
  if (autoConfirmed) {
    console.log(`Auto-confirmed HOLD decision ${entry.decisionId} (confirmedBy: ${autoConfirmed.queued.confirmedBy}).`);
  } else {
    console.log(`Decision ${entry.decisionId} is "${entry.queued.decision.action}", never auto-confirmed, left pending for real human review.`);
  }

  console.log("--- keeper: process any confirmed-but-unexecuted decisions ---");
  const keeper = new KeeperService({
    publicClient,
    vaultAddress: config.vaultAddress,
    assets: config.assets,
    stableAssets: config.stableAssets,
    strategyVersion: STRATEGY_VERSION,
    strategyConfigText,
    pipeline,
  });
  await keeper.runOnce();

  console.log("--- indexer: catch up on real onchain events ---");
  const indexer = new EventIndexer({
    publicClient,
    vaultAddress: config.vaultAddress,
    policyAddress: config.policyAddress,
    startBlock: config.vaultCreationBlock,
    store: eventStore,
  });
  await indexer.pollOnce();
}

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });
const decisionStore = new DecisionStore();
const eventStore = new EventStore();

console.log(`=== decision cycle start: ${new Date().toISOString()} ===`);

for (const config of VAULTS) {
  try {
    await runCycleForVault(publicClient, decisionStore, eventStore, config);
  } catch (error) {
    // One vault's failure must never stop the others from getting their
    // own cycle this run, same "never let one problem cascade silently"
    // principle already applied elsewhere in this project.
    console.error(`Cycle failed for ${config.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

decisionStore.close();
eventStore.close();
console.log(`\n=== decision cycle complete: ${new Date().toISOString()} ===\n`);
