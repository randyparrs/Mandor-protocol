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
}

export type PolicyViolationCode =
  | "MAX_ALLOCATION_EXCEEDED"
  | "MAX_DRAWDOWN_EXCEEDED"
  | "MAX_TRADES_PER_DAY_EXCEEDED"
  | "MIN_STABLE_ALLOCATION_VIOLATED"
  | "ORACLE_STALE"
  | "ORACLE_DEVIATION_EXCEEDED"
  | "VAULT_PAUSED";

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
