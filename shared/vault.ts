// Off-chain vault metadata and strategy versioning. VaultMetadata mirrors
// what VaultRegistry.sol tracks on-chain (address, roles, strategyAuthor);
// this off-chain copy adds display/marketing fields that are never
// authoritative for fund safety.

export interface StrategyAuthorRef {
  // Kept as a plain identifier, not assumed to always be "the team", see
  // docs/architecture.md for why this stays generic even though Phase 1 only
  // ever populates it with team-authored vaults.
  id: string;
  displayName: string;
}

export interface StrategyVersion {
  vaultId: `0x${string}`;
  version: string; // "v1", "v2", ...
  createdAt: string;
  policyLimitsSnapshot: unknown; // PolicyLimits at the time this version was deployed
  supersedes?: string; // previous version id, if any; history is never overwritten
}

export interface VaultMetadata {
  vaultId: `0x${string}`;
  name: string;
  description: string;
  strategyTemplate: string; // e.g. "Stable Yield", "BTC Momentum"
  strategyAuthor: StrategyAuthorRef;
  currentVersion: string;
  category: "stable" | "bitcoin" | "rwa";
  createdAt: string;
}
