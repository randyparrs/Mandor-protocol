// propose -> offchain pre-check -> rate-limit/anomaly flag -> ops
// confirmation queue, see server/README.md. Invokes agent/core's
// proposeDecision directly (this is the one place outside agent/core the
// Anthropic API key is ever reachable from, see server/README.md's "Must
// never do"), then agent/policy's checkPolicyOffchain, then queues the
// result as a QueuedDecision with a hard expiresAt.
//
// No real database yet (server/db/ is not built), so DecisionPipeline is an
// in-memory store, Phase 1 scoped: a single process instance is the source
// of truth for pending confirmations. A restart loses anything still
// pending, acceptable for now given nothing here ever signs or moves funds,
// see the threat-model.md row on ops-confirmation compromise: it only ever
// flips a flag, the keeper independently re-validates onchain regardless.
import { randomUUID } from "node:crypto";
import { proposeDecision, type ProposeDecisionInput } from "../agent/core/loop.js";
import { checkPolicyOffchain, type OffchainPolicyCheckParams } from "../agent/policy/offchainPolicyCheck.js";
import { DECISION_CONFIRMATION_TIMEOUT_SECONDS, type QueuedDecision, type VaultDecision } from "../shared/decision.js";
import type { MarketData } from "../agent/core/types.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";

export type AnomalyFlagCode = "HIGH_PROPOSAL_RATE" | "POLICY_PRECHECK_VIOLATION" | "LOW_CONFIDENCE" | "SELF_CONSISTENCY_DISAGREEMENT";

export interface AnomalyFlag {
  code: AnomalyFlagCode;
  detail: string;
}

// Below this, systemPrompt.ts's own calibration contract calls confidence
// "genuinely uncertain", not just "somewhat confident", worth a human's
// attention before confirming.
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export interface DecisionPipelineEntry {
  decisionId: string;
  queued: QueuedDecision;
  // Advisory only, never authoritative, see PolicyCheckResult.source and
  // agent/policy/README.md. A failing precheck does not block queuing (the
  // real onchain gate is what actually matters), it is surfaced to the ops
  // reviewer as an anomaly flag instead, see computeAnomalyFlags.
  policyCheck: PolicyCheckResult;
  anomalyFlags: AnomalyFlag[];
  // The exact MarketData proposeDecision used to produce this decision, so
  // executor/keeperService.ts can reuse it (per its own staleness check)
  // instead of fetching a second, independently-timed price for the same
  // execution, see executor/README.md.
  marketData: MarketData;
  // "high" only ever set by returnToQueueForReview (a keeper-side
  // self-consistency disagreement on EMERGENCY_EXIT_TO_STABLE), never by
  // enqueue itself, an ordinary fresh proposal is always "normal".
  priority: "normal" | "high";
  resolvedBy?: string;
  resolvedAt?: string;
  // Set only by markExecuted, once the keeper's transaction actually lands
  // onchain successfully. Absent for every other status.
  txHash?: `0x${string}`;
}

/// @notice Flags worth a human's attention, never a reason to block queuing
/// on their own, the real gate is VaultPolicy.sol, not this pipeline, see
/// PolicyCheckResult.source. `priorProposalsToday` is the count of
/// non-expired decisions this pipeline has already queued for the same
/// vault within the current 24h window (any status), the caller (enqueue)
/// computes it from its own store so this function stays pure and testable.
export function computeAnomalyFlags(params: {
  decision: VaultDecision;
  policyCheck: PolicyCheckResult;
  priorProposalsToday: number;
  maxTradesPerDay: number;
}): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  if (!params.policyCheck.passed) {
    flags.push({
      code: "POLICY_PRECHECK_VIOLATION",
      detail: `Offchain pre-check predicts this decision would be rejected onchain: ${params.policyCheck.violations.map((v) => v.code).join(", ")}.`,
    });
  }

  if (params.decision.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flags.push({
      code: "LOW_CONFIDENCE",
      detail: `confidence ${params.decision.confidence} is below ${LOW_CONFIDENCE_THRESHOLD}, systemPrompt.ts's own threshold for "genuinely uncertain".`,
    });
  }

  // A proposal velocity above the vault's own onchain daily trade cap is
  // worth a human's attention before the onchain gate would even reject it,
  // tied to a real existing limit rather than an arbitrary constant.
  if (params.priorProposalsToday >= params.maxTradesPerDay) {
    flags.push({
      code: "HIGH_PROPOSAL_RATE",
      detail: `${params.priorProposalsToday} decisions already proposed for this vault in the last 24h, at or above its own maxTradesPerDay (${params.maxTradesPerDay}).`,
    });
  }

  return flags;
}

export class DecisionPipeline {
  private readonly entries = new Map<string, DecisionPipelineEntry>();

  /// @notice The full real path: proposeDecision (real Claude call) ->
  /// checkPolicyOffchain -> anomaly flags -> queue. Costs a real API call
  /// every time, never call this in a fast/free test, see
  /// test/decisionPipeline.ts, which exercises enqueue/confirm/reject/expire
  /// directly with fixtures instead.
  async proposeAndQueue(
    input: ProposeDecisionInput,
    policyParams: Omit<OffchainPolicyCheckParams, "decision">,
  ): Promise<DecisionPipelineEntry> {
    const { decision } = await proposeDecision(input);
    const policyCheck = checkPolicyOffchain({ ...policyParams, decision });
    return this.enqueue(decision, policyCheck, policyParams.policyLimits.maxTradesPerDay, input.marketData);
  }

  /// @notice The pure, synchronous half of the pipeline: given an
  /// already-produced decision and its pre-check result, computes anomaly
  /// flags and queues it with a hard expiresAt. Split out from
  /// proposeAndQueue so it can be unit tested without a real API call.
  enqueue(decision: VaultDecision, policyCheck: PolicyCheckResult, maxTradesPerDay: number, marketData: MarketData): DecisionPipelineEntry {
    this.sweepExpired();

    const priorProposalsToday = this.countRecentProposals(decision.vaultId, new Date());
    const anomalyFlags = computeAnomalyFlags({ decision, policyCheck, priorProposalsToday, maxTradesPerDay });

    const queuedAt = new Date();
    const expiresAt = new Date(queuedAt.getTime() + DECISION_CONFIRMATION_TIMEOUT_SECONDS * 1000);
    const entry: DecisionPipelineEntry = {
      decisionId: randomUUID(),
      queued: {
        decision,
        status: "pending_confirmation",
        queuedAt: queuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      policyCheck,
      anomalyFlags,
      marketData,
      priority: "normal",
    };
    this.entries.set(entry.decisionId, entry);
    return entry;
  }

  /// @notice Ops confirmation, per docs/architecture.md: a human review
  /// action (decisionId + confirmedBy + timestamp), never a wallet
  /// signature in Phase 1, and never authoritative on its own, see
  /// threat-model.md's "ops-confirmation account compromised" row, the
  /// keeper independently re-validates onchain regardless of what was
  /// confirmed here. Refuses (throws) rather than silently no-op-ing on an
  /// already-resolved or expired entry, so a caller can't mistake a no-op
  /// for a successful confirmation.
  confirm(decisionId: string, confirmedBy: string): DecisionPipelineEntry {
    return this.resolve(decisionId, "confirmed", confirmedBy);
  }

  reject(decisionId: string, rejectedBy: string): DecisionPipelineEntry {
    return this.resolve(decisionId, "rejected", rejectedBy);
  }

  private resolve(decisionId: string, status: "confirmed" | "rejected", resolvedBy: string): DecisionPipelineEntry {
    this.sweepExpired();
    const entry = this.entries.get(decisionId);
    if (!entry) {
      throw new Error(`No queued decision found for decisionId ${decisionId}.`);
    }
    if (entry.queued.status !== "pending_confirmation") {
      throw new Error(`decisionId ${decisionId} is already "${entry.queued.status}", cannot ${status === "confirmed" ? "confirm" : "reject"} it.`);
    }
    const resolvedAt = new Date().toISOString();
    // QueuedDecision's confirmedBy/confirmedAt are named for the confirm
    // path specifically, only set them there; a rejection's who/when is
    // tracked on this entry's own resolvedBy/resolvedAt instead, not by
    // overloading a field named for the other outcome.
    entry.queued = status === "confirmed" ? { ...entry.queued, status, confirmedBy: resolvedBy, confirmedAt: resolvedAt } : { ...entry.queued, status };
    entry.resolvedBy = resolvedBy;
    entry.resolvedAt = resolvedAt;
    return entry;
  }

  getEntry(decisionId: string): DecisionPipelineEntry | undefined {
    this.sweepExpired();
    return this.entries.get(decisionId);
  }

  listPendingForVault(vaultId: `0x${string}`): DecisionPipelineEntry[] {
    this.sweepExpired();
    return [...this.entries.values()].filter((e) => e.queued.decision.vaultId === vaultId && e.queued.status === "pending_confirmation");
  }

  /// @notice What executor/keeperService.ts polls: decisions ops already
  /// confirmed but that have not yet landed onchain. A "confirmed" entry
  /// that stays in this list past a defined timeout is exactly what the
  /// keeper's heartbeat watchdog alerts on, see executor/alertSink.ts.
  listConfirmedUnexecuted(vaultId: `0x${string}`): DecisionPipelineEntry[] {
    this.sweepExpired();
    return [...this.entries.values()].filter((e) => e.queued.decision.vaultId === vaultId && e.queued.status === "confirmed");
  }

  /// @notice Only ever called by the keeper, only after a real transaction's
  /// receipt comes back status "success". Never called speculatively before
  /// a receipt exists, see executor/keeperService.ts's "never auto-retry"
  /// rule, this is the one terminal, success-only transition.
  markExecuted(decisionId: string, txHash: `0x${string}`): DecisionPipelineEntry {
    const entry = this.entries.get(decisionId);
    if (!entry) {
      throw new Error(`No queued decision found for decisionId ${decisionId}.`);
    }
    if (entry.queued.status !== "confirmed") {
      throw new Error(`decisionId ${decisionId} is "${entry.queued.status}", not "confirmed", cannot mark it executed.`);
    }
    entry.queued = { ...entry.queued, status: "executed" };
    entry.txHash = txHash;
    return entry;
  }

  /// @notice Only for the keeper's EMERGENCY_EXIT_TO_STABLE self-consistency
  /// gate: called when 3 fresh proposeDecision samples did not unanimously
  /// agree with an already-confirmed EMERGENCY_EXIT_TO_STABLE decision.
  /// Ops' earlier confirmation was valid given the information available
  /// then, not a standing authorization regardless of what changed after,
  /// so this returns the entry to "pending_confirmation" with a fresh
  /// expiresAt, rather than executing on stale authorization or silently
  /// discarding a disagreement that is itself meaningful signal.
  returnToQueueForReview(decisionId: string, flag: AnomalyFlag): DecisionPipelineEntry {
    const entry = this.entries.get(decisionId);
    if (!entry) {
      throw new Error(`No queued decision found for decisionId ${decisionId}.`);
    }
    if (entry.queued.status !== "confirmed") {
      throw new Error(`decisionId ${decisionId} is "${entry.queued.status}", not "confirmed", cannot return it to the queue for review.`);
    }
    const queuedAt = new Date();
    const expiresAt = new Date(queuedAt.getTime() + DECISION_CONFIRMATION_TIMEOUT_SECONDS * 1000);
    entry.queued = {
      decision: entry.queued.decision,
      status: "pending_confirmation",
      queuedAt: queuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    entry.priority = "high";
    entry.anomalyFlags = [...entry.anomalyFlags, flag];
    entry.resolvedBy = undefined;
    entry.resolvedAt = undefined;
    return entry;
  }

  /// @notice Marks every still-"pending_confirmation" entry past its
  /// expiresAt as "expired", matching docs/architecture.md exactly: "If no
  /// ops confirmation happens before expiresAt, decisionPipeline.ts marks
  /// the decision expired automatically and it is discarded, it can never
  /// be confirmed late." Called at the start of every read/mutation, so
  /// this invariant holds even with no external cron calling it, but is
  /// also exposed directly for a caller (e.g. a monitoring dashboard) that
  /// wants an accurate count without performing any other operation first.
  sweepExpired(now: Date = new Date()): void {
    for (const entry of this.entries.values()) {
      if (entry.queued.status === "pending_confirmation" && new Date(entry.queued.expiresAt).getTime() <= now.getTime()) {
        entry.queued = { ...entry.queued, status: "expired" };
      }
    }
  }

  private countRecentProposals(vaultId: `0x${string}`, now: Date, windowSeconds = 24 * 60 * 60): number {
    const cutoff = now.getTime() - windowSeconds * 1000;
    return [...this.entries.values()].filter((e) => e.queued.decision.vaultId === vaultId && new Date(e.queued.queuedAt).getTime() >= cutoff).length;
  }
}
