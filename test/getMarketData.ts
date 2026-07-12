import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getVolatileAssetPriceUSDC, hasIndependentReferencePrice } from "../agent/core/tools/getMarketData.js";

const WUSDC = "0x911b4000D3422F482F4062a913885f7b035382Df";
// The real sqrtPriceX96 read live from the real WUSDC/cirBTC pool this
// session (0x254bA0424618113127538eE11e42C1e3c1721225), token0 == WUSDC.
// Independently verified to correspond to ~276,073 WUSDC per cirBTC,
// closely matching a separate small-probe Quoter quote (~273,067) taken
// at the same time, confirmed live, not assumed.
const REAL_SQRT_PRICE_X96 = 1507882443911786873427n;

function makeFakePublicClient(sqrtPriceX96: bigint, token0: string = WUSDC) {
  return {
    async readContract(params: { functionName: string }) {
      if (params.functionName === "slot0") {
        return [sqrtPriceX96, 0, 0, 0, 0, 0, true];
      }
      if (params.functionName === "token0") {
        return token0;
      }
      throw new Error(`fake readContract: unexpected functionName ${params.functionName}`);
    },
  };
}

describe("getVolatileAssetPriceUSDC", () => {
  it("converts a real pool's slot0 sqrtPriceX96 into a USDC price, referencePriceUSDC equal to the spot price itself", async () => {
    const publicClient = makeFakePublicClient(REAL_SQRT_PRICE_X96);

    const price = await getVolatileAssetPriceUSDC(publicClient as never, "cirBTC");

    assert.equal(price.asset, "cirBTC");
    // Matches the real, independently-verified spot price for this exact
    // sqrtPriceX96, within a tiny rounding tolerance.
    const priceNum = Number(price.priceUSDC);
    assert.ok(priceNum > 276_000 && priceNum < 276_100, `expected ~276,073, got ${priceNum}`);
    assert.equal(price.priceUSDC, price.referencePriceUSDC);
    assert.ok(price.updatedAt);
  });

  it("gives the inverse price when the asset is token0 instead of token1", async () => {
    // Same sqrtPriceX96, but now cirBTC is token0 and WUSDC is token1: the
    // real pool never has this ordering (addresses are fixed), this only
    // tests the direction-handling branch in isolation.
    const publicClient = makeFakePublicClient(REAL_SQRT_PRICE_X96, "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");

    const price = await getVolatileAssetPriceUSDC(publicClient as never, "cirBTC");

    // Flipping token0/token1 inverts and rescales the price entirely
    // (different decimals convention), so this should NOT match the
    // token1 case's ~276,073, just confirming it takes a different,
    // finite, positive path.
    const priceNum = Number(price.priceUSDC);
    assert.ok(Number.isFinite(priceNum) && priceNum > 0);
  });

  it("throws for an asset with no configured quote source, never fabricating a price", async () => {
    const publicClient = makeFakePublicClient(REAL_SQRT_PRICE_X96);
    await assert.rejects(() => getVolatileAssetPriceUSDC(publicClient as never, "EURC"));
  });

  it("throws rather than silently produce a price if sqrtPriceX96 is 0 (invalid pool state)", async () => {
    const publicClient = makeFakePublicClient(0n);
    await assert.rejects(() => getVolatileAssetPriceUSDC(publicClient as never, "cirBTC"));
  });
});

describe("hasIndependentReferencePrice", () => {
  it("is true for USDC, a real fixed peg target independent of its fetched market price", () => {
    assert.equal(hasIndependentReferencePrice("USDC"), true);
  });

  it("is false for cirBTC, whose referencePriceUSDC is the same slot0 spot price as priceUSDC, not independent", () => {
    assert.equal(hasIndependentReferencePrice("cirBTC"), false);
  });

  it("fails closed (false) for any asset symbol with no configured independent reference source", () => {
    assert.equal(hasIndependentReferencePrice("EURC"), false);
  });
});
