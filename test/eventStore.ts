import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventStore, type IndexedEvent } from "../server/db/eventStore.js";

async function tempDbPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "event-store-test-"));
  return { path: path.join(dir, "test.db"), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function fakeEvent(overrides: Partial<IndexedEvent> = {}): IndexedEvent {
  return {
    id: "0xabc-0",
    contractAddress: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    eventName: "DecisionExecuted",
    args: { action: 0, asset: "0x0", amount: "0" },
    blockNumber: "100",
    transactionHash: "0xabc",
    logIndex: 0,
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventStore", () => {
  it("insertIfNew inserts a new event and returns true", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);
    const store = new EventStore(dbPath);
    assert.equal(store.insertIfNew(fakeEvent()), true);
    store.close();
  });

  it("insertIfNew is idempotent: replaying the same id never duplicates the row", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);
    const store = new EventStore(dbPath);
    assert.equal(store.insertIfNew(fakeEvent()), true);
    assert.equal(store.insertIfNew(fakeEvent()), false);
    assert.equal(store.listByEventName("DecisionExecuted").length, 1);
    store.close();
  });

  it("getByTransactionHash returns only events for that exact transaction", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);
    const store = new EventStore(dbPath);
    store.insertIfNew(fakeEvent({ id: "0xabc-0", transactionHash: "0xabc" }));
    store.insertIfNew(fakeEvent({ id: "0xdef-0", transactionHash: "0xdef" }));

    const found = store.getByTransactionHash("0xabc");
    assert.equal(found.length, 1);
    assert.equal(found[0].transactionHash, "0xabc");
    store.close();
  });

  it("cursor get/set round-trips per contract address", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);
    const store = new EventStore(dbPath);
    const addr = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;

    assert.equal(store.getCursor(addr), null);
    store.setCursor(addr, 500n);
    assert.equal(store.getCursor(addr), 500n);
    store.setCursor(addr, 600n);
    assert.equal(store.getCursor(addr), 600n);
    store.close();
  });

  it("survives a simulated restart: a fresh EventStore against the same file sees prior events and cursor", async () => {
    const { path: dbPath, cleanup } = await tempDbPath();
    after(cleanup);
    const addr = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;

    const store1 = new EventStore(dbPath);
    store1.insertIfNew(fakeEvent());
    store1.setCursor(addr, 42n);
    store1.close();

    const store2 = new EventStore(dbPath);
    assert.equal(store2.getCursor(addr), 42n);
    assert.equal(store2.listByEventName("DecisionExecuted").length, 1);
    store2.close();
  });
});
