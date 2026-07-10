import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PaperExecutor } from "../executor/paperExecutor.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult } from "../shared/policyTypes.js";

const decision: VaultDecision = {
  vaultId: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
  strategyVersion: "v1",
  modelId: "claude-sonnet-5",
  action: "HOLD",
  confidence: 0.9,
  reasoning: "test fixture",
  proposedAt: new Date().toISOString(),
};

const policyCheck: PolicyCheckResult = {
  passed: true,
  violations: [],
  checkedAt: new Date().toISOString(),
  source: "offchain-precheck",
};

describe("PaperExecutor", () => {
  it("never calls any signer/onchain path, just logs one JSON line per decision", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paper-executor-test-"));
    const logPath = path.join(dir, "decisions.jsonl");
    after(() => rm(dir, { recursive: true, force: true }));

    const executor = new PaperExecutor(logPath);
    const result = await executor.execute(decision, policyCheck);

    assert.equal(result.mode, "paper");
    assert.equal(result.decision.vaultId, decision.vaultId);
    assert.equal(result.policyCheck.passed, true);

    const contents = await readFile(logPath, "utf8");
    const lines = contents.trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.mode, "paper");
    assert.equal(parsed.decision.vaultId, decision.vaultId);
  });

  it("appends, never overwrites, across multiple executions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paper-executor-test-"));
    const logPath = path.join(dir, "decisions.jsonl");
    after(() => rm(dir, { recursive: true, force: true }));

    const executor = new PaperExecutor(logPath);
    await executor.execute(decision, policyCheck);
    await executor.execute({ ...decision, action: "EMERGENCY_EXIT_TO_STABLE" }, policyCheck);

    const contents = await readFile(logPath, "utf8");
    const lines = contents.trim().split("\n");
    assert.equal(lines.length, 2);
  });

  it("logs a failed pre-check result too, rather than skipping the record", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paper-executor-test-"));
    const logPath = path.join(dir, "decisions.jsonl");
    after(() => rm(dir, { recursive: true, force: true }));

    const rejected: PolicyCheckResult = {
      passed: false,
      violations: [{ code: "VAULT_PAUSED", detail: "test" }],
      checkedAt: new Date().toISOString(),
      source: "offchain-precheck",
    };
    const executor = new PaperExecutor(logPath);
    const result = await executor.execute(decision, rejected);

    assert.equal(result.policyCheck.passed, false);
    const contents = await readFile(logPath, "utf8");
    assert.ok(contents.includes("VAULT_PAUSED"));
  });
});
