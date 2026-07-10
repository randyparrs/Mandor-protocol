import type { PublicClient } from "viem";
import { formatRawAmount, scaleToInternalFixedPoint, INTERNAL_FIXED_POINT_DECIMALS } from "../../../shared/money.js";
import type { AssetSymbol, VaultState } from "../types.js";

// Minimal, framework-agnostic ABI fragments, just the read functions this
// tool needs. Not imported from Hardhat's artifact system on purpose:
// agent/core must stay usable outside a Hardhat project (see
// agent/core/README.md, "Must never do"), a real backend service reads
// these same contracts with nothing Hardhat-specific available.
const MANDATE_VAULT_ABI = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ledgerOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentDrawdownBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "tradesToday", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "highWaterMarkUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "assetDecimals", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "lastKnownPriceUSDC", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const VAULT_POLICY_ABI = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export interface KnownAsset {
  symbol: AssetSymbol;
  address: `0x${string}`;
  /// The vault's own base asset (the ERC-4626 asset()), valued 1:1 with
  /// itself rather than through lastKnownPriceUSDC, which is only ever
  /// populated by a real executeDecision call and stays 0 until one happens.
  isBaseAsset?: boolean;
}

/// @notice Reads MandateVault's own real onchain ledger and VaultPolicy's
/// pause state, never a projection or anything the keeper could fabricate,
/// same discipline MandateVault.sol itself follows internally
/// (executeDecision builds VaultState from its own ledger, never trusts a
/// caller-supplied one). USDC-only today (see docs/deployments.md), written
/// to generalize to more registered assets without changes here, the
/// caller's `assets` list is what actually encodes which assets exist for
/// a given vault instance, this tool doesn't hardcode that assumption.
export async function getVaultState(
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
  assets: KnownAsset[],
): Promise<VaultState> {
  const policyAddress = await publicClient.readContract({
    address: vaultAddress,
    abi: MANDATE_VAULT_ABI,
    functionName: "policy",
  });

  const [totalAssetsRaw, currentDrawdownBps, tradesToday, highWaterMarkRaw, paused] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "totalAssets" }),
    publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "currentDrawdownBps" }),
    publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "tradesToday" }),
    publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "highWaterMarkUSDC" }),
    publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_ABI, functionName: "paused" }),
  ]);

  const baseAsset = assets.find((a) => a.isBaseAsset);
  if (!baseAsset) {
    throw new Error("getVaultState requires exactly one asset in `assets` marked isBaseAsset, none was provided.");
  }

  let baseAssetDecimals = 0;
  const holdings = await Promise.all(
    assets.map(async (asset) => {
      const [ledgerAmount, decimals] = await Promise.all([
        publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "ledgerOf", args: [asset.address] }),
        publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "assetDecimals", args: [asset.address] }),
      ]);

      let valueUSDC18: bigint;
      if (asset.isBaseAsset) {
        baseAssetDecimals = decimals;
        // MandateVault.totalAssets() sums every asset's value in the base
        // asset's own native decimals (contracts/MandateVault.sol's
        // totalAssets(): `_ledger[asset()] + _valueInUSDC(...)` for
        // everything else), NOT a fixed 18-decimal representation, confirmed
        // live: a real 5 USDC (6-decimal) seed deposit reads back as
        // totalAssets() == 5_000_000, not 5e18. Rescale to the shared
        // internal fixed point so every asset's value is comparable, format
        // back to a human-readable decimal string before returning, see
        // shared/money.ts for why raw/wei strings must never reach VaultState.
        valueUSDC18 = scaleToInternalFixedPoint(ledgerAmount, decimals);
      } else {
        const priceUSDC = await publicClient.readContract({
          address: vaultAddress,
          abi: MANDATE_VAULT_ABI,
          functionName: "lastKnownPriceUSDC",
          args: [asset.address],
        });
        // 0 until a real executeDecision call has priced this asset at
        // least once, never fabricated here.
        const ledgerIn18 = scaleToInternalFixedPoint(ledgerAmount, decimals);
        valueUSDC18 = (ledgerIn18 * priceUSDC) / 10n ** BigInt(INTERNAL_FIXED_POINT_DECIMALS);
      }

      return {
        asset: asset.symbol,
        // Human-readable decimal strings, matching the convention every
        // other caller of VaultState already assumes (loop.ts JSON.stringifies
        // this straight into Claude's prompt; scripts/testProposeDecision.ts
        // and agent/core/promptInjection.test.ts's fixtures both use plain
        // decimals like "9000.00"). A raw/wei integer string here would
        // silently feed Claude a number many orders of magnitude off from
        // the vault's real size, see shared/money.ts.
        ledgerAmount: formatRawAmount(ledgerAmount, decimals),
        valueUSDC: formatRawAmount(valueUSDC18, INTERNAL_FIXED_POINT_DECIMALS),
      };
    }),
  );

  return {
    vaultId: vaultAddress,
    totalAssetsUSDC: formatRawAmount(scaleToInternalFixedPoint(totalAssetsRaw, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    holdings,
    paused,
    tradesToday: Number(tradesToday),
    highWaterMarkUSDC: formatRawAmount(scaleToInternalFixedPoint(highWaterMarkRaw, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    currentDrawdownBps: currentDrawdownBps,
  };
}
