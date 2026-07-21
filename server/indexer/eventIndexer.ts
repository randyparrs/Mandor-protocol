// Listens to MandateVault/VaultPolicy's real onchain events and persists
// them (server/db/eventStore.ts), the "eventos onchain -> DecisionRecord"
// piece: this is what turns reasoning + offchain pre-check + ops
// confirmation + final onchain result into the actual auditable "AI
// Decision Timeline", see docs/architecture.md's "Offchain (DB)" section.
//
// Polls via getContractEvents rather than watchContractEvent: Arc
// Testnet's RPC endpoint (https://rpc.testnet.arc.network) is plain HTTP,
// not a websocket, so a filter-based subscription isn't available; polling
// a block range on an interval is the only real option here.
import type { PublicClient } from "viem";
import { EventStore, type IndexedEvent } from "../db/eventStore.js";
import { DecisionPipeline, type DecisionPipelineEntry } from "../decisionPipeline.js";
import { ConsoleAlertSink, makeEvent, type AlertSink } from "../../shared/alertSink.js";

// The real, public Arc Testnet RPC rejects "request limit reached" not
// just for a burst of simultaneous calls (see agent/core/context.ts's own
// RPC_PACING_MS note) but, confirmed live 2026-07-21 immediately after a
// real end-to-end v5 decision cycle run, also for a sequential call that
// simply follows too closely behind a long preceding chain of other real
// calls in the same process. pollOnce/indexContract's calls were already
// sequential (never Promise.all), but had no pacing between them, so they
// get the same treatment for full, consistent closure of this same bug
// class across every shared RPC-calling path.
const RPC_PACING_MS = 3000;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const MANDATE_VAULT_EVENTS_ABI = [
  { type: "event", name: "PolicySet", inputs: [{ name: "policy", type: "address", indexed: true }] },
  {
    type: "event",
    name: "DecisionExecuted",
    inputs: [
      { name: "action", type: "uint8", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SwapExecuted",
    inputs: [
      { name: "router", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RouterAllowedSet",
    inputs: [
      { name: "router", type: "address", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RouterChangeProposed",
    inputs: [
      { name: "router", type: "address", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
      { name: "executableAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RouterChangeCancelled",
    inputs: [
      { name: "router", type: "address", indexed: true },
      { name: "cancelledBy", type: "address", indexed: true },
    ],
  },
  { type: "event", name: "CapitalLimitRegistrySet", inputs: [{ name: "registry", type: "address", indexed: true }] },
  {
    type: "event",
    name: "SweepDustProposed",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executableAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SweepDustCancelled",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "cancelledBy", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "DustSwept",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "event", name: "AutoPauseBountyAmountSet", inputs: [{ name: "amount", type: "uint256", indexed: false }] },
  {
    type: "event",
    name: "AutoPauseBountyPaid",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const VAULT_POLICY_EVENTS_ABI = [
  { type: "event", name: "Paused", inputs: [{ name: "by", type: "address", indexed: true }] },
  { type: "event", name: "Unpaused", inputs: [{ name: "by", type: "address", indexed: true }] },
  {
    type: "event",
    name: "AutoPaused",
    inputs: [
      { name: "triggeredBy", type: "address", indexed: true },
      { name: "code", type: "bytes32", indexed: false },
    ],
  },
  { type: "event", name: "AutoPauseBountyCallFailed", inputs: [{ name: "to", type: "address", indexed: true }] },
] as const;

// Worth an immediate, high-severity alert regardless of whether an AI
// decision triggered them, per docs/threat-model.md's monitoring list:
// "pause/unpause events... alert always."
const CRITICAL_EVENT_NAMES = new Set(["Paused", "AutoPaused", "AutoPauseBountyCallFailed"]);

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_BLOCK_RANGE_CHUNK = 2_000n;
// Deliberate safety margin on every resume (a real restart, or just the
// next scheduled poll, this code path doesn't distinguish the two, so the
// margin applies continuously, not only after downtime): re-scan the last
// few already-processed blocks rather than relying only on the incidental
// 1-block overlap the persisted cursor itself provides. Arc Testnet's own
// reorg depth is not verified anywhere in this project
// (docs/arc-facts-to-verify.md), so this guards against a short reorg
// silently orphaning an already-indexed block, not just against a crash
// mid-poll. insertIfNew's dedup key means re-scanning never duplicates a
// row or re-fires an alert for an event already seen.
const RESTART_OVERLAP_BLOCKS = 5n;

export interface EventIndexerConfig {
  publicClient: PublicClient;
  vaultAddress: `0x${string}`;
  policyAddress: `0x${string}`;
  // The block the vault/policy pair was actually deployed at, see
  // docs/deployments.md. Only used the very first time this contract has
  // never been indexed before (no cursor row yet); after that, the
  // persisted cursor always takes over, this is never re-consulted.
  startBlock: bigint;
  store?: EventStore;
  pipeline?: DecisionPipeline;
  alertSink?: AlertSink;
  pollIntervalMs?: number;
  blockRangeChunk?: bigint;
}

export class EventIndexer {
  private readonly store: EventStore;
  private readonly alertSink: AlertSink;

  constructor(private readonly config: EventIndexerConfig) {
    this.store = config.store ?? new EventStore();
    this.alertSink = config.alertSink ?? new ConsoleAlertSink();
  }

  /// @notice Indexes every not-yet-seen block range for both contracts,
  /// oldest to newest, chunked so a long gap (e.g. after downtime) doesn't
  /// attempt one enormous eth_getLogs call. Idempotent: safe to call
  /// repeatedly, insertIfNew's dedup key means replaying an already-indexed
  /// range never duplicates a row.
  async pollOnce(): Promise<void> {
    const latest = await this.config.publicClient.getBlockNumber();
    await sleep(RPC_PACING_MS);
    await this.indexContract(this.config.vaultAddress, MANDATE_VAULT_EVENTS_ABI, latest);
    await sleep(RPC_PACING_MS);
    await this.indexContract(this.config.policyAddress, VAULT_POLICY_EVENTS_ABI, latest);
  }

  private async indexContract(address: `0x${string}`, abi: typeof MANDATE_VAULT_EVENTS_ABI | typeof VAULT_POLICY_EVENTS_ABI, latest: bigint): Promise<void> {
    const chunk = this.config.blockRangeChunk ?? DEFAULT_BLOCK_RANGE_CHUNK;
    const cursor = this.store.getCursor(address);
    // Only applies the reorg-safety margin against a real persisted
    // cursor, never against startBlock: startBlock is a deliberate,
    // explicit choice (the contract's actual deployment block), rescanning
    // before it would be pointless, there is nothing there to find.
    let fromBlock = cursor !== null ? (cursor > RESTART_OVERLAP_BLOCKS ? cursor - RESTART_OVERLAP_BLOCKS + 1n : 0n) : this.config.startBlock;
    if (fromBlock > latest) return;

    while (fromBlock <= latest) {
      const toBlock = fromBlock + chunk - 1n > latest ? latest : fromBlock + chunk - 1n;
      const logs = await this.config.publicClient.getContractEvents({ address, abi, fromBlock, toBlock });
      await sleep(RPC_PACING_MS);
      for (const log of logs) {
        if (!log.eventName || !log.transactionHash || log.logIndex === null) continue;
        const event: IndexedEvent = {
          id: `${log.transactionHash}-${log.logIndex}`,
          contractAddress: address,
          eventName: log.eventName,
          args: log.args as Record<string, unknown>,
          blockNumber: (log.blockNumber ?? 0n).toString(),
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          indexedAt: new Date().toISOString(),
        };
        const isNew = this.store.insertIfNew(event);
        if (isNew) this.handleNewEvent(event);
      }
      this.store.setCursor(address, toBlock);
      fromBlock = toBlock + 1n;
    }
  }

  private handleNewEvent(event: IndexedEvent): void {
    if (CRITICAL_EVENT_NAMES.has(event.eventName)) {
      this.alertSink.send(
        makeEvent("critical", `ONCHAIN_${event.eventName.toUpperCase()}`, `${event.eventName} at tx ${event.transactionHash} (block ${event.blockNumber}): ${JSON.stringify(event.args)}`),
      );
    }
    if (event.eventName === "DecisionExecuted" && this.config.pipeline) {
      const matched = this.config.pipeline.findByTxHash(event.transactionHash);
      if (!matched) {
        // A real DecisionExecuted happened onchain with no corresponding
        // DecisionPipelineEntry, e.g. the process restarted between
        // markExecuted and this indexing pass, or a decision was submitted
        // through a path other than this keeper. Worth a human's
        // attention, not a fund-safety issue on its own.
        this.alertSink.send(
          makeEvent("warning", "UNMATCHED_DECISION_EXECUTED", `DecisionExecuted at tx ${event.transactionHash} has no matching DecisionPipelineEntry.`),
        );
      }
    }
  }

  runLoop(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      this.pollOnce().catch((error) => {
        this.alertSink.send(makeEvent("critical", "INDEXER_LOOP_ERROR", error instanceof Error ? error.message : String(error)));
      });
    }, intervalMs);
  }
}

export interface DecisionTimelineEntry {
  entry: DecisionPipelineEntry;
  onchainEvent: IndexedEvent | undefined;
}

/// @notice The AI Decision Timeline itself: every decision this pipeline
/// has ever produced for a vault, joined against its correlated onchain
/// DecisionExecuted event (if any), reasoning + thinking-trace status +
/// pre-check result + ops confirmation + anomaly flags + final onchain
/// result, all in one place, see docs/architecture.md's "Offchain (DB)"
/// section. A read-time join over two already-real, already-tested stores
/// (DecisionStore via DecisionPipeline, EventStore), not a third persisted
/// table duplicating both.
export function buildDecisionTimeline(pipeline: DecisionPipeline, eventStore: EventStore, vaultId: `0x${string}`): DecisionTimelineEntry[] {
  return pipeline.listAllForVault(vaultId).map((entry) => {
    const onchainEvent = entry.txHash ? eventStore.getByTransactionHash(entry.txHash).find((e) => e.eventName === "DecisionExecuted") : undefined;
    return { entry, onchainEvent };
  });
}
