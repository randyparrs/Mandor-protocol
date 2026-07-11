// Real persistence for indexed onchain events, server/indexer/'s backing
// store. Same node:sqlite pattern as decisionStore.ts (see that file's own
// comment for why: no native build step, no external DB server, enough for
// hackathon-timeline pace). Shares the same on-disk file as DecisionStore
// by default (different tables, one small app-level database, not
// fragmented across many tiny files), confirmed safe: node:sqlite supports
// multiple DatabaseSync handles open on the same file within one process.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { projectDataPath } from "../../shared/paths.js";

export interface IndexedEvent {
  // `${transactionHash}-${logIndex}`, a stable dedup key so re-indexing an
  // already-processed block range (e.g. after a restart resumes slightly
  // behind the true last-processed block, see EventIndexer's cursor) never
  // inserts a duplicate row.
  id: string;
  contractAddress: `0x${string}`;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: string; // bigint serialized as a string, JSON/SQLite-safe
  transactionHash: `0x${string}`;
  logIndex: number;
  indexedAt: string;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

interface EventRow {
  data: string;
}

interface CursorRow {
  lastProcessedBlock: string;
}

export class EventStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = projectDataPath("mandate.db")) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        eventName TEXT NOT NULL,
        transactionHash TEXT NOT NULL,
        blockNumber TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexer_cursor (
        contractAddress TEXT PRIMARY KEY,
        lastProcessedBlock TEXT NOT NULL
      )
    `);
  }

  /// @notice Uses INSERT OR IGNORE keyed on the stable id, so replaying an
  /// already-indexed block range (normal after a restart, see
  /// EventIndexer's cursor) is idempotent, never a duplicate row. Returns
  /// whether a row was actually inserted, so a caller can tell a genuinely
  /// new event from a harmless replay.
  insertIfNew(event: IndexedEvent): boolean {
    // event.args comes straight from viem's decoded log for a real
    // onchain event, any uint256 field (DecisionExecuted's amount,
    // SwapExecuted's amountIn/amountOut, etc.) is a bigint, which
    // JSON.stringify cannot serialize on its own, hence the replacer.
    const result = this.db
      .prepare(`INSERT OR IGNORE INTO events (id, eventName, transactionHash, blockNumber, data) VALUES (?, ?, ?, ?, ?)`)
      .run(event.id, event.eventName, event.transactionHash, event.blockNumber, JSON.stringify(event, bigintReplacer));
    return result.changes > 0;
  }

  /// @notice What correlates an onchain DecisionExecuted event back to the
  /// DecisionPipelineEntry that produced the transaction (matched by
  /// transactionHash, the only shared key between the offchain pipeline and
  /// the onchain log, see server/indexer/eventIndexer.ts).
  getByTransactionHash(transactionHash: `0x${string}`): IndexedEvent[] {
    const rows = this.db.prepare("SELECT data FROM events WHERE transactionHash = ?").all(transactionHash) as unknown as EventRow[];
    return rows.map((row) => JSON.parse(row.data) as IndexedEvent);
  }

  listByEventName(eventName: string): IndexedEvent[] {
    const rows = this.db.prepare("SELECT data FROM events WHERE eventName = ? ORDER BY blockNumber ASC").all(eventName) as unknown as EventRow[];
    return rows.map((row) => JSON.parse(row.data) as IndexedEvent);
  }

  /// @notice The last block this contract's events were successfully
  /// indexed through, so a restart resumes from here rather than from
  /// genesis (slow, re-processes everything) or from "now" (silently skips
  /// whatever happened while the indexer was down).
  getCursor(contractAddress: `0x${string}`): bigint | null {
    const row = this.db.prepare("SELECT lastProcessedBlock FROM indexer_cursor WHERE contractAddress = ?").get(contractAddress) as unknown as CursorRow | undefined;
    return row ? BigInt(row.lastProcessedBlock) : null;
  }

  setCursor(contractAddress: `0x${string}`, blockNumber: bigint): void {
    this.db
      .prepare(
        `INSERT INTO indexer_cursor (contractAddress, lastProcessedBlock)
         VALUES (?, ?)
         ON CONFLICT(contractAddress) DO UPDATE SET lastProcessedBlock = excluded.lastProcessedBlock`,
      )
      .run(contractAddress, blockNumber.toString());
  }

  close(): void {
    this.db.close();
  }
}
