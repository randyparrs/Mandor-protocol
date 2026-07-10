import type { PublicClient } from "viem";
import type { AssetSymbol } from "./types.js";
import type { PolicyLimits } from "../../shared/policyTypes.js";
import type { ProposeDecisionInput } from "./loop.js";
import { getVaultState, type KnownAsset } from "./tools/getVaultState.js";
import { getMarketData } from "./tools/getMarketData.js";

const MANDATE_VAULT_POLICY_GETTER_ABI = [
  { type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "autoPauseBountyAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const VAULT_POLICY_LIMITS_ABI = [
  { type: "function", name: "maxDrawdownBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxTradesPerDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minStableAllocationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "oracleMaxStalenessSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "oracleMaxDeviationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDrawdownSpeedBpsPerWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "drawdownSpeedWindowSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxAllocationBpsPerAsset", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isStableAsset", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;

/// @notice Built from VaultPolicy's own immutable limits, read live, never
/// hand-copied into a string that could drift from what the contract
/// actually enforces. The onchain gate is authoritative regardless, this
/// text only helps the model avoid proposing something predictably
/// rejected, see systemPrompt.ts.
export async function buildPolicyLimitsText(publicClient: PublicClient, policyAddress: `0x${string}`, assets: KnownAsset[]): Promise<string> {
  const read = <T>(functionName: (typeof VAULT_POLICY_LIMITS_ABI)[number]["name"], args: readonly unknown[] = []) =>
    publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_LIMITS_ABI, functionName, args } as Parameters<typeof publicClient.readContract>[0]) as Promise<T>;

  const [maxDrawdownBps, maxTradesPerDay, minStableAllocationBps, oracleMaxStalenessSeconds, oracleMaxDeviationBps, maxDrawdownSpeedBpsPerWindow, drawdownSpeedWindowSeconds] =
    await Promise.all([
      read<bigint>("maxDrawdownBps"),
      read<bigint>("maxTradesPerDay"),
      read<bigint>("minStableAllocationBps"),
      read<bigint>("oracleMaxStalenessSeconds"),
      read<bigint>("oracleMaxDeviationBps"),
      read<bigint>("maxDrawdownSpeedBpsPerWindow"),
      read<bigint>("drawdownSpeedWindowSeconds"),
    ]);

  const perAsset = await Promise.all(
    assets.map(async (asset) => {
      const [maxBps, isStable] = await Promise.all([
        read<bigint>("maxAllocationBpsPerAsset", [asset.address]),
        read<boolean>("isStableAsset", [asset.address]),
      ]);
      return `${asset.symbol}: maxAllocationBps=${maxBps}, isStable=${isStable}`;
    }),
  );

  return [
    `maxDrawdownBps: ${maxDrawdownBps}`,
    `maxTradesPerDay: ${maxTradesPerDay}`,
    `minStableAllocationBps: ${minStableAllocationBps}`,
    `oracleMaxStalenessSeconds: ${oracleMaxStalenessSeconds}`,
    `oracleMaxDeviationBps: ${oracleMaxDeviationBps}`,
    `maxDrawdownSpeedBpsPerWindow: ${maxDrawdownSpeedBpsPerWindow}`,
    `drawdownSpeedWindowSeconds: ${drawdownSpeedWindowSeconds}`,
    ...perAsset,
  ].join("\n");
}

/// @notice Same immutable limits as buildPolicyLimitsText, but as a
/// structured PolicyLimits object rather than a prompt string, for
/// agent/policy/offchainPolicyCheck.ts, which needs to compute against them,
/// not just show them to the model. autoPauseBountyAmount deliberately reads
/// from MandateVault, not VaultPolicy: VaultPolicy.sol's own comments say it
/// is intentionally not stored there (see that contract's constructor
/// docs), so treating VaultPolicy as its source would be fabricating a
/// value this contract doesn't actually hold.
export async function buildPolicyLimitsStruct(
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
  policyAddress: `0x${string}`,
  assets: KnownAsset[],
): Promise<PolicyLimits> {
  const read = <T>(functionName: (typeof VAULT_POLICY_LIMITS_ABI)[number]["name"], args: readonly unknown[] = []) =>
    publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_LIMITS_ABI, functionName, args } as Parameters<typeof publicClient.readContract>[0]) as Promise<T>;

  const [maxDrawdownBps, maxTradesPerDay, minStableAllocationBps, oracleMaxStalenessSeconds, oracleMaxDeviationBps, maxDrawdownSpeedBpsPerWindow, drawdownSpeedWindowSeconds, autoPauseBountyAmount] =
    await Promise.all([
      read<bigint>("maxDrawdownBps"),
      read<bigint>("maxTradesPerDay"),
      read<bigint>("minStableAllocationBps"),
      read<bigint>("oracleMaxStalenessSeconds"),
      read<bigint>("oracleMaxDeviationBps"),
      read<bigint>("maxDrawdownSpeedBpsPerWindow"),
      read<bigint>("drawdownSpeedWindowSeconds"),
      publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_POLICY_GETTER_ABI, functionName: "autoPauseBountyAmount" }),
    ]);

  const maxAllocationBpsPerAsset: Record<AssetSymbol, number> = {};
  const isStableAsset: Record<AssetSymbol, boolean> = {};
  await Promise.all(
    assets.map(async (asset) => {
      const [maxBps, isStable] = await Promise.all([
        read<bigint>("maxAllocationBpsPerAsset", [asset.address]),
        read<boolean>("isStableAsset", [asset.address]),
      ]);
      maxAllocationBpsPerAsset[asset.symbol] = Number(maxBps);
      isStableAsset[asset.symbol] = isStable;
    }),
  );

  return {
    maxAllocationBpsPerAsset,
    isStableAsset,
    maxDrawdownBps: Number(maxDrawdownBps),
    maxTradesPerDay: Number(maxTradesPerDay),
    minStableAllocationBps: Number(minStableAllocationBps),
    oracleMaxStalenessSeconds: Number(oracleMaxStalenessSeconds),
    oracleMaxDeviationBps: Number(oracleMaxDeviationBps),
    maxDrawdownSpeedBpsPerWindow: Number(maxDrawdownSpeedBpsPerWindow),
    drawdownSpeedWindowSeconds: Number(drawdownSpeedWindowSeconds),
    autoPauseBountyAmount: autoPauseBountyAmount.toString(),
  };
}

export interface BuildProposeDecisionInputParams {
  publicClient: PublicClient;
  vaultAddress: `0x${string}`;
  strategyVersion: string;
  strategyConfigText: string;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  untrustedMarketContext?: string;
}

/// @notice Assembles everything proposeDecision needs from real onchain
/// state plus team-authored config, the only two trusted inputs allowed
/// into a decision, see agent/core/README.md. Never fabricates vault state
/// or prices, both come from the tools/ modules, which read the real
/// deployed contracts or refuse to guess.
export async function buildProposeDecisionInput(params: BuildProposeDecisionInputParams): Promise<ProposeDecisionInput> {
  const policyAddress = await params.publicClient.readContract({
    address: params.vaultAddress,
    abi: MANDATE_VAULT_POLICY_GETTER_ABI,
    functionName: "policy",
  });

  const [vaultState, policyLimitsText, marketData] = await Promise.all([
    getVaultState(params.publicClient, params.vaultAddress, params.assets),
    buildPolicyLimitsText(params.publicClient, policyAddress, params.assets),
    getMarketData(
      params.stableAssets.map((asset) => ({ asset })),
      params.untrustedMarketContext,
    ),
  ]);

  return {
    vaultId: params.vaultAddress,
    strategyVersion: params.strategyVersion,
    strategyConfigText: params.strategyConfigText,
    policyLimitsText,
    vaultState,
    marketData,
  };
}
