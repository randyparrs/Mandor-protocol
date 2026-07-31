// Real, live vault addresses for the four active versions (v3, v5, v6, v7).
// v4 is discarded, never shown here. Every address below is copied
// verbatim from a real deploy script or docs/deployments.md, never guessed
// (scripts/deployVaultV3.ts, scripts/deployVaultV5.ts,
// scripts/deployLendingPositionRegistryV6.ts's VAULT_V6_ADDRESS, and
// memory's v7 record).
//
// Internal note: this app's own state keys v6's data under "v4" (see
// ShellController.tsx's vaultMeta/rpc/user state shapes, ported unchanged
// from the original design) -- this file's `id` below matches those
// internal keys exactly, `ver` is the real, user-facing version label.
export interface VaultConfig {
  id: 'v3' | 'v4' | 'v5' | 'v7';
  ver: string;
  address: `0x${string}`;
  assetAddress: `0x${string}`;
  assetDecimals: number;
}

export const VAULT_CONFIGS: Record<'v3' | 'v4' | 'v5' | 'v7', VaultConfig> = {
  v3: {
    id: 'v3',
    ver: 'v3',
    address: '0x907C61F958805Ba7b8fAEaCe0aAa5c2a93472718',
    assetAddress: '0x3600000000000000000000000000000000000000', // native USDC ERC-20 interface, 6 decimals
    assetDecimals: 6,
  },
  // Internal key "v4" is really v6 (the real cross-chain lending vault
  // that went live). v4 itself was discarded, never wired here.
  v4: {
    id: 'v4',
    ver: 'v6',
    address: '0x10623f7715e8fD8D3C8F06A2000FbCEeA5002624',
    assetAddress: '0x3600000000000000000000000000000000000000',
    assetDecimals: 6,
  },
  v5: {
    id: 'v5',
    ver: 'v5',
    address: '0x95c42f3eBC5c5A5eEc9d716D9aA84aa5EE729667',
    assetAddress: '0x3600000000000000000000000000000000000000',
    assetDecimals: 6,
  },
  v7: {
    id: 'v7',
    ver: 'v7',
    address: '0x9EF3E5896f2Cec68f8C5D7F61574c77dD2C410e4',
    assetAddress: '0x911b4000D3422F482F4062a913885f7b035382Df', // WUSDC
    assetDecimals: 18,
  },
};
