// Verifies getVaultState/context.ts against the real deployed vault, no
// synthetic data. Run with: npx tsx scripts/testContextAgainstRealVault.ts
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { buildPolicyLimitsText, buildProposeDecisionInput } from "../agent/core/context.js";
import { getVaultState } from "../agent/core/tools/getVaultState.js";
import { proposeDecision } from "../agent/core/loop.js";
import { setModelPin } from "../agent/core/modelPin.js";

const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });

const assets = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];

console.log("=== getVaultState ===");
const vaultState = await getVaultState(publicClient, VAULT_ADDRESS, assets);
console.log(JSON.stringify(vaultState, null, 2));

console.log("\n=== buildPolicyLimitsText ===");
const policyAddress = await publicClient.readContract({
  address: VAULT_ADDRESS,
  abi: [{ type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
  functionName: "policy",
});
console.log(await buildPolicyLimitsText(publicClient, policyAddress, assets));

console.log("\n=== buildProposeDecisionInput (full assembly) ===");
const input = await buildProposeDecisionInput({
  publicClient,
  vaultAddress: VAULT_ADDRESS,
  strategyVersion: "v1",
  strategyConfigText: "Conservative income strategy. Prefer HOLD unless there is a clear, well-supported reason to rebalance.",
  assets,
  stableAssets: ["USDC"],
});
console.log(JSON.stringify(input, null, 2));

console.log("\n=== proposeDecision, full pipeline: real vault state -> real Claude decision ===");
setModelPin(VAULT_ADDRESS, "claude-sonnet-5");
const result = await proposeDecision(input);
console.log(JSON.stringify(result.decision, null, 2));
console.log(`thinkingTokens: ${result.thinkingTokens}`);

