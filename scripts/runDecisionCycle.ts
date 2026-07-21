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
// between scheduled runs. Any vault configured below would share the same
// underlying data/mandate.db (already vault/contract-scoped internally by
// every query in DecisionPipeline/EventStore), not a separate database
// each -- see VAULTS's own comment for why that list is empty today.
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

const STRATEGY_VERSION = "v1";
const BASE_STRATEGY_CONFIG_TEXT = "Conservative income strategy. Prefer HOLD unless there is a clear, well-supported reason to rebalance.";

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

// EMPTY ON PURPOSE (2026-07-21): v1 and v2 are fully discontinued, per
// Randy's own explicit decision, not just deprioritized -- he does not
// want them consuming any further RPC calls, gas, or generating any more
// decision history, ever again. This is the code-level guarantee: even an
// accidental manual run of this script (`node --import tsx
// scripts/runDecisionCycle.ts`) now does nothing at all, since the loop
// below has nothing to iterate. Confirmed live 2026-07-21 that no Windows
// Scheduled Task, running process, Startup entry, or Run registry key
// anywhere on this machine was actually driving this script either, so
// there was nothing at the OS level left to disable. v1/v2's own already
// deployed contracts and their real onchain history are untouched and
// permanent, see legacy/README.md, this only ever stops FUTURE automated
// activity. Do not re-add v1/v2 here.
const VAULTS: VaultCycleConfig[] = [];

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
