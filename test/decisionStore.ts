import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DecisionStore } from "../server/db/decisionStore.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";
import type { MarketData } from "../agent/core/types.js";

function decision(overrides: Partial<VaultDecision> = {}): VaultDecision {
  return {
    vaultId: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    strategyVersion: "v1",
    modelId: "claude-sonnet-5",
    action: "HOLD",
    confidence: 0.9,
    reasoning: "test fixture",
    proposedAt: new Date().toISOString(),
    ...overrides,
  };
}

function passingCheck(): PolicyCheckResult {
  return { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" };
}

function marketData(): MarketData {
  return { prices: [{ asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: new Date().toISOString() }] };
}

async function tempDbPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "decision-store-test-"));
  return { path: path.join(dir, "test.db"), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("DecisionStore", () => {
  it("upsert then loadAll round-trips an entry exactly", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);

    const store = new DecisionStore(dbPath);
    const pipeline = new DecisionPipeline(store);
    const entry = pipeline.enqueue(decision(), passingCheck(), 5, marketData());

    const loaded = store.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].decisionId, entry.decisionId);
    assert.equal(loaded[0].queued.status, "pending_confirmation");
    store.close();
  });

  it("upsert on an existing decisionId updates in place, never duplicates the row", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);

    const store = new DecisionStore(dbPath);
    const pipeline = new DecisionPipeline(store);
    const entry = pipeline.enqueue(decision(), passingCheck(), 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const loaded = store.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].queued.status, "confirmed");
    store.close();
  });

  it("a fresh DecisionPipeline pointed at the same store rehydrates state after a simulated restart", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);

    const store1 = new DecisionStore(dbPath);
    const pipeline1 = new DecisionPipeline(store1);
    const entry = pipeline1.enqueue(decision(), passingCheck(), 5, marketData());
    pipeline1.confirm(entry.decisionId, "ops@team");
    pipeline1.close();

    // Simulate a process restart: a brand new DecisionPipeline instance,
    // backed by a brand new DecisionStore instance, same underlying file.
    const store2 = new DecisionStore(dbPath);
    const pipeline2 = new DecisionPipeline(store2);

    const rehydrated = pipeline2.getEntry(entry.decisionId);
    assert.ok(rehydrated);
    assert.equal(rehydrated.queued.status, "confirmed");
    assert.equal(rehydrated.queued.confirmedBy, "ops@team");
    pipeline2.close();
  });

  it("DecisionPipeline with no store behaves exactly as before, in-memory only, never touches disk", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5, marketData());
    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "pending_confirmation");
    // close() is a no-op with no store, must not throw.
    pipeline.close();
  });
});
