// Fast, advisory re-implementation of VaultPolicy.sol's validateDecision, in
// TypeScript. Mirrors contracts/VaultPolicy.sol lines 136-187 check for
// check. Never authoritative, see this module's README and
// shared/policyTypes.ts's PolicyCheckResult.source: only MandateVault's own
// call into the real VaultPolicy contract can ever allow execution.
//
// A pure function, deliberately: no PublicClient, no RPC call, so it can run
// before ever touching the chain (the whole point of a "fast" pre-check) and
// be unit tested without a live vault. Callers that already have a
// PublicClient build its PolicyLimits input via
// agent/core/context.ts's buildPolicyLimitsStruct.
import type { AssetSymbol, VaultDecision } from "../../shared/decision.js";
import type { PolicyCheckResult, PolicyLimits, PolicyViolation, PolicyViolationCode } from "../../shared/policyTypes.js";
import type { KnownAsset } from "../core/tools/getVaultState.js";
import type { MarketData, VaultState } from "../core/types.js";
import { parseRawAmount, INTERNAL_FIXED_POINT_DECIMALS } from "../../shared/money.js";

const BPS_DENOMINATOR = 10_000n;
const FIXED_POINT_DECIMALS = INTERNAL_FIXED_POINT_DECIMALS;

export interface OffchainPolicyCheckParams {
  decision: VaultDecision;
  vaultState: VaultState;
  policyLimits: PolicyLimits;
  marketData: MarketData;
  /// The vault's full known-asset set (same list threaded through
  /// getVaultState/buildProposeDecisionInput), needed to identify the base
  /// asset for ENTER/EXIT projection and to know every asset's symbol, see
  /// "Projection model" below.
  assets: KnownAsset[];
  now?: Date; // injectable for tests, defaults to real time
}

function violation(code: PolicyViolationCode, detail: string): PolicyViolation {
  return { code, detail };
}

function bpsOf(value: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((value * BPS_DENOMINATOR) / total);
}

/// @notice Finds a real, verified price for `asset` to value a projected
/// ENTER/EXIT delta in USDC. Never fabricates one: the base asset is valued
/// 1:1 with itself (same rule getVaultState.ts already applies), every
/// other asset must have a live entry in marketData.prices, matching the
/// exact "throw rather than guess" discipline getMarketData.ts follows for
/// the same reason.
function resolvePriceUSDC(asset: AssetSymbol, assets: KnownAsset[], marketData: MarketData): bigint {
  const known = assets.find((a) => a.symbol === asset);
  if (known?.isBaseAsset) {
    return parseRawAmount("1", FIXED_POINT_DECIMALS);
  }
  const priced = marketData.prices.find((p) => p.asset === asset);
  if (!priced) {
    throw new Error(
      `Cannot project an allocation change for ${asset}: no market price available (not the base asset, not in marketData.prices). Refusing to fabricate one, same rule getMarketData.ts follows.`,
    );
  }
  return parseRawAmount(priced.priceUSDC, FIXED_POINT_DECIMALS);
}

interface ProjectedHolding {
  asset: AssetSymbol;
  valueUSDC: bigint;
}

/// @notice Projects post-decision holdings, mirroring the caller-supplied
/// "AS IF this decision executes" state VaultPolicy.sol's own
/// validateDecision expects (see that function's doc comment: "state.
/// currentHoldings... represent the vault's projected allocation... this
/// contract only ever validates a resulting state, it never computes trade
/// deltas itself"). That real trade-delta computation is the keeper's job
/// once built (see docs/architecture.md's pipeline diagram, "keeper
/// simulates" runs after this pre-check, not before), this is a best-effort
/// approximation for advisory purposes only:
/// - HOLD: unchanged.
/// - REBALANCE: uses decision.targetAllocations directly, since that is
///   already a full target bps vector, nothing to project.
/// - ENTER/EXIT: assumes total vault NAV is unchanged (a swap into/out of
///   the base asset, not new deposited/withdrawn capital), crediting or
///   debiting the delta against the vault's base asset. A vault with
///   multiple non-base holdings funding an ENTER from more than one asset at
///   once is not modeled; today's live vault is USDC-only (see
///   docs/deployments.md), so this gap has no live consequence yet.
function projectHoldings(
  decision: VaultDecision,
  vaultState: VaultState,
  assets: KnownAsset[],
  marketData: MarketData,
): { holdings: ProjectedHolding[]; totalUSDC: bigint } {
  // vaultState's USDC-denominated fields are human-readable decimal strings
  // (e.g. "9000.00"), matching what actually reaches Claude's prompt via
  // loop.ts, not raw/wei integers, see getVaultState.ts's own note on this.
  const currentByAsset = new Map<AssetSymbol, bigint>(
    vaultState.holdings.map((h) => [h.asset, parseRawAmount(h.valueUSDC, FIXED_POINT_DECIMALS)]),
  );
  const totalUSDC = parseRawAmount(vaultState.totalAssetsUSDC, FIXED_POINT_DECIMALS);

  if (decision.action === "HOLD") {
    return {
      holdings: assets.map((a) => ({ asset: a.symbol, valueUSDC: currentByAsset.get(a.symbol) ?? 0n })),
      totalUSDC,
    };
  }

  if (decision.action === "REBALANCE") {
    if (!decision.targetAllocations || decision.targetAllocations.length === 0) {
      throw new Error("REBALANCE decision is missing targetAllocations, cannot project resulting holdings.");
    }
    const targetBpsByAsset = new Map(decision.targetAllocations.map((t) => [t.asset, BigInt(t.targetWeightBps)]));
    return {
      holdings: assets.map((a) => ({
        asset: a.symbol,
        valueUSDC: ((targetBpsByAsset.get(a.symbol) ?? 0n) * totalUSDC) / BPS_DENOMINATOR,
      })),
      totalUSDC,
    };
  }

  // ENTER or EXIT.
  if (!decision.asset || !decision.amount) {
    throw new Error(`${decision.action} decision is missing asset/amount, cannot project resulting holdings.`);
  }
  const baseAsset = assets.find((a) => a.isBaseAsset);
  if (!baseAsset) {
    throw new Error(`Cannot project ${decision.action}: no asset in the known-asset list is marked isBaseAsset.`);
  }

  const priceUSDC = resolvePriceUSDC(decision.asset, assets, marketData);
  const amount18 = parseRawAmount(decision.amount, FIXED_POINT_DECIMALS);
  const deltaUSDC = (amount18 * priceUSDC) / 10n ** BigInt(FIXED_POINT_DECIMALS);

  const currentTargetValue = currentByAsset.get(decision.asset) ?? 0n;
  const currentBaseValue = currentByAsset.get(baseAsset.symbol) ?? 0n;

  let newTargetValue: bigint;
  let newBaseValue: bigint;
  if (decision.action === "ENTER") {
    newTargetValue = currentTargetValue + deltaUSDC;
    newBaseValue = currentBaseValue - deltaUSDC; // may go negative, see note below
  } else {
    // EXIT: bounded at the existing holding, can't exit more than is held.
    const cappedDelta = deltaUSDC > currentTargetValue ? currentTargetValue : deltaUSDC;
    newTargetValue = currentTargetValue - cappedDelta;
    newBaseValue = currentBaseValue + cappedDelta;
  }
  // A negative projected base value (ENTER funded by more than the base
  // asset actually holds) is left as-is rather than clamped: it is a strong
  // signal the decision is unfundable, and a resulting sub-zero bps well
  // above any configured max/min will make that visible in the returned
  // violations rather than being silently hidden by clamping to zero.

  return {
    holdings: assets.map((a) => {
      if (a.symbol === decision.asset) return { asset: a.symbol, valueUSDC: newTargetValue };
      if (a.symbol === baseAsset.symbol) return { asset: a.symbol, valueUSDC: newBaseValue };
      return { asset: a.symbol, valueUSDC: currentByAsset.get(a.symbol) ?? 0n };
    }),
    totalUSDC, // NAV-neutral swap assumption, see doc comment above
  };
}

/// @notice Mirrors VaultPolicy.sol's validateDecision exactly (same order,
/// same conditions), operating on the same "projected as if executed" state
/// shape that contract expects. See this module's own file-level comment
/// for why it is a pure function and never authoritative.
export function checkPolicyOffchain(params: OffchainPolicyCheckParams): PolicyCheckResult {
  const { decision, vaultState, policyLimits, marketData, assets } = params;
  const checkedAt = (params.now ?? new Date()).toISOString();

  if (decision.action === "EMERGENCY_EXIT_TO_STABLE") {
    // The safety valve: always allowed, exactly matching VaultPolicy.sol's
    // own bypass for this one action.
    return { passed: true, violations: [], checkedAt, source: "offchain-precheck" };
  }

  const violations: PolicyViolation[] = [];

  if (vaultState.paused) {
    violations.push(violation("VAULT_PAUSED", "The vault's policy contract currently reports paused = true."));
  }

  if (decision.action !== "HOLD" && vaultState.tradesToday >= policyLimits.maxTradesPerDay) {
    violations.push(
      violation(
        "MAX_TRADES_PER_DAY_EXCEEDED",
        `tradesToday (${vaultState.tradesToday}) already at or above maxTradesPerDay (${policyLimits.maxTradesPerDay}).`,
      ),
    );
  }

  const now = params.now ?? new Date();
  for (const price of marketData.prices) {
    const updatedAtMs = new Date(price.updatedAt).getTime();
    const staleSeconds = (now.getTime() - updatedAtMs) / 1000;
    if (staleSeconds > policyLimits.oracleMaxStalenessSeconds) {
      violations.push(
        violation(
          "ORACLE_STALE",
          `${price.asset} price was last updated ${staleSeconds.toFixed(0)}s ago, exceeding oracleMaxStalenessSeconds (${policyLimits.oracleMaxStalenessSeconds}).`,
        ),
      );
    }
    const priceNum = Number(price.priceUSDC);
    const referenceNum = Number(price.referencePriceUSDC);
    if (referenceNum > 0) {
      const deviationBps = (Math.abs(priceNum - referenceNum) / referenceNum) * 10_000;
      if (deviationBps > policyLimits.oracleMaxDeviationBps) {
        violations.push(
          violation(
            "ORACLE_DEVIATION_EXCEEDED",
            `${price.asset} deviates ${deviationBps.toFixed(1)}bps from its reference price (${price.priceUSDC} vs ${price.referencePriceUSDC}), exceeding oracleMaxDeviationBps (${policyLimits.oracleMaxDeviationBps}).`,
          ),
        );
      }
    }
  }

  const { holdings: projectedHoldings, totalUSDC: projectedTotalUSDC } = projectHoldings(decision, vaultState, assets, marketData);

  let stableBps = 0;
  for (const holding of projectedHoldings) {
    const allocationBps = bpsOf(holding.valueUSDC, projectedTotalUSDC);
    const maxBps = policyLimits.maxAllocationBpsPerAsset[holding.asset] ?? 0;
    if (allocationBps > maxBps) {
      violations.push(
        violation(
          "MAX_ALLOCATION_EXCEEDED",
          `${holding.asset} projected allocation ${allocationBps}bps exceeds maxAllocationBpsPerAsset (${maxBps}bps).`,
        ),
      );
    }
    if (policyLimits.isStableAsset[holding.asset]) {
      stableBps += allocationBps;
    }
  }
  if (stableBps < policyLimits.minStableAllocationBps) {
    violations.push(
      violation(
        "MIN_STABLE_ALLOCATION_VIOLATED",
        `Projected stable allocation ${stableBps}bps is below minStableAllocationBps (${policyLimits.minStableAllocationBps}bps).`,
      ),
    );
  }

  // Both ENTER/EXIT/REBALANCE are modeled as NAV-neutral swaps (see
  // projectHoldings), so drawdown does not move for any action this module
  // handles, same as VaultPolicy.sol's own currentDrawdownBps input, which
  // only the keeper's real trade simulation (not built yet) could actually
  // change ahead of execution.
  if (vaultState.currentDrawdownBps > policyLimits.maxDrawdownBps) {
    violations.push(
      violation(
        "MAX_DRAWDOWN_EXCEEDED",
        `currentDrawdownBps (${vaultState.currentDrawdownBps}) exceeds maxDrawdownBps (${policyLimits.maxDrawdownBps}).`,
      ),
    );
  }

  return { passed: violations.length === 0, violations, checkedAt, source: "offchain-precheck" };
}
