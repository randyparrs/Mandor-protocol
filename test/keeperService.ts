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
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as const;
const ASSETS = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];
const ASSETS_V2 = [
  { symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true },
  { symbol: "cirBTC" as const, address: CIRBTC_ADDRESS },
];
const ASSET_DECIMALS_V2: Record<string, number> = { [USDC_ADDRESS.toLowerCase()]: 6, [CIRBTC_ADDRESS.toLowerCase()]: 8 };
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
    lpPositions: [],
    currentLendingPositions: [],
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
    minLpTickRangeWidth: 0,
    maxLpPositionValueLossBps: 0,
    maxLpOutOfRangeSeconds: 0,
    minLpPoolLiquidityRatioBps: 0,
    maxLpAllocationBps: 0,
    lendingReportStaleAfterSeconds: 0,
    lendingReportMaxDeviationBps: 0,
    lendingPositionForceUnwindSeconds: 0,
    maxLendingAllocationBps: 0,
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
  assetDecimalsByAddress?: Record<string, number>;
  quoteAmountOut?: bigint;
  positionManagerAddress?: string;
  // tokenId (string) -> the real INonfungiblePositionManager.positions()
  // tuple, only needed by tests exercising an open LP position (e.g.
  // EMERGENCY_EXIT_TO_STABLE closing one), see closeAllOpenLpPositions.
  positionsByTokenId?: Record<string, readonly [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint]>;
} = {}) {
  const calls: FakeCall[] = [];
  const totalAssetsSequence = opts.totalAssetsSequence ?? [5_000_000n, 5_000_000n];
  let totalAssetsCallIndex = 0;

  const publicClient = {
    async readContract(params: { functionName: string; args?: unknown[] }) {
      calls.push({ functionName: params.functionName, args: params.args });
      if (params.functionName === "policy") return "0xPolicyAddress0000000000000000000000000";
      if (params.functionName === "assetDecimals") {
        const address = (params.args?.[0] as string | undefined)?.toLowerCase();
        return (address && opts.assetDecimalsByAddress?.[address]) ?? 6;
      }
      if (params.functionName === "totalAssets") {
        const value = totalAssetsSequence[Math.min(totalAssetsCallIndex, totalAssetsSequence.length - 1)];
        totalAssetsCallIndex++;
        return value;
      }
      if (params.functionName === "quoteExactInputSingle") {
        return opts.quoteAmountOut ?? 0n;
      }
      if (params.functionName === "positionManager") {
        if (!opts.positionManagerAddress) throw new Error("fake readContract: positionManagerAddress not configured for this test");
        return opts.positionManagerAddress;
      }
      if (params.functionName === "positions") {
        const tokenId = (params.args?.[0] as bigint | undefined)?.toString();
        const position = tokenId && opts.positionsByTokenId?.[tokenId];
        if (!position) throw new Error(`fake readContract: no fixture position for tokenId ${tokenId}`);
        return position;
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
    async writeContract(params: { functionName: string; args?: unknown[] }) {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      calls.push({ functionName: params.functionName, args: params.args });
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
  assets?: typeof ASSETS | typeof ASSETS_V2;
  stableAssets?: string[];
  poolFeeByAssetSymbol?: Record<string, number>;
  vaultStateOverride?: VaultState;
  marketDataOverride?: MarketData;
  policyLimitsOverride?: PolicyLimits;
}) {
  const assets = opts.assets ?? ASSETS;
  const stableAssets = opts.stableAssets ?? ["USDC"];
  const fixedVaultState = opts.vaultStateOverride ?? vaultState();
  const fixedMarketData = opts.marketDataOverride ?? marketData();
  const fixedPolicyLimits = opts.policyLimitsOverride ?? policyLimits();
  return new KeeperService({
    publicClient: opts.publicClient as any,
    walletClient: opts.walletClient as any,
    vaultAddress: VAULT_ADDRESS,
    assets,
    stableAssets,
    poolFeeByAssetSymbol: opts.poolFeeByAssetSymbol,
    strategyVersion: "v1",
    strategyConfigText: "test strategy",
    pipeline: opts.pipeline,
    keeperAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
    alertSink: { send: (event) => opts.events.push(event) },
    getVaultStateFn: async () => fixedVaultState,
    buildPolicyLimitsStructFn: async () => fixedPolicyLimits,
    getMarketDataFn: async () => {
      if (opts.getMarketDataCallCount) opts.getMarketDataCallCount.count++;
      return fixedMarketData;
    },
    buildProposeDecisionInputFn: async () => ({
      vaultId: VAULT_ADDRESS,
      strategyVersion: "v1",
      strategyConfigText: "test strategy",
      policyLimitsText: "",
      vaultState: fixedVaultState,
      marketData: fixedMarketData,
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

  it("EMERGENCY_EXIT_TO_STABLE closes an open LP position first, then sweeps ledger holdings to stable, as two separate transactions", async () => {
    // Regression test for a real bug found 2026-07-14: EMERGENCY_EXIT_TO_STABLE
    // used to only ever sweep simple ledger holdings, silently leaving any
    // open LP position untouched (still exposed to the pool's own
    // manipulable slot0() price). See executor/keeperService.ts's
    // closeAllOpenLpPositions and contracts/MandateVault.sol's
    // _executeLpLeg (now treats EMERGENCY_EXIT_TO_STABLE + a populated leg
    // as an implicit close).
    const POSITION_MANAGER_ADDRESS = "0x0553682bc188b850acd31CBd3500Dcd0aa35372B";
    const pipeline = new DecisionPipeline();
    const vs = vaultState({
      totalAssetsUSDC: "10000",
      holdings: [{ asset: "USDC", ledgerAmount: "8000", valueUSDC: "8000" }, { asset: "cirBTC", ledgerAmount: "0.04", valueUSDC: "2000" }],
      lpPositions: [
        {
          tokenId: "42",
          pool: "0x254bA0424618113127538eE11e42C1e3c1721225",
          valueUSDC: "0",
          openValueUSDC: "0",
          inRange: true,
          outOfRangeSince: null,
          poolLiquidityAtOpen: "0",
          currentPoolLiquidity: "0",
        },
      ],
    });
    const md: MarketData = {
      prices: [
        { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: new Date().toISOString() },
        { asset: "cirBTC", priceUSDC: "50000", referencePriceUSDC: "50000", updatedAt: new Date().toISOString() },
      ],
    };
    const entry = pipeline.enqueue(
      decision({ action: "EMERGENCY_EXIT_TO_STABLE" }),
      { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
      5,
      md,
    );
    pipeline.confirm(entry.decisionId, "ops@team");

    const { publicClient } = makeFakePublicClient({
      assetDecimalsByAddress: ASSET_DECIMALS_V2,
      quoteAmountOut: 25_000_000n,
      positionManagerAddress: POSITION_MANAGER_ADDRESS,
      positionsByTokenId: {
        "42": [0n, ZERO_ADDRESS, USDC_ADDRESS, CIRBTC_ADDRESS, 3000, -1200, 1200, 1_000_000n, 0n, 0n, 0n, 0n],
      },
    });
    const { walletClient, calls: walletCalls } = makeFakeWalletClient();
    const events: AlertEvent[] = [];
    const service = makeService({
      pipeline,
      publicClient,
      walletClient,
      events,
      assets: ASSETS_V2,
      stableAssets: ["USDC"],
      poolFeeByAssetSymbol: { cirBTC: 3000 },
      vaultStateOverride: vs,
      marketDataOverride: md,
      // EMERGENCY_EXIT_TO_STABLE's own self-consistency gate (point 7)
      // samples 3 fresh proposals before ever executing; all 3 must agree.
      proposeDecisionFn: async () => ({
        decision: decision({ action: "EMERGENCY_EXIT_TO_STABLE" }),
        promptHash: "hash",
        thinkingText: null,
        thinkingTokens: null,
        rawOutput: {} as never,
      }),
    });

    await service.runOnce();

    // Two separate onchain calls: the LP close, then the ledger sweep.
    assert.equal(walletCalls.length, 2);

    const [closeCall, sweepCall] = walletCalls;
    const closeSwaps = closeCall.args?.[2] as unknown[];
    const closeLpLeg = closeCall.args?.[3] as { pool: string; tokenId: bigint };
    assert.equal(closeSwaps.length, 0, "the LP-close call must never also carry a ledger sweep, that happens in the second call");
    assert.equal(closeLpLeg.tokenId, 42n);

    const sweepSwaps = sweepCall.args?.[2] as unknown[];
    const sweepLpLeg = sweepCall.args?.[3] as { pool: string; tokenId: bigint };
    assert.equal(sweepLpLeg.pool, ZERO_ADDRESS, "the sweep call carries no LP leg, the position was already closed by the first call");
    assert.equal(sweepSwaps.length, 1, "the sweep call must still convert the simple cirBTC ledger holding to stable");

    assert.ok(events.some((e) => e.code === "EMERGENCY_EXIT_LP_POSITIONS_CLOSED" && e.detail.includes("closed 1 open LP position")));
    assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
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

  describe("real swap-leg construction", () => {
    const usdcOnlyHolding = { asset: "USDC" as const, ledgerAmount: "10000", valueUSDC: "10000" };
    const v2MarketData = (): MarketData => ({
      prices: [
        { asset: "USDC", priceUSDC: "1.00", referencePriceUSDC: "1.00", updatedAt: new Date().toISOString() },
        { asset: "cirBTC", priceUSDC: "50000", referencePriceUSDC: "50000", updatedAt: new Date().toISOString() },
      ],
    });
    const v2PolicyLimits = (): PolicyLimits =>
      policyLimits({ maxAllocationBpsPerAsset: { USDC: 10_000, cirBTC: 2000 }, isStableAsset: { USDC: true, cirBTC: false }, minStableAllocationBps: 8000 });

    it("ENTER: refuses to buy cirBTC (no independent reference price source), leaves the entry confirmed, never calls the chain -- now caught at the offchain pre-check, before ever reaching the keeper's own hard block", async () => {
      const pipeline = new DecisionPipeline();
      const vs = vaultState({ totalAssetsUSDC: "10000", holdings: [usdcOnlyHolding] });
      const md = v2MarketData();
      const entry = pipeline.enqueue(
        decision({ action: "ENTER", asset: "cirBTC", amount: "0.001" }),
        { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
        5,
        md,
      );
      pipeline.confirm(entry.decisionId, "ops@team");

      const { publicClient } = makeFakePublicClient({ assetDecimalsByAddress: ASSET_DECIMALS_V2, quoteAmountOut: 1_000_000n });
      const { walletClient, calls: walletCalls } = makeFakeWalletClient();
      const events: AlertEvent[] = [];
      const service = makeService({
        pipeline,
        publicClient,
        walletClient,
        events,
        assets: ASSETS_V2,
        stableAssets: ["USDC"],
        poolFeeByAssetSymbol: { cirBTC: 3000 },
        policyLimitsOverride: v2PolicyLimits(),
        vaultStateOverride: vs,
        marketDataOverride: md,
      });

      await service.runOnce();

      // Security hard gate (executor/keeperService.ts's
      // requireIndependentReferencePriceToBuy): buying cirBTC is refused
      // before any real transaction is attempted, since its
      // referencePriceUSDC is not independent from priceUSDC (see
      // agent/core/tools/getMarketData.ts's hasIndependentReferencePrice).
      // Real behavior change (an improvement, not a regression): this is
      // now caught earlier, by agent/policy/offchainPolicyCheck.ts's own
      // INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY check, so the keeper's
      // own hard block (still present, still correct as a defense-in-depth
      // backstop) is never even reached.
      assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "confirmed");
      assert.equal(walletCalls.length, 0);
      assert.ok(events.some((e) => e.code === "EXECUTION_ABORTED_PRECHECK" && e.severity === "warning" && e.detail.includes("INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY")));
      assert.ok(!events.some((e) => e.code === "EXECUTION_FAILED"));
    });

    it("EXIT: sizes amountIn directly from decision.amount in the target asset's own units", async () => {
      const pipeline = new DecisionPipeline();
      const vs = vaultState({
        totalAssetsUSDC: "10000",
        holdings: [{ asset: "USDC", ledgerAmount: "8000", valueUSDC: "8000" }, { asset: "cirBTC", ledgerAmount: "0.04", valueUSDC: "2000" }],
      });
      const md = v2MarketData();
      const entry = pipeline.enqueue(
        decision({ action: "EXIT", asset: "cirBTC", amount: "0.0005" }),
        { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
        5,
        md,
      );
      pipeline.confirm(entry.decisionId, "ops@team");

      const { publicClient } = makeFakePublicClient({ assetDecimalsByAddress: ASSET_DECIMALS_V2, quoteAmountOut: 25_000_000n });
      const { walletClient, calls: walletCalls } = makeFakeWalletClient();
      const events: AlertEvent[] = [];
      const service = makeService({
        pipeline,
        publicClient,
        walletClient,
        events,
        assets: ASSETS_V2,
        stableAssets: ["USDC"],
        poolFeeByAssetSymbol: { cirBTC: 3000 },
        policyLimitsOverride: v2PolicyLimits(),
        vaultStateOverride: vs,
        marketDataOverride: md,
      });

      await service.runOnce();

      assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
      const swap = (walletCalls[0].args as unknown[])[2] as Array<Record<string, unknown>>;
      assert.equal((swap[0].tokenIn as string).toLowerCase(), CIRBTC_ADDRESS.toLowerCase());
      assert.equal((swap[0].tokenOut as string).toLowerCase(), USDC_ADDRESS.toLowerCase());
      // 0.0005 cirBTC at 8 decimals.
      assert.equal(swap[0].amountIn, 50_000n);
      assert.equal(swap[0].minAmountOut, (25_000_000n * 9700n) / 10_000n);
    });

    it("REBALANCE: refuses to increase cirBTC's target allocation (no independent reference price source), leaves the entry confirmed -- now caught at the offchain pre-check, before ever reaching the keeper's own hard block", async () => {
      const pipeline = new DecisionPipeline();
      const vs = vaultState({ totalAssetsUSDC: "10000", holdings: [usdcOnlyHolding] });
      const md = v2MarketData();
      const entry = pipeline.enqueue(
        decision({ action: "REBALANCE", targetAllocations: [{ asset: "USDC", targetWeightBps: 9000 }, { asset: "cirBTC", targetWeightBps: 1000 }] }),
        { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
        5,
        md,
      );
      pipeline.confirm(entry.decisionId, "ops@team");

      const { publicClient } = makeFakePublicClient({ assetDecimalsByAddress: ASSET_DECIMALS_V2, quoteAmountOut: 20_000_000n });
      const { walletClient, calls: walletCalls } = makeFakeWalletClient();
      const events: AlertEvent[] = [];
      const service = makeService({
        pipeline,
        publicClient,
        walletClient,
        events,
        assets: ASSETS_V2,
        stableAssets: ["USDC"],
        poolFeeByAssetSymbol: { cirBTC: 3000 },
        policyLimitsOverride: v2PolicyLimits(),
        vaultStateOverride: vs,
        marketDataOverride: md,
      });

      await service.runOnce();

      assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "confirmed");
      assert.equal(walletCalls.length, 0);
      // Real behavior change (an improvement, not a regression): this exact
      // scenario is now caught earlier, by
      // agent/policy/offchainPolicyCheck.ts's own INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY
      // check, at the "fresh pre-check re-verification" step inside
      // processEntry -- so the keeper's own requireIndependentReferencePriceToBuy
      // (still present, still correct as a defense-in-depth backstop) is
      // never even reached, and the alert is now a warning-level
      // EXECUTION_ABORTED_PRECHECK, not a critical-level EXECUTION_FAILED.
      assert.ok(events.some((e) => e.code === "EXECUTION_ABORTED_PRECHECK" && e.severity === "warning" && e.detail.includes("INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY")));
      assert.ok(!events.some((e) => e.code === "EXECUTION_FAILED"));
    });

    it("REBALANCE: still allows decreasing cirBTC's target allocation (selling is never blocked), sizes amountIn correctly", async () => {
      const pipeline = new DecisionPipeline();
      const vs = vaultState({
        totalAssetsUSDC: "10000",
        holdings: [{ asset: "USDC", ledgerAmount: "8000", valueUSDC: "8000" }, { asset: "cirBTC", ledgerAmount: "0.04", valueUSDC: "2000" }],
      });
      const md = v2MarketData();
      const entry = pipeline.enqueue(
        decision({ action: "REBALANCE", targetAllocations: [{ asset: "USDC", targetWeightBps: 9000 }, { asset: "cirBTC", targetWeightBps: 1000 }] }),
        { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
        5,
        md,
      );
      pipeline.confirm(entry.decisionId, "ops@team");

      const { publicClient } = makeFakePublicClient({ assetDecimalsByAddress: ASSET_DECIMALS_V2, quoteAmountOut: 20_000_000n });
      const { walletClient, calls: walletCalls } = makeFakeWalletClient();
      const events: AlertEvent[] = [];
      const service = makeService({
        pipeline,
        publicClient,
        walletClient,
        events,
        assets: ASSETS_V2,
        stableAssets: ["USDC"],
        poolFeeByAssetSymbol: { cirBTC: 3000 },
        policyLimitsOverride: v2PolicyLimits(),
        vaultStateOverride: vs,
        marketDataOverride: md,
      });

      await service.runOnce();

      assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
      const swap = (walletCalls[0].args as unknown[])[2] as Array<Record<string, unknown>>;
      assert.equal(swap.length, 1);
      assert.equal((swap[0].tokenIn as string).toLowerCase(), CIRBTC_ADDRESS.toLowerCase());
      assert.equal((swap[0].tokenOut as string).toLowerCase(), USDC_ADDRESS.toLowerCase());
      // Current cirBTC value 2000 USDC, target 1000 USDC (10% of 10000):
      // sell |1000 - 2000| / 50000 USDC-per-cirBTC = 0.02 cirBTC, at 8 decimals.
      assert.equal(swap[0].amountIn, 2_000_000n);
    });

    it("REBALANCE produces no legs when every target already matches current allocation", async () => {
      const pipeline = new DecisionPipeline();
      const vs = vaultState({ totalAssetsUSDC: "10000", holdings: [usdcOnlyHolding] });
      const md = v2MarketData();
      const entry = pipeline.enqueue(
        decision({ action: "REBALANCE", targetAllocations: [{ asset: "USDC", targetWeightBps: 10_000 }] }),
        { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
        5,
        md,
      );
      pipeline.confirm(entry.decisionId, "ops@team");

      const { publicClient } = makeFakePublicClient({ assetDecimalsByAddress: ASSET_DECIMALS_V2 });
      const { walletClient, calls: walletCalls } = makeFakeWalletClient();
      const events: AlertEvent[] = [];
      const service = makeService({
        pipeline,
        publicClient,
        walletClient,
        events,
        assets: ASSETS_V2,
        stableAssets: ["USDC"],
        poolFeeByAssetSymbol: { cirBTC: 3000 },
        policyLimitsOverride: v2PolicyLimits(),
        vaultStateOverride: vs,
        marketDataOverride: md,
      });

      await service.runOnce();

      assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
      const swap = (walletCalls[0].args as unknown[])[2] as Array<Record<string, unknown>>;
      assert.equal(swap.length, 0);
    });
  });
});
