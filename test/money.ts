import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRawAmount, parseRawAmount, scaleToInternalFixedPoint, assertHumanDecimalString, INTERNAL_FIXED_POINT_DECIMALS } from "../shared/money.js";

describe("shared/money", () => {
  it("formatRawAmount converts a raw 6-decimal integer to a human-decimal string", () => {
    assert.equal(formatRawAmount(5_000_000n, 6), "5");
    assert.equal(formatRawAmount(1_234_560n, 6), "1.23456");
  });

  it("parseRawAmount is the exact inverse of formatRawAmount", () => {
    assert.equal(parseRawAmount("5", 6), 5_000_000n);
    assert.equal(parseRawAmount(formatRawAmount(1_234_560n, 6), 6), 1_234_560n);
  });

  it("scaleToInternalFixedPoint rescales up from 6 decimals to the internal 18", () => {
    const scaled = scaleToInternalFixedPoint(5_000_000n, 6);
    assert.equal(scaled, 5n * 10n ** BigInt(INTERNAL_FIXED_POINT_DECIMALS));
    assert.equal(formatRawAmount(scaled, INTERNAL_FIXED_POINT_DECIMALS), "5");
  });

  it("scaleToInternalFixedPoint is a no-op when already at 18 decimals", () => {
    const raw = 5n * 10n ** 18n;
    assert.equal(scaleToInternalFixedPoint(raw, 18), raw);
  });

  it("assertHumanDecimalString accepts plain decimals and rejects garbage", () => {
    assert.doesNotThrow(() => assertHumanDecimalString("5", "test"));
    assert.doesNotThrow(() => assertHumanDecimalString("1234.56", "test"));
    assert.doesNotThrow(() => assertHumanDecimalString("-1.5", "test"));
    assert.throws(() => assertHumanDecimalString("5e18", "test"));
    assert.throws(() => assertHumanDecimalString("not a number", "test"));
    assert.throws(() => assertHumanDecimalString("", "test"));
  });
});
