// The structured decision schema Claude must emit. Strict, no free text for
// anything execution-relevant. `reasoning` is the one free-text field and it
// is read only by explainability/timeline code, never by anything with
// execution authority, the actual authority boundary is enforced in
// VaultPolicy.sol, which has no string parameter in its interface at all.

export type AssetSymbol = "USDC" | "EURC" | "USYC" | "cirBTC" | string;

export type DecisionAction =
  | "HOLD"
  | "REBALANCE"
  | "ENTER"
  | "EXIT"
  | "EMERGENCY_EXIT_TO_STABLE";

export interface TargetAllocation {
  asset: AssetSymbol;
  targetWeightBps: number; // 0-10000, basis points of vault NAV
}

export interface VaultDecision {
  vaultId: `0x${string}`;
  strategyVersion: string;
  modelId: string; // pinned Claude model id that produced this decision
  action: DecisionAction;
  asset?: AssetSymbol; // primary asset for ENTER/EXIT
  amount?: string; // human decimal, present for ENTER/EXIT
  targetAllocations?: TargetAllocation[]; // full target weight vector, for REBALANCE
  confidence: number; // 0-1
  reasoning: string; // explainability only, zero execution authority
  proposedAt: string; // ISO timestamp
}

// The ops confirmation queue's wrapper around a proposed decision. A decision
// that sits unconfirmed past expiresAt is auto-discarded by decisionPipeline
// as "expired", it can never be confirmed late and rubber-stamped after
// market conditions have moved on, and it is never auto-retried.
export type DecisionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "rejected"
  | "expired"
  | "executed"
  | "policy_rejected";

export interface QueuedDecision {
  decision: VaultDecision;
  status: DecisionStatus;
  queuedAt: string;
  expiresAt: string; // queuedAt + DECISION_CONFIRMATION_TIMEOUT_SECONDS
  confirmedBy?: string;
  confirmedAt?: string;
}
