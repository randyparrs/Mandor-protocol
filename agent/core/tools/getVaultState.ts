import type { PublicClient } from "viem";
import { formatRawAmount, scaleToInternalFixedPoint, INTERNAL_FIXED_POINT_DECIMALS } from "../../../shared/money.js";
import type { AssetSymbol, VaultState } from "../types.js";

// The real, public Arc Testnet RPC rejects a burst of simultaneous
// eth_call requests ("request limit reached"), confirmed live 2026-07-20
// while wiring v5's own scheduled decision cycle -- same root cause as
// agent/core/context.ts's own RPC_PACING_MS note, this file's reads are
// paced the same way rather than fired via Promise.all, since this
// affects every vault version's real, scheduled decision cycle equally.
const RPC_PACING_MS = 3000;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // v4 only. Public state var, reverts to address(0) on v1/v2/v3's real
  // deployed bytecode? No -- it simply does not exist there at all (their
  // real shape predates this field), so this read must only ever be
  // attempted for a real v4 vault, see the try/catch below.
  { type: "function", name: "lendingRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  // v7 only. Public state var, same "does not exist at all on older
  // versions' real deployed bytecode" reasoning as lendingRegistry above,
  // see the try/catch around currentLpPositions below.
  { type: "function", name: "lpRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  // v3/v6 only (v6 always returns empty, no LP mechanism at all), always
  // returns an empty array for v1/v2 (no LP positions ever held), see
  // contracts/MandateVault.sol's own doc comment. v7 has NO this function
  // at all (contracts/MandateVaultLp.sol), see the try/catch below.
  {
    type: "function",
    name: "currentLpPositions",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "pool", type: "address" },
          { name: "currentAllocationBps", type: "uint16" },
          { name: "openValueUSDC", type: "uint256" },
          { name: "currentValueUSDC", type: "uint256" },
          { name: "inRange", type: "bool" },
          { name: "outOfRangeSince", type: "uint256" },
          { name: "poolLiquidityAtOpen", type: "uint128" },
          { name: "currentPoolLiquidity", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const VAULT_POLICY_ABI = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

// v4 only. LendingPositionRegistry's own real, existing public view (see
// contracts/LendingPositionRegistry.sol), read directly rather than adding
// a matching convenience getter to MandateVault.sol itself: v1/v2/v3's
// real deployed vaults already exist and are immutable, this avoids ever
// needing a MandateVault.sol change (or a redeploy) just to expose this.
const LENDING_POSITION_REGISTRY_ABI = [
  {
    type: "function",
    name: "currentPositions",
    stateMutability: "view",
    inputs: [{ name: "nav", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "positionId", type: "uint256" },
          { name: "chainId", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "currentAllocationBps", type: "uint16" },
          { name: "principalUSDC", type: "uint256" },
          { name: "currentValueUSDC", type: "uint256" },
          { name: "lastReportedAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

// Mirrors LendingPositionRegistry.sol's LendingPositionStatus enum order
// exactly (Solidity enums are just uint8 indices in declaration order).
const LENDING_POSITION_STATUS_BY_INDEX = ["IN_TRANSIT_OUT", "OPEN", "WITHDRAWAL_PENDING", "IN_TRANSIT_BACK"] as const;

// v7 only. LpPositionRegistry's own real, existing public view (see
// contracts/LpPositionRegistry.sol), read directly rather than adding a
// matching convenience getter back onto MandateVaultLp.sol -- same
// reasoning as LENDING_POSITION_REGISTRY_ABI above, and the same tuple
// shape MANDATE_VAULT_ABI's own currentLpPositions already returns (v3's
// inline version), so the exact same mapping code below can be reused
// unchanged regardless of which one actually produced the raw array.
const LP_POSITION_REGISTRY_ABI = [
  {
    type: "function",
    name: "currentPositions",
    stateMutability: "view",
    inputs: [{ name: "nav", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "pool", type: "address" },
          { name: "currentAllocationBps", type: "uint16" },
          { name: "openValueUSDC", type: "uint256" },
          { name: "currentValueUSDC", type: "uint256" },
          { name: "inRange", type: "bool" },
          { name: "outOfRangeSince", type: "uint256" },
          { name: "poolLiquidityAtOpen", type: "uint128" },
          { name: "currentPoolLiquidity", type: "uint128" },
        ],
      },
    ],
  },
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
  await sleep(RPC_PACING_MS);

  const totalAssetsRaw = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "totalAssets" });
  await sleep(RPC_PACING_MS);
  const currentDrawdownBps = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "currentDrawdownBps" });
  await sleep(RPC_PACING_MS);
  const tradesToday = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "tradesToday" });
  await sleep(RPC_PACING_MS);
  const highWaterMarkRaw = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "highWaterMarkUSDC" });
  await sleep(RPC_PACING_MS);
  const paused = await publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_ABI, functionName: "paused" });
  await sleep(RPC_PACING_MS);
  // Read defensively, same "one obvious, safe fallback, a shared file
  // stays correct for every vault version without needing its own
  // duplicate" reasoning already established for lendingRegistry below:
  // v1/v2/v3/v6 vaults have a real currentLpPositions() on their own
  // deployed bytecode (v6 always returns empty, no LP mechanism at all);
  // v7 (contracts/MandateVaultLp.sol) does NOT -- that call reverts
  // (wrong selector), not returns empty, since the function simply does
  // not exist there. On that specific failure, fall back to reading
  // lpRegistry() from the vault and querying LpPositionRegistry directly
  // instead (the same tuple shape, see LP_POSITION_REGISTRY_ABI's own doc
  // comment) -- and if THAT also fails for any reason, default to empty
  // rather than ever letting an optional read break vault state entirely.
  let rawLpPositions: readonly {
    tokenId: bigint;
    pool: `0x${string}`;
    currentAllocationBps: number;
    openValueUSDC: bigint;
    currentValueUSDC: bigint;
    inRange: boolean;
    outOfRangeSince: bigint;
    poolLiquidityAtOpen: bigint;
    currentPoolLiquidity: bigint;
  }[] = [];
  try {
    rawLpPositions = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "currentLpPositions" });
  } catch {
    try {
      const lpRegistryAddress = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "lpRegistry" });
      await sleep(RPC_PACING_MS);
      if (lpRegistryAddress !== "0x0000000000000000000000000000000000000000") {
        rawLpPositions = await publicClient.readContract({
          address: lpRegistryAddress,
          abi: LP_POSITION_REGISTRY_ABI,
          functionName: "currentPositions",
          args: [totalAssetsRaw],
        });
      }
    } catch {
      // Neither currentLpPositions() nor lpRegistry() exist/succeeded:
      // treat as "no LP capability for this vault", never rethrown.
      rawLpPositions = [];
    }
  }
  await sleep(RPC_PACING_MS);

  const baseAsset = assets.find((a) => a.isBaseAsset);
  if (!baseAsset) {
    throw new Error("getVaultState requires exactly one asset in `assets` marked isBaseAsset, none was provided.");
  }

  let baseAssetDecimals = 0;
  const holdings: Array<{ asset: AssetSymbol; ledgerAmount: string; valueUSDC: string }> = [];
  for (const asset of assets) {
    const ledgerAmount = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "ledgerOf", args: [asset.address] });
    await sleep(RPC_PACING_MS);
    const decimals = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "assetDecimals", args: [asset.address] });
    await sleep(RPC_PACING_MS);

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
      await sleep(RPC_PACING_MS);
      // 0 until a real executeDecision call has priced this asset at
      // least once, never fabricated here.
      const ledgerIn18 = scaleToInternalFixedPoint(ledgerAmount, decimals);
      valueUSDC18 = (ledgerIn18 * priceUSDC) / 10n ** BigInt(INTERNAL_FIXED_POINT_DECIMALS);
    }

    holdings.push({
      asset: asset.symbol,
      // Human-readable decimal strings, matching the convention every
      // other caller of VaultState already assumes (loop.ts JSON.stringifies
      // this straight into the AI agent's prompt; scripts/testProposeDecision.ts
      // and agent/core/promptInjection.test.ts's fixtures both use plain
      // decimals like "9000.00"). A raw/wei integer string here would
      // silently feed the AI agent a number many orders of magnitude off from
      // the vault's real size, see shared/money.ts.
      ledgerAmount: formatRawAmount(ledgerAmount, decimals),
      valueUSDC: formatRawAmount(valueUSDC18, INTERNAL_FIXED_POINT_DECIMALS),
    });
  }

  // v3 only: openValueUSDC/currentValueUSDC come back in the same
  // base-asset-native scale as totalAssetsRaw/highWaterMarkRaw above
  // (MandateVault.sol's _valueLpPositions reuses the same _valueInUSDC
  // scale as everything else in that contract), rescaled to the shared
  // internal fixed point the same way. poolLiquidityAtOpen/
  // currentPoolLiquidity are raw pool liquidity units, not a USD amount,
  // so they are passed through as plain decimal strings, no rescaling.
  const lpPositions = rawLpPositions.map((p) => ({
    tokenId: p.tokenId.toString(),
    pool: p.pool,
    valueUSDC: formatRawAmount(scaleToInternalFixedPoint(p.currentValueUSDC, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    openValueUSDC: formatRawAmount(scaleToInternalFixedPoint(p.openValueUSDC, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    inRange: p.inRange,
    outOfRangeSince: p.outOfRangeSince > 0n ? new Date(Number(p.outOfRangeSince) * 1000).toISOString() : null,
    poolLiquidityAtOpen: p.poolLiquidityAtOpen.toString(),
    currentPoolLiquidity: p.currentPoolLiquidity.toString(),
  }));

  // v4 only. Read defensively, never as part of the sequential batch
  // above: v1/v2/v3's real deployed vaults predate this field entirely
  // (confirmed live via cast --trace, see executor/keeperService.ts's own
  // "INTENTIONAL FORK" note), so calling lendingRegistry() against them
  // reverts (wrong selector), not just returns address(0). A single vault-
  // wide try/catch around this optional read, rather than forking this
  // whole file the way keeperService.ts was forked, is the right amount of
  // caution for a plain, no-side-effect view call: unlike executeDecision's
  // exact struct-shape encoding (where getting it wrong risks a silent
  // wrong-selector call), a failed read here has one obvious, safe
  // fallback (treat as "no lending capability"), so a shared file stays
  // correct for every vault version without needing its own duplicate.
  let currentLendingPositions: VaultState["currentLendingPositions"] = [];
  try {
    const lendingRegistryAddress = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_ABI, functionName: "lendingRegistry" });
    await sleep(RPC_PACING_MS);
    if (lendingRegistryAddress !== "0x0000000000000000000000000000000000000000") {
      const rawLendingPositions = await publicClient.readContract({
        address: lendingRegistryAddress,
        abi: LENDING_POSITION_REGISTRY_ABI,
        functionName: "currentPositions",
        args: [totalAssetsRaw],
      });
      currentLendingPositions = rawLendingPositions.map((p) => ({
        positionId: p.positionId.toString(),
        chainId: p.chainId.toString(),
        status: LENDING_POSITION_STATUS_BY_INDEX[p.status],
        currentAllocationBps: p.currentAllocationBps,
        principalUSDC: formatRawAmount(scaleToInternalFixedPoint(p.principalUSDC, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
        currentValueUSDC: formatRawAmount(scaleToInternalFixedPoint(p.currentValueUSDC, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
        lastReportedAt: new Date(Number(p.lastReportedAt) * 1000).toISOString(),
      }));
    }
  } catch {
    // v1/v2/v3's real vaults: lendingRegistry() does not exist on their
    // real deployed bytecode at all, this is the expected, harmless path
    // for every vault version except v4, never rethrown.
    currentLendingPositions = [];
  }

  return {
    vaultId: vaultAddress,
    totalAssetsUSDC: formatRawAmount(scaleToInternalFixedPoint(totalAssetsRaw, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    holdings,
    paused,
    tradesToday: Number(tradesToday),
    highWaterMarkUSDC: formatRawAmount(scaleToInternalFixedPoint(highWaterMarkRaw, baseAssetDecimals), INTERNAL_FIXED_POINT_DECIMALS),
    currentDrawdownBps: currentDrawdownBps,
    lpPositions,
    currentLendingPositions,
  };
}
