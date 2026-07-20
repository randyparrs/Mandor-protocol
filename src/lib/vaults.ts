// Real, live vault addresses, copied verbatim from docs/deployments.md.
// Never guessed, never re-derived: both were confirmed live on Arc Testnet
// earlier this project (see docs/deployments.md's transaction tables).
export interface VaultInfo {
  id: string;
  label: string;
  address: `0x${string}`;
  policyAddress: `0x${string}`;
  assetLabel: string;
  // Plain-language, user-facing disclosures of real, current restrictions
  // on this vault's stated strategy, shown regardless of wallet connection
  // state, never buried in engineering docs only. Empty for vaults with no
  // known restrictions today (v1).
  knownLimitations?: string[];
  // v1/v2 (HOLD/REBALANCE only, no real yield mechanism) are discontinued,
  // superseded by v3 (LP yield)/v4 (cross-chain lending)/v5 (ergodic
  // rebalancing), see legacy/README.md. Undefined/false for active vaults.
  legacy?: boolean;
}

export const BASE_ASSET_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const BASE_ASSET_DECIMALS = 6;

export const VAULTS: VaultInfo[] = [
  {
    id: "v1",
    label: "Mandate USDC Vault (v1)",
    address: "0x9D1b2853722bc69C062D044D74DBeFae430422be",
    policyAddress: "0x5285D175849513b5918aaB5c539b5ED79EEF1A1f",
    assetLabel: "USDC-only",
    legacy: true,
  },
  {
    id: "v2",
    label: "Mandate USDC+cirBTC Vault (v2)",
    address: "0x6a00e9de0b830Fd2Bc37db7C19Ae8b67a0df1862",
    policyAddress: "0x676a1dd7CF88C768559d9A3ECC60F5Fc5319b9d5",
    assetLabel: "USDC + cirBTC",
    legacy: true,
    knownLimitations: [
      "This vault cannot currently execute a real swap into cirBTC at all: no liquidity pool pairing native USDC with cirBTC exists on the real DEX today (Arc Testnet). The mechanism itself works and is verified, there is simply nothing to trade into yet.",
      "Separately, the agent is currently blocked from proposing (and the vault is hard-blocked from executing) any action that would increase cirBTC exposure (ENTER into cirBTC, or a REBALANCE that raises cirBTC's target allocation), because no genuinely independent reference price exists for cirBTC yet. Reducing cirBTC exposure (EXIT, REBALANCE decreasing cirBTC, or an emergency exit to stable) is unaffected.",
      "In practice today, this vault can only hold or reduce cirBTC exposure, never increase it.",
    ],
  },
];
