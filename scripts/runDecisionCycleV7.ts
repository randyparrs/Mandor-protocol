// One full unattended cycle, for every configured v7-shaped vault: propose
// (real AI agent call) -> auto-confirm ONLY if HOLD (same rule as
// scripts/runDecisionCycle.ts/runDecisionCycleV4.ts: HOLD never moves
// funds, always empty swap/lp/bridge legs, functionally equivalent to a
// human clicking confirm every time) -> keeper executes anything confirmed
// -> indexer catches up on real onchain events.
//
// A DELIBERATE, SEPARATE sibling of scripts/runDecisionCycleV4.ts, not a
// merge: that script drives v4/v5/v6-shaped vaults via
// executor/keeperServiceV4.ts; this one drives v7 via the dedicated
// executor/keeperServiceV7.ts fork (needed because contracts/MandateVaultLp.sol
// has no positionManager() on the vault itself, see that fork's own
// top-of-file comment for the full reasoning). Same "INTENTIONAL FORK"
// principle, kept as a fully separate cycle script so neither ever needs a
// runtime branch on which keeper class/ABI a given vault actually needs.
//
// Meant to be invoked periodically by an external scheduler (Windows Task
// Scheduler), never a long-running loop itself: each invocation is a
// fresh, independent process, using the real persisted
// DecisionPipeline/EventStore (data/mandate.db), same database every other
// cycle script already shares (already vault/contract-scoped internally by
// every query in DecisionPipeline/EventStore, not a separate database
// each).
//
// ENTER/EXIT/REBALANCE/LP_*/EMERGENCY_EXIT_TO_STABLE are never
// auto-confirmed, no exceptions, they sit in the queue exactly like any
// manually-proposed decision until a real person confirms or rejects it.
//
// VAULTS is EMPTY until the real v7 vault + LpPositionRegistry are actually
// deployed (scripts/deployVaultV7.ts, scripts/deployLpPositionRegistryV7.ts)
// and wired through the Safe -- same "empty until real deployment exists"
// convention already used by every prior version's cycle script during its
// own pre-deployment window. An accidental manual run of this script does
// nothing at all until a real entry is added here.
//
// Run with: node --import tsx scripts/runDecisionCycleV7.ts
import "dotenv/config";
import { createPublicClient, http, type PublicClient } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { setModelPin } from "../agent/core/modelPin.js";
import type { AssetSymbol } from "../shared/decision.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import { DecisionStore } from "../server/db/decisionStore.js";
import { KeeperServiceV7 } from "../executor/keeperServiceV7.js";
import { EventIndexer } from "../server/indexer/eventIndexer.js";
import { EventStore } from "../server/db/eventStore.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";
import { V7_YIELD_STRATEGY_TEXT } from "./v7StrategyText.js";

const WUSDC_ADDRESS = "0x911b4000D3422F482F4062a913885f7b035382Df" as const;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

const STRATEGY_VERSION = "v7";

interface VaultCycleConfig {
  label: string;
  vaultAddress: `0x${string}`;
  policyAddress: `0x${string}`;
  // Only consulted by EventIndexer if no cursor has ever been persisted
  // yet for this contract, harmless to leave as-is afterward, see
  // docs/deployments.md for the real block once v7 is deployed.
  vaultCreationBlock: bigint;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  strategyConfigText: string;
}

// EMPTY until scripts/deployVaultV7.ts and
// scripts/deployLpPositionRegistryV7.ts have actually run against real
// infrastructure and their real addresses are known. See this file's own
// top-of-file note.
const VAULTS: VaultCycleConfig[] = [];

async function runCycleForVault(publicClient: PublicClient, decisionStore: DecisionStore, eventStore: EventStore, config: VaultCycleConfig): Promise<void> {
  console.log(`\n=== ${config.label}: ${config.vaultAddress} ===`);
  const pipeline = new DecisionPipeline(decisionStore);

  const policyLimits = await buildPolicyLimitsStruct(publicClient, config.vaultAddress, config.policyAddress, config.assets);
  const input = await buildProposeDecisionInput({
    publicClient,
    vaultAddress: config.vaultAddress,
    strategyVersion: STRATEGY_VERSION,
    strategyConfigText: config.strategyConfigText,
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
  const keeper = new KeeperServiceV7({
    publicClient,
    vaultAddress: config.vaultAddress,
    assets: config.assets,
    stableAssets: config.stableAssets,
    strategyVersion: STRATEGY_VERSION,
    strategyConfigText: config.strategyConfigText,
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

console.log(`=== v7 decision cycle start: ${new Date().toISOString()} ===`);

for (const config of VAULTS) {
  try {
    await runCycleForVault(publicClient, decisionStore, eventStore, config);
  } catch (error) {
    // One vault's failure must never stop the others from getting their
    // own cycle this run, same "never let one problem cascade silently"
    // principle already applied in every other cycle script.
    console.error(`Cycle failed for ${config.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

decisionStore.close();
eventStore.close();
console.log(`\n=== v7 decision cycle complete: ${new Date().toISOString()} ===\n`);
