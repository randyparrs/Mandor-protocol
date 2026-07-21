// One full unattended cycle, for every configured v4/v5-shaped vault:
// propose (real Claude call) -> auto-confirm ONLY if HOLD (same rule as
// scripts/runDecisionCycle.ts: HOLD never moves funds, always empty
// swap/lp/bridge legs, functionally equivalent to a human clicking
// confirm every time) -> keeper executes anything confirmed -> indexer
// catches up on real onchain events.
//
// A DELIBERATE, SEPARATE sibling of scripts/runDecisionCycle.ts, not a
// merge: that script drives v1/v2(/v3)-shaped vaults via
// executor/keeperService.ts (the older, 3-arg Decision/executeDecision
// ABI); this one drives v4/v5-shaped vaults via
// executor/keeperServiceV4.ts (the newer ABI, with chainId/
// lendingPositionId/bridgeLeg present). This mirrors the exact same
// "INTENTIONAL FORK" already established between the two keeper modules
// themselves (see keeperServiceV4.ts's own top-of-file doc comment) --
// keeping the two cycle scripts separate means neither ever needs a
// runtime branch on which keeper class/ABI a given vault actually needs.
//
// Meant to be invoked periodically by an external scheduler (Windows Task
// Scheduler), never a long-running loop itself: each invocation is a
// fresh, independent process, using the real persisted
// DecisionPipeline/EventStore (data/mandate.db), same as
// scripts/runDecisionCycle.ts -- both scripts share the same database,
// already vault/contract-scoped internally by every query in
// DecisionPipeline/EventStore, not a separate database each.
//
// ENTER/EXIT/REBALANCE/LP_*/BRIDGE_*/EMERGENCY_EXIT_TO_STABLE are never
// auto-confirmed, no exceptions, they sit in the queue exactly like any
// manually-proposed decision until a real person confirms or rejects it.
//
// v5 specifically: real BUY-direction rebalancing is refused at execution
// time until cirBTC has a genuinely independent reference price (see
// docs/v5-ergodic-rebalancing.md's Known Limitations) -- this cycle still
// runs for real today, building a genuine, auditable HOLD-based decision
// history (and, once Blocker A/B are resolved, real REBALANCE history)
// rather than sitting completely idle in the meantime.
//
// Run with: node --import tsx scripts/runDecisionCycleV4.ts
import "dotenv/config";
import { createPublicClient, http, type PublicClient } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { setModelPin } from "../agent/core/modelPin.js";
import type { AssetSymbol } from "../shared/decision.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import { DecisionStore } from "../server/db/decisionStore.js";
import { KeeperServiceV4 } from "../executor/keeperServiceV4.js";
import { EventIndexer } from "../server/indexer/eventIndexer.js";
import { EventStore } from "../server/db/eventStore.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";
import { V5_ERGODIC_REBALANCING_STRATEGY_TEXT } from "./v5StrategyText.js";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as const;

const STRATEGY_VERSION = "v5";

interface VaultCycleConfig {
  label: string;
  vaultAddress: `0x${string}`;
  policyAddress: `0x${string}`;
  // Only consulted by EventIndexer if no cursor has ever been persisted
  // yet for this contract, harmless to leave as-is afterward, see
  // docs/deployments.md for the real block.
  vaultCreationBlock: bigint;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  strategyConfigText: string;
}

const VAULTS: VaultCycleConfig[] = [
  {
    label: "v5 (ergodic rebalancing, USDC + cirBTC)",
    vaultAddress: "0x95c42f3eBC5c5A5eEc9d716D9aA84aa5EE729667",
    policyAddress: "0xb8A402E5CD24B0358256fA9744838586d9529FcB",
    vaultCreationBlock: 52698591n,
    assets: [
      { symbol: "USDC", address: USDC_ADDRESS, isBaseAsset: true },
      { symbol: "cirBTC", address: CIRBTC_ADDRESS },
    ],
    stableAssets: ["USDC"],
    strategyConfigText: V5_ERGODIC_REBALANCING_STRATEGY_TEXT,
  },
];

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
  const keeper = new KeeperServiceV4({
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

console.log(`=== v4/v5 decision cycle start: ${new Date().toISOString()} ===`);

for (const config of VAULTS) {
  try {
    await runCycleForVault(publicClient, decisionStore, eventStore, config);
  } catch (error) {
    // One vault's failure must never stop the others from getting their
    // own cycle this run, same "never let one problem cascade silently"
    // principle already applied in scripts/runDecisionCycle.ts.
    console.error(`Cycle failed for ${config.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

decisionStore.close();
eventStore.close();
console.log(`\n=== v4/v5 decision cycle complete: ${new Date().toISOString()} ===\n`);
