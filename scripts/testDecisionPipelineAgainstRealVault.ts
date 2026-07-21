// Verifies server/decisionPipeline.ts's full real path against the real
// deployed vault: proposeDecision (one real AI agent API call) ->
// checkPolicyOffchain -> anomaly flags -> queue -> confirm. Run with:
// npx tsx scripts/testDecisionPipelineAgainstRealVault.ts
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { setModelPin } from "../agent/core/modelPin.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";

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
console.log("=== proposeAndQueue (real AI agent call + real onchain reads) ===");
const entry = await pipeline.proposeAndQueue(input, { vaultState: input.vaultState, policyLimits, marketData: input.marketData, assets });
console.log(JSON.stringify(entry, null, 2));

console.log("\n=== confirm ===");
const confirmed = pipeline.confirm(entry.decisionId, "test-script@local");
console.log(JSON.stringify(confirmed.queued, null, 2));

console.log("\n=== confirming again should throw ===");
try {
  pipeline.confirm(entry.decisionId, "test-script@local");
  console.log("UNEXPECTED: second confirm did not throw");
} catch (error) {
  console.log(`Threw as expected: ${error instanceof Error ? error.message : String(error)}`);
}
