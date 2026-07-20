import type { VaultDecision, AssetSymbol } from "../../shared/decision.js";

export type { VaultDecision, AssetSymbol };
export type { LLMDecisionOutput } from "./schemas.js";

// Onchain state MandateVault.sol actually holds, read fresh by whatever
// calls proposeDecision (see contracts/MandateVault.sol's ledger-based
// accounting). Never trust the model to know or assert any of this.
export interface AssetHolding {
  asset: AssetSymbol;
  ledgerAmount: string;
  valueUSDC: string;
}

// v3 (yield-seeking LP vault) only, mirrors
// contracts/interfaces/IVaultPolicy.sol's LpPositionHolding exactly,
// populated fresh by getVaultState.ts reading the real position manager/
// pool state, never fabricated or cached, same "read live, only for this
// one deliberate exception" reasoning as MandateVault.sol's own
// _valueLpPositions.
export interface LpPositionHolding {
  tokenId: string;
  pool: `0x${string}`;
  valueUSDC: string;
  openValueUSDC: string;
  inRange: boolean;
  outOfRangeSince: string | null; // ISO timestamp, null if currently in range
  poolLiquidityAtOpen: string;
  currentPoolLiquidity: string;
}

// v4 (cross-chain lending vault) only, mirrors
// contracts/interfaces/IVaultPolicy.sol's LendingPositionHolding exactly,
// populated fresh by getVaultState.ts reading LendingPositionRegistry's own
// currentPositions view directly (never fabricated or cached), same "read
// live, only for this one deliberate exception" reasoning as LpPositionHolding.
export interface LendingPositionHolding {
  positionId: string;
  chainId: string;
  status: "IN_TRANSIT_OUT" | "OPEN" | "WITHDRAWAL_PENDING" | "IN_TRANSIT_BACK";
  currentAllocationBps: number;
  principalUSDC: string;
  currentValueUSDC: string;
  lastReportedAt: string; // ISO timestamp
}

export interface VaultState {
  vaultId: `0x${string}`;
  totalAssetsUSDC: string;
  holdings: AssetHolding[];
  paused: boolean;
  tradesToday: number;
  highWaterMarkUSDC: string;
  currentDrawdownBps: number;
  // Always empty for v1/v2 (no LP positions ever held).
  lpPositions: LpPositionHolding[];
  // Always empty for v1/v2/v3 (no lendingRegistry set, or the vault's real
  // deployed shape predates this field entirely).
  currentLendingPositions: LendingPositionHolding[];
}

// Freeform, potentially untrusted fields (e.g. a news headline) must be
// wrapped before reaching the model, see systemPrompt.ts's
// wrapUntrustedMarketData. Numeric/enum fields are already structurally safe.
export interface AssetPriceInput {
  asset: AssetSymbol;
  priceUSDC: string;
  referencePriceUSDC: string;
  updatedAt: string;
}

export interface MarketData {
  prices: AssetPriceInput[];
  untrustedContext?: string;
}
