// Single source of truth for converting between raw on-chain integer
// amounts and the human-readable decimal strings every consumer of
// VaultState/PolicyLimits/MarketData actually expects (loop.ts puts
// JSON.stringify(vaultState) straight into Claude's prompt; the vaultState
// fixtures in scripts/testProposeDecision.ts and
// agent/core/promptInjection.test.ts both use plain decimals like "9000.00").
//
// This exists because ad-hoc formatUnits/decimal-scaling math spread across
// individual files has already produced one real, live bug: getVaultState.ts
// used to return totalAssetsUSDC/valueUSDC as raw, unformatted integers
// (native on-chain decimals, or an internally-rescaled 18-decimal integer),
// which fed Claude a vault size many orders of magnitude off from reality
// (see agent/core/README.md's postmortem). Every file that needs to format
// or scale a raw on-chain amount should import from here instead of calling
// viem's formatUnits/parseUnits directly, so there is exactly one place this
// conversion can go wrong, not one place per file.
import { formatUnits, parseUnits } from "viem";

// The common working precision this codebase rescales every asset's raw
// amount to internally, so amounts with different native decimals (e.g. a
// 6-decimal USDC vs. an 18-decimal mock) can be compared or summed directly.
// Never returned to a caller as-is, always formatted back down with
// formatRawAmount first.
export const INTERNAL_FIXED_POINT_DECIMALS = 18;

/// @notice Converts a raw on-chain integer amount (in `decimals` units) into
/// the human-readable decimal string every VaultState/PolicyLimits consumer
/// expects, e.g. formatRawAmount(5_000_000n, 6) === "5".
export function formatRawAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

/// @notice The inverse: a human-readable decimal string back to a raw
/// on-chain integer amount in `decimals` units.
export function parseRawAmount(value: string, decimals: number): bigint {
  return parseUnits(value, decimals);
}

/// @notice Rescales a raw integer amount from its native `fromDecimals` into
/// INTERNAL_FIXED_POINT_DECIMALS, for internal math only (see getVaultState.ts,
/// agent/policy/offchainPolicyCheck.ts). Always pass the result through
/// formatRawAmount(_, INTERNAL_FIXED_POINT_DECIMALS) before it leaves a
/// function boundary, never return it as a bare integer string.
export function scaleToInternalFixedPoint(raw: bigint, fromDecimals: number): bigint {
  const scale = INTERNAL_FIXED_POINT_DECIMALS - fromDecimals;
  return scale >= 0 ? raw * 10n ** BigInt(scale) : raw / 10n ** BigInt(-scale);
}

/// @notice Throws if `value` does not look like a human-readable decimal
/// string, catching the exact class of bug already found once: a raw,
/// unformatted on-chain integer (native-decimals or internally-rescaled
/// 18-decimal) leaking out of a function that promises a human amount.
/// Deliberately a plain finite-number check, not a magnitude threshold: a
/// small real amount at the wrong scale (e.g. "5000000" for 5 USDC at
/// 6-decimals) is not implausibly large in absolute terms, so magnitude
/// alone would not have caught the actual bug this project hit. Callers
/// that can cross-check an amount against a known-good reference (e.g.
/// getVaultState.test.ts asserting an exact expected string against a
/// deterministic fixture) should do that instead, this is a last-resort
/// shape check for callers that cannot.
export function assertHumanDecimalString(value: string, label: string): void {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${label}: "${value}" is not a plain decimal string.`);
  }
}
