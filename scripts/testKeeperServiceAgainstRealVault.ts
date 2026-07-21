// Verifies KeeperService end to end against the real deployed vault: real
// AI agent proposal -> queue -> confirm -> keeper simulates, submits, and
// confirms a REAL executeDecision transaction (a HOLD, empty swap legs, so
// it costs gas but changes no vault state). This is the first real
// transaction this keeper ever signs, review before running.
// Run with: npx tsx scripts/testKeeperServiceAgainstRealVault.ts
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { setModelPin } from "../agent/core/modelPin.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import { KeeperService } from "../executor/keeperService.js";

const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });
const assets = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];

const policyAddress = await publicClient.readContract({
  address: VAULT_ADDRESS,
  abi: [{ type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
  functionName: "policy",
});
const policyLimits = await buildPolicyLimitsStruct(publicClient, VAULT_ADDRESS, policyAddress, assets);

const input = await buildProposeDecisionInput({
  publicClient,
  vaultAddress: VAULT_ADDRESS,
  strategyVersion: "v1",
  strategyConfigText: "Conservative income strategy. Prefer HOLD unless there is a clear, well-supported reason to rebalance.",
  assets,
  stableAssets: ["USDC"],
});

setModelPin(VAULT_ADDRESS, "claude-sonnet-5");

const pipeline = new DecisionPipeline();
console.log("=== proposeAndQueue (real AI agent call) ===");
const entry = await pipeline.proposeAndQueue(input, { vaultState: input.vaultState, policyLimits, marketData: input.marketData, assets });
console.log(JSON.stringify(entry.queued.decision, null, 2));

if (entry.queued.decision.action !== "HOLD") {
  console.log(`The AI agent proposed ${entry.queued.decision.action}, not HOLD. This script only verifies the HOLD path (no swap-leg construction yet), stopping without confirming or executing.`);
  process.exit(0);
}

console.log("\n=== confirm ===");
pipeline.confirm(entry.decisionId, "test-script@local");

console.log("\n=== KeeperService.runOnce (this submits a REAL transaction) ===");
const keeper = new KeeperService({
  publicClient,
  vaultAddress: VAULT_ADDRESS,
  assets,
  stableAssets: ["USDC"],
  strategyVersion: "v1",
  strategyConfigText: "Conservative income strategy. Prefer HOLD unless there is a clear, well-supported reason to rebalance.",
  pipeline,
});
await keeper.runOnce();

const final = pipeline.getEntry(entry.decisionId)!;
console.log(JSON.stringify({ status: final.queued.status, txHash: final.txHash }, null, 2));
