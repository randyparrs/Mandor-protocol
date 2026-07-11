// Fast, free tests for everything that doesn't need a real signer, a real
// Anthropic API call, or a live chain: nonce sequencing, no-retry behavior,
// abnormal NAV-delta detection, self-consistency agreement/disagreement,
// and price reuse vs refresh. Uses the injectable seams on
// KeeperServiceConfig (see executor/keeperService.ts) to swap every real
// dependency for a fixture. A real end-to-end run against the live vault
// is scripts/testKeeperServiceAgainstRealVault.ts instead, not this file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { KeeperService } from "../executor/keeperService.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import type { AlertEvent } from "../shared/alertSink.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyLimits } from "../shared/policyTypes.js";
import type { MarketData, VaultState } from "../agent/core/types.js";
import type { ProposeDecisionResult } from "../agent/core/loop.js";

// A syntactically valid, unfunded, never-used-live private key, purely for
// deriving a local account object, no network call happens at construction.
const TEST_PRIVATE_KEY = "0x852612fe3a79b9e5cf233469ff9a1a885d3ac262d3f5949bac68f3d433123f51" as const;
const VAULT_ADDRESS = "0x9D1b2853722bc69C062D044D74DBeFae430422be" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const ASSETS = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];

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

function vaultState(overrides: Partial<VaultState> = {}): VaultState {
  return {
    vaultId: VAULT_ADDRESS,
    totalAssetsUSDC: "5",
    holdings: [{ asset: "USDC", ledgerAmount: "5", valueUSDC: "5" }],
    paused: false,
    tradesToday: 0,
    highWaterMarkUSDC: "5",
    currentDrawdownBps: 0,
    ...overrides,
  };
}

function policyLimits(overrides: Partial<PolicyLimits> = {}): PolicyLimits {
  return {
    maxAllocationBpsPerAsset: { USDC: 10_000 },
    isStableAsset: { USDC: true },
    maxDrawdownBps: 1000,
    maxTradesPerDay: 5,
    minStableAllocationBps: 10_000,
    oracleMaxStalenessSeconds: 3600,
    oracleMaxDeviationBps: 500,
    maxDrawdownSpeedBpsPerWindow: 300,
    drawdownSpeedWindowSeconds: 3600,
    autoPauseBountyAmount: "0",
    ...overrides,
  };
}

function marketData(updatedAt: string = new Date().toISOString()): MarketData {
  return { prices: [{ asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt }] };
}

function fakeReceipt(status: "success" | "reverted" = "success") {
  return { status, transactionHash: "0xtxhash" };
}

interface FakeCall {
  functionName: string;
  args?: unknown[];
}

/// @notice Records every call, lets a test script exactly what
/// readContract/simulateContract/waitForTransactionReceipt should return,
/// and can inject a synthetic revert for the simulate step.
function makeFakePublicClient(opts: {
  totalAssetsSequence?: bigint[];
  simulateShouldThrow?: boolean;
  receiptStatus?: "success" | "reverted";
} = {}) {
  const calls: FakeCall[] = [];
  const totalAssetsSequence = opts.totalAssetsSequence ?? [5_000_000n, 5_000_000n];
  let totalAssetsCallIndex = 0;

  const publicClient = {
    async readContract(params: { functionName: string; args?: unknown[] }) {
      calls.push({ functionName: params.functionName, args: params.args });
      if (params.functionName === "policy") return "0xPolicyAddress0000000000000000000000000";
      if (params.functionName === "assetDecimals") return 6;
      if (params.functionName === "totalAssets") {
        const value = totalAssetsSequence[Math.min(totalAssetsCallIndex, totalAssetsSequence.length - 1)];
        totalAssetsCallIndex++;
        return value;
      }
      throw new Error(`fake readContract: unexpected functionName ${params.functionName}`);
    },
    async simulateContract(params: { functionName: string }) {
      calls.push({ functionName: `simulate:${params.functionName}` });
      if (opts.simulateShouldThrow) {
        throw new Error("simulated revert: DecisionRejected");
      }
      return { result: true };
    },
    async waitForTransactionReceipt() {
      calls.push({ functionName: "waitForTransactionReceipt" });
      return fakeReceipt(opts.receiptStatus ?? "success");
    },
  };
  return { publicClient, calls };
}

function makeFakeWalletClient() {
  const calls: FakeCall[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const walletClient = {
    async writeContract(params: { functionName: string }) {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      calls.push({ functionName: params.functionName });
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return "0xtxhash";
    },
  };
  return { walletClient, calls, getMaxConcurrent: () => maxConcurrent };
}

function makeService(opts: {
  pipeline: DecisionPipeline;
  publicClient: ReturnType<typeof makeFakePublicClient>["publicClient"];
  walletClient: ReturnType<typeof makeFakeWalletClient>["walletClient"];
  events: AlertEvent[];
  proposeDecisionFn?: (input: unknown) => Promise<ProposeDecisionResult>;
  getMarketDataCallCount?: { count: number };
}) {
  return new KeeperService({
    publicClient: opts.publicClient as any,
    walletClient: opts.walletClient as any,
    vaultAddress: VAULT_ADDRESS,
    assets: ASSETS,
    stableAssets: ["USDC"],
    strategyVersion: "v1",
    strategyConfigText: "test strategy",
    pipeline: opts.pipeline,
    keeperAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
    alertSink: { send: (event) => opts.events.push(event) },
    getVaultStateFn: async () => vaultState(),
    buildPolicyLimitsStructFn: async () => policyLimits(),
    getMarketDataFn: async () => {
      if (opts.getMarketDataCallCount) opts.getMarketDataCallCount.count++;
      return marketData();
    },
    buildProposeDecisionInputFn: async () => ({
      vaultId: VAULT_ADDRESS,
      strategyVersion: "v1",
      strategyConfigText: "test strategy",
      policyLimitsText: "",
      vaultState: vaultState(),
      marketData: marketData(),
    }),
    proposeDecisionFn: (opts.proposeDecisionFn as typeof import("../agent/core/loop.js").proposeDecision) ?? (async () => {
      throw new Error("proposeDecisionFn not provided for this test");
    }),
  });
}

describe("KeeperService", () => {
  it("executes a confirmed HOLD, marks it executed, and never fires an abnormal-delta alert when NAV does not move", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient({ totalAssetsSequence: [5_000_000n, 5_000_000n] });
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    const updated = pipeline.getEntry(entry.decisionId)!;
    assert.equal(updated.queued.status, "executed");
    assert.equal(updated.txHash, "0xtxhash");
    assert.ok(!events.some((e) => e.code === "ABNORMAL_NAV_DELTA"));
  });

  it("fires a critical ABNORMAL_NAV_DELTA alert if totalAssets moves despite zero swap legs", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    // preNAV then a different postNAV, simulating something unexpected moved funds.
    const { publicClient } = makeFakePublicClient({ totalAssetsSequence: [5_000_000n, 4_000_000n] });
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    assert.ok(events.some((e) => e.code === "ABNORMAL_NAV_DELTA" && e.severity === "critical"));
    // Still marked executed: the transaction itself succeeded, this is a
    // post-hoc integrity alarm, not a pre-submission blocker.
    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
  });

  it("never retries automatically when simulateContract reverts, leaves the entry confirmed, never calls writeContract", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient({ simulateShouldThrow: true });
    const { walletClient, calls: walletCalls } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "confirmed");
    assert.equal(walletCalls.length, 0);
    assert.ok(events.some((e) => e.code === "EXECUTION_FAILED" && e.severity === "critical"));
  });

  it("aborts and alerts (never executes) when the fresh offchain pre-check now fails, e.g. the vault is paused", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient();
    const { walletClient, calls: walletCalls } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = new KeeperService({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      vaultAddress: VAULT_ADDRESS,
      assets: ASSETS,
      stableAssets: ["USDC"],
      strategyVersion: "v1",
      strategyConfigText: "test strategy",
      pipeline,
      keeperAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
      alertSink: { send: (event) => events.push(event) },
      getVaultStateFn: async () => vaultState({ paused: true }),
      buildPolicyLimitsStructFn: async () => policyLimits(),
      getMarketDataFn: async () => marketData(),
      buildProposeDecisionInputFn: async () => {
        throw new Error("should not be called for a HOLD decision");
      },
      proposeDecisionFn: async () => {
        throw new Error("should not be called for a HOLD decision");
      },
    });

    await service.runOnce();

    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "confirmed");
    assert.equal(walletCalls.length, 0);
    assert.ok(events.some((e) => e.code === "EXECUTION_ABORTED_PRECHECK"));
  });

  it("processes multiple confirmed decisions strictly sequentially, never more than one writeContract in flight", async () => {
    const pipeline = new DecisionPipeline();
    const e1 = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    const e2 = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(e1.decisionId, "ops@team");
    pipeline.confirm(e2.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient({ totalAssetsSequence: [5_000_000n, 5_000_000n, 5_000_000n, 5_000_000n] });
    const { walletClient, getMaxConcurrent } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    assert.equal(getMaxConcurrent(), 1);
    assert.equal(pipeline.getEntry(e1.decisionId)!.queued.status, "executed");
    assert.equal(pipeline.getEntry(e2.decisionId)!.queued.status, "executed");
  });

  it("EMERGENCY_EXIT_TO_STABLE executes when 3 fresh proposals unanimously agree", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision({ action: "EMERGENCY_EXIT_TO_STABLE" }), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient();
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    let sampleCount = 0;
    const service = makeService({
      pipeline,
      publicClient,
      walletClient,
      events,
      proposeDecisionFn: async () => {
        sampleCount++;
        return { decision: decision({ action: "EMERGENCY_EXIT_TO_STABLE" }), promptHash: "hash", thinkingText: null, thinkingTokens: null, rawOutput: {} as never };
      },
    });

    await service.runOnce();

    assert.equal(sampleCount, 3);
    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
  });

  it("EMERGENCY_EXIT_TO_STABLE never executes on any dissent, returns the entry to the queue with priority high and never calls writeContract", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision({ action: "EMERGENCY_EXIT_TO_STABLE" }), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient();
    const { walletClient, calls: walletCalls } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    let sampleIndex = 0;
    const service = makeService({
      pipeline,
      publicClient,
      walletClient,
      events,
      proposeDecisionFn: async () => {
        // 2 of 3 agree, 1 dissents: not unanimous.
        const action = sampleIndex === 1 ? "HOLD" : "EMERGENCY_EXIT_TO_STABLE";
        sampleIndex++;
        return { decision: decision({ action }), promptHash: "hash", thinkingText: null, thinkingTokens: null, rawOutput: {} as never };
      },
    });

    await service.runOnce();

    const updated = pipeline.getEntry(entry.decisionId)!;
    assert.equal(updated.queued.status, "pending_confirmation");
    assert.equal(updated.priority, "high");
    assert.ok(updated.anomalyFlags.some((f) => f.code === "SELF_CONSISTENCY_DISAGREEMENT"));
    assert.equal(walletCalls.length, 0);
    assert.ok(events.some((e) => e.code === "SELF_CONSISTENCY_DISAGREEMENT" && e.severity === "critical"));
  });

  it("reuses the stored price when still within oracleMaxStalenessSeconds, never calls getMarketData again", async () => {
    const pipeline = new DecisionPipeline();
    const freshPrice = marketData(new Date().toISOString());
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, freshPrice);
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient();
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const callCount = { count: 0 };
    const service = makeService({ pipeline, publicClient, walletClient, events, getMarketDataCallCount: callCount });

    await service.runOnce();

    assert.equal(callCount.count, 0);
  });

  it("refreshes the price when the stored one is older than oracleMaxStalenessSeconds", async () => {
    const pipeline = new DecisionPipeline();
    const staleTime = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2h old, limit is 1h
    const stalePrice = marketData(staleTime);
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, stalePrice);
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient();
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const callCount = { count: 0 };
    const service = makeService({ pipeline, publicClient, walletClient, events, getMarketDataCallCount: callCount });

    await service.runOnce();

    assert.equal(callCount.count, 1);
    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
  });

  it("emits a heartbeat every runOnce call", async () => {
    const pipeline = new DecisionPipeline();
    const { publicClient } = makeFakePublicClient();
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    assert.ok(events.some((e) => e.code === "HEARTBEAT" && e.severity === "info"));
  });

  it("alerts CONFIRMED_DECISION_STUCK for a confirmed entry older than the execution timeout", async () => {
    const pipeline = new DecisionPipeline();
    const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
    pipeline.confirm(entry.decisionId, "ops@team");
    // Force confirmedAt far in the past.
    pipeline.getEntry(entry.decisionId)!.queued.confirmedAt = new Date(Date.now() - 999 * 60 * 60 * 1000).toISOString();

    const { publicClient } = makeFakePublicClient();
    const { walletClient } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({ pipeline, publicClient, walletClient, events });

    await service.runOnce();

    assert.ok(events.some((e) => e.code === "CONFIRMED_DECISION_STUCK" && e.severity === "warning"));
  });
});
