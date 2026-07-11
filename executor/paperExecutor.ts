// The no-op executor Paper Vault mode injects in place of the real keeper,
// see docs/architecture.md: "Paper Vault reuses proposeDecision with a
// mode: paper context; only the injected executor changes." Holds no signing
// key, makes no onchain call, ever, unlike keeperService.ts (not yet built),
// the one module in this repo that does, see executor/README.md.
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";
import { projectDataPath } from "../shared/paths.js";
import type { Executor, ExecutionResult } from "./types.js";

export interface PaperExecutionResult extends ExecutionResult {
  mode: "paper";
  decision: VaultDecision;
  policyCheck: PolicyCheckResult;
}

// Anchored to this project's own root (shared/paths.ts), not process.cwd(),
// so the log always lands in the same gitignored data/ directory
// regardless of which directory the process happens to be launched from.
const DEFAULT_LOG_PATH = projectDataPath("paperVaultDecisions.jsonl");

/// @notice Appends one JSON line per decision to a local log file so Paper
/// Vault decision history can start accumulating before server/'s real
/// DecisionRecord store exists. Never treats the offchain pre-check result
/// as a reason to skip logging: a paper run's whole point is to see what the
/// pipeline would have produced, rejected proposals included.
export class PaperExecutor implements Executor {
  constructor(private readonly logPath: string = DEFAULT_LOG_PATH) {}

  async execute(decision: VaultDecision, policyCheck: PolicyCheckResult): Promise<PaperExecutionResult> {
    const result: PaperExecutionResult = {
      mode: "paper",
      executedAt: new Date().toISOString(),
      decision,
      policyCheck,
    };
    await mkdir(path.dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(result)}\n`, "utf8");
    console.log(
      `[PaperExecutor] ${decision.action} for vault ${decision.vaultId}: precheck ${policyCheck.passed ? "passed" : "failed"} (paper mode, no onchain call).`,
    );
    return result;
  }
}
