// The structured decision schema the AI agent must emit. Strict, no free text for
// anything execution-relevant. `reasoning` is the one free-text field and it
// is read only by explainability/timeline code, never by anything with
// execution authority, the actual authority boundary is enforced in
// VaultPolicy.sol, which has no string parameter in its interface at all.

export type AssetSymbol = "USDC" | "EURC" | "USYC" | "cirBTC" | string;

export type DecisionAction =
  | "HOLD"
  | "REBALANCE"
  | "ENTER"
  | "EXIT"
  | "EMERGENCY_EXIT_TO_STABLE"
  // v3 (yield-seeking LP vault) only, mirrors IVaultPolicy.sol's
  // DecisionAction exactly. Kept granular (mirroring
  // UnitFlowV3PositionManager's own real function separation) rather than
  // one consolidated "LP" action, see this project's v3 design doc.
  | "LP_OPEN"
  | "LP_INCREASE"
  | "LP_DECREASE"
  | "LP_COLLECT"
  | "LP_CLOSE"
  // v4 (cross-chain lending vault) only, mirrors IVaultPolicy.sol's
  // DecisionAction exactly. Two separate actions rather than one "BRIDGE"
  // action with a direction flag, same reasoning as LP_OPEN/LP_CLOSE being
  // separate: opening new cross-chain exposure and retrieving an existing
  // position are governed by very different rules (BRIDGE_WITHDRAW, like
  // LP_CLOSE/EXIT, is always allowed regardless of a position's health).
  | "BRIDGE_DEPOSIT"
  | "BRIDGE_WITHDRAW";

export interface TargetAllocation {
  asset: AssetSymbol;
  targetWeightBps: number; // 0-10000, basis points of vault NAV
}

export interface VaultDecision {
  vaultId: `0x${string}`;
  strategyVersion: string;
  modelId: string; // pinned AI model id that produced this decision
  action: DecisionAction;
  asset?: AssetSymbol; // primary asset for ENTER/EXIT
  amount?: string; // human decimal, present for ENTER/EXIT
  targetAllocations?: TargetAllocation[]; // full target weight vector, for REBALANCE
  // For LP_OPEN/LP_INCREASE/LP_DECREASE/LP_COLLECT/LP_CLOSE only, unused
  // otherwise, same "one shape, action-specific fields" convention as the
  // fields above, mirroring IVaultPolicy.sol's Decision struct exactly.
  // lpPool/lpFeeTier identify the real pool (LP_OPEN only); tickLower/
  // tickUpper is the proposed price range (LP_OPEN only, real ticks, not
  // basis points); amount0Desired/amount1Desired are human-decimal
  // amounts of the pool's own token0/token1 (LP_OPEN/LP_INCREASE only);
  // lpTokenId identifies an existing held position (LP_INCREASE/
  // LP_DECREASE/LP_COLLECT/LP_CLOSE only); liquidityFractionBps expresses
  // how much of the position's current liquidity to remove, as basis
  // points (LP_DECREASE only, converted to a real liquidity amount by the
  // keeper at execution time from the position's actual current
  // liquidity, never proposed as a raw liquidity unit the model would
  // have to compute itself).
  lpPool?: `0x${string}`;
  lpFeeTier?: number;
  tickLower?: number;
  tickUpper?: number;
  amount0Desired?: string;
  amount1Desired?: string;
  lpTokenId?: string;
  liquidityFractionBps?: number;
  // For BRIDGE_DEPOSIT/BRIDGE_WITHDRAW only, unused otherwise, mirrors
  // IVaultPolicy.sol's BridgeLeg struct. bridgeChainId is the real EVM
  // chainId of the destination chain (BRIDGE_DEPOSIT only, a new position,
  // e.g. 421614 for Arbitrum Sepolia -- distinct from the CCTP domain,
  // which the keeper derives itself, never agent-proposed). bridgeAmount
  // is a human-decimal amount of the vault's own base asset (BRIDGE_DEPOSIT
  // only). bridgePositionId identifies an existing position to withdraw
  // (BRIDGE_WITHDRAW only). Real CCTP-specific values (maxFee,
  // cctpDestinationDomain) are never agent-proposed, the keeper computes
  // them at execution time from real, current chain state, same "keeper
  // supplies real, current values" convention as SwapLeg.minAmountOut.
  bridgeChainId?: number;
  bridgeAmount?: string;
  bridgePositionId?: string;
  confidence: number; // 0-1
  reasoning: string; // explainability only, zero execution authority
  proposedAt: string; // ISO timestamp
}

// Phase 1 config value, see docs/architecture.md's "Ops confirmation has a
// hard expiration". A proposed decision is only ever relevant to the market
// conditions it was proposed under, so this window is deliberately short,
// not a generic "review at your leisure" timeout.
export const DECISION_CONFIRMATION_TIMEOUT_SECONDS = 15 * 60;

// The ops confirmation queue's wrapper around a proposed decision. A decision
// that sits unconfirmed past expiresAt is auto-discarded by decisionPipeline
// as "expired", it can never be confirmed late and rubber-stamped after
// market conditions have moved on, and it is never auto-retried.
export type DecisionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "rejected"
  | "expired"
  | "executed"
  | "policy_rejected";

export interface QueuedDecision {
  decision: VaultDecision;
  status: DecisionStatus;
  queuedAt: string;
  expiresAt: string; // queuedAt + DECISION_CONFIRMATION_TIMEOUT_SECONDS
  confirmedBy?: string;
  confirmedAt?: string;
}
