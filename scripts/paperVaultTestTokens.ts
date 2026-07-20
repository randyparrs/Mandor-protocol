// Paper-Vault-only pricing/opportunity data for the 4 team-created test
// tokens (docs/deployments.md, "Team-created test tokens and pools (v3
// test infrastructure, 2026-07-14)"). Deliberately a SEPARATE module from
// agent/core/tools/getMarketData.ts, not an extension of its
// VOLATILE_ASSET_QUOTE_CONFIG: that file's config is shared by v1/v2's
// real scripts/runDecisionCycle.ts and will feed the real v3 vault once
// deployed, and these 4 tokens must never appear there (Randy's explicit
// "confirm nothing here touches v1, v2, or the real v3 vault"). Keeping
// them in a distinct file makes that a structural fact, not just a
// promise kept by discipline.
import type { PublicClient } from "viem";
import type { AssetPriceInput, AssetSymbol } from "../agent/core/types.js";
import type { KnownAsset } from "../agent/core/tools/getVaultState.js";
import { formatRawAmount } from "../shared/money.js";

interface TestTokenQuoteConfig {
  assetAddress: `0x${string}`;
  assetDecimals: number;
  poolAddress: `0x${string}`;
  category: string;
  // Unlike cirBTC (agent/core/tools/getMarketData.ts's
  // getVolatileAssetPriceUSDC, self-referential because no independent
  // source exists anywhere for it), these ARE entitled to a genuinely
  // independent reference price: as the team that deployed and seeded
  // every one of these pools, this fixed target price (set at seed time,
  // see scripts/deployTestTokens.ts's own TOKENS array) is a real second
  // source distinct from the pool's own live spot price, exactly the role
  // a real off-chain reference plays for a genuine asset. This is what
  // lets these test opportunities pass an independent-reference check
  // rather than being hard-blocked like cirBTC, which is the whole point
  // of adding them: real decision variety, not another forced-HOLD case.
  independentReferencePriceUSDC: string;
  // Known from seeding (scripts/deployTestTokens.ts's own TOKENS array:
  // seedUSD=3 per side for every one of these 4 pools), not a live
  // revaluation. Good enough for an honest, clearly-labeled order-of-
  // magnitude fee-APR estimate (see computeFeeApr below); anything
  // execution-relevant instead uses the real, precise LiquidityAmounts-
  // based valuation in contracts/MandateVault.sol.
  approxTvlUSD: number;
}

const WUSDC_ADDRESS = "0x911b4000D3422F482F4062a913885f7b035382Df" as const;
const WUSDC_DECIMALS = 18;

// Real wall-clock time scripts/generatePaperVaultTestVolume.ts's round-trip
// swaps were executed and independently verified (nonzero
// feeGrowthGlobal0X128/1X128 confirmed onchain after the run). Before this
// moment these pools had zero fee accrual (seeded via mint(), which does
// not generate fees, only swaps do); this is the true start of their real
// (if team-generated) fee-accrual history, used only to compute an
// elapsed-time disclosure, never fabricated.
const TEST_VOLUME_OBSERVED_SINCE = "2026-07-14T19:27:48.669Z";

const TEST_TOKEN_QUOTE_CONFIG: Record<string, TestTokenQuoteConfig> = {
  "MANDORTEST-STABLE": {
    assetAddress: "0xb5a15b8370984Cd3C5d657d76B8C4Fe3Cf1320D0",
    assetDecimals: 6,
    poolAddress: "0x7da67d0b3950ccd6090f76fbefaad0355bc0312c",
    category: "additional stablecoin-style test asset",
    independentReferencePriceUSDC: "1.00",
    approxTvlUSD: 6,
  },
  "MANDORTEST-RWA": {
    assetAddress: "0x9e3EfD1B99506e65e61C021b42BdD436c088384f",
    assetDecimals: 18,
    poolAddress: "0x4a8dfa8f92e6c1f3b02107e515d645f8a8b73f46",
    category: "tokenized RWA/bond-style test asset",
    independentReferencePriceUSDC: "100.00",
    approxTvlUSD: 6,
  },
  "MANDORTEST-EQUITY": {
    assetAddress: "0xbF53Ca85AB6becF290c089fA6135f7f83E624201",
    assetDecimals: 18,
    poolAddress: "0x4ea5eb558c0a84642a9bc3e2a2cbb042fdac5cb8",
    category: "tokenized equity-style test asset, more volatile",
    independentReferencePriceUSDC: "50.00",
    approxTvlUSD: 6,
  },
  "MANDORTEST-YIELD": {
    assetAddress: "0xCB9EdD86ba1FbD08E53E3460990659562c128c4e",
    assetDecimals: 6,
    poolAddress: "0x6fd54a25189fc7113d8815c643e1054dc62800ed",
    category: "yield-bearing-style test asset (deliberately not USYC)",
    independentReferencePriceUSDC: "10.00",
    approxTvlUSD: 6,
  },
};

export const PAPER_TEST_TOKEN_ASSETS: KnownAsset[] = Object.keys(TEST_TOKEN_QUOTE_CONFIG).map((symbol) => ({
  symbol,
  address: TEST_TOKEN_QUOTE_CONFIG[symbol].assetAddress,
}));

const POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "feeGrowthGlobal0X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeGrowthGlobal1X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/// @notice Real, live spot price read from each test pool's own slot0(),
/// same BigInt-exact math as getVolatileAssetPriceUSDC (deliberately not
/// imported from there: that function always sets referencePriceUSDC ===
/// priceUSDC, which is specifically wrong here, see the doc comment
/// above). referencePriceUSDC here is the fixed, independently-defined
/// seed-time target, not the pool's own live price.
export async function getPaperTestTokenPrices(publicClient: PublicClient): Promise<AssetPriceInput[]> {
  const now = new Date().toISOString();

  return Promise.all(
    Object.entries(TEST_TOKEN_QUOTE_CONFIG).map(async ([symbol, config]) => {
      const [sqrtPriceX96] = await publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "slot0" });
      const token0 = await publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "token0" });
      const assetIsToken0 = token0.toLowerCase() === config.assetAddress.toLowerCase();

      const Q192 = 2n ** 192n;
      const priceSquared = sqrtPriceX96 * sqrtPriceX96;
      const decimalsDelta = assetIsToken0 ? config.assetDecimals - WUSDC_DECIMALS : WUSDC_DECIMALS - config.assetDecimals;
      const scaleUp = 10n ** BigInt(Math.max(0, -decimalsDelta)) * 10n ** 18n;
      const scaleDown = 10n ** BigInt(Math.max(0, decimalsDelta));

      const quoteHumanPerAssetHumanScaled = assetIsToken0 ? (priceSquared * scaleUp) / (Q192 * scaleDown) : (Q192 * scaleUp) / (priceSquared * scaleDown);
      const priceInWUSDC = formatRawAmount(quoteHumanPerAssetHumanScaled, 18);
      const priceUSDC = Number(priceInWUSDC); // WUSDC assumed 1:1 USD, same assumption getMarketData.ts already makes.
      if (!Number.isFinite(priceUSDC) || priceUSDC <= 0) {
        throw new Error(`Pool slot0 produced an unusable price for ${symbol} (sqrtPriceX96=${sqrtPriceX96}). Refusing to fabricate one.`);
      }

      return {
        asset: symbol as AssetSymbol,
        priceUSDC: priceUSDC.toString(),
        referencePriceUSDC: config.independentReferencePriceUSDC,
        updatedAt: now,
      };
    }),
  );
}

interface LpOpportunitySummary {
  symbol: string;
  pool: `0x${string}`;
  isRealMarketPool: boolean;
  liquidity: string;
  note: string;
  feeAprNote?: string;
}

/// @notice Real fee-APR signal for one MANDORTEST pool, derived entirely
/// from onchain data (feeGrowthGlobal0X128/1X128, standard Uniswap V3 fee
/// accumulators, real fees earned by 100% of this pool's liquidity, which
/// is 100% this project's own seed). NOT extrapolated from assumed future
/// volume, and NOT presented as a mature APR: the observation window is
/// necessarily short (these pools only started accruing fees once
/// scripts/generatePaperVaultTestVolume.ts's real, but explicitly
/// team-originated, round-trip swaps ran, see TEST_VOLUME_OBSERVED_SINCE
/// above), so both the raw realized return AND a heavily-caveated naive
/// annualized extrapolation are reported, deliberately not pre-filtered:
/// the agent is trusted to weigh data quality itself (it already
/// demonstrated exactly that discipline in an earlier real cycle, treating
/// "no fee data provided" as a reason to withhold ENTER rather than
/// guessing), same as this project's standing "agent reasons, deterministic
/// checks enforce separately" split.
async function computeFeeApr(publicClient: PublicClient, symbol: string, config: TestTokenQuoteConfig): Promise<string> {
  const [feeGrowth0, feeGrowth1, liquidity, token0] = await Promise.all([
    publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" }),
    publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" }),
    publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "liquidity" }),
    publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "token0" }),
  ]);
  const assetIsToken0 = token0.toLowerCase() === config.assetAddress.toLowerCase();

  const Q128 = 2n ** 128n;
  const fees0Raw = (feeGrowth0 * liquidity) / Q128;
  const fees1Raw = (feeGrowth1 * liquidity) / Q128;

  const assetPriceUSDC = Number(config.independentReferencePriceUSDC);
  const token0Decimals = assetIsToken0 ? config.assetDecimals : WUSDC_DECIMALS;
  const token1Decimals = assetIsToken0 ? WUSDC_DECIMALS : config.assetDecimals;
  const token0PriceUSDC = assetIsToken0 ? assetPriceUSDC : 1;
  const token1PriceUSDC = assetIsToken0 ? 1 : assetPriceUSDC;

  const fees0USD = Number(formatRawAmount(fees0Raw, token0Decimals)) * token0PriceUSDC;
  const fees1USD = Number(formatRawAmount(fees1Raw, token1Decimals)) * token1PriceUSDC;
  const totalFeesUSD = fees0USD + fees1USD;

  if (totalFeesUSD <= 0) {
    return "fee APR: no real fee accrual observed yet (feeGrowthGlobal still 0 for this pool)";
  }

  const elapsedHours = (Date.now() - Date.parse(TEST_VOLUME_OBSERVED_SINCE)) / 3_600_000;
  const cumulativeReturnPct = (totalFeesUSD / config.approxTvlUSD) * 100;
  const naiveAnnualizedAprPct = elapsedHours > 0 ? cumulativeReturnPct * ((365 * 24) / elapsedHours) : 0;

  return (
    `fee APR: real fees accrued since first team-generated swap ~$${totalFeesUSD.toFixed(4)} ` +
    `over ~${elapsedHours.toFixed(2)}h (cumulative return ${cumulativeReturnPct.toFixed(3)}% of approx TVL $${config.approxTvlUSD}); ` +
    `naive annualized extrapolation ${naiveAnnualizedAprPct.toFixed(1)}% APR. ` +
    `IMPORTANT: this volume was entirely team-generated (the test-token deployer wallet round-tripping against its own seeded pool), ` +
    `not organic market demand, and the observation window is far too short for a statistically reliable annualized figure. ` +
    `Treat this as a rough, disclosed signal only, never as proof of real, sustained market interest, and never describe an ENTER ` +
    `informed by this figure as reflecting real market demand.`
  );
}

/// @notice Live liquidity depth for every pool the Paper Vault can
/// currently evaluate (the one real cirBTC/WUSDC pool plus the 4 team-
/// created test pools), read fresh each cycle via pool.liquidity(), never
/// a cached/assumed figure. This is what lets the strategy text's
/// criterion 1 ("real pool depth and reserves") be evaluated against an
/// actual number instead of being unactionable, since MarketData/VaultState
/// only carry per-asset prices, not per-pool depth, see
/// scripts/paperVaultCycle.ts.
export async function buildLpOpportunitiesText(publicClient: PublicClient): Promise<string> {
  const pools: Array<{ symbol: string; pool: `0x${string}`; isRealMarketPool: boolean; note: string }> = [
    {
      symbol: "cirBTC",
      pool: "0x254bA0424618113127538eE11e42C1e3c1721225",
      isRealMarketPool: true,
      note: "real Arc Testnet pool (WUSDC/cirBTC, fee 3000), no independent reference price exists for cirBTC",
    },
    ...Object.entries(TEST_TOKEN_QUOTE_CONFIG).map(([symbol, config]) => ({
      symbol,
      pool: config.poolAddress,
      isRealMarketPool: false,
      note: `team-created test pool (WUSDC/${symbol}, fee 3000, ${config.category}), simulated LP opportunity, not a real market, has an independent reference price`,
    })),
  ];

  const summaries: LpOpportunitySummary[] = await Promise.all(
    pools.map(async (p) => {
      const liquidity = await publicClient.readContract({ address: p.pool, abi: POOL_ABI, functionName: "liquidity" });
      const testConfig = TEST_TOKEN_QUOTE_CONFIG[p.symbol];
      const feeAprNote = testConfig ? await computeFeeApr(publicClient, p.symbol, testConfig) : undefined;
      return { symbol: p.symbol, pool: p.pool, isRealMarketPool: p.isRealMarketPool, liquidity: liquidity.toString(), note: p.note, feeAprNote };
    }),
  );

  const lines = summaries.map((s) => `- ${s.symbol}: pool ${s.pool}, real current liquidity=${s.liquidity} (${s.note})${s.feeAprNote ? `. ${s.feeAprNote}` : ""}`);
  return ["Available LP opportunities (real, freshly-read pool liquidity, not assumed):", ...lines].join("\n");
}
