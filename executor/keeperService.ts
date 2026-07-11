// The one module in this repo that holds a real signing key
// (KEEPER_PRIVATE_KEY) and submits real transactions calling
// MandateVault.executeDecision. See executor/README.md's "Must never do".
// Never custodies vault assets, even transiently, swaps happen atomically
// inside MandateVault itself, see docs/architecture.md.
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, defineChain, http, type Hex, type PublicClient } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { getVaultState, type KnownAsset } from "../agent/core/tools/getVaultState.js";
import { getMarketData } from "../agent/core/tools/getMarketData.js";
import { proposeDecision } from "../agent/core/loop.js";
import { checkPolicyOffchain } from "../agent/policy/offchainPolicyCheck.js";
import { DecisionPipeline, type DecisionPipelineEntry } from "../server/decisionPipeline.js";
import type { AssetSymbol, VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult, PolicyLimits } from "../shared/policyTypes.js";
import type { MarketData } from "../agent/core/types.js";
import { parseRawAmount } from "../shared/money.js";
import type { Executor, ExecutionResult } from "./types.js";
import { ConsoleAlertSink, makeEvent, type AlertSink } from "../shared/alertSink.js";

const POLICY_GETTER_ABI = [
  { type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Verified live, see docs/arc-facts-to-verify.md and hardhat.config.ts's
// arcTestnet network entry. Defined here directly (not imported from
// Hardhat config) since this module must run outside a Hardhat project,
// same rule agent/core follows.
const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const DECISION_ACTION_INDEX: Record<VaultDecision["action"], number> = {
  HOLD: 0,
  REBALANCE: 1,
  ENTER: 2,
  EXIT: 3,
  EMERGENCY_EXIT_TO_STABLE: 4,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Phase 1 values, not yet governance-adjustable, see executor/README.md.
const HEARTBEAT_INTERVAL_MS = 60_000;
const EXECUTION_STUCK_TIMEOUT_SECONDS = 30 * 60;
const SELF_CONSISTENCY_SAMPLE_COUNT = 3;

const MANDATE_VAULT_KEEPER_ABI = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetDecimals", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "executeDecision",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "decision",
        type: "tuple",
        components: [
          { name: "action", type: "uint8" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          {
            name: "targetAllocations",
            type: "tuple[]",
            components: [
              { name: "asset", type: "address" },
              { name: "targetWeightBps", type: "uint16" },
            ],
          },
        ],
      },
      {
        name: "prices",
        type: "tuple[]",
        components: [
          { name: "asset", type: "address" },
          { name: "price", type: "uint256" },
          { name: "referencePrice", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
        ],
      },
      {
        name: "swaps",
        type: "tuple[]",
        components: [
          { name: "router", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

interface OnchainAssetPrice {
  asset: `0x${string}`;
  price: bigint;
  referencePrice: bigint;
  updatedAt: bigint;
}

interface OnchainSwapLeg {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  sqrtPriceLimitX96: bigint;
}

/// @notice process.env only, never hardcoded, never included in any thrown
/// error's message. Not exported, not cached on any object another module
/// could import, only ever referenced inside this file's own closures, see
/// executor/README.md's "single-purpose module... imported by nothing else."
function loadKeeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) {
    throw new Error("KEEPER_PRIVATE_KEY is not set. Set it in .env, never hardcode it.");
  }
  return privateKeyToAccount(key as Hex);
}

/// @notice Converts a decision's AssetSymbol-keyed fields into the
/// address-keyed Decision struct MandateVault.sol actually expects. asset/
/// amount/targetAllocations are genuinely unused onchain for HOLD and
/// EMERGENCY_EXIT_TO_STABLE (see IVaultPolicy.sol's own "unused otherwise"
/// comments), so this only needs to resolve them correctly for
/// ENTER/EXIT/REBALANCE, which this module does not yet execute (see
/// buildSwapLegs below).
function resolveAssetAddress(symbol: AssetSymbol, assets: KnownAsset[]): `0x${string}` {
  const known = assets.find((a) => a.symbol === symbol);
  if (!known) {
    throw new Error(`Cannot resolve onchain address for asset symbol "${symbol}", it is not in the known-asset list.`);
  }
  return known.address;
}

async function buildOnchainDecision(decision: VaultDecision, assets: KnownAsset[], publicClient: PublicClient, vaultAddress: `0x${string}`) {
  const actionIndex = DECISION_ACTION_INDEX[decision.action];
  if (decision.action === "ENTER" || decision.action === "EXIT") {
    if (!decision.asset || !decision.amount) {
      throw new Error(`${decision.action} decision is missing asset/amount, cannot build onchain calldata.`);
    }
    const asset = resolveAssetAddress(decision.asset, assets);
    // Same live-verified decimals source as buildOnchainPrices below, never
    // trust a hand-carried decimals value for an onchain amount.
    const decimals = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [asset] });
    return {
      action: actionIndex,
      asset,
      amount: parseRawAmount(decision.amount, decimals),
      targetAllocations: [],
    };
  }
  if (decision.action === "REBALANCE") {
    if (!decision.targetAllocations || decision.targetAllocations.length === 0) {
      throw new Error("REBALANCE decision is missing targetAllocations, cannot build onchain calldata.");
    }
    return {
      action: actionIndex,
      asset: ZERO_ADDRESS,
      amount: 0n,
      targetAllocations: decision.targetAllocations.map((t) => ({
        asset: resolveAssetAddress(t.asset, assets),
        targetWeightBps: t.targetWeightBps,
      })),
    };
  }
  // HOLD and EMERGENCY_EXIT_TO_STABLE: asset/amount/targetAllocations are
  // unused onchain, see IVaultPolicy.sol.
  return { action: actionIndex, asset: ZERO_ADDRESS, amount: 0n, targetAllocations: [] };
}

/// @notice Scale confirmed live, not guessed: MandateVault.sol's
/// _valueInUSDC does `(amount * price) / (10 ** assetDecimals[asset])`, so
/// `price` must be scaled to that SAME asset's own decimals, not a fixed
/// 18-decimal figure, or every non-base asset's cached lastKnownPriceUSDC
/// would silently be wrong by a factor of 10^(18-decimals). Reads
/// assetDecimals live for each priced asset rather than trusting the
/// KnownAsset list to carry a correct decimals field.
async function buildOnchainPrices(
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
  marketData: MarketData,
  assets: KnownAsset[],
): Promise<OnchainAssetPrice[]> {
  return Promise.all(
    marketData.prices.map(async (p) => {
      const asset = resolveAssetAddress(p.asset, assets);
      const decimals = await publicClient.readContract({
        address: vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "assetDecimals",
        args: [asset],
      });
      return {
        asset,
        price: parseRawAmount(p.priceUSDC, decimals),
        referencePrice: parseRawAmount(p.referencePriceUSDC, decimals),
        updatedAt: BigInt(Math.floor(new Date(p.updatedAt).getTime() / 1000)),
      };
    }),
  );
}

/// @notice Swap-leg construction (quoting via the real router/Quoter,
/// slippage tolerance) is explicitly out of scope this round, same "no live
/// consequence yet, vault is USDC-only" reasoning already used for
/// agent/policy/offchainPolicyCheck.ts's ENTER/EXIT projection gap. HOLD and
/// EMERGENCY_EXIT_TO_STABLE never need a swap leg on today's single-asset
/// vault (there is nothing else to exit into stable). Throws rather than
/// guess a swap for any action that would actually need one.
function buildSwapLegs(decision: VaultDecision, assets: KnownAsset[]): OnchainSwapLeg[] {
  if (decision.action === "HOLD") return [];
  if (decision.action === "EMERGENCY_EXIT_TO_STABLE") {
    const nonBaseHeld = assets.some((a) => !a.isBaseAsset);
    if (nonBaseHeld) {
      throw new Error(
        "EMERGENCY_EXIT_TO_STABLE would need to swap a non-base asset into the base asset, but swap-leg construction (router quoting, slippage) is not implemented yet. Today's live vault is USDC-only, so this should never be reached in practice.",
      );
    }
    return [];
  }
  throw new Error(
    `${decision.action} requires real swap-leg construction (router quoting, slippage tolerance), not implemented yet. See executor/README.md.`,
  );
}

export interface KeeperServiceConfig {
  publicClient: PublicClient;
  vaultAddress: `0x${string}`;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  strategyVersion: string;
  strategyConfigText: string;
  pipeline: DecisionPipeline;
  alertSink?: AlertSink;
  // Injectable seams, real implementations by default. test/keeperService.ts
  // swaps these for fixtures so nonce sequencing, no-retry behavior, and
  // self-consistency branching can be tested without a real signer, a real
  // Anthropic API call, or a live chain, see agent/core/README.md's own
  // "cost real money, keep separate from the free suite" discipline applied
  // here to the keeper's real dependencies instead.
  keeperAccount?: ReturnType<typeof privateKeyToAccount>;
  walletClient?: ReturnType<typeof createWalletClient>;
  getVaultStateFn?: typeof getVaultState;
  buildPolicyLimitsStructFn?: typeof buildPolicyLimitsStruct;
  getMarketDataFn?: typeof getMarketData;
  buildProposeDecisionInputFn?: typeof buildProposeDecisionInput;
  proposeDecisionFn?: typeof proposeDecision;
}

/// @notice Implements Executor (executor/types.ts) for structural
/// compatibility with the same swappable-implementation seam PaperExecutor
/// uses, docs/architecture.md's "only the injected executor changes."
/// execute() is the narrow, general-purpose entrypoint (no stored
/// marketData to reuse, fetches fresh); processEntry/runOnce/runLoop are
/// this service's own richer, pipeline-aware orchestration, and are what a
/// real deployment actually calls.
export class KeeperService implements Executor {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly walletClient: ReturnType<typeof createWalletClient>;
  private readonly alertSink: AlertSink;
  private readonly getVaultStateFn: typeof getVaultState;
  private readonly buildPolicyLimitsStructFn: typeof buildPolicyLimitsStruct;
  private readonly getMarketDataFn: typeof getMarketData;
  private readonly buildProposeDecisionInputFn: typeof buildProposeDecisionInput;
  private readonly proposeDecisionFn: typeof proposeDecision;

  constructor(private readonly config: KeeperServiceConfig) {
    this.account = config.keeperAccount ?? loadKeeperAccount();
    this.walletClient = config.walletClient ?? createWalletClient({ account: this.account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
    this.alertSink = config.alertSink ?? new ConsoleAlertSink();
    this.getVaultStateFn = config.getVaultStateFn ?? getVaultState;
    this.buildPolicyLimitsStructFn = config.buildPolicyLimitsStructFn ?? buildPolicyLimitsStruct;
    this.getMarketDataFn = config.getMarketDataFn ?? getMarketData;
    this.buildProposeDecisionInputFn = config.buildProposeDecisionInputFn ?? buildProposeDecisionInput;
    this.proposeDecisionFn = config.proposeDecisionFn ?? proposeDecision;
  }

  /// @notice Satisfies the Executor interface exactly (decision +
  /// already-computed policyCheck, mirroring PaperExecutor's signature).
  /// Has no stored marketData to reuse at this call boundary, so it fetches
  /// current state/price fresh; the real pipeline-integrated path
  /// (processEntry, called by runOnce) is what does true price reuse per
  /// point 2, since only it has access to a DecisionPipelineEntry.
  async execute(decision: VaultDecision, policyCheck: PolicyCheckResult): Promise<ExecutionResult & { txHash: `0x${string}` }> {
    void policyCheck;
    const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
    const [vaultState, policyLimits, marketData] = await Promise.all([
      this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
      this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset }))),
    ]);
    const txHash = await this.submitExecution(decision, marketData);
    return { mode: "live", executedAt: new Date().toISOString(), txHash };
  }

  /// @notice The real path: called once per confirmed, not-yet-executed
  /// entry. Reuses entry.marketData unless it is now stale (point 2),
  /// re-verifies against current state, runs the EMERGENCY_EXIT_TO_STABLE
  /// self-consistency gate (point 7) before ever submitting, and never
  /// retries on its own (point 5).
  async processEntry(entry: DecisionPipelineEntry): Promise<void> {
    const decision = entry.queued.decision;
    try {
      const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
      const [vaultState, policyLimits] = await Promise.all([
        this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
        this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      ]);

      // Point 2: reuse the stored price unless it is now stale relative to
      // the vault's own oracleMaxStalenessSeconds, refresh only if needed.
      const marketData = await this.currentOrRefreshedMarketData(entry, policyLimits);

      // Point 3, cheap half: re-verify against current state before ever
      // touching the chain, conditions may have changed since ops confirmed.
      const freshCheck = checkPolicyOffchain({ decision, vaultState, policyLimits, marketData, assets: this.config.assets });
      if (!freshCheck.passed) {
        this.alertSink.send(
          makeEvent("warning", "EXECUTION_ABORTED_PRECHECK", `decisionId ${entry.decisionId}: current state now fails the offchain pre-check: ${freshCheck.violations.map((v) => v.code).join(", ")}.`),
        );
        return;
      }

      // Point 7: EMERGENCY_EXIT_TO_STABLE self-consistency gate, only for
      // this action, per Randy's explicit confirmation this round.
      if (decision.action === "EMERGENCY_EXIT_TO_STABLE") {
        const agrees = await this.checkEmergencyExitSelfConsistency();
        if (!agrees) {
          const flag = {
            code: "SELF_CONSISTENCY_DISAGREEMENT" as const,
            detail: `${SELF_CONSISTENCY_SAMPLE_COUNT} fresh proposals did not unanimously agree with the already-confirmed EMERGENCY_EXIT_TO_STABLE decision.`,
          };
          this.config.pipeline.returnToQueueForReview(entry.decisionId, flag);
          this.alertSink.send(
            makeEvent("critical", "SELF_CONSISTENCY_DISAGREEMENT", `decisionId ${entry.decisionId}: fresh proposals disagreed on EMERGENCY_EXIT_TO_STABLE, returned to ops queue with priority "high", never executed.`),
          );
          return;
        }
      }

      const txHash = await this.submitExecution(decision, marketData);
      this.config.pipeline.markExecuted(entry.decisionId, txHash);
    } catch (error) {
      // Point 5: never retry in a loop. Log, alert, leave the entry
      // "confirmed" (still visible, still stuck), a human decides next.
      this.alertSink.send(
        makeEvent("critical", "EXECUTION_FAILED", `decisionId ${entry.decisionId}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }

  /// @notice Shared core: builds onchain calldata, simulates (revert check),
  /// checks for an abnormal NAV delta post-execution, submits, waits for the
  /// receipt sequentially (point 4), never fires a second submission before
  /// this one's receipt lands.
  private async submitExecution(decision: VaultDecision, marketData: MarketData): Promise<`0x${string}`> {
    const onchainDecision = await buildOnchainDecision(decision, this.config.assets, this.config.publicClient, this.config.vaultAddress);
    const onchainPrices = await buildOnchainPrices(this.config.publicClient, this.config.vaultAddress, marketData, this.config.assets);
    const swaps = buildSwapLegs(decision, this.config.assets);

    // Point 3, real half: simulate before ever submitting.
    await this.config.publicClient.simulateContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps],
      account: this.account,
    });

    const preNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });

    const hash = await this.walletClient.writeContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps],
      chain: ARC_TESTNET,
      account: this.account,
    });
    const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`executeDecision transaction ${hash} reverted onchain.`);
    }

    // Abnormal-delta check, point 3: with zero swap legs (today's only real
    // path, HOLD/EMERGENCY_EXIT_TO_STABLE on a USDC-only vault), NAV must
    // not move at all. Cannot block a transaction that already landed, but
    // this is exactly the "second, application-layer check... for abnormal
    // deltas" docs/architecture.md calls for, real and testable today. A
    // real threshold for swaps.length > 0 (ENTER/EXIT/REBALANCE) is not
    // built yet, that branch is unreachable until buildSwapLegs above
    // actually constructs real legs.
    if (swaps.length === 0) {
      const postNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });
      if (postNAV !== preNAV) {
        this.alertSink.send(
          makeEvent("critical", "ABNORMAL_NAV_DELTA", `${decision.action} executed with zero swap legs but totalAssets moved from ${preNAV} to ${postNAV}, this should never happen.`),
        );
      }
    }

    return hash;
  }

  /// @notice Point 2's refresh path: if any stored price is older than the
  /// vault's own oracleMaxStalenessSeconds (reused, not a new constant),
  /// fetch a fresh one instead of submitting a price the onchain gate would
  /// reject as stale anyway.
  private async currentOrRefreshedMarketData(entry: DecisionPipelineEntry, policyLimits: PolicyLimits): Promise<MarketData> {
    const now = Date.now();
    const isStale = entry.marketData.prices.some((p) => (now - new Date(p.updatedAt).getTime()) / 1000 > policyLimits.oracleMaxStalenessSeconds);
    if (!isStale) return entry.marketData;
    return this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset })));
  }

  /// @notice Standard self-consistency: one fresh input, sampled
  /// SELF_CONSISTENCY_SAMPLE_COUNT times, same methodology
  /// agent/core/promptInjection.test.ts already uses. Requires unanimous
  /// agreement, Randy's explicit call: EMERGENCY_EXIT_TO_STABLE bypasses
  /// every onchain allocation/drawdown check, so a single dissent is enough
  /// to hold off.
  private async checkEmergencyExitSelfConsistency(): Promise<boolean> {
    const input = await this.buildProposeDecisionInputFn({
      publicClient: this.config.publicClient,
      vaultAddress: this.config.vaultAddress,
      strategyVersion: this.config.strategyVersion,
      strategyConfigText: this.config.strategyConfigText,
      assets: this.config.assets,
      stableAssets: this.config.stableAssets,
    });
    const samples = await Promise.all(Array.from({ length: SELF_CONSISTENCY_SAMPLE_COUNT }, () => this.proposeDecisionFn(input)));
    return samples.every((s) => s.decision.action === "EMERGENCY_EXIT_TO_STABLE");
  }

  /// @notice Processes every confirmed-but-unexecuted decision for the
  /// vault, strictly sequentially (point 4, one executeDecision submission
  /// in flight at a time), emits a heartbeat, and alerts on any entry stuck
  /// past EXECUTION_STUCK_TIMEOUT_SECONDS.
  async runOnce(): Promise<void> {
    this.alertSink.send(makeEvent("info", "HEARTBEAT", "keeper loop alive"));

    const confirmed = this.config.pipeline.listConfirmedUnexecuted(this.config.vaultAddress);
    for (const entry of confirmed) {
      const confirmedAgeSeconds = entry.queued.confirmedAt ? (Date.now() - new Date(entry.queued.confirmedAt).getTime()) / 1000 : 0;
      if (confirmedAgeSeconds > EXECUTION_STUCK_TIMEOUT_SECONDS) {
        this.alertSink.send(
          makeEvent("warning", "CONFIRMED_DECISION_STUCK", `decisionId ${entry.decisionId} confirmed ${Math.round(confirmedAgeSeconds)}s ago, still not executed.`),
        );
      }
      // Sequential on purpose: awaited before the next iteration starts,
      // never fired concurrently, see point 4.
      await this.processEntry(entry);
    }
  }

  runLoop(intervalMs: number = HEARTBEAT_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      this.runOnce().catch((error) => {
        this.alertSink.send(makeEvent("critical", "KEEPER_LOOP_ERROR", error instanceof Error ? error.message : String(error)));
      });
    }, intervalMs);
  }
}
