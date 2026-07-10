import type { AssetSymbol, MarketData } from "../types.js";

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
