import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DecisionPipeline, computeAnomalyFlags } from "../server/decisionPipeline.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";

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

function failingCheck(): PolicyCheckResult {
  return {
    passed: false,
    violations: [{ code: "VAULT_PAUSED", detail: "test" }],
    checkedAt: new Date().toISOString(),
    source: "offchain-precheck",
  };
}

describe("computeAnomalyFlags", () => {
  it("returns no flags for a clean, confident, first-of-the-day decision", () => {
    const flags = computeAnomalyFlags({ decision: decision(), policyCheck: passingCheck(), priorProposalsToday: 0, maxTradesPerDay: 5 });
    assert.deepEqual(flags, []);
  });

  it("flags POLICY_PRECHECK_VIOLATION when the pre-check fails", () => {
    const flags = computeAnomalyFlags({ decision: decision(), policyCheck: failingCheck(), priorProposalsToday: 0, maxTradesPerDay: 5 });
    assert.ok(flags.some((f) => f.code === "POLICY_PRECHECK_VIOLATION"));
  });

  it("flags LOW_CONFIDENCE below the 0.5 threshold", () => {
    const flags = computeAnomalyFlags({ decision: decision({ confidence: 0.3 }), policyCheck: passingCheck(), priorProposalsToday: 0, maxTradesPerDay: 5 });
    assert.ok(flags.some((f) => f.code === "LOW_CONFIDENCE"));
  });

  it("does not flag LOW_CONFIDENCE at exactly the threshold or above", () => {
    const flags = computeAnomalyFlags({ decision: decision({ confidence: 0.5 }), policyCheck: passingCheck(), priorProposalsToday: 0, maxTradesPerDay: 5 });
    assert.ok(!flags.some((f) => f.code === "LOW_CONFIDENCE"));
  });

  it("flags HIGH_PROPOSAL_RATE once prior proposals today reach maxTradesPerDay", () => {
    const flags = computeAnomalyFlags({ decision: decision(), policyCheck: passingCheck(), priorProposalsToday: 5, maxTradesPerDay: 5 });
    assert.ok(flags.some((f) => f.code === "HIGH_PROPOSAL_RATE"));
  });

  it("can raise multiple flags at once", () => {
    const flags = computeAnomalyFlags({
      decision: decision({ confidence: 0.1 }),
      policyCheck: failingCheck(),
      priorProposalsToday: 10,
      maxTradesPerDay: 5,
    });
    const codes = flags.map((f) => f.code);
    assert.ok(codes.includes("POLICY_PRECHECK_VIOLATION"));
    assert.ok(codes.includes("LOW_CONFIDENCE"));
    assert.ok(codes.includes("HIGH_PROPOSAL_RATE"));
  });
});

describe("DecisionPipeline", () => {
  it("enqueues a decision as pending_confirmation with a real expiresAt in the future", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    assert.equal(entry.queued.status, "pending_confirmation");
    assert.ok(new Date(entry.queued.expiresAt).getTime() > new Date(entry.queued.queuedAt).getTime());
    assert.deepEqual(entry.anomalyFlags, []);
  });

  it("confirm() transitions pending_confirmation to confirmed and records who/when", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    const confirmed = pipeline.confirm(entry.decisionId, "ops@team");
    assert.equal(confirmed.queued.status, "confirmed");
    assert.equal(confirmed.queued.confirmedBy, "ops@team");
    assert.ok(confirmed.queued.confirmedAt);
  });

  it("reject() transitions pending_confirmation to rejected without setting confirmedBy", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    const rejected = pipeline.reject(entry.decisionId, "ops@team");
    assert.equal(rejected.queued.status, "rejected");
    assert.equal(rejected.queued.confirmedBy, undefined);
    assert.equal(rejected.resolvedBy, "ops@team");
  });

  it("throws confirming a decisionId that does not exist", () => {
    const pipeline = new DecisionPipeline();
    assert.throws(() => pipeline.confirm("not-a-real-id", "ops@team"));
  });

  it("throws confirming a decision that is already confirmed", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    pipeline.confirm(entry.decisionId, "ops@team");
    assert.throws(() => pipeline.confirm(entry.decisionId, "ops2@team"));
  });

  it("throws confirming a decision that has already expired, never confirmable late", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    // Force expiry by sweeping with a "now" far past expiresAt.
    pipeline.sweepExpired(new Date(Date.now() + 999 * 60 * 60 * 1000));
    assert.throws(() => pipeline.confirm(entry.decisionId, "ops@team"));
    assert.equal(pipeline.getEntry(entry.decisionId)?.queued.status, "expired");
  });

  it("sweepExpired is idempotent and never touches an already-resolved entry", () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), passingCheck(), 5);
    pipeline.confirm(entry.decisionId, "ops@team");
    pipeline.sweepExpired(new Date(Date.now() + 999 * 60 * 60 * 1000));
    assert.equal(pipeline.getEntry(entry.decisionId)?.queued.status, "confirmed");
  });

  it("listPendingForVault only returns pending entries for the given vault", () => {
    const pipeline = new DecisionPipeline();
    const vaultA = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
    const vaultB = "0x000000000000000000000000000000000000aa" as const;
    const entryA = pipeline.enqueue(decision({ vaultId: vaultA }), passingCheck(), 5);
    pipeline.enqueue(decision({ vaultId: vaultB }), passingCheck(), 5);
    const confirmedA = pipeline.enqueue(decision({ vaultId: vaultA }), passingCheck(), 5);
    pipeline.confirm(confirmedA.decisionId, "ops@team");

    const pending = pipeline.listPendingForVault(vaultA);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].decisionId, entryA.decisionId);
  });

  it("flags HIGH_PROPOSAL_RATE once this pipeline's own store has already queued maxTradesPerDay decisions for the vault today", () => {
    const pipeline = new DecisionPipeline();
    const vaultId = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
    for (let i = 0; i < 5; i++) {
      pipeline.enqueue(decision({ vaultId }), passingCheck(), 5);
    }
    const sixth = pipeline.enqueue(decision({ vaultId }), passingCheck(), 5);
    assert.ok(sixth.anomalyFlags.some((f) => f.code === "HIGH_PROPOSAL_RATE"));
  });
});
