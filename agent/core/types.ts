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

export interface VaultState {
  vaultId: `0x${string}`;
  totalAssetsUSDC: string;
  holdings: AssetHolding[];
  paused: boolean;
  tradesToday: number;
  highWaterMarkUSDC: string;
  currentDrawdownBps: number;
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
