// Real, durable persistence for DecisionPipeline, replacing the in-memory-
// only store that used to lose everything on a restart, see
// server/README.md and docs/architecture.md's "Offchain (DB)" section
// (DecisionRecord, the AI Decision Timeline's backing store).
//
// Uses node:sqlite (built into Node 22.5+, confirmed available in this
// project's Node version, no native build step, no external DB server to
// provision, matching the "solo/small-team pace" pragmatism
// docs/threat-model.md already applies to the keeper key's own storage).
// Not an ORM, not a normalized relational schema, deliberately: a single
// table storing each DecisionPipelineEntry as a JSON blob, plus the columns
// actually needed for fast lookups (vaultId, status). This is enough for
// hackathon-timeline pace without the schema-migration overhead a heavier
// setup would add; revisit if/when query patterns actually demand it.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { projectDataPath } from "../../shared/paths.js";
import type { DecisionPipelineEntry } from "../decisionPipeline.js";

interface DecisionRow {
  data: string;
}

export class DecisionStore {
  private readonly db: DatabaseSync;

  // Anchored to this project's own root (shared/paths.ts), not
  // process.cwd(), so this always lands in the same gitignored data/
  // directory regardless of which directory the process is launched from.
  constructor(dbPath: string = projectDataPath("mandate.db")) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        decisionId TEXT PRIMARY KEY,
        vaultId TEXT NOT NULL,
        status TEXT NOT NULL,
        queuedAt TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);
  }

  /// @notice Called after every mutation (enqueue/confirm/reject/expire/
  /// markExecuted/returnToQueueForReview), never partially, the whole entry
  /// is re-serialized each time so the row can never drift out of sync with
  /// the in-memory copy DecisionPipeline actually operates on.
  upsert(entry: DecisionPipelineEntry): void {
    this.db
      .prepare(
        `INSERT INTO decisions (decisionId, vaultId, status, queuedAt, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(decisionId) DO UPDATE SET
           status = excluded.status,
           data = excluded.data`,
      )
      .run(entry.decisionId, entry.queued.decision.vaultId, entry.queued.status, entry.queued.queuedAt, JSON.stringify(entry));
  }

  /// @notice Read on construction only, to rehydrate DecisionPipeline's
  /// in-memory Map after a restart. Never called mid-process, the
  /// in-memory copy is the working set, this store only needs to survive a
  /// restart, not serve live reads.
  loadAll(): DecisionPipelineEntry[] {
    const rows = this.db.prepare("SELECT data FROM decisions").all() as unknown as DecisionRow[];
    return rows.map((row) => JSON.parse(row.data) as DecisionPipelineEntry);
  }

  close(): void {
    this.db.close();
  }
}
