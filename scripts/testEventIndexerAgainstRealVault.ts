// Verifies EventIndexer against the real deployed vault. Read-only, no
// transactions, safe to run any time: indexes real onchain events from the
// vault's actual creation block (docs/deployments.md) through latest, then
// builds the AI Decision Timeline by joining against DecisionPipeline.
// Run with: npx tsx scripts/testEventIndexerAgainstRealVault.ts
import { createPublicClient, http } from "viem";
import { EventIndexer, buildDecisionTimeline } from "../server/indexer/eventIndexer.js";
import { EventStore } from "../server/db/eventStore.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";

const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const POLICY_ADDRESS = "0x5285D175849513b5918aaB5c539b5ED79EEF1A1f" as const;
// createVault (deploys MandateVault + VaultPolicy internally), see
// docs/deployments.md, step 11.
const VAULT_CREATION_BLOCK = 51112175n;

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });

// In-memory store and a fresh, empty DecisionPipeline for this read-only
// check, not the real data/mandate.db, so this never mutates real state.
const store = new EventStore(":memory:");
const pipeline = new DecisionPipeline();

const indexer = new EventIndexer({
  publicClient,
  vaultAddress: VAULT_ADDRESS,
  policyAddress: POLICY_ADDRESS,
  startBlock: VAULT_CREATION_BLOCK,
  store,
});

console.log("=== indexing real events from block", VAULT_CREATION_BLOCK.toString(), "===");
await indexer.pollOnce();

console.log("\n=== DecisionExecuted events found ===");
console.log(JSON.stringify(store.listByEventName("DecisionExecuted"), null, 2));

console.log("\n=== AI Decision Timeline (empty pipeline in this read-only check, no correlation expected) ===");
console.log(JSON.stringify(buildDecisionTimeline(pipeline, store, VAULT_ADDRESS), null, 2));

store.close();
