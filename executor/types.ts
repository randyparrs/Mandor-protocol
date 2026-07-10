// The swappable-implementation-behind-one-interface seam docs/architecture.md
// describes for Paper Vault vs. the real keeper, mirroring Vpay's test vs.
// real signer pattern. Only the implementation differs (PaperExecutor logs,
// keeperService.ts, not yet built, submits a real transaction);
// proposeDecision and offchainPolicyCheck stay identical either way.
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";

export interface ExecutionResult {
  mode: "paper" | "live";
  executedAt: string;
}

export interface Executor {
  execute(decision: VaultDecision, policyCheck: PolicyCheckResult): Promise<ExecutionResult>;
}
