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
import { hasIndependentReferencePrice } from "../core/tools/getMarketData.js";

const BPS_DENOMINATOR = 10_000n;
const FIXED_POINT_DECIMALS = INTERNAL_FIXED_POINT_DECIMALS;

// Far above any real cap this project configures today (highest is
// scripts/paperVaultConfig.ts's 4500bps), yet far below the magnitude a
// real unit-mismatch bug already produced (1,385,721,371bps). See the
// IMPLAUSIBLE_ALLOCATION_MAGNITUDE check below for why this exists
// alongside, not instead of, MAX_ALLOCATION_EXCEEDED.
const IMPLAUSIBLE_ALLOCATION_BPS_THRESHOLD = 50_000;

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
  /// @notice Opt-in, defaults to false/undefined (v1-v4's real, unchanged
  /// behavior). NOT a PolicyLimits field: PolicyLimits exists specifically
  /// to mirror REAL, chain-readable VaultPolicy immutables, and whether a
  /// given vault's REBALANCE is exempt from MAX_DRAWDOWN_EXCEEDED is not
  /// readable from chain at all (contracts/VaultPolicy.sol's own exemption
  /// is a hardcoded logic branch baked into whichever bytecode a vault was
  /// deployed with, not a stored value with a getter). Since this module is
  /// shared LIVE across every vault version (unlike VaultPolicy.sol, where
  /// each version's bytecode is independently frozen at its own deploy
  /// time), a caller must say so explicitly per vault -- passing this as
  /// `true` for v5 and leaving it unset for v1-v4 is what keeps this
  /// offchain pre-check from silently drifting ahead of v1-v4's real,
  /// already-deployed onchain gate (which still enforces the OLD,
  /// unconditional check unconditionally, exactly as deployed).
  rebalanceExemptFromMaxDrawdown?: boolean;
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

export interface ProjectedHolding {
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
/// @notice Exported (only reason this isn't still module-private): reused
/// by scripts/paperVaultCycle.ts to advance the Paper Vault's own
/// simulated holdings after a decision that passes the pre-check, so that
/// state's evolution logic is never duplicated. This function's own
/// behavior/contract is unchanged, only its visibility.
export function projectHoldings(
  decision: VaultDecision,
  vaultState: VaultState,
  assets: KnownAsset[],
  marketData: MarketData,
): { holdings: ProjectedHolding[]; totalUSDC: bigint } {
  // vaultState's USDC-denominated fields are human-readable decimal strings
  // (e.g. "9000.00"), matching what actually reaches the AI agent's prompt via
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
  const { decision, vaultState, policyLimits, marketData, assets, rebalanceExemptFromMaxDrawdown } = params;
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

  // LP_*/BRIDGE_* actions are not modeled by projectHoldings (it assumes a
  // simple swap into/out of a registered fungible asset, not a position
  // bucket whose composition depends on a chosen tick range or a
  // cross-chain lending position). Rather than force an under-tested
  // projection model into this advisory-only pre-check, the current
  // (unprojected) holdings are used for the allocation/stable-bps checks
  // below for these actions, same "not modeled, no live consequence yet"
  // honesty already applied to ENTER/EXIT's own multi-asset-funding gap
  // (see projectHoldings's own doc comment). The LP-position-health and
  // lending-position-health loops further below run regardless of action,
  // mirroring VaultPolicy.sol's own unconditional currentLpPositions/
  // currentLendingPositions loops.
  const isLpAction = decision.action === "LP_OPEN" || decision.action === "LP_INCREASE" || decision.action === "LP_DECREASE" || decision.action === "LP_COLLECT" || decision.action === "LP_CLOSE";
  const isBridgeAction = decision.action === "BRIDGE_DEPOSIT" || decision.action === "BRIDGE_WITHDRAW";
  const { holdings: projectedHoldings, totalUSDC: projectedTotalUSDC } =
    isLpAction || isBridgeAction
      ? { holdings: vaultState.holdings.map((h) => ({ asset: h.asset, valueUSDC: parseRawAmount(h.valueUSDC, FIXED_POINT_DECIMALS) })), totalUSDC: parseRawAmount(vaultState.totalAssetsUSDC, FIXED_POINT_DECIMALS) }
      : projectHoldings(decision, vaultState, assets, marketData);

  if (decision.action === "LP_OPEN") {
    if (decision.tickLower === undefined || decision.tickUpper === undefined) {
      throw new Error("LP_OPEN decision is missing tickLower/tickUpper, cannot check range width.");
    }
    const width = decision.tickUpper - decision.tickLower;
    if (width < policyLimits.minLpTickRangeWidth) {
      violations.push(
        violation(
          "LP_RANGE_TOO_NARROW",
          `Proposed tick range width ${width} is below minLpTickRangeWidth (${policyLimits.minLpTickRangeWidth}), too narrow, maximizes manipulation/impermanent-loss exposure for minimal capital.`,
        ),
      );
    }
  }

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
    // Defense in depth, independent of systemPrompt.ts's own guidance on
    // ENTER/EXIT amount units (see that file): a real bug already produced
    // a projected allocation in the hundreds of millions of bps (an ENTER
    // amount meant as "20% of NAV" written as a literal asset-unit count
    // for an asset priced in the tens of thousands of dollars). That is
    // categorically different from a merely over-cap trade, MAX_ALLOCATION_EXCEEDED's
    // own message ("Xbps exceeds Ybps") reads the same for both and does
    // not make the likely root cause obvious. IMPLAUSIBLE_ALLOCATION_BPS_THRESHOLD
    // is set far above any real cap this project configures (highest
    // today is 4500bps, see scripts/paperVaultConfig.ts) specifically so
    // this only ever fires for a magnitude no legitimate single-asset
    // allocation could ever reach, never a false positive on a real,
    // deliberately large but sane trade.
    if (allocationBps > IMPLAUSIBLE_ALLOCATION_BPS_THRESHOLD) {
      violations.push(
        violation(
          "IMPLAUSIBLE_ALLOCATION_MAGNITUDE",
          `${holding.asset} amount appears out of reasonable range, possible unit mismatch: projected allocation ${allocationBps}bps is far beyond any plausible single-asset allocation (over ${IMPLAUSIBLE_ALLOCATION_BPS_THRESHOLD}bps). This usually means the decision's amount field was expressed in the wrong units (e.g. a target percentage or USD value written as if it were the target asset's own unit count), not a deliberately large trade. See systemPrompt.ts's guidance on ENTER/EXIT amount units.`,
        ),
      );
    }
    if (policyLimits.isStableAsset[holding.asset]) {
      stableBps += allocationBps;
    }

    // Mirrors executor/keeperService.ts's/keeperServiceV4.ts's own
    // requireIndependentReferencePriceToBuy exactly, just earlier: a net
    // increase (buy) in an asset with no genuinely independent reference
    // price would be refused at the keeper's execution step regardless,
    // so surface it here instead, at ops-review time, rather than let a
    // decision reach "confirmed" only to fail with a late, confusing
    // EXECUTION_FAILED alert. Naturally only ever fires for ENTER (always
    // a buy of decision.asset) and REBALANCE (per-asset, only when this
    // asset's target weight exceeds its current one) -- HOLD/EXIT/LP_*/
    // BRIDGE_* never produce a net increase here, see projectHoldings's
    // and this function's own doc comments on how each action projects.
    // Selling (reducing this asset's weight) is never affected, same
    // asymmetry the keeper's own check applies.
    const currentHoldingEntry = vaultState.holdings.find((h) => h.asset === holding.asset);
    const currentValueUSDC = currentHoldingEntry ? parseRawAmount(currentHoldingEntry.valueUSDC, FIXED_POINT_DECIMALS) : 0n;
    if (holding.valueUSDC > currentValueUSDC && !hasIndependentReferencePrice(holding.asset)) {
      violations.push(
        violation(
          "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY",
          `${holding.asset} allocation would increase (a net buy), but no genuinely independent reference price source exists for it yet, so real execution would be refused at the keeper's own execution step (see executor/keeperService.ts's requireIndependentReferencePriceToBuy and agent/core/tools/getMarketData.ts's hasIndependentReferencePrice). Reducing this asset's allocation remains fine; only a net increase is blocked until this is fixed.`,
        ),
      );
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
  //
  // REBALANCE is exempt from this check ONLY when the caller explicitly
  // passes rebalanceExemptFromMaxDrawdown: true (v5's real caller does this;
  // v1-v4's callers never pass it, so their behavior here is byte-for-byte
  // unchanged). Mirrors contracts/VaultPolicy.sol's own onchain exemption
  // for the same action, itself only compiled into v5+ bytecode -- see that
  // file's own comment on the reasoning (a REBALANCE's resulting allocation
  // stays fully bounded by maxAllocationBpsPerAsset/minStableAllocationBps
  // regardless of this check, so exempting it here cannot let REBALANCE push
  // the vault past those separate, still-enforced caps).
  const rebalanceExempt = decision.action === "REBALANCE" && rebalanceExemptFromMaxDrawdown === true;
  if (!rebalanceExempt && vaultState.currentDrawdownBps > policyLimits.maxDrawdownBps) {
    violations.push(
      violation(
        "MAX_DRAWDOWN_EXCEEDED",
        `currentDrawdownBps (${vaultState.currentDrawdownBps}) exceeds maxDrawdownBps (${policyLimits.maxDrawdownBps}).`,
      ),
    );
  }

  // v3 only: vaultState.lpPositions is always empty for v1/v2, so this is
  // a no-op loop for them. Mirrors VaultPolicy.sol's own currentLpPositions
  // loop exactly, including the exemption fixed there 2026-07-14: a
  // breached position blocks everything except LP_DECREASE/LP_COLLECT/
  // LP_CLOSE targeting that exact position's own tokenId (via
  // decision.lpTokenId), or EMERGENCY_EXIT_TO_STABLE (already bypassed
  // above). Before that fix, this offchain loop had no such exemption
  // either, which would have silently diverged from the onchain fix (this
  // pre-check rejecting a decision the real contract would now accept),
  // breaking the "offchain pre-check must never diverge from onchain" rule.
  const isReduceOrCloseAction = decision.action === "LP_DECREASE" || decision.action === "LP_COLLECT" || decision.action === "LP_CLOSE";
  let lpBps = 0;
  for (const position of vaultState.lpPositions) {
    const currentValueUSDC = parseRawAmount(position.valueUSDC, FIXED_POINT_DECIMALS);
    const openValueUSDC = parseRawAmount(position.openValueUSDC, FIXED_POINT_DECIMALS);
    lpBps += bpsOf(currentValueUSDC, projectedTotalUSDC);

    const isTargetOfReduceOrClose = isReduceOrCloseAction && decision.lpTokenId === position.tokenId;
    if (isTargetOfReduceOrClose) continue;

    if (openValueUSDC > 0n) {
      const floor = (openValueUSDC * BigInt(10_000 - policyLimits.maxLpPositionValueLossBps)) / BPS_DENOMINATOR;
      if (currentValueUSDC < floor) {
        violations.push(
          violation(
            "LP_POSITION_VALUE_LOSS_EXCEEDED",
            `Position ${position.tokenId} (pool ${position.pool}) current value ${position.valueUSDC} USDC has fallen more than maxLpPositionValueLossBps (${policyLimits.maxLpPositionValueLossBps}bps) below its open value ${position.openValueUSDC} USDC.`,
          ),
        );
      }
    }

    if (!position.inRange && position.outOfRangeSince) {
      const outOfRangeSeconds = (now.getTime() - new Date(position.outOfRangeSince).getTime()) / 1000;
      if (outOfRangeSeconds > policyLimits.maxLpOutOfRangeSeconds) {
        violations.push(
          violation(
            "LP_OUT_OF_RANGE_TOO_LONG",
            `Position ${position.tokenId} (pool ${position.pool}) has been out of its price range for ${outOfRangeSeconds.toFixed(0)}s, exceeding maxLpOutOfRangeSeconds (${policyLimits.maxLpOutOfRangeSeconds}).`,
          ),
        );
      }
    }

    const poolLiquidityAtOpen = BigInt(position.poolLiquidityAtOpen);
    if (poolLiquidityAtOpen > 0n) {
      const currentPoolLiquidity = BigInt(position.currentPoolLiquidity);
      const ratioBps = Number((currentPoolLiquidity * BPS_DENOMINATOR) / poolLiquidityAtOpen);
      if (ratioBps < policyLimits.minLpPoolLiquidityRatioBps) {
        violations.push(
          violation(
            "LP_POOL_LIQUIDITY_DROPPED",
            `Position ${position.tokenId} (pool ${position.pool}) pool liquidity has dropped to ${ratioBps}bps of its value at open, below minLpPoolLiquidityRatioBps (${policyLimits.minLpPoolLiquidityRatioBps}bps).`,
          ),
        );
      }
    }
  }
  if (lpBps > policyLimits.maxLpAllocationBps) {
    violations.push(
      violation(
        "LP_MAX_ALLOCATION_EXCEEDED",
        `Total LP position value ${lpBps}bps of NAV exceeds maxLpAllocationBps (${policyLimits.maxLpAllocationBps}bps).`,
      ),
    );
  }

  // v4 only: vaultState.currentLendingPositions is always empty for
  // v1/v2/v3, so this is a no-op loop for them. Mirrors
  // VaultPolicy.sol's own currentLendingPositions loop exactly, including
  // its two exemptions: a position already WITHDRAWAL_PENDING/
  // IN_TRANSIT_BACK is already being unwound and is skipped
  // unconditionally (unlike the LP loop, there is only one narrowing
  // action here, BRIDGE_WITHDRAW, and a position already mid-unwind can
  // never be the target of a new one); a position that IS the target of
  // this exact BRIDGE_WITHDRAW (matched by decision.bridgePositionId,
  // this module's own name for onchain's lendingPositionId, see
  // shared/decision.ts) is exempt from the staleness check so the one
  // action that could actually resolve a stale position is never blocked
  // by the very staleness it would resolve.
  let lendingBps = 0;
  for (const position of vaultState.currentLendingPositions) {
    lendingBps += position.currentAllocationBps;

    const alreadyUnwinding = position.status === "WITHDRAWAL_PENDING" || position.status === "IN_TRANSIT_BACK";
    if (alreadyUnwinding) continue;

    const isTargetOfWithdraw = decision.action === "BRIDGE_WITHDRAW" && position.positionId === decision.bridgePositionId;
    if (isTargetOfWithdraw) continue;

    const awaitingConfirmation = position.status === "OPEN" || position.status === "IN_TRANSIT_OUT";
    if (awaitingConfirmation) {
      const secondsSinceReport = (now.getTime() - new Date(position.lastReportedAt).getTime()) / 1000;
      if (secondsSinceReport > policyLimits.lendingPositionForceUnwindSeconds) {
        violations.push(
          violation(
            "LENDING_POSITION_STALE",
            `Lending position ${position.positionId} (chain ${position.chainId}) has not been reported in ${secondsSinceReport.toFixed(0)}s, exceeding lendingPositionForceUnwindSeconds (${policyLimits.lendingPositionForceUnwindSeconds}).`,
          ),
        );
      }
    }
  }
  if (lendingBps > policyLimits.maxLendingAllocationBps) {
    violations.push(
      violation(
        "LENDING_MAX_ALLOCATION_EXCEEDED",
        `Total lending position value ${lendingBps}bps of NAV exceeds maxLendingAllocationBps (${policyLimits.maxLendingAllocationBps}bps).`,
      ),
    );
  }

  return { passed: violations.length === 0, violations, checkedAt, source: "offchain-precheck" };
}
