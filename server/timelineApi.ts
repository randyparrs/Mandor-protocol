// Read-only HTTP wrapper around buildDecisionTimeline
// (server/indexer/eventIndexer.ts), the AI Decision Timeline's actual data
// source. No secrets, no external API calls: this only opens the same
// local data/mandate.db every other real script already reads from, and
// serves it as JSON for the frontend (a browser cannot use node:sqlite
// directly). Isolated, like server/circleWalletProxy.ts was: does not
// touch decisionPipeline.ts's own in-process logic beyond reading its
// persisted store, never calls proposeDecision, never holds any signing
// key. No dotenv/.env loading here at all, deliberately: unlike every
// other real backend piece in this project, this one needs no secret
// (not CIRCLE_API_KEY, not ANTHROPIC_API_KEY, not KEEPER_PRIVATE_KEY),
// so it never even has the opportunity to read, hold, or leak one.
//
// Read-only is enforced structurally, not just by convention: both
// DecisionStore and EventStore are opened with readOnly: true below,
// which node:sqlite enforces at the actual SQLite connection layer (any
// write attempt throws there, regardless of what application code around
// it does or is later changed to do), not merely "this file happens not
// to call a mutating method today." The DecisionPipeline built on top of
// the read-only DecisionStore inherits the same guarantee: any of its
// mutating methods (enqueue/confirm/reject/markExecuted) would throw the
// moment they tried to persist, since they all end in store.upsert(...).
import http from "node:http";
import { DecisionPipeline } from "./decisionPipeline.js";
import { DecisionStore } from "./db/decisionStore.js";
import { EventStore } from "./db/eventStore.js";
import { buildDecisionTimeline } from "./indexer/eventIndexer.js";
import { projectDataPath } from "../shared/paths.js";

const PORT = Number(process.env.TIMELINE_API_PORT ?? 8789);
const DB_PATH = projectDataPath("mandate.db");

// EventStore is genuinely safe to share across requests (every read
// method queries the database directly, no in-memory copy to go stale).
// DecisionPipeline is NOT: its constructor only hydrates its in-memory
// Map once, from decisionStore.loadAll(), and every read method
// (listAllForVault included) reads that in-memory copy, never the
// database again. A single long-lived instance would silently keep
// serving whatever the data looked like at process startup, missing
// every decision scripts/runDecisionCycle.ts's hourly cycle adds
// afterward, a real staleness bug, caught before shipping it. A fresh
// DecisionStore + DecisionPipeline is constructed per request instead,
// cheap at this project's real data volume (hackathon-timeline pace, see
// server/db/decisionStore.ts's own doc comment), and closed again right
// after, so no connection lingers open between requests.
const eventStore = new EventStore(DB_PATH, true);

// Pause/unpause/auto-pause events, shown separately from the per-decision
// timeline below, not because the addresses involved are sensitive (they
// are not: PAUSER_ROLE/GOVERNANCE_ROLE/ADMIN_ROLE are public onchain
// roles, already listed in docs/deployments.md and verifiable by anyone
// via the block explorer, same standard this project already applies
// everywhere else), but because these events are emitted by VaultPolicy
// directly (Paused/Unpaused/AutoPaused/AutoPauseBountyCallFailed), never
// tied to any specific AI decision's own transaction hash the way
// DecisionExecuted is, so buildDecisionTimeline's txHash-based join
// structurally cannot surface them, not because they were deliberately
// excluded for privacy. A depositor deciding whether to trust a vault
// should be able to see its real pause history, not just a calm run of
// HOLD decisions, so these are now included, plainly labeled as
// vault-level events rather than folded into the per-decision list.
const VAULT_LEVEL_EVENT_NAMES = ["Paused", "Unpaused", "AutoPaused", "AutoPauseBountyCallFailed"];

function getVaultLevelEvents(policyAddress: string) {
  return VAULT_LEVEL_EVENT_NAMES.flatMap((eventName) => eventStore.listByEventName(eventName)).filter(
    (event) => event.contractAddress.toLowerCase() === policyAddress.toLowerCase(),
  );
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, bigintReplacer));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/timeline") {
    const vaultId = url.searchParams.get("vaultId");
    const policyId = url.searchParams.get("policyId");
    if (!vaultId) return sendJson(res, 400, { error: "vaultId query param is required" });
    // Fresh per request, see the doc comment above: DecisionPipeline only
    // ever hydrates its in-memory Map at construction, a shared instance
    // would silently never see decisions added after this process started.
    const decisionStore = new DecisionStore(DB_PATH, true);
    try {
      const pipeline = new DecisionPipeline(decisionStore);
      const timeline = buildDecisionTimeline(pipeline, eventStore, vaultId as `0x${string}`);
      // Newest first: the timeline reads top-to-bottom as "what happened
      // most recently", matching how every other real-time view in this
      // project (the keeper's own log output) already reads.
      const sorted = [...timeline].sort((a, b) => new Date(b.entry.queued.queuedAt).getTime() - new Date(a.entry.queued.queuedAt).getTime());
      const vaultEvents = policyId
        ? [...getVaultLevelEvents(policyId)].sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)))
        : [];
      sendJson(res, 200, { entries: sorted, vaultEvents });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      decisionStore.close();
    }
    return;
  }
  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`timelineApi listening on http://localhost:${PORT}`);
});
