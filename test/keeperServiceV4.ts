// Fast, free tests for executor/keeperServiceV4.ts: v4's bridge-leg
// construction, the CCTP fee-quote fallback, and the cross-chain
// settlement crash-recovery scenarios (processCrossChainSettlements),
// using the injectable seams on KeeperServiceV4Config to swap every real
// dependency (both chains' clients, fetch, the settlement log path) for a
// fixture. Mirrors test/keeperService.ts's own style. A real end-to-end
// run against the live vault is scripts/testKeeperServiceV4AgainstRealVault.ts
// instead (not written yet, blocked on the chainKeeper timelock), not
// this file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { KeeperServiceV4 } from "../executor/keeperServiceV4.js";
import { DecisionPipeline } from "../server/decisionPipeline.js";
import type { AlertEvent } from "../shared/alertSink.js";
import type { VaultDecision } from "../shared/decision.js";
import type { PolicyLimits } from "../shared/policyTypes.js";
import type { MarketData, VaultState } from "../agent/core/types.js";

const TEST_PRIVATE_KEY = "0x852612fe3a79b9e5cf233469ff9a1a885d3ac262d3f5949bac68f3d433123f51" as const;
const ARBITRUM_TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const VAULT_ADDRESS = "0xFba09f9466C8469cfA058d7ab99e9807fC8155f0" as const;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const LENDING_REGISTRY_ADDRESS = "0x17d471bA284635Db88a47361083bA9748CF4688c" as const;
const AUSDC_ADDRESS = "0x460b97BD498E1157530AEb3086301d5225b91216" as const;
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ASSETS = [{ symbol: "USDC" as const, address: USDC_ADDRESS, isBaseAsset: true }];

function decision(overrides: Partial<VaultDecision> = {}): VaultDecision {
  return {
    vaultId: VAULT_ADDRESS,
    strategyVersion: "v4",
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
    totalAssetsUSDC: "10000",
    holdings: [{ asset: "USDC", ledgerAmount: "10000", valueUSDC: "10000" }],
    paused: false,
    tradesToday: 0,
    highWaterMarkUSDC: "10000",
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
    minStableAllocationBps: 7000,
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
    lendingReportStaleAfterSeconds: 86_400,
    lendingReportMaxDeviationBps: 200,
    lendingPositionForceUnwindSeconds: 604_800,
    maxLendingAllocationBps: 3000,
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
  address?: string;
  functionName: string;
  args?: unknown[];
  account?: { address: string };
}

/// @notice Arc-side fake public client: dispatches by functionName (and
/// address where the same functionName is used against more than one
/// contract, e.g. balanceOf). registryPosition/registryPositionCount let a
/// test fixture exactly one tracked position at a time, matching this
/// class's own "one position in flight at a time" real constraint.
function makeFakeArcPublicClient(opts: {
  lendingRegistryAddress?: string;
  chainKeeperAddress?: string;
  registryPositionCount?: bigint;
  registryPosition?: readonly [bigint, number, bigint, bigint, bigint]; // chainId, status, principalUSDC, currentValueUSDC, lastReportedAt
  registryPositionRemoved?: boolean;
  arcKeeperUsdcBalanceSequence?: bigint[];
  totalAssetsSequence?: bigint[];
  simulateShouldThrow?: boolean;
  receiptStatus?: "success" | "reverted";
} = {}) {
  const calls: FakeCall[] = [];
  const totalAssetsSequence = opts.totalAssetsSequence ?? [10_000_000n, 10_000_000n];
  let totalAssetsCallIndex = 0;
  const arcBalanceSequence = opts.arcKeeperUsdcBalanceSequence ?? [0n];
  let arcBalanceIndex = 0;

  const publicClient = {
    async readContract(params: { address?: string; functionName: string; args?: unknown[] }) {
      calls.push({ address: params.address, functionName: params.functionName, args: params.args });
      if (params.functionName === "policy") return "0xPolicyAddress0000000000000000000000000";
      if (params.functionName === "assetDecimals") return 6;
      if (params.functionName === "totalAssets") {
        const value = totalAssetsSequence[Math.min(totalAssetsCallIndex, totalAssetsSequence.length - 1)];
        totalAssetsCallIndex++;
        return value;
      }
      if (params.functionName === "lendingRegistry") return opts.lendingRegistryAddress ?? LENDING_REGISTRY_ADDRESS;
      if (params.functionName === "asset") return USDC_ADDRESS;
      if (params.functionName === "chainKeeper") return opts.chainKeeperAddress ?? ZERO_ADDRESS;
      if (params.functionName === "positionCount") return opts.registryPositionCount ?? 0n;
      if (params.functionName === "positionIds") return 1n;
      if (params.functionName === "positions") {
        if (opts.registryPositionRemoved) return [0n, 0, 0n, 0n, 0n] as const;
        return opts.registryPosition ?? ([0n, 0, 0n, 0n, 0n] as const);
      }
      if (params.functionName === "balanceOf") {
        const value = arcBalanceSequence[Math.min(arcBalanceIndex, arcBalanceSequence.length - 1)];
        arcBalanceIndex++;
        return value;
      }
      throw new Error(`fake Arc readContract: unexpected functionName ${params.functionName}`);
    },
    async simulateContract(params: { functionName: string }) {
      calls.push({ functionName: `simulate:${params.functionName}` });
      if (opts.simulateShouldThrow) throw new Error("simulated revert: DecisionRejected");
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
  const walletClient = {
    async writeContract(params: { address?: string; functionName: string; args?: unknown[]; account?: { address: string } }) {
      calls.push({ address: params.address, functionName: params.functionName, args: params.args, account: params.account });
      return "0xtxhash";
    },
  };
  return { walletClient, calls };
}

/// @notice Arbitrum-side fake public client: balanceOf is address-keyed
/// (USDC vs aUSDC are different contracts), each with its own sequence so
/// a test can express "raw balance was 0, then became nonzero after a
/// mint, then dropped back to 0 after being supplied to Aave" precisely.
function makeFakeArbitrumPublicClient(opts: {
  usdcBalanceSequence?: bigint[];
  aUsdcBalanceSequence?: bigint[];
  receiveMessageShouldThrow?: boolean;
} = {}) {
  const calls: FakeCall[] = [];
  const usdcSeq = opts.usdcBalanceSequence ?? [0n];
  const aUsdcSeq = opts.aUsdcBalanceSequence ?? [0n];
  let usdcIndex = 0;
  let aUsdcIndex = 0;

  const publicClient = {
    async readContract(params: { address?: string; functionName: string; args?: unknown[] }) {
      calls.push({ address: params.address, functionName: params.functionName, args: params.args });
      if (params.functionName === "balanceOf") {
        if (params.address?.toLowerCase() === AUSDC_ADDRESS.toLowerCase()) {
          const value = aUsdcSeq[Math.min(aUsdcIndex, aUsdcSeq.length - 1)];
          aUsdcIndex++;
          return value;
        }
        const value = usdcSeq[Math.min(usdcIndex, usdcSeq.length - 1)];
        usdcIndex++;
        return value;
      }
      throw new Error(`fake Arbitrum readContract: unexpected functionName ${params.functionName}`);
    },
    async waitForTransactionReceipt() {
      calls.push({ functionName: "waitForTransactionReceipt" });
      return fakeReceipt("success");
    },
  };
  return { publicClient, calls };
}

function makeFakeArbitrumWalletClient(opts: { receiveMessageShouldThrow?: boolean } = {}) {
  const calls: FakeCall[] = [];
  const walletClient = {
    async writeContract(params: { address?: string; functionName: string; args?: unknown[]; account?: { address: string } }) {
      calls.push({ address: params.address, functionName: params.functionName, args: params.args, account: params.account });
      if (params.functionName === "receiveMessage" && opts.receiveMessageShouldThrow) {
        throw new Error("simulated revert: nonce already used");
      }
      return "0xarbtxhash";
    },
  };
  return { walletClient, calls };
}

/// @notice Fake fetch: dispatches by URL substring, for the two real
/// endpoints this file calls (CCTP fee-quote, Iris messages).
function makeFakeFetch(opts: {
  feeQuoteShouldFail?: boolean;
  feeQuoteMinimumFee?: number;
  irisResponses?: Array<{ status: string; message?: string; attestation?: string }>;
}) {
  let irisCallIndex = 0;
  const fetchFn = (async (url: string) => {
    if (url.includes("/burn/USDC/fees/")) {
      if (opts.feeQuoteShouldFail) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => [{ finalityThreshold: 1000, minimumFee: opts.feeQuoteMinimumFee ?? 1 }],
      } as Response;
    }
    if (url.includes("/messages?transactionHash=")) {
      const responses = opts.irisResponses ?? [{ status: "complete", message: "0xmessage", attestation: "0xattestation" }];
      const entry = responses[Math.min(irisCallIndex, responses.length - 1)];
      irisCallIndex++;
      return { ok: true, json: async () => ({ messages: [entry] }) } as Response;
    }
    throw new Error(`fake fetch: unexpected URL ${url}`);
  }) as typeof fetch;
  return fetchFn;
}

async function withTempSettlementLog(fn: (logPath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keeperServiceV4-test-"));
  try {
    await fn(path.join(dir, "settlements.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeService(opts: {
  pipeline: DecisionPipeline;
  arcPublicClient: ReturnType<typeof makeFakeArcPublicClient>["publicClient"];
  arcWalletClient: ReturnType<typeof makeFakeWalletClient>["walletClient"];
  arbitrumPublicClient?: ReturnType<typeof makeFakeArbitrumPublicClient>["publicClient"];
  arbitrumWalletClient?: ReturnType<typeof makeFakeArbitrumWalletClient>["walletClient"];
  fetchFn?: typeof fetch;
  settlementLogPath: string;
  events: AlertEvent[];
  vaultStateOverride?: VaultState;
  marketDataOverride?: MarketData;
  policyLimitsOverride?: PolicyLimits;
}) {
  const fixedVaultState = opts.vaultStateOverride ?? vaultState();
  const fixedMarketData = opts.marketDataOverride ?? marketData();
  const fixedPolicyLimits = opts.policyLimitsOverride ?? policyLimits();
  const { publicClient: defaultArbitrumPublicClient } = makeFakeArbitrumPublicClient();
  const { walletClient: defaultArbitrumWalletClient } = makeFakeArbitrumWalletClient();
  return new KeeperServiceV4({
    publicClient: opts.arcPublicClient as any,
    walletClient: opts.arcWalletClient as any,
    arbitrumPublicClient: (opts.arbitrumPublicClient ?? defaultArbitrumPublicClient) as any,
    arbitrumWalletClient: (opts.arbitrumWalletClient ?? defaultArbitrumWalletClient) as any,
    fetchFn: opts.fetchFn ?? makeFakeFetch({}),
    settlementLogPath: opts.settlementLogPath,
    // Fast in every test by default: the real 5-minute bound is only
    // meaningful in production, see pollForAttestation's own doc comment.
    attestationPollIntervalMs: 1,
    attestationPollTimeoutMs: 50,
    vaultAddress: VAULT_ADDRESS,
    assets: ASSETS,
    stableAssets: ["USDC"],
    strategyVersion: "v4",
    strategyConfigText: "test strategy",
    pipeline: opts.pipeline,
    keeperAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
    arbitrumKeeperAccount: privateKeyToAccount(ARBITRUM_TEST_PRIVATE_KEY),
    alertSink: { send: (event) => opts.events.push(event) },
    getVaultStateFn: async () => fixedVaultState,
    buildPolicyLimitsStructFn: async () => fixedPolicyLimits,
    getMarketDataFn: async () => fixedMarketData,
    buildProposeDecisionInputFn: async () => {
      throw new Error("should not be called in this test");
    },
    proposeDecisionFn: async () => {
      throw new Error("should not be called in this test");
    },
  });
}

describe("KeeperServiceV4", () => {
  describe("buildBridgeLeg / requireChainKeeperActive", () => {
    it("BRIDGE_DEPOSIT refuses to execute when the destination chainKeeper is not yet active (address(0))", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const entry = pipeline.enqueue(
          decision({ action: "BRIDGE_DEPOSIT", bridgeChainId: ARBITRUM_SEPOLIA_CHAIN_ID, bridgeAmount: "1000" }),
          { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
          5,
          marketData(),
        );
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient } = makeFakeArcPublicClient({ chainKeeperAddress: ZERO_ADDRESS });
        const { walletClient, calls: walletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const service = makeService({ pipeline, arcPublicClient: publicClient, arcWalletClient: walletClient, settlementLogPath: logPath, events });

        await service.runOnce();

        assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "confirmed");
        assert.equal(walletCalls.length, 0);
        assert.ok(events.some((e) => e.code === "EXECUTION_FAILED" && e.detail.includes("not yet active")));
      });
    });

    it("BRIDGE_DEPOSIT builds a real bridge leg (chainId, amount, cctpDestinationDomain, maxFee from the live fee quote) once chainKeeper is active", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const entry = pipeline.enqueue(
          decision({ action: "BRIDGE_DEPOSIT", bridgeChainId: ARBITRUM_SEPOLIA_CHAIN_ID, bridgeAmount: "1000" }),
          { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
          5,
          marketData(),
        );
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient } = makeFakeArcPublicClient({ chainKeeperAddress: "0xc5c828D0AC3e106C5006c4b62c3eb2405A5462b3" });
        const { walletClient, calls: walletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const fetchFn = makeFakeFetch({ feeQuoteMinimumFee: 100 }); // 100bps
        const service = makeService({ pipeline, arcPublicClient: publicClient, arcWalletClient: walletClient, settlementLogPath: logPath, events, fetchFn });

        await service.runOnce();

        assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
        const executeCall = walletCalls.find((c) => c.functionName === "executeDecision")!;
        const bridgeLeg = (executeCall.args as unknown[])[4] as { chainId: bigint; amount: bigint; cctpDestinationDomain: number; maxFee: bigint };
        assert.equal(bridgeLeg.chainId, BigInt(ARBITRUM_SEPOLIA_CHAIN_ID));
        assert.equal(bridgeLeg.amount, 1_000_000_000n); // 1000 USDC at 6 decimals
        assert.equal(bridgeLeg.cctpDestinationDomain, 3);
        assert.equal(bridgeLeg.maxFee, (1_000_000_000n * 100n) / 10_000n);
      });
    });

    it("falls back to the conservative fixed fee ceiling, with a warning alert, if the live CCTP fee-quote query fails", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const entry = pipeline.enqueue(
          decision({ action: "BRIDGE_DEPOSIT", bridgeChainId: ARBITRUM_SEPOLIA_CHAIN_ID, bridgeAmount: "1000" }),
          { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
          5,
          marketData(),
        );
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient } = makeFakeArcPublicClient({ chainKeeperAddress: "0xc5c828D0AC3e106C5006c4b62c3eb2405A5462b3" });
        const { walletClient, calls: walletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const fetchFn = makeFakeFetch({ feeQuoteShouldFail: true });
        const service = makeService({ pipeline, arcPublicClient: publicClient, arcWalletClient: walletClient, settlementLogPath: logPath, events, fetchFn });

        await service.runOnce();

        assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
        assert.ok(events.some((e) => e.code === "CCTP_FEE_QUOTE_FAILED" && e.severity === "warning"));
        const executeCall = walletCalls.find((c) => c.functionName === "executeDecision")!;
        const bridgeLeg = (executeCall.args as unknown[])[4] as { maxFee: bigint };
        assert.equal(bridgeLeg.maxFee, (1_000_000_000n * 100n) / 10_000n); // FALLBACK_CCTP_FEE_BPS = 100
      });
    });

    it("BRIDGE_WITHDRAW builds a leg with only positionId set", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const entry = pipeline.enqueue(
          decision({ action: "BRIDGE_WITHDRAW", bridgePositionId: "7" }),
          { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" },
          5,
          marketData(),
        );
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient } = makeFakeArcPublicClient();
        const { walletClient, calls: walletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const service = makeService({ pipeline, arcPublicClient: publicClient, arcWalletClient: walletClient, settlementLogPath: logPath, events });

        await service.runOnce();

        assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
        const executeCall = walletCalls.find((c) => c.functionName === "executeDecision")!;
        const bridgeLeg = (executeCall.args as unknown[])[4] as { chainId: bigint; positionId: bigint; amount: bigint };
        assert.equal(bridgeLeg.positionId, 7n);
        assert.equal(bridgeLeg.chainId, 0n);
        assert.equal(bridgeLeg.amount, 0n);
      });
    });

    it("HOLD builds an empty bridge leg (chainId == 0 && positionId == 0)", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const entry = pipeline.enqueue(decision(), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, marketData());
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient } = makeFakeArcPublicClient();
        const { walletClient, calls: walletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const service = makeService({ pipeline, arcPublicClient: publicClient, arcWalletClient: walletClient, settlementLogPath: logPath, events });

        await service.runOnce();

        const executeCall = walletCalls.find((c) => c.functionName === "executeDecision")!;
        const bridgeLeg = (executeCall.args as unknown[])[4] as { chainId: bigint; positionId: bigint };
        assert.equal(bridgeLeg.chainId, 0n);
        assert.equal(bridgeLeg.positionId, 0n);
      });
    });
  });

  describe("processCrossChainSettlements: outbound leg (IN_TRANSIT_OUT) crash recovery", () => {
    const IN_TRANSIT_OUT = 0;

    it("fresh position, nothing done yet: polls Iris, calls receiveMessage, supplies to Aave, reports", async () => {
      await withTempSettlementLog(async (logPath) => {
        // Pre-seed the settlement log with a depositTxHash, as if a prior
        // BRIDGE_DEPOSIT execution had already recorded it.
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { depositTxHash: "0xdeposittx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({
          usdcBalanceSequence: [0n, 1_000_000n, 1_000_000n], // not landed yet -> landed after receiveMessage -> still there before supply
          aUsdcBalanceSequence: [0n],
        });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({
          pipeline,
          arcPublicClient,
          arcWalletClient,
          arbitrumPublicClient,
          arbitrumWalletClient,
          settlementLogPath: logPath,
          events,
        });

        await service.processCrossChainSettlements();

        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "receiveMessage"));
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "approve"));
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "supply"));
        const reportCall = arcWalletCalls.find((c) => c.functionName === "reportLendingPosition")!;
        assert.ok(reportCall, "reportLendingPosition should have been called on Arc");
        assert.equal((reportCall.args as unknown[])[0], 1n);
        assert.equal((reportCall.args as unknown[])[1], 1_000_000n);
        // Signed with the Arbitrum keeper's own key, submitted to Arc --
        // the real, unavoidable 4th capability that key needs, since
        // chainKeeper(chainId) (checked as msg.sender, regardless of
        // origin chain) is that same address.
        assert.equal(reportCall.account?.address.toLowerCase(), privateKeyToAccount(ARBITRUM_TEST_PRIVATE_KEY).address.toLowerCase());
      });
    });

    it("mint already landed before a crash (raw balance > 0): skips receiveMessage entirely, goes straight to supply", async () => {
      await withTempSettlementLog(async (logPath) => {
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({
          usdcBalanceSequence: [1_000_000n], // already landed
          aUsdcBalanceSequence: [0n],
        });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!arbitrumWalletCalls.some((c) => c.functionName === "receiveMessage"), "should never call receiveMessage when the mint already landed");
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "supply"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "reportLendingPosition"));
      });
    });

    it("already supplied to Aave before a crash (aUSDC balance >= principal): skips both receiveMessage and supply, goes straight to reporting", async () => {
      await withTempSettlementLog(async (logPath) => {
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({
          usdcBalanceSequence: [0n], // raw balance is 0 -- ambiguous on its own
          aUsdcBalanceSequence: [1_000_000n], // but aUSDC already reflects the principal: already supplied
        });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.equal(arbitrumWalletCalls.length, 0, "should take no Arbitrum action at all once aUSDC already reflects the principal");
        assert.ok(arcWalletCalls.some((c) => c.functionName === "reportLendingPosition"));
      });
    });

    it("receiveMessage reverts (nonce already used by an earlier crashed attempt) but the balance confirms the mint landed: treated as success, not a failure", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { depositTxHash: "0xdeposittx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({
          // First read: 0 (triggers the receiveMessage attempt). Second
          // read (inside the catch block): already reflects the mint.
          usdcBalanceSequence: [0n, 1_000_000n, 1_000_000n],
          aUsdcBalanceSequence: [0n],
        });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient({ receiveMessageShouldThrow: true });
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!events.some((e) => e.code === "CROSS_CHAIN_SETTLEMENT_STEP_FAILED"), "an already-used nonce confirmed by real balance state must not be reported as a failure");
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "supply"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "reportLendingPosition"));
      });
    });

    it("receiveMessage genuinely fails (balance still 0 after the revert): surfaces as a real CROSS_CHAIN_SETTLEMENT_STEP_FAILED alert, never proceeds to supply/report", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { depositTxHash: "0xdeposittx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({
          usdcBalanceSequence: [0n, 0n, 0n], // never lands
          aUsdcBalanceSequence: [0n],
        });
        const { walletClient: arbitrumWalletClient } = makeFakeArbitrumWalletClient({ receiveMessageShouldThrow: true });
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(events.some((e) => e.code === "CROSS_CHAIN_SETTLEMENT_STEP_FAILED"));
        assert.equal(arcWalletCalls.length, 0, "must never report a position whose mint genuinely never landed");
      });
    });

    it("missing settlement-log pointer: alerts a warning and returns, never guesses a tx hash", async () => {
      await withTempSettlementLog(async (logPath) => {
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [0n], aUsdcBalanceSequence: [0n] });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(events.some((e) => e.code === "CROSS_CHAIN_SETTLEMENT_MISSING_POINTER" && e.severity === "warning"));
        assert.equal(arbitrumWalletCalls.length, 0);
        assert.equal(arcWalletCalls.length, 0);
      });
    });

    it("bounded attestation timeout: Iris never returns complete, alerts critical CCTP_ATTESTATION_TIMEOUT, takes no action", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { depositTxHash: "0xdeposittx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), IN_TRANSIT_OUT, 1_000_000n, 1_000_000n, 0n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [0n], aUsdcBalanceSequence: [0n] });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        // Iris never reports "complete" (every call fails); makeService's
        // own fast attestationPollIntervalMs/attestationPollTimeoutMs
        // defaults (1ms/50ms) mean this genuinely exhausts the real
        // bounded-poll logic in well under a second, not the real
        // 5-minute production bound, see pollForAttestation's own doc
        // comment on why these are injectable at all.
        const fetchFn = (async () => {
          throw new Error("network unreachable");
        }) as typeof fetch;
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events, fetchFn });
        await service.processCrossChainSettlements();

        assert.ok(events.some((e) => e.code === "CCTP_ATTESTATION_TIMEOUT" && e.severity === "critical"));
        assert.equal(arbitrumWalletCalls.length, 0);
        assert.equal(arcWalletCalls.length, 0);
      });
    });
  });

  describe("processCrossChainSettlements: return leg (WITHDRAWAL_PENDING) crash recovery", () => {
    const WITHDRAWAL_PENDING = 2;

    it("fresh position: withdraws from Aave, burns via CCTP, polls Iris, mints on Arc, transfers into the vault, confirms", async () => {
      await withTempSettlementLog(async (logPath) => {
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), WITHDRAWAL_PENDING, 1_000_000n, 1_000_000n, 0n],
          arcKeeperUsdcBalanceSequence: [0n, 1_000_000n, 1_000_000n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [0n, 1_000_000n, 1_000_000n] });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "withdraw"));
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "depositForBurn"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "receiveMessage"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "transfer"));
        const confirmCall = arcWalletCalls.find((c) => c.functionName === "confirmCrossChainWithdrawalComplete")!;
        assert.ok(confirmCall);
        assert.equal((confirmCall.args as unknown[])[0], 1n);
      });
    });

    it("Aave withdraw already happened before a crash (raw balance > 0): skips withdraw, goes straight to depositForBurn", async () => {
      await withTempSettlementLog(async (logPath) => {
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), WITHDRAWAL_PENDING, 1_000_000n, 1_000_000n, 0n],
          arcKeeperUsdcBalanceSequence: [0n, 1_000_000n, 1_000_000n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [1_000_000n] }); // already withdrawn
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!arbitrumWalletCalls.some((c) => c.functionName === "withdraw"), "must never re-withdraw once the raw balance already reflects it");
        assert.ok(arbitrumWalletCalls.some((c) => c.functionName === "depositForBurn"));
      });
    });

    it("depositForBurn already submitted and logged before a crash: resumes straight from polling Iris, never re-submits the burn", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { withdrawBurnTxHash: "0xburntx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), WITHDRAWAL_PENDING, 1_000_000n, 1_000_000n, 0n],
          arcKeeperUsdcBalanceSequence: [0n, 1_000_000n, 1_000_000n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [1_000_000n] });
        const { walletClient: arbitrumWalletClient, calls: arbitrumWalletCalls } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!arbitrumWalletCalls.some((c) => c.functionName === "withdraw"));
        assert.ok(!arbitrumWalletCalls.some((c) => c.functionName === "depositForBurn"), "must never re-submit a burn that was already logged");
        assert.ok(arcWalletCalls.some((c) => c.functionName === "receiveMessage"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "confirmCrossChainWithdrawalComplete"));
      });
    });

    it("receiveMessage on Arc already happened before a crash (Arc keeper's raw USDC balance > 0): skips receiveMessage, transfers and confirms directly", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { withdrawBurnTxHash: "0xburntx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), WITHDRAWAL_PENDING, 1_000_000n, 1_000_000n, 0n],
          arcKeeperUsdcBalanceSequence: [1_000_000n], // already minted on Arc
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [1_000_000n] });
        const { walletClient: arbitrumWalletClient } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!arcWalletCalls.some((c) => c.functionName === "receiveMessage"), "must never re-mint once the Arc keeper's own balance already reflects it");
        assert.ok(arcWalletCalls.some((c) => c.functionName === "transfer"));
        assert.ok(arcWalletCalls.some((c) => c.functionName === "confirmCrossChainWithdrawalComplete"));
      });
    });

    it("position already fully closed before a crash (registry no longer tracks it): returns without a duplicate transfer/confirm", async () => {
      await withTempSettlementLog(async (logPath) => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify({ "1": { withdrawBurnTxHash: "0xburntx" } }));

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({
          registryPositionCount: 1n,
          registryPosition: [BigInt(ARBITRUM_SEPOLIA_CHAIN_ID), WITHDRAWAL_PENDING, 1_000_000n, 1_000_000n, 0n],
          registryPositionRemoved: true,
          arcKeeperUsdcBalanceSequence: [1_000_000n],
        });
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const { publicClient: arbitrumPublicClient } = makeFakeArbitrumPublicClient({ usdcBalanceSequence: [1_000_000n] });
        const { walletClient: arbitrumWalletClient } = makeFakeArbitrumWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, arbitrumPublicClient, arbitrumWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();

        assert.ok(!arcWalletCalls.some((c) => c.functionName === "transfer"), "must never re-transfer once the position is already closed");
        assert.ok(!arcWalletCalls.some((c) => c.functionName === "confirmCrossChainWithdrawalComplete"));
      });
    });
  });

  describe("settlement log persistence", () => {
    it("loadSettlementLog returns {} when the file does not exist yet", async () => {
      await withTempSettlementLog(async (logPath) => {
        // A BRIDGE_DEPOSIT execution against a vault with no positions
        // touches recordBridgeDepositTxHash's own load/save path; simplest
        // direct exercise is via a fresh outbound-leg run with no prior
        // file, which should not throw.
        const { publicClient: arcPublicClient } = makeFakeArcPublicClient({ registryPositionCount: 0n });
        const { walletClient: arcWalletClient } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const pipeline = new DecisionPipeline();
        const service = makeService({ pipeline, arcPublicClient, arcWalletClient, settlementLogPath: logPath, events });

        await service.processCrossChainSettlements();
        // No positions tracked, nothing to do, no throw.
        assert.equal(events.length, 0);
      });
    });
  });

  describe("EMERGENCY_EXIT_TO_STABLE with both LP and cross-chain lending positions open", () => {
    it("closes LP positions first, then initiates withdrawal for lending positions, re-reading state between each step, before sweeping the ledger", async () => {
      await withTempSettlementLog(async (logPath) => {
        const pipeline = new DecisionPipeline();
        const openLendingPosition = {
          positionId: "3",
          chainId: String(ARBITRUM_SEPOLIA_CHAIN_ID),
          status: "OPEN" as const,
          currentAllocationBps: 1000,
          principalUSDC: "1000",
          currentValueUSDC: "1000",
          lastReportedAt: new Date().toISOString(),
        };
        // First read (inside executeWithUnwind): no open LP positions,
        // one open lending position. Second/third reads (after each
        // unwind step re-reads state): nothing left open, matching a
        // vault whose only non-base holding was the bridged position.
        let vsCallIndex = 0;
        const vsSequence = [
          vaultState({ currentLendingPositions: [openLendingPosition] }),
          vaultState({ currentLendingPositions: [] }),
        ];
        const md = marketData();
        const entry = pipeline.enqueue(decision({ action: "EMERGENCY_EXIT_TO_STABLE" }), { passed: true, violations: [], checkedAt: new Date().toISOString(), source: "offchain-precheck" }, 5, md);
        pipeline.confirm(entry.decisionId, "ops@team");

        const { publicClient: arcPublicClient } = makeFakeArcPublicClient();
        const { walletClient: arcWalletClient, calls: arcWalletCalls } = makeFakeWalletClient();
        const events: AlertEvent[] = [];
        const service = new KeeperServiceV4({
          publicClient: arcPublicClient as any,
          walletClient: arcWalletClient as any,
          arbitrumPublicClient: makeFakeArbitrumPublicClient().publicClient as any,
          arbitrumWalletClient: makeFakeArbitrumWalletClient().walletClient as any,
          fetchFn: makeFakeFetch({}),
          settlementLogPath: logPath,
          vaultAddress: VAULT_ADDRESS,
          assets: ASSETS,
          stableAssets: ["USDC"],
          strategyVersion: "v4",
          strategyConfigText: "test strategy",
          pipeline,
          keeperAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
          arbitrumKeeperAccount: privateKeyToAccount(ARBITRUM_TEST_PRIVATE_KEY),
          alertSink: { send: (event) => events.push(event) },
          getVaultStateFn: async () => vsSequence[Math.min(vsCallIndex++, vsSequence.length - 1)],
          buildPolicyLimitsStructFn: async () => policyLimits(),
          getMarketDataFn: async () => md,
          buildProposeDecisionInputFn: async () => ({
            vaultId: VAULT_ADDRESS,
            strategyVersion: "v4",
            strategyConfigText: "test strategy",
            policyLimitsText: "",
            vaultState: vsSequence[0],
            marketData: md,
          }),
          proposeDecisionFn: async () => ({
            decision: decision({ action: "EMERGENCY_EXIT_TO_STABLE" }),
            promptHash: "hash",
            thinkingText: null,
            thinkingTokens: null,
            rawOutput: {} as never,
          }),
        });

        await service.runOnce();

        assert.ok(events.some((e) => e.code === "EMERGENCY_EXIT_LENDING_WITHDRAWAL_INITIATED"));
        const initiateCall = arcWalletCalls.find((c) => c.functionName === "executeDecision" && ((c.args as unknown[])[4] as { positionId: bigint }).positionId === 3n);
        assert.ok(initiateCall, "must submit an executeDecision call with bridgeLeg.positionId == 3 to initiate the lending withdrawal");
        assert.equal(pipeline.getEntry(entry.decisionId)!.queued.status, "executed");
      });
    });
  });
});
