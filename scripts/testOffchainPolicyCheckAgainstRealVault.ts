// Verifies buildPolicyLimitsStruct/checkPolicyOffchain against the real
// deployed vault, no synthetic data. Read-only, no transactions. Run with:
// npx tsx scripts/testOffchainPolicyCheckAgainstRealVault.ts
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { buildPolicyLimitsStruct } from "../agent/core/context.js";
import { getVaultState } from "../agent/core/tools/getVaultState.js";
import { getMarketData } from "../agent/core/tools/getMarketData.js";
import { checkPolicyOffchain } from "../agent/policy/offchainPolicyCheck.js";

const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });

const assets = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];

const policyAddress = await publicClient.readContract({
  address: VAULT_ADDRESS,
  abi: [{ type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
  functionName: "policy",
});

console.log("=== buildPolicyLimitsStruct ===");
const policyLimits = await buildPolicyLimitsStruct(publicClient, VAULT_ADDRESS, policyAddress, assets);
console.log(JSON.stringify(policyLimits, null, 2));

console.log("\n=== getVaultState ===");
const vaultState = await getVaultState(publicClient, VAULT_ADDRESS, assets);
console.log(JSON.stringify(vaultState, null, 2));

console.log("\n=== getMarketData ===");
const marketData = await getMarketData([{ asset: "USDC" }]);
console.log(JSON.stringify(marketData, null, 2));

console.log("\n=== checkPolicyOffchain (HOLD) ===");
const result = checkPolicyOffchain({
  decision: {
    vaultId: VAULT_ADDRESS,
    strategyVersion: "v1",
    modelId: "claude-sonnet-5",
    action: "HOLD",
    confidence: 1,
    reasoning: "read-only verification run, not a real proposal",
    proposedAt: new Date().toISOString(),
  },
  vaultState,
  policyLimits,
  marketData,
  assets,
});
console.log(JSON.stringify(result, null, 2));
