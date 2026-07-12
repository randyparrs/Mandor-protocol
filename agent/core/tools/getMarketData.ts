import type { PublicClient } from "viem";
import type { AssetPriceInput, AssetSymbol, MarketData } from "../types.js";
import { formatRawAmount } from "../../../shared/money.js";

export interface StableAssetPrice {
  asset: AssetSymbol;
}

// Real-world reference price data for assets whose peg target isn't a flat
// 1.00 USD (e.g. EURC tracks EUR, not USD, so its USD value legitimately
// floats with EUR/USD FX, that is normal, not a depeg). USDC is the only
// entry actually needed today (the live vault is USDC-only, see
// docs/deployments.md); documented here rather than assumed for any future
// stable asset, since a wrong flat assumption would be exactly the kind of
// fabricated data this module exists to avoid.
const STABLE_ASSET_CONFIG: Partial<Record<AssetSymbol, { coingeckoId: string; referencePriceUSDC: string }>> = {
  USDC: { coingeckoId: "usd-coin", referencePriceUSDC: "1.00" },
};

/// @notice No onchain oracle exists yet on Arc (see
/// docs/arc-facts-to-verify.md, "Chainlink oracle feed availability on Arc"
/// is still unverified), but a stablecoin's real price is not a constant,
/// it holds its peg only as long as the market keeps it there (USDC itself
/// briefly depegged in March 2023). Hardcoding 1.00 would make a real depeg
/// invisible to the agent, exactly the kind of anomaly an AI decision-maker
/// should add value catching, VaultPolicy's own oracle deviation check
/// protects execution but never gives the agent itself anything to reason
/// about. This reads the real, current USD price from CoinGecko's public
/// API (no API key required, rate-limited, acceptable at this call
/// frequency, one call per proposeDecision, not a hot loop), a genuine
/// external market signal rather than an assumption, until a real onchain
/// oracle exists on Arc to read instead. `priceUSDC` is what the market
/// actually says right now; `referencePriceUSDC` is the peg target, letting
/// both the agent and VaultPolicy's own deviation check compare them.
export async function getMarketData(stableAssets: StableAssetPrice[], untrustedContext?: string): Promise<MarketData> {
  const now = new Date().toISOString();

  const prices = await Promise.all(
    stableAssets.map(async ({ asset }) => {
      const config = STABLE_ASSET_CONFIG[asset];
      if (!config) {
        throw new Error(
          `No real price source configured for ${asset}. Add an entry to STABLE_ASSET_CONFIG with a real, verified reference price, never fabricate one here.`,
        );
      }

      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${config.coingeckoId}&vs_currencies=usd`);
      if (!response.ok) {
        throw new Error(`Failed to fetch a real price for ${asset} from CoinGecko: HTTP ${response.status}`);
      }
      const data = (await response.json()) as Record<string, { usd?: number }>;
      const priceUSD = data[config.coingeckoId]?.usd;
      if (typeof priceUSD !== "number") {
        throw new Error(`CoinGecko returned no usable price for ${asset} (${config.coingeckoId}). Refusing to fabricate one.`);
      }

      return {
        asset,
        priceUSDC: priceUSD.toString(),
        referencePriceUSDC: config.referencePriceUSDC,
        updatedAt: now,
      };
    }),
  );

  return { prices, untrustedContext };
}

/// @notice Placeholder marking where real price-feed data would be fetched
/// for a non-stable asset once a verified oracle exists on Arc, or a real
/// external price source is confirmed for that specific asset. Throws
/// instead of guessing, see the module-level note above.
export function getUnverifiedAssetPrice(asset: AssetSymbol): never {
  throw new Error(
    `No real price feed exists yet for ${asset}. See docs/arc-facts-to-verify.md, "Chainlink oracle feed availability on Arc" is still unverified. Do not fabricate a price here.`,
  );
}

/// @notice Whether `referencePriceUSDC` for this asset comes from a
/// genuinely independent source (a fixed peg target, or a real independent
/// oracle) rather than being derived from the exact same feed as
/// `priceUSDC` itself. Fails closed: any asset not explicitly listed in
/// STABLE_ASSET_CONFIG returns false, including cirBTC and any future
/// volatile asset added to VOLATILE_ASSET_QUOTE_CONFIG below, same
/// "never assume it's safe" discipline as everything else in this file.
///
/// Confirmed live on 2026-07-11: despite Arc joining "Chainlink Scale" (a
/// partnership announcement covering CCIP/Data Streams/Data Feeds/Proof of
/// Reserve), Chainlink's own official Price Feed Contract Addresses page
/// (docs.chain.link/data-feeds/price-feeds/addresses, both Mainnet and
/// Testnet network selectors) returns zero results for "Arc", i.e. no real
/// Data Feed of any kind is deployed on Arc yet. The only real, live
/// Chainlink product confirmed present for "Arc Testnet" is CRE (Chainlink
/// Runtime Environment) workflow support, per Chainlink's own release
/// notes, a different product, not a price feed. Revisit this function
/// (and executor/keeperService.ts's requireIndependentReferencePriceToBuy)
/// if a real BTC/USD Data Feed goes live on Arc, verified live the same way
/// (eth_getCode + a real latestRoundData() call), not from the
/// announcement alone.
export function hasIndependentReferencePrice(asset: AssetSymbol): boolean {
  return asset in STABLE_ASSET_CONFIG;
}

const POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
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

export interface VolatileAssetQuoteConfig {
  assetAddress: `0x${string}`;
  assetDecimals: number;
  // The token this asset is actually priced against. Not necessarily the
  // vault's own base asset: for cirBTC, the only pool with real liquidity
  // is WUSDC/cirBTC (poolAddress below), not a direct USDC pool, confirmed
  // live (the real Factory's getPool returns address(0) for USDC/cirBTC at
  // every fee tier, and the one USDC/EURC pool that does exist has zero
  // real liquidity, liquidity() == 0). This price is therefore a real,
  // live, on-chain signal, but an approximation of what the vault's own
  // base asset would actually get, not the vault's own execution venue,
  // see agent/core/README.md.
  quoteAgainstToken: `0x${string}`;
  quoteAgainstDecimals: number;
  poolAddress: `0x${string}`;
  // WUSDC is assumed 1:1 USD (it wraps Arc's native gas currency, which is
  // USDC-denominated), same assumption this project already makes for
  // native USDC elsewhere, never fabricated, just not independently
  // re-verified here since it is not this function's own subject asset.
  quoteAgainstReferencePriceUSDC: string;
}

// Only cirBTC needed today, see docs/deployments.md's v2 vault. Documented
// here rather than assumed for any future volatile asset, same discipline
// STABLE_ASSET_CONFIG above already follows.
const VOLATILE_ASSET_QUOTE_CONFIG: Partial<Record<AssetSymbol, VolatileAssetQuoteConfig>> = {
  cirBTC: {
    assetAddress: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    assetDecimals: 8,
    quoteAgainstToken: "0x911b4000D3422F482F4062a913885f7b035382Df",
    quoteAgainstDecimals: 18,
    poolAddress: "0x254bA0424618113127538eE11e42C1e3c1721225",
    quoteAgainstReferencePriceUSDC: "1.00",
  },
};

/// @notice Real, live pricing for a volatile (non-stable) asset with no
/// CEX/oracle source, read directly from the real pool's own slot0()
/// sqrtPriceX96, a genuine zero-price-impact spot price, not the Quoter's
/// quoteExactInputSingle. Verified live this was the right choice, not
/// assumed: this pool's real cirBTC-side reserve is only ~0.00048 cirBTC
/// (docs/arc-facts-to-verify.md), so quoting a full "1 whole cirBTC" trade
/// against it (what an earlier version of this function did) meant
/// simulating a sell 2000x the pool's own liquidity, crashing the quoted
/// price to a small fraction of the real spot price (confirmed live:
/// quoteExactInputSingle for 1 whole cirBTC returned an implied price
/// ~900x lower than smaller-probe quotes and this function's own slot0
/// result, which agree closely with each other). The Quoter is still the
/// right tool for sizing a REAL trade's minAmountOut
/// (executor/keeperService.ts, a fresh quote for the actual requested
/// trade size, where price impact is a real, wanted signal), just not for
/// this "what does the market currently think this is worth" reference
/// price, which must be impact-free.
///
/// @dev SECURITY: referencePriceUSDC is set equal to priceUSDC itself,
/// because no genuinely independent second source exists for cirBTC today
/// (confirmed live, see hasIndependentReferencePrice above). This is NOT a
/// harmless no-op: VaultPolicy's oracleMaxDeviationBps check compares
/// price against referencePrice specifically to catch a single manipulated
/// feed, and a self-referencing pair always reports zero deviation,
/// silently defeating that defense for the one asset in this project
/// with the thinnest, most manipulable liquidity (~0.00048 cirBTC pool
/// reserve). hasIndependentReferencePrice(asset) returns false for this
/// exact reason, and executor/keeperService.ts's
/// requireIndependentReferencePriceToBuy hard-blocks any swap leg that
/// would BUY an asset failing that check, so this unreliable price can
/// never authorize new onchain allocation into cirBTC. Selling out of it
/// (EXIT, REBALANCE-down, EMERGENCY_EXIT_TO_STABLE) stays allowed: that
/// direction only ever reduces exposure, so a spoofed price there cannot
/// be used to sneak an over-cap position past the allocation gate.
export async function getVolatileAssetPriceUSDC(publicClient: PublicClient, asset: AssetSymbol): Promise<AssetPriceInput> {
  const config = VOLATILE_ASSET_QUOTE_CONFIG[asset];
  if (!config) {
    return getUnverifiedAssetPrice(asset);
  }

  const [sqrtPriceX96] = await publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "slot0" });
  const token0 = await publicClient.readContract({ address: config.poolAddress, abi: POOL_ABI, functionName: "token0" });
  const assetIsToken0 = token0.toLowerCase() === config.assetAddress.toLowerCase();

  // sqrtPriceX96^2 / 2^192 = raw token1-per-token0 price (Uniswap V3's own
  // convention). Kept entirely in BigInt until the final formatRawAmount
  // step, a real precision-loss bug already found once this session
  // (Number(bigint) silently rounds for realistic on-chain magnitudes).
  const Q192 = 2n ** 192n;
  const priceSquared = sqrtPriceX96 * sqrtPriceX96;
  const decimalsDelta = assetIsToken0 ? config.assetDecimals - config.quoteAgainstDecimals : config.quoteAgainstDecimals - config.assetDecimals;
  const scaleUp = 10n ** BigInt(Math.max(0, -decimalsDelta)) * 10n ** 18n;
  const scaleDown = 10n ** BigInt(Math.max(0, decimalsDelta));

  // quoteAgainstToken human units per 1 assetToken human unit, scaled to
  // an internal 18-decimal fixed point, direction depends on which token
  // is token0 vs token1 (Uniswap orders by address, not by role).
  const quoteHumanPerAssetHumanScaled = assetIsToken0 ? (priceSquared * scaleUp) / (Q192 * scaleDown) : (Q192 * scaleUp) / (priceSquared * scaleDown);

  const priceInQuoteToken = formatRawAmount(quoteHumanPerAssetHumanScaled, 18);
  const priceUSDC = Number(priceInQuoteToken) * Number(config.quoteAgainstReferencePriceUSDC);
  if (!Number.isFinite(priceUSDC) || priceUSDC <= 0) {
    throw new Error(`Pool slot0 produced an unusable price for ${asset} (sqrtPriceX96=${sqrtPriceX96}). Refusing to fabricate one.`);
  }

  const priceStr = priceUSDC.toString();
  return {
    asset,
    priceUSDC: priceStr,
    referencePriceUSDC: priceStr,
    updatedAt: new Date().toISOString(),
  };
}
