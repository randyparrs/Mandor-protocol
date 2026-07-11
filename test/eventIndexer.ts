import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventIndexer, buildDecisionTimeline } from "../server/indexer/eventIndexer.js";
import { EventStore } from "../server/db/eventStore.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import type { AlertEvent } from "../shared/alertSink.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";
import type { MarketData } from "../agent/core/types.js";

const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const POLICY_ADDRESS = "0x5285D175849513b5918aaB5c539b5ED79EEF1A1f" as const;

async function tempEventStore(): Promise<{ store: EventStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "event-indexer-test-"));
  const store = new EventStore(path.join(dir, "test.db"));
  // Close the sqlite handle before removing the directory, or Windows
  // refuses to unlink a file that's still open (EBUSY).
  return { store, cleanup: () => { store.close(); return rm(dir, { recursive: true, force: true }); } };
}

function fakeLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "DecisionExecuted",
    args: { action: 0, asset: "0x0", amount: 0n },
    blockNumber: 100n,
    transactionHash: "0xabc",
    logIndex: 0,
    ...overrides,
  };
}

function makeFakePublicClient(logsByCall: Array<ReturnType<typeof fakeLog>[]>, blockNumber = 200n) {
  let callIndex = 0;
  const calls: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  return {
    calls,
    async getBlockNumber() {
      return blockNumber;
    },
    async getContractEvents(params: { fromBlock: bigint; toBlock: bigint }) {
      calls.push({ fromBlock: params.fromBlock, toBlock: params.toBlock });
      const logs = logsByCall[Math.min(callIndex, logsByCall.length - 1)] ?? [];
      callIndex++;
      return logs;
    },
  };
}

function decision(overrides: Partial<VaultDecision> = {}): VaultDecision {
  return {
    vaultId: VAULT_ADDRESS,
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

describe("EventIndexer", () => {
  it("indexes new events and persists a cursor", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    // vault call gets a log, policy call gets none.
    const publicClient = makeFakePublicClient([[fakeLog()], []]);
    const events: AlertEvent[] = [];
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
      alertSink: { send: (e) => events.push(e) },
    });

    await indexer.pollOnce();

    assert.equal(store.getCursor(VAULT_ADDRESS), 200n);
    assert.equal(store.getCursor(POLICY_ADDRESS), 200n);
    assert.equal(store.getByTransactionHash("0xabc").length, 1);
  });

  it("never indexes the same event twice across repeated polls", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const publicClient = makeFakePublicClient([[fakeLog()], [], [fakeLog()], []]);
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
    });

    await indexer.pollOnce();
    await indexer.pollOnce();

    assert.equal(store.getByTransactionHash("0xabc").length, 1);
  });

  it("re-scans a small overlap window on every poll (reorg safety margin), never re-alerts for an already-seen event in that window", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    // First poll processes blocks up through 200 (getBlockNumber below),
    // seeing one Paused event. Second poll simulates the vault having no
    // new events, only the policy contract producing an overlap-range call.
    const publicClient = makeFakePublicClient(
      [[fakeLog({ eventName: "Paused", transactionHash: "0xpaused", blockNumber: 200n, args: { by: "0x1" } })], [], [fakeLog({ eventName: "Paused", transactionHash: "0xpaused", blockNumber: 200n, args: { by: "0x1" } })], []],
    );
    const events: AlertEvent[] = [];
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
      alertSink: { send: (e) => events.push(e) },
    });

    await indexer.pollOnce();
    const cursorAfterFirstPoll = store.getCursor(VAULT_ADDRESS);
    assert.equal(cursorAfterFirstPoll, 200n);

    await indexer.pollOnce();

    // The vault's second-poll call (calls[2], since calls[0]/[1] were the
    // first poll's vault/policy calls) must re-scan starting 5 blocks
    // before the persisted cursor, not resume strictly after it.
    const secondPollVaultCall = publicClient.calls[2];
    const EXPECTED_OVERLAP_BLOCKS = 5n; // matches RESTART_OVERLAP_BLOCKS in eventIndexer.ts, kept private, not exported for this
    assert.equal(secondPollVaultCall.fromBlock, cursorAfterFirstPoll! - EXPECTED_OVERLAP_BLOCKS + 1n);

    // Only one Paused alert total, the re-scanned duplicate never re-fires it.
    assert.equal(events.filter((e) => e.code === "ONCHAIN_PAUSED").length, 1);
    assert.equal(store.listByEventName("Paused").length, 1);
  });

  it("fires a critical alert for Paused, regardless of whether an AI decision was involved", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const publicClient = makeFakePublicClient([[], [fakeLog({ eventName: "Paused", transactionHash: "0xpaused", args: { by: "0x1" } })]]);
    const events: AlertEvent[] = [];
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
      alertSink: { send: (e) => events.push(e) },
    });

    await indexer.pollOnce();

    assert.ok(events.some((e) => e.code === "ONCHAIN_PAUSED" && e.severity === "critical"));
  });

  it("fires a warning for a DecisionExecuted event with no matching DecisionPipelineEntry", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const publicClient = makeFakePublicClient([[fakeLog({ transactionHash: "0xunmatched" })], []]);
    const events: AlertEvent[] = [];
    const pipeline = new DecisionPipeline();
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
      pipeline,
      alertSink: { send: (e) => events.push(e) },
    });

    await indexer.pollOnce();

    assert.ok(events.some((e) => e.code === "UNMATCHED_DECISION_EXECUTED"));
  });

  it("never alerts UNMATCHED_DECISION_EXECUTED when the txHash correlates to a real pipeline entry", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");
    pipeline.markExecuted(entry.decisionId, "0xmatched");

    const publicClient = makeFakePublicClient([[fakeLog({ transactionHash: "0xmatched" })], []]);
    const events: AlertEvent[] = [];
    const indexer = new EventIndexer({
      publicClient: publicClient as never,
      vaultAddress: VAULT_ADDRESS,
      policyAddress: POLICY_ADDRESS,
      startBlock: 0n,
      store,
      pipeline,
      alertSink: { send: (e) => events.push(e) },
    });

    await indexer.pollOnce();

    assert.ok(!events.some((e) => e.code === "UNMATCHED_DECISION_EXECUTED"));
  });

  it("buildDecisionTimeline joins each DecisionPipelineEntry with its correlated onchain event", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");
    pipeline.markExecuted(entry.decisionId, "0xmatched");
    store.insertIfNew({
      id: "0xmatched-0",
      contractAddress: VAULT_ADDRESS,
      eventName: "DecisionExecuted",
      args: { action: 0, asset: "0x0", amount: "0" },
      blockNumber: "150",
      transactionHash: "0xmatched",
      logIndex: 0,
      indexedAt: new Date().toISOString(),
    });

    const timeline = buildDecisionTimeline(pipeline, store, VAULT_ADDRESS);
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].entry.decisionId, entry.decisionId);
    assert.equal(timeline[0].onchainEvent?.transactionHash, "0xmatched");
  });

  it("buildDecisionTimeline leaves onchainEvent undefined for a decision never executed", async () => {
    const { store, cleanup } = await tempEventStore();
    after(cleanup);

    const pipeline = new DecisionPipeline();
    pipeline.enqueue(decision(), passingCheck(), 5, marketData());

    const timeline = buildDecisionTimeline(pipeline, store, VAULT_ADDRESS);
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].onchainEvent, undefined);
  });
});
