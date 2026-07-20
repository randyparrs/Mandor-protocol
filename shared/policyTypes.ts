// Mirrors VaultPolicy.sol's validation shape. PolicyCheckResult.source exists
// specifically so callers never mistake an offchain pre-check for the real,
// authoritative onchain gate.

import type { AssetSymbol } from "./decision.js";

export interface PolicyLimits {
  maxAllocationBpsPerAsset: Record<AssetSymbol, number>;
  // Mirrors VaultPolicy.sol's isStableAsset mapping. Needed to replicate the
  // MIN_STABLE_ALLOCATION_VIOLATED check, which sums allocation across every
  // asset flagged stable, not just one.
  isStableAsset: Record<AssetSymbol, boolean>;
  maxDrawdownBps: number;
  maxTradesPerDay: number;
  minStableAllocationBps: number;
  oracleMaxStalenessSeconds: number;
  oracleMaxDeviationBps: number;
  // Guardian auto-pause thresholds, checked by the permissionless
  // checkAndAutoPause path, independent of the human PAUSER role.
  maxDrawdownSpeedBpsPerWindow: number;
  drawdownSpeedWindowSeconds: number;
  // Paid, in the vault's own asset, to whoever's checkAndAutoPause call
  // actually triggers a pause. Keeps the permissionless path real even if
  // the team's own watcher bot is down, same incentive pattern lending
  // protocols use for liquidations. Deliberately capped and tiny relative
  // to the loss a timely pause prevents.
  autoPauseBountyAmount: string;
  // v3 (yield-seeking LP vault) only, mirrors VaultPolicy.sol's own new
  // immutables exactly. Zero-valued for v1/v2 (harmless: they never hold
  // an LP position or propose an LP_* action, so these are simply never
  // evaluated for them).
  minLpTickRangeWidth: number;
  maxLpPositionValueLossBps: number;
  maxLpOutOfRangeSeconds: number;
  minLpPoolLiquidityRatioBps: number;
  maxLpAllocationBps: number;
  // v4 (cross-chain lending vault) only, mirrors VaultPolicy.sol's own new
  // immutables exactly. Zero-valued for v1/v2/v3 (harmless: they never
  // hold a lending position or propose a BRIDGE_* action, so these are
  // simply never evaluated for them).
  lendingReportStaleAfterSeconds: number;
  lendingReportMaxDeviationBps: number;
  lendingPositionForceUnwindSeconds: number;
  maxLendingAllocationBps: number;
}

export type PolicyViolationCode =
  | "MAX_ALLOCATION_EXCEEDED"
  | "MAX_DRAWDOWN_EXCEEDED"
  | "MAX_TRADES_PER_DAY_EXCEEDED"
  | "MIN_STABLE_ALLOCATION_VIOLATED"
  | "ORACLE_STALE"
  | "ORACLE_DEVIATION_EXCEEDED"
  | "VAULT_PAUSED"
  // Offchain-only, no VaultPolicy.sol equivalent (source is always
  // "offchain-precheck" for this one): a projected allocation came out at
  // an implausible order of magnitude (e.g. hundreds of thousands of
  // percent), the signature of a unit-mismatch bug (a decision's `amount`
  // field treated as a percentage or USD value instead of the target
  // asset's own units, see systemPrompt.ts's explicit guidance on this)
  // rather than a deliberately large, merely over-cap trade. Defense in
  // depth: catches this class of bug even if a future prompt change
  // accidentally weakens or removes that guidance, see
  // agent/policy/offchainPolicyCheck.ts's own doc comment on the check.
  | "IMPLAUSIBLE_ALLOCATION_MAGNITUDE"
  // v3 only, mirrors VaultPolicy.sol's own new violation codes exactly
  // (same bytes32 string values), never fires for v1/v2.
  | "LP_POSITION_VALUE_LOSS_EXCEEDED"
  | "LP_OUT_OF_RANGE_TOO_LONG"
  | "LP_POOL_LIQUIDITY_DROPPED"
  | "LP_RANGE_TOO_NARROW"
  | "LP_MAX_ALLOCATION_EXCEEDED"
  // v4 only, mirrors VaultPolicy.sol's own new violation codes exactly
  // (same bytes32 string values), never fires for v1/v2/v3.
  | "LENDING_POSITION_STALE"
  | "LENDING_MAX_ALLOCATION_EXCEEDED"
  // Offchain-only, no VaultPolicy.sol equivalent: refuses to even propose
  // a BRIDGE_DEPOSIT to a chain whose chainKeeper is not yet active
  // (LendingPositionRegistry.chainKeeper(chainId) == address(0)), which
  // the real onchain call would revert on anyway (ChainKeeperNotSet). See
  // executor/keeperServiceV4.ts's requireChainKeeperActive.
  | "CHAIN_KEEPER_NOT_ACTIVE"
  // Offchain-only, no VaultPolicy.sol equivalent: an ENTER, or a REBALANCE
  // whose target weight for some asset exceeds its current weight (a net
  // buy), for an asset with no genuinely independent reference price
  // source (agent/core/tools/getMarketData.ts's hasIndependentReferencePrice,
  // cirBTC today). Real execution would be refused later anyway, at the
  // keeper's own execution step (executor/keeperService.ts's/
  // keeperServiceV4.ts's requireIndependentReferencePriceToBuy) -- this
  // surfaces the same real, already-enforced constraint earlier in the
  // pipeline, at ops-review time, instead of letting a decision reach
  // "confirmed" only to fail with a late, confusing EXECUTION_FAILED
  // alert. Selling (reducing an asset's weight) is never affected.
  | "INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY";

export interface PolicyViolation {
  code: PolicyViolationCode;
  detail: string;
}

export interface PolicyCheckResult {
  passed: boolean;
  violations: PolicyViolation[]; // empty iff passed
  checkedAt: string;
  source: "offchain-precheck" | "onchain"; // never treat offchain as authoritative
}

// The condition VaultPolicy.checkAndAutoPause evaluates. Anyone can call the
// function; whether it actually pauses depends entirely on this check being
// objectively true on-chain, not on who called it.
export type AutoPauseTriggerCode =
  | "ORACLE_DEVIATION_EXCEEDED"
  | "DRAWDOWN_SPEED_EXCEEDED";

export interface AutoPauseCheckResult {
  triggered: boolean;
  code?: AutoPauseTriggerCode;
  detail?: string;
  checkedAt: string;
}

// Required before GOVERNANCE's timelocked oracle feed switch takes effect.
export interface OracleSwitchCheck {
  previousFeedPrice: string;
  newFeedPrice: string;
  deviationBps: number;
  maxAllowedDeviationBps: number;
  passed: boolean;
}
