import type { PublicClient } from "viem";
import type { AssetSymbol, AssetPriceInput } from "./types.js";
import type { PolicyLimits } from "../../shared/policyTypes.js";
import type { ProposeDecisionInput } from "./loop.js";
import { getVaultState, type KnownAsset } from "./tools/getVaultState.js";
import { getMarketData, getVolatileAssetPriceUSDC } from "./tools/getMarketData.js";

// The real, public Arc Testnet RPC rejects a burst of simultaneous
// eth_call requests ("request limit reached"), confirmed live 2026-07-20
// while wiring v5's own scheduled decision cycle: buildPolicyLimitsText/
// buildPolicyLimitsStruct below both read every VaultPolicy limit via a
// single Promise.all, 11-17 requests fired at once depending on version.
// This affects every vault version's real, scheduled decision cycle
// equally (the ABI/field list is shared across v1-v5), not just v5 --
// fixed here by reading sequentially with a small pace between calls,
// same RPC_PACING_MS discipline already used in the deploy/bootstrap
// scripts, rather than adding retry logic to paper over a real
// concurrency limit.
const RPC_PACING_MS = 3000;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // v3 only, zero for v1/v2 (ConstructorLimits was never given real
  // values for these), harmless to always read.
  { type: "function", name: "minLpTickRangeWidth", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "maxLpPositionValueLossBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxLpOutOfRangeSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minLpPoolLiquidityRatioBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxLpAllocationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // v4 only, zero for v1/v2/v3 (ConstructorLimits was never given real
  // values for these), harmless to always read.
  { type: "function", name: "lendingReportStaleAfterSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lendingReportMaxDeviationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lendingPositionForceUnwindSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxLendingAllocationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/// @notice Built from VaultPolicy's own immutable limits, read live, never
/// hand-copied into a string that could drift from what the contract
/// actually enforces. The onchain gate is authoritative regardless, this
/// text only helps the model avoid proposing something predictably
/// rejected, see systemPrompt.ts.
export async function buildPolicyLimitsText(publicClient: PublicClient, policyAddress: `0x${string}`, assets: KnownAsset[]): Promise<string> {
  const read = <T>(functionName: (typeof VAULT_POLICY_LIMITS_ABI)[number]["name"], args: readonly unknown[] = []) =>
    publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_LIMITS_ABI, functionName, args } as Parameters<typeof publicClient.readContract>[0]) as Promise<T>;

  const maxDrawdownBps = await read<bigint>("maxDrawdownBps");
  await sleep(RPC_PACING_MS);
  const maxTradesPerDay = await read<bigint>("maxTradesPerDay");
  await sleep(RPC_PACING_MS);
  const minStableAllocationBps = await read<bigint>("minStableAllocationBps");
  await sleep(RPC_PACING_MS);
  const oracleMaxStalenessSeconds = await read<bigint>("oracleMaxStalenessSeconds");
  await sleep(RPC_PACING_MS);
  const oracleMaxDeviationBps = await read<bigint>("oracleMaxDeviationBps");
  await sleep(RPC_PACING_MS);
  const maxDrawdownSpeedBpsPerWindow = await read<bigint>("maxDrawdownSpeedBpsPerWindow");
  await sleep(RPC_PACING_MS);
  const drawdownSpeedWindowSeconds = await read<bigint>("drawdownSpeedWindowSeconds");
  await sleep(RPC_PACING_MS);
  const lendingReportStaleAfterSeconds = await read<bigint>("lendingReportStaleAfterSeconds");
  await sleep(RPC_PACING_MS);
  const lendingReportMaxDeviationBps = await read<bigint>("lendingReportMaxDeviationBps");
  await sleep(RPC_PACING_MS);
  const lendingPositionForceUnwindSeconds = await read<bigint>("lendingPositionForceUnwindSeconds");
  await sleep(RPC_PACING_MS);
  const maxLendingAllocationBps = await read<bigint>("maxLendingAllocationBps");
  await sleep(RPC_PACING_MS);

  const perAsset: string[] = [];
  for (const asset of assets) {
    const maxBps = await read<bigint>("maxAllocationBpsPerAsset", [asset.address]);
    await sleep(RPC_PACING_MS);
    const isStable = await read<boolean>("isStableAsset", [asset.address]);
    await sleep(RPC_PACING_MS);
    perAsset.push(`${asset.symbol}: maxAllocationBps=${maxBps}, isStable=${isStable}`);
  }

  return [
    `maxDrawdownBps: ${maxDrawdownBps}`,
    `maxTradesPerDay: ${maxTradesPerDay}`,
    `minStableAllocationBps: ${minStableAllocationBps}`,
    `oracleMaxStalenessSeconds: ${oracleMaxStalenessSeconds}`,
    `oracleMaxDeviationBps: ${oracleMaxDeviationBps}`,
    `maxDrawdownSpeedBpsPerWindow: ${maxDrawdownSpeedBpsPerWindow}`,
    `drawdownSpeedWindowSeconds: ${drawdownSpeedWindowSeconds}`,
    `lendingReportStaleAfterSeconds: ${lendingReportStaleAfterSeconds}`,
    `lendingReportMaxDeviationBps: ${lendingReportMaxDeviationBps}`,
    `lendingPositionForceUnwindSeconds: ${lendingPositionForceUnwindSeconds}`,
    `maxLendingAllocationBps: ${maxLendingAllocationBps}`,
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

  const maxDrawdownBps = await read<bigint>("maxDrawdownBps");
  await sleep(RPC_PACING_MS);
  const maxTradesPerDay = await read<bigint>("maxTradesPerDay");
  await sleep(RPC_PACING_MS);
  const minStableAllocationBps = await read<bigint>("minStableAllocationBps");
  await sleep(RPC_PACING_MS);
  const oracleMaxStalenessSeconds = await read<bigint>("oracleMaxStalenessSeconds");
  await sleep(RPC_PACING_MS);
  const oracleMaxDeviationBps = await read<bigint>("oracleMaxDeviationBps");
  await sleep(RPC_PACING_MS);
  const maxDrawdownSpeedBpsPerWindow = await read<bigint>("maxDrawdownSpeedBpsPerWindow");
  await sleep(RPC_PACING_MS);
  const drawdownSpeedWindowSeconds = await read<bigint>("drawdownSpeedWindowSeconds");
  await sleep(RPC_PACING_MS);
  const autoPauseBountyAmount = (await publicClient.readContract({
    address: vaultAddress,
    abi: MANDATE_VAULT_POLICY_GETTER_ABI,
    functionName: "autoPauseBountyAmount",
  })) as bigint;
  await sleep(RPC_PACING_MS);
  const minLpTickRangeWidth = await read<number>("minLpTickRangeWidth");
  await sleep(RPC_PACING_MS);
  const maxLpPositionValueLossBps = await read<bigint>("maxLpPositionValueLossBps");
  await sleep(RPC_PACING_MS);
  const maxLpOutOfRangeSeconds = await read<bigint>("maxLpOutOfRangeSeconds");
  await sleep(RPC_PACING_MS);
  const minLpPoolLiquidityRatioBps = await read<bigint>("minLpPoolLiquidityRatioBps");
  await sleep(RPC_PACING_MS);
  const maxLpAllocationBps = await read<bigint>("maxLpAllocationBps");
  await sleep(RPC_PACING_MS);
  const lendingReportStaleAfterSeconds = await read<bigint>("lendingReportStaleAfterSeconds");
  await sleep(RPC_PACING_MS);
  const lendingReportMaxDeviationBps = await read<bigint>("lendingReportMaxDeviationBps");
  await sleep(RPC_PACING_MS);
  const lendingPositionForceUnwindSeconds = await read<bigint>("lendingPositionForceUnwindSeconds");
  await sleep(RPC_PACING_MS);
  const maxLendingAllocationBps = await read<bigint>("maxLendingAllocationBps");
  await sleep(RPC_PACING_MS);

  const maxAllocationBpsPerAsset: Record<AssetSymbol, number> = {};
  const isStableAsset: Record<AssetSymbol, boolean> = {};
  for (const asset of assets) {
    const maxBps = await read<bigint>("maxAllocationBpsPerAsset", [asset.address]);
    await sleep(RPC_PACING_MS);
    const isStable = await read<boolean>("isStableAsset", [asset.address]);
    await sleep(RPC_PACING_MS);
    maxAllocationBpsPerAsset[asset.symbol] = Number(maxBps);
    isStableAsset[asset.symbol] = isStable;
  }

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
    minLpTickRangeWidth: Number(minLpTickRangeWidth),
    maxLpPositionValueLossBps: Number(maxLpPositionValueLossBps),
    maxLpOutOfRangeSeconds: Number(maxLpOutOfRangeSeconds),
    minLpPoolLiquidityRatioBps: Number(minLpPoolLiquidityRatioBps),
    maxLpAllocationBps: Number(maxLpAllocationBps),
    lendingReportStaleAfterSeconds: Number(lendingReportStaleAfterSeconds),
    lendingReportMaxDeviationBps: Number(lendingReportMaxDeviationBps),
    lendingPositionForceUnwindSeconds: Number(lendingPositionForceUnwindSeconds),
    maxLendingAllocationBps: Number(maxLendingAllocationBps),
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
  await sleep(RPC_PACING_MS);

  // Assets known to this vault but not in stableAssets need a different
  // real price source (getVolatileAssetPriceUSDC's on-chain quoter, not
  // CoinGecko), see agent/core/tools/getMarketData.ts. Both are merged
  // into one MarketData.prices array so the model and checkPolicyOffchain
  // see every asset's price uniformly, regardless of which real source it
  // actually came from.
  const volatileAssets = params.assets.filter((a) => !params.stableAssets.includes(a.symbol) && !a.isBaseAsset);

  // getMarketData is a CoinGecko HTTP call, not a real Arc RPC read -- it
  // never shares the same rate-limit bucket as the calls below, so it is
  // kicked off here and only awaited once everything Arc-RPC-related is
  // done, rather than serialized behind them for no reason.
  const stablePricesPromise = getMarketData(
    params.stableAssets.map((asset) => ({ asset })),
    params.untrustedMarketContext,
  );

  // Every one of these DOES hit the real Arc Testnet RPC, and firing them
  // via Promise.all was confirmed live (2026-07-20, wiring v5's own
  // scheduled decision cycle) to trip the public RPC's "request limit
  // reached" rejection -- same root cause as getVaultState.ts's and
  // buildPolicyLimitsText/Struct's own RPC_PACING_MS fix, applied here for
  // the same reason: this path runs for every vault version's real,
  // scheduled decision cycle, not just v5's.
  const vaultState = await getVaultState(params.publicClient, params.vaultAddress, params.assets);
  await sleep(RPC_PACING_MS);
  const policyLimitsText = await buildPolicyLimitsText(params.publicClient, policyAddress, params.assets);
  await sleep(RPC_PACING_MS);
  const volatilePrices: AssetPriceInput[] = [];
  for (const asset of volatileAssets) {
    volatilePrices.push(await getVolatileAssetPriceUSDC(params.publicClient, asset.symbol));
    await sleep(RPC_PACING_MS);
  }

  const stablePrices = await stablePricesPromise;
  const marketData = { prices: [...stablePrices.prices, ...volatilePrices], untrustedContext: stablePrices.untrustedContext };

  return {
    vaultId: params.vaultAddress,
    strategyVersion: params.strategyVersion,
    strategyConfigText: params.strategyConfigText,
    policyLimitsText,
    vaultState,
    marketData,
  };
}
