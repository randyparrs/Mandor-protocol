// The one module in this repo that holds a real signing key
// (KEEPER_PRIVATE_KEY) and submits real transactions calling
// MandateVault.executeDecision. See executor/README.md's "Must never do".
// Never custodies vault assets, even transiently, swaps happen atomically
// inside MandateVault itself, see docs/architecture.md.
//
// INTENTIONAL FORK, READ BEFORE FIXING A BUG HERE (2026-07-18): this file
// targets v1/v2/v3's real, already-deployed Decision/executeDecision shape
// specifically (no chainId/lendingPositionId/bridgeLeg -- those fields did
// not exist yet when v1/v2/v3 were deployed, and each vault's real bytecode
// is frozen at its own deploy time, confirmed live via cast --trace: the
// v4-shaped ABI reverts immediately, wrong selector, against the real v3
// vault). executor/keeperServiceV4.ts is a separate, deliberately
// duplicated module for v4's newer struct shape, sharing most of this
// file's logic by copy, not by import (same "new version = new deployment,
// never touch a live one" principle already applied to the contracts
// themselves, extended to this executor layer, a deliberate decision).
// scripts/runDecisionCycle.ts's real, scheduled production cycle
// for v1/v2 depends on THIS file's ABI staying exactly as-is.
//
// Consequence: a security-relevant fix discovered in one of these two files
// (e.g. a real swap/LP-leg sizing bug, a missing revert check, an
// alerting gap) does NOT automatically apply to the other. Manually check
// the other file whenever you fix something security-relevant here.
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, defineChain, http, type Hex, type PublicClient } from "viem";
import { buildProposeDecisionInput, buildPolicyLimitsStruct } from "../agent/core/context.js";
import { getVaultState, type KnownAsset } from "../agent/core/tools/getVaultState.js";
import { getMarketData, hasIndependentReferencePrice } from "../agent/core/tools/getMarketData.js";
import { proposeDecision } from "../agent/core/loop.js";
import { checkPolicyOffchain } from "../agent/policy/offchainPolicyCheck.js";
import { DecisionPipeline, type DecisionPipelineEntry } from "../server/decisionPipeline.js";
import type { AssetSymbol, VaultDecision } from "../shared/decision.js";
import type { PolicyCheckResult, PolicyLimits } from "../shared/policyTypes.js";
import type { MarketData, VaultState } from "../agent/core/types.js";
import { parseRawAmount } from "../shared/money.js";
import type { Executor, ExecutionResult } from "./types.js";
import { ConsoleAlertSink, makeEvent, type AlertSink } from "../shared/alertSink.js";

// The only real, verified, allowlisted router/quoter in this project, see
// docs/arc-facts-to-verify.md. Hardcoded here rather than made per-vault
// configurable: every vault created so far allowlists this exact router at
// construction (scripts/deployArcTestnet.ts, scripts/deployVaultV2.ts), a
// genuinely different router would need its own allowlisting flow first,
// out of scope for this module.
const UNITFLOW_V3_ROUTER = "0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01" as const;
const UNITFLOW_V3_QUOTER = "0x121aeB6DEf00F6F67665008CaC1C19805886ed1a" as const;

// Deliberately more generous than mainnet-depth assumptions: the only real
// pool this has ever been verified against (WUSDC/cirBTC) is extremely
// thin (~0.00048 cirBTC total reserve, docs/arc-facts-to-verify.md), so
// even a modest trade can have real, meaningful price impact. 3% leaves
// room for that without being so loose it stops protecting anything.
const SLIPPAGE_TOLERANCE_BPS = 300n;
const SWAP_DEADLINE_BUFFER_SECONDS = 600n;

const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const POLICY_GETTER_ABI = [
  { type: "function", name: "policy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// The real, verified UnitFlowV3PositionManager (0x0553682bc188b850acd31CBd3500Dcd0aa35372B,
// see docs/arc-facts-to-verify.md item 5 for why this specific instance
// was chosen over the two older ones from the same deployer), just the
// two read-only views buildLpLeg needs (current liquidity/range, to size
// a real LP_DECREASE without guessing).
const POSITION_MANAGER_MIN_ABI = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

// Verified live, see docs/arc-facts-to-verify.md and hardhat.config.ts's
// arcTestnet network entry. Defined here directly (not imported from
// Hardhat config) since this module must run outside a Hardhat project,
// same rule agent/core follows.
const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

// Mirrors contracts/interfaces/IVaultPolicy.sol's DecisionAction enum
// order exactly (Solidity enums are just uint8 indices in declaration
// order); the 5 LP_* values only ever matter for v3, see this project's
// v3 design doc.
const DECISION_ACTION_INDEX: Record<VaultDecision["action"], number> = {
  HOLD: 0,
  REBALANCE: 1,
  ENTER: 2,
  EXIT: 3,
  EMERGENCY_EXIT_TO_STABLE: 4,
  LP_OPEN: 5,
  LP_INCREASE: 6,
  LP_DECREASE: 7,
  LP_COLLECT: 8,
  LP_CLOSE: 9,
  // v4 only, unreachable for v1/v2/v3 in practice (this file's own real
  // vaults never receive these), present only so DecisionAction's shared,
  // wider type (now that v4's actions exist) stays exhaustively mapped
  // here, same pre-existing "index exists, action never actually reaches
  // this file's real vaults" situation LP_OPEN..LP_CLOSE already are for
  // v1/v2. See executor/keeperServiceV4.ts for the module that actually
  // uses these.
  BRIDGE_DEPOSIT: 10,
  BRIDGE_WITHDRAW: 11,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Phase 1 values, not yet governance-adjustable, see executor/README.md.
const HEARTBEAT_INTERVAL_MS = 60_000;
const EXECUTION_STUCK_TIMEOUT_SECONDS = 30 * 60;
const SELF_CONSISTENCY_SAMPLE_COUNT = 3;

const MANDATE_VAULT_KEEPER_ABI = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetDecimals", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "executeDecision",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "decision",
        type: "tuple",
        components: [
          { name: "action", type: "uint8" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          {
            name: "targetAllocations",
            type: "tuple[]",
            components: [
              { name: "asset", type: "address" },
              { name: "targetWeightBps", type: "uint16" },
            ],
          },
          { name: "lpPool", type: "address" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "lpTokenId", type: "uint256" },
          { name: "liquidityToRemove", type: "uint128" },
        ],
      },
      {
        name: "prices",
        type: "tuple[]",
        components: [
          { name: "asset", type: "address" },
          { name: "price", type: "uint256" },
          { name: "referencePrice", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
        ],
      },
      {
        name: "swaps",
        type: "tuple[]",
        components: [
          { name: "router", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "lpLeg",
        type: "tuple",
        components: [
          { name: "pool", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

interface OnchainLpLeg {
  pool: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  tokenId: bigint;
  liquidity: bigint;
  deadline: bigint;
}

// pool == ZERO_ADDRESS means "no LP action this call," the exact
// convention MandateVault.sol's executeDecision itself uses.
const EMPTY_LP_LEG: OnchainLpLeg = {
  pool: "0x0000000000000000000000000000000000000000",
  fee: 0,
  tickLower: 0,
  tickUpper: 0,
  amount0Desired: 0n,
  amount1Desired: 0n,
  amount0Min: 0n,
  amount1Min: 0n,
  tokenId: 0n,
  liquidity: 0n,
  deadline: 0n,
};

interface OnchainAssetPrice {
  asset: `0x${string}`;
  price: bigint;
  referencePrice: bigint;
  updatedAt: bigint;
}

interface OnchainSwapLeg {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  sqrtPriceLimitX96: bigint;
}

/// @notice process.env only, never hardcoded, never included in any thrown
/// error's message. Not exported, not cached on any object another module
/// could import, only ever referenced inside this file's own closures, see
/// executor/README.md's "single-purpose module... imported by nothing else."
function loadKeeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) {
    throw new Error("KEEPER_PRIVATE_KEY is not set. Set it in .env, never hardcode it.");
  }
  return privateKeyToAccount(key as Hex);
}

/// @notice Converts a decision's AssetSymbol-keyed fields into the
/// address-keyed Decision struct MandateVault.sol actually expects. asset/
/// amount/targetAllocations are genuinely unused onchain for HOLD and
/// EMERGENCY_EXIT_TO_STABLE (see IVaultPolicy.sol's own "unused otherwise"
/// comments), so this only needs to resolve them correctly for
/// ENTER/EXIT/REBALANCE, which this module does not yet execute (see
/// buildSwapLegs below).
function resolveAssetAddress(symbol: AssetSymbol, assets: KnownAsset[]): `0x${string}` {
  const known = assets.find((a) => a.symbol === symbol);
  if (!known) {
    throw new Error(`Cannot resolve onchain address for asset symbol "${symbol}", it is not in the known-asset list.`);
  }
  return known.address;
}

const EMPTY_ONCHAIN_DECISION_LP_FIELDS = {
  lpPool: ZERO_ADDRESS,
  tickLower: 0,
  tickUpper: 0,
  amount0Desired: 0n,
  amount1Desired: 0n,
  amount0Min: 0n,
  amount1Min: 0n,
  lpTokenId: 0n,
  liquidityToRemove: 0n,
};

const LP_ACTIONS = new Set<VaultDecision["action"]>(["LP_OPEN", "LP_INCREASE", "LP_DECREASE", "LP_COLLECT", "LP_CLOSE"]);

async function buildOnchainDecision(decision: VaultDecision, assets: KnownAsset[], publicClient: PublicClient, vaultAddress: `0x${string}`) {
  const actionIndex = DECISION_ACTION_INDEX[decision.action];
  if (decision.action === "ENTER" || decision.action === "EXIT") {
    if (!decision.asset || !decision.amount) {
      throw new Error(`${decision.action} decision is missing asset/amount, cannot build onchain calldata.`);
    }
    const asset = resolveAssetAddress(decision.asset, assets);
    // Same live-verified decimals source as buildOnchainPrices below, never
    // trust a hand-carried decimals value for an onchain amount.
    const decimals = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [asset] });
    return {
      action: actionIndex,
      asset,
      amount: parseRawAmount(decision.amount, decimals),
      targetAllocations: [],
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
    };
  }
  if (decision.action === "REBALANCE") {
    if (!decision.targetAllocations || decision.targetAllocations.length === 0) {
      throw new Error("REBALANCE decision is missing targetAllocations, cannot build onchain calldata.");
    }
    return {
      action: actionIndex,
      asset: ZERO_ADDRESS,
      amount: 0n,
      targetAllocations: decision.targetAllocations.map((t) => ({
        asset: resolveAssetAddress(t.asset, assets),
        targetWeightBps: t.targetWeightBps,
      })),
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
    };
  }
  if (LP_ACTIONS.has(decision.action)) {
    // Only the fields VaultPolicy.sol's checks actually read from Decision
    // directly matter here (lpPool/tickLower/tickUpper for LP_OPEN's range-
    // width check); the real mint/increase/decrease amounts live on the
    // separately-built LpLeg (buildLpLeg below), same "decision states
    // intent, the leg carries fresh execution mechanics" split SwapLeg
    // already uses.
    if (decision.action === "LP_OPEN" && (decision.tickLower === undefined || decision.tickUpper === undefined || !decision.lpPool)) {
      throw new Error("LP_OPEN decision is missing lpPool/tickLower/tickUpper, cannot build onchain calldata.");
    }
    return {
      action: actionIndex,
      asset: ZERO_ADDRESS,
      amount: 0n,
      targetAllocations: [],
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
      lpPool: decision.lpPool ?? ZERO_ADDRESS,
      tickLower: decision.tickLower ?? 0,
      tickUpper: decision.tickUpper ?? 0,
      lpTokenId: decision.lpTokenId ? BigInt(decision.lpTokenId) : 0n,
    };
  }
  // HOLD and EMERGENCY_EXIT_TO_STABLE: asset/amount/targetAllocations/LP
  // fields are unused onchain, see IVaultPolicy.sol.
  return { action: actionIndex, asset: ZERO_ADDRESS, amount: 0n, targetAllocations: [], ...EMPTY_ONCHAIN_DECISION_LP_FIELDS };
}

/// @notice Scale confirmed live, not guessed, and re-derived carefully
/// after a real Foundry fork test caught this being wrong: MandateVault.sol's
/// _valueInUSDC does `(amount * price) / (10 ** assetDecimals[asset])`
/// where `amount` is the PRICED asset's own raw ledger amount. Working
/// through the algebra for the result to land in the BASE asset's own raw
/// units (matching how totalAssets() sums everything): price must be
/// scaled by the BASE asset's decimals, not the priced asset's own
/// decimals. This bug was latent and harmless until now: every real
/// executeDecision call so far only ever priced the base asset itself
/// (USDC), and the base asset's own cached price is never read by
/// _valueInUSDC (totalAssets() values it directly via _ledger[asset()]
/// instead), so the wrong scale never affected anything. It became live
/// and wrong the moment a real non-base asset (cirBTC) needed pricing for
/// ENTER/EXIT/REBALANCE, caught by test_executeDecisionRevertsAndRollsBackRealSwap_WhenPolicyViolated
/// (test/MandateVaultArcFork.t.sol) failing to revert as expected: an
/// under-scaled cirBTC price made its computed valueUSDC always ~0,
/// trivially passing any allocation cap regardless of the real swap.
async function buildOnchainPrices(
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
  marketData: MarketData,
  assets: KnownAsset[],
): Promise<OnchainAssetPrice[]> {
  const baseAsset = assets.find((a) => a.isBaseAsset);
  if (!baseAsset) throw new Error("buildOnchainPrices requires exactly one asset marked isBaseAsset.");
  const baseAssetDecimals = await publicClient.readContract({
    address: vaultAddress,
    abi: MANDATE_VAULT_KEEPER_ABI,
    functionName: "assetDecimals",
    args: [baseAsset.address],
  });

  return Promise.all(
    marketData.prices.map(async (p) => {
      const asset = resolveAssetAddress(p.asset, assets);
      return {
        asset,
        price: parseRawAmount(p.priceUSDC, baseAssetDecimals),
        referencePrice: parseRawAmount(p.referencePriceUSDC, baseAssetDecimals),
        updatedAt: BigInt(Math.floor(new Date(p.updatedAt).getTime() / 1000)),
      };
    }),
  );
}

/// @notice Quotes a real swap against the real UnitFlowV3 Quoter
/// (eth_call, no state change, no gas) for the actual requested trade
/// size, right before building the leg, never reusing the reasoning-time
/// marketData price for this step: minAmountOut must reflect the pool's
/// current state at submission time, that is the entire point of slippage
/// protection, see executor/README.md. sqrtPriceLimitX96 left at 0 (no
/// limit), same as test/MandateVaultArcFork.t.sol's existing precedent,
/// minAmountOut is the sole protection mechanism.
///
/// Design choice, not an inconsistency: this file uses two genuinely
/// different "prices" and always keeps them separate on purpose.
///   1. The reasoning/sizing price (marketData.prices, reused from
///      proposal time per buildOnchainPrices/currentOrRefreshedMarketData,
///      refreshed only once it is older than the vault's own
///      oracleMaxStalenessSeconds) decides how much to trade: it answers
///      "what does the agent believe this asset is worth," and must stay
///      stable between proposal and execution so ops is confirming the
///      same numbers the keeper later acts on.
///   2. The slippage-protection quote (this function, called fresh, every
///      time, right before submission) decides minAmountOut: it answers
///      "what will this pool actually give me right now," which by
///      definition cannot be reused from an earlier moment, market
///      conditions (and this project's thin real pools especially) can
///      move between proposal and keeper execution.
/// Reusing (1) for minAmountOut would under-protect a swap against a pool
/// that moved since proposal; re-fetching for (2) would defeat the whole
/// point of proposal-time price consistency. Never conflate the two.
async function quoteAndBuildLeg(
  publicClient: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
  amountIn: bigint,
): Promise<OnchainSwapLeg> {
  const amountOut = await publicClient.readContract({
    address: UNITFLOW_V3_QUOTER,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [tokenIn, tokenOut, fee, amountIn, 0n],
  });
  const minAmountOut = (amountOut * (10_000n - SLIPPAGE_TOLERANCE_BPS)) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + SWAP_DEADLINE_BUFFER_SECONDS;
  return { router: UNITFLOW_V3_ROUTER, tokenIn, tokenOut, fee, amountIn, minAmountOut, deadline, sqrtPriceLimitX96: 0n };
}

function requireAssetDecimalsAndAddress(symbol: AssetSymbol, assets: KnownAsset[], assetDecimalsBySymbol: Record<AssetSymbol, number>) {
  const known = assets.find((a) => a.symbol === symbol);
  if (!known) throw new Error(`Cannot resolve onchain address for asset symbol "${symbol}", it is not in the known-asset list.`);
  const decimals = assetDecimalsBySymbol[symbol];
  if (decimals === undefined) throw new Error(`No known decimals for asset symbol "${symbol}", cannot size a swap leg.`);
  return { address: known.address, decimals };
}

/// @notice SECURITY hard gate, not just a comment: refuses to build any
/// swap leg that would BUY (increase onchain allocation into) an asset
/// whose referencePriceUSDC is not genuinely independent from priceUSDC
/// (agent/core/tools/getMarketData.ts's hasIndependentReferencePrice).
/// Today this is exactly cirBTC: its referencePriceUSDC is set equal to
/// priceUSDC (no independent source exists, confirmed live against
/// Chainlink's own Price Feed addresses page, see getMarketData.ts), which
/// makes VaultPolicy's onchain oracleMaxDeviationBps check
/// (_deviationBps(price, referencePrice)) a permanent no-op for it. That
/// check exists specifically to catch a single manipulated feed being used
/// to make an over-cap allocation appear compliant, so buying more of an
/// asset using a price this check cannot meaningfully validate is exactly
/// the exposure to close. Selling is deliberately NOT blocked here
/// (EXIT, REBALANCE reducing this asset's target, and
/// EMERGENCY_EXIT_TO_STABLE, which already skips this check entirely, see
/// VaultPolicy.sol's early return): reducing exposure to an asset can
/// never be the harmful direction for this specific manipulation, and
/// EMERGENCY_EXIT_TO_STABLE must keep working as an unconditional safety
/// valve. Revisit only once hasIndependentReferencePrice(asset) is true.
function requireIndependentReferencePriceToBuy(symbol: AssetSymbol): void {
  if (!hasIndependentReferencePrice(symbol)) {
    throw new Error(
      `Refusing to build a swap leg that buys ${symbol}: no genuinely independent reference price source exists for it yet, so VaultPolicy's onchain oracle-deviation check cannot meaningfully validate this allocation (see agent/core/tools/getMarketData.ts's hasIndependentReferencePrice and docs/arc-facts-to-verify.md). Selling out of ${symbol} remains allowed; only new buys are blocked until this is fixed.`,
    );
  }
}

/// @notice v3's own extension of the exact same hard block above, applied
/// to LP_OPEN/LP_INCREASE instead of a direct buy. Providing liquidity
/// into a pool priced by an asset with no independent reference price is,
/// if anything, a WORSE manipulation surface than a simple directional
/// buy: an attacker can manipulate the pool's own spot price immediately
/// before this vault mints/increases a position to force it into a bad
/// range or an unfavorable amount0/amount1 split, and this vault's own
/// LP valuation (MandateVault.sol's _valueLpPositions) reads that exact
/// same manipulable spot price. Confirmed: both of v3's only
/// two real-liquidity pools (WUSDC/cirBTC, EURC/cirBTC) involve cirBTC,
/// so this blocks real LP_OPEN/LP_INCREASE execution entirely today,
/// same documented, disclosed situation as v2's cirBTC ENTER, until an
/// independent cirBTC feed exists. LP_DECREASE/LP_COLLECT/LP_CLOSE are
/// deliberately NOT gated here, same "reducing exposure is always fine"
/// rule as requireIndependentReferencePriceToBuy above.
function requireIndependentReferencePriceForLp(pool: { token0Symbol: AssetSymbol; token1Symbol: AssetSymbol }): void {
  for (const symbol of [pool.token0Symbol, pool.token1Symbol]) {
    if (!hasIndependentReferencePrice(symbol)) {
      throw new Error(
        `Refusing to open/increase an LP position touching ${symbol}: no genuinely independent reference price source exists for it yet, so this vault's own LP position valuation (reading the pool's own spot price) cannot be meaningfully trusted (see agent/core/tools/getMarketData.ts's hasIndependentReferencePrice and docs/arc-facts-to-verify.md). Reducing or closing an existing position remains allowed; only opening/increasing new exposure is blocked until this is fixed.`,
      );
    }
  }
}

/// @notice Real swap-leg construction for ENTER/EXIT/REBALANCE, quoting
/// against the real UnitFlowV3 Quoter, respecting existing policy limits
/// by construction (nothing here bypasses VaultPolicy, it only ever sizes
/// a realistic trade for the onchain gate to actually evaluate). HOLD and
/// EMERGENCY_EXIT_TO_STABLE (on today's real vaults, always USDC-only or
/// USDC+cirBTC with cirBTC never actually enterable, see
/// docs/deployments.md) still return [], nothing to swap.
///
/// amountIn is always derived from the SAME marketData price already
/// reused elsewhere in this file (point 2's rule: never re-fetch the
/// reasoning price), the base asset is valued 1:1 USD, same convention
/// agent/core/tools/getVaultState.ts already uses for it.
async function buildSwapLegs(
  decision: VaultDecision,
  vaultState: VaultState,
  marketData: MarketData,
  assets: KnownAsset[],
  publicClient: PublicClient,
  poolFeeByAssetSymbol: Record<AssetSymbol, number>,
  assetDecimalsBySymbol: Record<AssetSymbol, number>,
): Promise<OnchainSwapLeg[]> {
  const baseAsset = assets.find((a) => a.isBaseAsset);
  if (!baseAsset) throw new Error("buildSwapLegs requires exactly one asset marked isBaseAsset.");

  const priceOf = (symbol: AssetSymbol): number => {
    const entry = marketData.prices.find((p) => p.asset === symbol);
    if (!entry) throw new Error(`No market price available for ${symbol}, cannot size a swap leg. See agent/core/tools/getMarketData.ts.`);
    return Number(entry.priceUSDC);
  };
  const feeFor = (symbol: AssetSymbol): number => {
    const fee = poolFeeByAssetSymbol[symbol];
    if (fee === undefined) throw new Error(`No configured pool fee for ${symbol}, cannot size a swap leg.`);
    return fee;
  };

  if (decision.action === "HOLD") return [];

  if (decision.action === "EMERGENCY_EXIT_TO_STABLE") {
    const legs: OnchainSwapLeg[] = [];
    for (const holding of vaultState.holdings) {
      if (holding.asset === baseAsset.symbol) continue;
      const amountHuman = Number(holding.ledgerAmount);
      if (amountHuman <= 0) continue;
      const { address: tokenIn, decimals } = requireAssetDecimalsAndAddress(holding.asset, assets, assetDecimalsBySymbol);
      const amountIn = parseRawAmount(holding.ledgerAmount, decimals);
      legs.push(await quoteAndBuildLeg(publicClient, tokenIn, baseAsset.address, feeFor(holding.asset), amountIn));
    }
    return legs;
  }

  if (decision.action === "ENTER" || decision.action === "EXIT") {
    if (!decision.asset || !decision.amount) throw new Error(`${decision.action} decision is missing asset/amount, cannot build a swap leg.`);
    const { address: targetAddress, decimals: targetDecimals } = requireAssetDecimalsAndAddress(decision.asset, assets, assetDecimalsBySymbol);
    if (decision.action === "ENTER") {
      requireIndependentReferencePriceToBuy(decision.asset);
      // decision.amount is the desired amount of the TARGET asset (its own
      // units), converted to a base-asset (USDC, 1:1 USD) amountIn via the
      // reused reasoning price.
      const amountInUSD = Number(decision.amount) * priceOf(decision.asset);
      const amountIn = parseRawAmount(amountInUSD.toString(), assetDecimalsBySymbol[baseAsset.symbol]);
      return [await quoteAndBuildLeg(publicClient, baseAsset.address, targetAddress, feeFor(decision.asset), amountIn)];
    }
    // EXIT: decision.amount already is the input amount, the target
    // asset's own units, no price conversion needed.
    const amountIn = parseRawAmount(decision.amount, targetDecimals);
    return [await quoteAndBuildLeg(publicClient, targetAddress, baseAsset.address, feeFor(decision.asset), amountIn)];
  }

  // Standalone LP_* actions (not wrapped in EMERGENCY_EXIT_TO_STABLE) need
  // no swap legs at all: buildLpLeg alone builds their entire onchain
  // effect, same "empty swaps for HOLD" convention. Found and fixed
  // 2026-07-14: without this explicit return, every one of these 5 action
  // types fell through to the REBALANCE branch below and threw ("REBALANCE
  // decision is missing targetAllocations"), since none of them ever set
  // decision.targetAllocations. This made the entire LP lifecycle
  // unreachable via the real keeper before this fix.
  if (LP_ACTIONS.has(decision.action)) return [];

  // REBALANCE: reduces to one leg per non-base asset whose target bps
  // differs from its current bps, reusing the same quote-and-build helper.
  // Today's real vaults hold at most one non-base asset (cirBTC on v2),
  // so this only ever produces 0 or 1 legs in practice, written generally
  // rather than hardcoded to that shape.
  if (!decision.targetAllocations || decision.targetAllocations.length === 0) {
    throw new Error("REBALANCE decision is missing targetAllocations, cannot build swap legs.");
  }
  const totalAssetsUSDC = Number(vaultState.totalAssetsUSDC);
  const legs: OnchainSwapLeg[] = [];
  for (const target of decision.targetAllocations) {
    if (target.asset === baseAsset.symbol) continue;
    const currentHolding = vaultState.holdings.find((h) => h.asset === target.asset);
    const currentValueUSDC = currentHolding ? Number(currentHolding.valueUSDC) : 0;
    const targetValueUSDC = (target.targetWeightBps / 10_000) * totalAssetsUSDC;
    const deltaUSDC = targetValueUSDC - currentValueUSDC;
    if (Math.abs(deltaUSDC) < Number.EPSILON) continue;

    const { address: targetAddress, decimals: targetDecimals } = requireAssetDecimalsAndAddress(target.asset, assets, assetDecimalsBySymbol);
    if (deltaUSDC > 0) {
      // Need more of this asset: buy it with the base asset (1:1 USD).
      requireIndependentReferencePriceToBuy(target.asset);
      const amountIn = parseRawAmount(deltaUSDC.toString(), assetDecimalsBySymbol[baseAsset.symbol]);
      legs.push(await quoteAndBuildLeg(publicClient, baseAsset.address, targetAddress, feeFor(target.asset), amountIn));
    } else {
      // Need less: sell enough of it, in its own units, to reduce by
      // roughly |deltaUSDC|.
      const amountInAsset = Math.abs(deltaUSDC) / priceOf(target.asset);
      const amountIn = parseRawAmount(amountInAsset.toString(), targetDecimals);
      legs.push(await quoteAndBuildLeg(publicClient, targetAddress, baseAsset.address, feeFor(target.asset), amountIn));
    }
  }
  return legs;
}

const POOL_MIN_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

function symbolForAddress(address: `0x${string}`, assets: KnownAsset[]): AssetSymbol {
  const known = assets.find((a) => a.address.toLowerCase() === address.toLowerCase());
  if (!known) throw new Error(`Cannot resolve asset symbol for pool token address ${address}, it is not in the known-asset list.`);
  return known.symbol;
}

/// @notice v3's own LP-leg construction, the LP counterpart to
/// buildSwapLegs. Returns EMPTY_LP_LEG (pool == ZERO_ADDRESS, "no LP
/// action this call") for every non-LP action, same convention an empty
/// swaps[] already uses for HOLD.
///
/// LP_OPEN/LP_INCREASE are gated by requireIndependentReferencePriceForLp
/// before any amount is computed, same "check first, never quote a
/// blocked trade" order buildSwapLegs already follows for ENTER/REBALANCE
/// buys. Confirmed today: this blocks both real actions entirely (v3's
/// only two real-liquidity pools both involve cirBTC), the mechanism
/// below is real and fork-testable, not currently reachable against real
/// capital, same disclosed situation as v2's cirBTC ENTER.
///
/// LP_DECREASE/LP_COLLECT/LP_CLOSE deliberately use amount0Min/amount1Min
/// = 0 (no slippage protection) for this round: unlike a fresh swap, a
/// decrease only returns principal this vault already deposited, a lower-
/// stakes operation than a new trade, and adding real protection here
/// would require porting Uniswap's tick/liquidity math into TypeScript
/// too (already done once, correctly, in contracts/lib/ for the onchain
/// side). A real, honest gap, not built yet, flagged the same way this
/// project already flags every other deliberately-deferred piece, never
/// silently guessed.
async function buildLpLeg(
  decision: VaultDecision,
  assets: KnownAsset[],
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
): Promise<OnchainLpLeg> {
  if (!LP_ACTIONS.has(decision.action)) return EMPTY_LP_LEG;

  const positionManager = await publicClient.readContract({ address: vaultAddress, abi: [{ type: "function", name: "positionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "positionManager" });
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + SWAP_DEADLINE_BUFFER_SECONDS;

  if (decision.action === "LP_OPEN") {
    if (!decision.lpPool || decision.tickLower === undefined || decision.tickUpper === undefined || !decision.amount0Desired || !decision.amount1Desired || decision.lpFeeTier === undefined) {
      throw new Error("LP_OPEN decision is missing lpPool/tickLower/tickUpper/amount0Desired/amount1Desired/lpFeeTier, cannot build an LP leg.");
    }
    const [token0, token1] = await Promise.all([
      publicClient.readContract({ address: decision.lpPool, abi: POOL_MIN_ABI, functionName: "token0" }),
      publicClient.readContract({ address: decision.lpPool, abi: POOL_MIN_ABI, functionName: "token1" }),
    ]);
    const token0Symbol = symbolForAddress(token0, assets);
    const token1Symbol = symbolForAddress(token1, assets);
    requireIndependentReferencePriceForLp({ token0Symbol, token1Symbol });

    const [decimals0, decimals1] = await Promise.all([
      publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [token0] }),
      publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [token1] }),
    ]);
    return {
      pool: decision.lpPool,
      fee: decision.lpFeeTier,
      tickLower: decision.tickLower,
      tickUpper: decision.tickUpper,
      amount0Desired: parseRawAmount(decision.amount0Desired, decimals0),
      amount1Desired: parseRawAmount(decision.amount1Desired, decimals1),
      amount0Min: 0n,
      amount1Min: 0n,
      tokenId: 0n,
      liquidity: 0n,
      deadline,
    };
  }

  if (!decision.lpTokenId) {
    throw new Error(`${decision.action} decision is missing lpTokenId, cannot build an LP leg.`);
  }
  const tokenId = BigInt(decision.lpTokenId);
  const position = await publicClient.readContract({ address: positionManager, abi: POSITION_MANAGER_MIN_ABI, functionName: "positions", args: [tokenId] });
  const [, , token0, token1, fee, tickLower, tickUpper, currentLiquidity] = position;

  if (decision.action === "LP_INCREASE") {
    if (!decision.amount0Desired || !decision.amount1Desired) {
      throw new Error("LP_INCREASE decision is missing amount0Desired/amount1Desired, cannot build an LP leg.");
    }
    const token0Symbol = symbolForAddress(token0, assets);
    const token1Symbol = symbolForAddress(token1, assets);
    requireIndependentReferencePriceForLp({ token0Symbol, token1Symbol });
    const [decimals0, decimals1] = await Promise.all([
      publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [token0] }),
      publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [token1] }),
    ]);
    return {
      pool: ZERO_ADDRESS,
      fee,
      tickLower,
      tickUpper,
      amount0Desired: parseRawAmount(decision.amount0Desired, decimals0),
      amount1Desired: parseRawAmount(decision.amount1Desired, decimals1),
      amount0Min: 0n,
      amount1Min: 0n,
      tokenId,
      liquidity: 0n,
      deadline,
    };
  }

  if (decision.action === "LP_DECREASE") {
    const fractionBps = BigInt(decision.liquidityFractionBps ?? 0);
    if (fractionBps <= 0n || fractionBps > 10_000n) {
      throw new Error(`LP_DECREASE decision has an invalid liquidityFractionBps (${decision.liquidityFractionBps}), must be in (0, 10000].`);
    }
    const liquidity = (currentLiquidity * fractionBps) / 10_000n;
    return { pool: ZERO_ADDRESS, fee, tickLower, tickUpper, amount0Desired: 0n, amount1Desired: 0n, amount0Min: 0n, amount1Min: 0n, tokenId, liquidity, deadline };
  }

  // LP_COLLECT and LP_CLOSE: no amounts/liquidity to size, MandateVault's
  // _lpCollect/_lpClose always sweep everything available (tokensOwed for
  // COLLECT, the position's full current liquidity plus tokensOwed for
  // CLOSE), see contracts/MandateVault.sol.
  return { pool: ZERO_ADDRESS, fee, tickLower, tickUpper, amount0Desired: 0n, amount1Desired: 0n, amount0Min: 0n, amount1Min: 0n, tokenId, liquidity: 0n, deadline };
}

export interface KeeperServiceConfig {
  publicClient: PublicClient;
  vaultAddress: `0x${string}`;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  strategyVersion: string;
  strategyConfigText: string;
  pipeline: DecisionPipeline;
  // Real pool fee tier per non-base asset symbol, needed to size a real
  // swap leg (ISwapRouter/IQuoter's fee param). Only asset symbols this
  // vault could ever ENTER/EXIT/REBALANCE into need an entry, see
  // docs/deployments.md for the real v2 vault's cirBTC fee tier (3000).
  poolFeeByAssetSymbol?: Record<AssetSymbol, number>;
  alertSink?: AlertSink;
  // Injectable seams, real implementations by default. test/keeperService.ts
  // swaps these for fixtures so nonce sequencing, no-retry behavior, and
  // self-consistency branching can be tested without a real signer, a real
  // Anthropic API call, or a live chain, see agent/core/README.md's own
  // "cost real money, keep separate from the free suite" discipline applied
  // here to the keeper's real dependencies instead.
  keeperAccount?: ReturnType<typeof privateKeyToAccount>;
  walletClient?: ReturnType<typeof createWalletClient>;
  getVaultStateFn?: typeof getVaultState;
  buildPolicyLimitsStructFn?: typeof buildPolicyLimitsStruct;
  getMarketDataFn?: typeof getMarketData;
  buildProposeDecisionInputFn?: typeof buildProposeDecisionInput;
  proposeDecisionFn?: typeof proposeDecision;
}

/// @notice Implements Executor (executor/types.ts) for structural
/// compatibility with the same swappable-implementation seam PaperExecutor
/// uses, docs/architecture.md's "only the injected executor changes."
/// execute() is the narrow, general-purpose entrypoint (no stored
/// marketData to reuse, fetches fresh); processEntry/runOnce/runLoop are
/// this service's own richer, pipeline-aware orchestration, and are what a
/// real deployment actually calls.
export class KeeperService implements Executor {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly walletClient: ReturnType<typeof createWalletClient>;
  private readonly alertSink: AlertSink;
  private readonly getVaultStateFn: typeof getVaultState;
  private readonly buildPolicyLimitsStructFn: typeof buildPolicyLimitsStruct;
  private readonly getMarketDataFn: typeof getMarketData;
  private readonly buildProposeDecisionInputFn: typeof buildProposeDecisionInput;
  private readonly proposeDecisionFn: typeof proposeDecision;

  constructor(private readonly config: KeeperServiceConfig) {
    this.account = config.keeperAccount ?? loadKeeperAccount();
    this.walletClient = config.walletClient ?? createWalletClient({ account: this.account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
    this.alertSink = config.alertSink ?? new ConsoleAlertSink();
    this.getVaultStateFn = config.getVaultStateFn ?? getVaultState;
    this.buildPolicyLimitsStructFn = config.buildPolicyLimitsStructFn ?? buildPolicyLimitsStruct;
    this.getMarketDataFn = config.getMarketDataFn ?? getMarketData;
    this.buildProposeDecisionInputFn = config.buildProposeDecisionInputFn ?? buildProposeDecisionInput;
    this.proposeDecisionFn = config.proposeDecisionFn ?? proposeDecision;
  }

  /// @notice Satisfies the Executor interface exactly (decision +
  /// already-computed policyCheck, mirroring PaperExecutor's signature).
  /// Has no stored marketData to reuse at this call boundary, so it fetches
  /// current state/price fresh; the real pipeline-integrated path
  /// (processEntry, called by runOnce) is what does true price reuse per
  /// point 2, since only it has access to a DecisionPipelineEntry.
  async execute(decision: VaultDecision, policyCheck: PolicyCheckResult): Promise<ExecutionResult & { txHash: `0x${string}` }> {
    void policyCheck;
    const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
    const [vaultState, policyLimits, marketData] = await Promise.all([
      this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
      this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset }))),
    ]);
    const txHash = await this.executeWithLpUnwind(decision, vaultState, marketData);
    return { mode: "live", executedAt: new Date().toISOString(), txHash };
  }

  /// @notice EMERGENCY_EXIT_TO_STABLE's real entry point: closes any open
  /// LP position first (closeAllOpenLpPositions), re-reads vaultState fresh
  /// so the ledger sweep below sees the tokens those closes just returned,
  /// then runs the existing base-ledger sweep. Every other decision/action
  /// (including EMERGENCY_EXIT_TO_STABLE on a vault with nothing open,
  /// v1/v2's own permanent case) is unaffected: falls straight through to
  /// the original single submitExecution call, zero behavior change.
  private async executeWithLpUnwind(decision: VaultDecision, vaultState: VaultState, marketData: MarketData): Promise<`0x${string}`> {
    if (decision.action !== "EMERGENCY_EXIT_TO_STABLE" || vaultState.lpPositions.length === 0) {
      return this.submitExecution(decision, vaultState, marketData);
    }

    const closeHashes = await this.closeAllOpenLpPositions(vaultState.lpPositions, marketData);
    this.alertSink.send(
      makeEvent(
        "warning",
        "EMERGENCY_EXIT_LP_POSITIONS_CLOSED",
        `EMERGENCY_EXIT_TO_STABLE closed ${closeHashes.length} open LP position(s) before sweeping ledger holdings to stable: ${closeHashes.join(", ")}.`,
      ),
    );

    const freshVaultState = await this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets);
    return this.submitExecution(decision, freshVaultState, marketData);
  }

  /// @notice The real path: called once per confirmed, not-yet-executed
  /// entry. Reuses entry.marketData unless it is now stale (point 2),
  /// re-verifies against current state, runs the EMERGENCY_EXIT_TO_STABLE
  /// self-consistency gate (point 7) before ever submitting, and never
  /// retries on its own (point 5).
  async processEntry(entry: DecisionPipelineEntry): Promise<void> {
    const decision = entry.queued.decision;
    try {
      const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
      const [vaultState, policyLimits] = await Promise.all([
        this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
        this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      ]);

      // Point 2: reuse the stored price unless it is now stale relative to
      // the vault's own oracleMaxStalenessSeconds, refresh only if needed.
      const marketData = await this.currentOrRefreshedMarketData(entry, policyLimits);

      // Point 3, cheap half: re-verify against current state before ever
      // touching the chain, conditions may have changed since ops confirmed.
      const freshCheck = checkPolicyOffchain({ decision, vaultState, policyLimits, marketData, assets: this.config.assets });
      if (!freshCheck.passed) {
        this.alertSink.send(
          makeEvent("warning", "EXECUTION_ABORTED_PRECHECK", `decisionId ${entry.decisionId}: current state now fails the offchain pre-check: ${freshCheck.violations.map((v) => v.code).join(", ")}.`),
        );
        return;
      }

      // Point 7: EMERGENCY_EXIT_TO_STABLE self-consistency gate, only for
      // this action, confirmed deliberately.
      if (decision.action === "EMERGENCY_EXIT_TO_STABLE") {
        const agrees = await this.checkEmergencyExitSelfConsistency();
        if (!agrees) {
          const flag = {
            code: "SELF_CONSISTENCY_DISAGREEMENT" as const,
            detail: `${SELF_CONSISTENCY_SAMPLE_COUNT} fresh proposals did not unanimously agree with the already-confirmed EMERGENCY_EXIT_TO_STABLE decision.`,
          };
          this.config.pipeline.returnToQueueForReview(entry.decisionId, flag);
          this.alertSink.send(
            makeEvent("critical", "SELF_CONSISTENCY_DISAGREEMENT", `decisionId ${entry.decisionId}: fresh proposals disagreed on EMERGENCY_EXIT_TO_STABLE, returned to ops queue with priority "high", never executed.`),
          );
          return;
        }
      }

      const txHash = await this.executeWithLpUnwind(decision, vaultState, marketData);
      this.config.pipeline.markExecuted(entry.decisionId, txHash);
    } catch (error) {
      // Point 5: never retry in a loop. Log, alert, leave the entry
      // "confirmed" (still visible, still stuck), a human decides next.
      this.alertSink.send(
        makeEvent("critical", "EXECUTION_FAILED", `decisionId ${entry.decisionId}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }

  /// @notice EMERGENCY_EXIT_TO_STABLE must be a genuinely unconditional
  /// safety valve, including for value sitting in an open LP position, not
  /// just simple ledger holdings. Found and fixed 2026-07-14: before this,
  /// an emergency exit silently left any open LP position untouched (its
  /// value still exposed to the pool's own manipulable slot0() price)
  /// because buildSwapLegs/buildLpLeg only ever built a close leg for a
  /// standalone LP_CLOSE decision, never for EMERGENCY_EXIT_TO_STABLE.
  ///
  /// Closes every open position one transaction at a time, each one still
  /// labeled decision.action = EMERGENCY_EXIT_TO_STABLE (never LP_CLOSE),
  /// so every single transaction in this sequence keeps benefiting from
  /// VaultPolicy's unconditional EMERGENCY_EXIT_TO_STABLE bypass
  /// (VaultPolicy.sol's early return) -- the whole point is that this must
  /// never depend on any other check (maxTradesPerDay included) staying
  /// satisfied. contracts/MandateVault.sol's _executeLpLeg treats an
  /// EMERGENCY_EXIT_TO_STABLE decision carrying a populated lpLeg as an
  /// implicit close, added specifically to make this possible.
  ///
  /// swaps is deliberately [] on every one of these calls: sweeping
  /// ledger holdings to stable happens exactly once, after every position
  /// is closed and vaultState has been re-read fresh (see execute/
  /// processEntry below), never interleaved per-position (a stale
  /// mid-sequence vaultState snapshot would try to re-sell the same
  /// holdings more than once and revert on insufficient balance).
  /// Waits for each receipt sequentially before submitting the next, same
  /// discipline submitExecution itself already follows.
  private async closeAllOpenLpPositions(lpPositions: VaultState["lpPositions"], marketData: MarketData): Promise<`0x${string}`[]> {
    const onchainPrices = await buildOnchainPrices(this.config.publicClient, this.config.vaultAddress, marketData, this.config.assets);
    const emergencyExitDecision: VaultDecision = {
      vaultId: this.config.vaultAddress,
      strategyVersion: this.config.strategyVersion,
      modelId: "system-emergency-exit-lp-close",
      action: "EMERGENCY_EXIT_TO_STABLE",
      confidence: 1,
      reasoning: "Closing an open LP position as part of an unconditional EMERGENCY_EXIT_TO_STABLE.",
      proposedAt: new Date().toISOString(),
    };
    const onchainDecision = await buildOnchainDecision(emergencyExitDecision, this.config.assets, this.config.publicClient, this.config.vaultAddress);

    const hashes: `0x${string}`[] = [];
    for (const position of lpPositions) {
      // buildLpLeg only builds a close-shaped leg for an action it
      // recognizes as LP_CLOSE; the actual submitted decision.action stays
      // EMERGENCY_EXIT_TO_STABLE (built above), this synthetic one is only
      // ever used to shape the leg, never sent onchain itself.
      const lpLeg = await buildLpLeg(
        { ...emergencyExitDecision, action: "LP_CLOSE", lpTokenId: position.tokenId },
        this.config.assets,
        this.config.publicClient,
        this.config.vaultAddress,
      );

      await this.config.publicClient.simulateContract({
        address: this.config.vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "executeDecision",
        args: [onchainDecision, onchainPrices, [], lpLeg],
        account: this.account,
      });
      const hash = await this.walletClient.writeContract({
        address: this.config.vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "executeDecision",
        args: [onchainDecision, onchainPrices, [], lpLeg],
        chain: ARC_TESTNET,
        account: this.account,
      });
      const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`EMERGENCY_EXIT_TO_STABLE's close of LP position tokenId ${position.tokenId} (tx ${hash}) reverted onchain.`);
      }
      hashes.push(hash);
    }
    return hashes;
  }

  /// @notice Shared core: builds onchain calldata, simulates (revert check),
  /// checks for an abnormal NAV delta post-execution, submits, waits for the
  /// receipt sequentially (point 4), never fires a second submission before
  /// this one's receipt lands.
  private async submitExecution(decision: VaultDecision, vaultState: VaultState, marketData: MarketData): Promise<`0x${string}`> {
    const onchainDecision = await buildOnchainDecision(decision, this.config.assets, this.config.publicClient, this.config.vaultAddress);
    const onchainPrices = await buildOnchainPrices(this.config.publicClient, this.config.vaultAddress, marketData, this.config.assets);

    const assetDecimalsBySymbol: Record<AssetSymbol, number> = {};
    await Promise.all(
      this.config.assets.map(async (asset) => {
        assetDecimalsBySymbol[asset.symbol] = await this.config.publicClient.readContract({
          address: this.config.vaultAddress,
          abi: MANDATE_VAULT_KEEPER_ABI,
          functionName: "assetDecimals",
          args: [asset.address],
        });
      }),
    );

    const swaps = await buildSwapLegs(
      decision,
      vaultState,
      marketData,
      this.config.assets,
      this.config.publicClient,
      this.config.poolFeeByAssetSymbol ?? {},
      assetDecimalsBySymbol,
    );
    const lpLeg = await buildLpLeg(decision, this.config.assets, this.config.publicClient, this.config.vaultAddress);

    // Point 3, real half: simulate before ever submitting.
    await this.config.publicClient.simulateContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps, lpLeg],
      account: this.account,
    });

    const preNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });

    const hash = await this.walletClient.writeContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps, lpLeg],
      chain: ARC_TESTNET,
      account: this.account,
    });
    const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`executeDecision transaction ${hash} reverted onchain.`);
    }

    // Abnormal-delta check, point 3: with zero swap legs (HOLD, or
    // EMERGENCY_EXIT_TO_STABLE on a vault with nothing non-base to exit),
    // NAV must not move at all. Cannot block a transaction that already
    // landed, but this is exactly the "second, application-layer check...
    // for abnormal deltas" docs/architecture.md calls for, real and
    // testable today. A real threshold for swaps.length > 0 (ENTER/EXIT/
    // REBALANCE, now genuinely reachable with real swap legs built above)
    // is a real, honest gap, not built yet: minAmountOut/slippage
    // tolerance already bounds the swap itself, but nothing here yet
    // separately bounds the resulting NAV/allocation delta beyond what
    // VaultPolicy's own pre/post validateDecision calls already enforce.
    if (swaps.length === 0) {
      const postNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });
      if (postNAV !== preNAV) {
        this.alertSink.send(
          makeEvent("critical", "ABNORMAL_NAV_DELTA", `${decision.action} executed with zero swap legs but totalAssets moved from ${preNAV} to ${postNAV}, this should never happen.`),
        );
      }
    }

    return hash;
  }

  /// @notice Point 2's refresh path: if any stored price is older than the
  /// vault's own oracleMaxStalenessSeconds (reused, not a new constant),
  /// fetch a fresh one instead of submitting a price the onchain gate would
  /// reject as stale anyway.
  private async currentOrRefreshedMarketData(entry: DecisionPipelineEntry, policyLimits: PolicyLimits): Promise<MarketData> {
    const now = Date.now();
    const isStale = entry.marketData.prices.some((p) => (now - new Date(p.updatedAt).getTime()) / 1000 > policyLimits.oracleMaxStalenessSeconds);
    if (!isStale) return entry.marketData;
    return this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset })));
  }

  /// @notice Standard self-consistency: one fresh input, sampled
  /// SELF_CONSISTENCY_SAMPLE_COUNT times, same methodology
  /// agent/core/promptInjection.test.ts already uses. Requires unanimous
  /// agreement, by deliberate design: EMERGENCY_EXIT_TO_STABLE bypasses
  /// every onchain allocation/drawdown check, so a single dissent is enough
  /// to hold off.
  private async checkEmergencyExitSelfConsistency(): Promise<boolean> {
    const input = await this.buildProposeDecisionInputFn({
      publicClient: this.config.publicClient,
      vaultAddress: this.config.vaultAddress,
      strategyVersion: this.config.strategyVersion,
      strategyConfigText: this.config.strategyConfigText,
      assets: this.config.assets,
      stableAssets: this.config.stableAssets,
    });
    const samples = await Promise.all(Array.from({ length: SELF_CONSISTENCY_SAMPLE_COUNT }, () => this.proposeDecisionFn(input)));
    return samples.every((s) => s.decision.action === "EMERGENCY_EXIT_TO_STABLE");
  }

  /// @notice Processes every confirmed-but-unexecuted decision for the
  /// vault, strictly sequentially (point 4, one executeDecision submission
  /// in flight at a time), emits a heartbeat, and alerts on any entry stuck
  /// past EXECUTION_STUCK_TIMEOUT_SECONDS.
  async runOnce(): Promise<void> {
    this.alertSink.send(makeEvent("info", "HEARTBEAT", "keeper loop alive"));

    const confirmed = this.config.pipeline.listConfirmedUnexecuted(this.config.vaultAddress);
    for (const entry of confirmed) {
      const confirmedAgeSeconds = entry.queued.confirmedAt ? (Date.now() - new Date(entry.queued.confirmedAt).getTime()) / 1000 : 0;
      if (confirmedAgeSeconds > EXECUTION_STUCK_TIMEOUT_SECONDS) {
        this.alertSink.send(
          makeEvent("warning", "CONFIRMED_DECISION_STUCK", `decisionId ${entry.decisionId} confirmed ${Math.round(confirmedAgeSeconds)}s ago, still not executed.`),
        );
      }
      // Sequential on purpose: awaited before the next iteration starts,
      // never fired concurrently, see point 4.
      await this.processEntry(entry);
    }
  }

  runLoop(intervalMs: number = HEARTBEAT_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      this.runOnce().catch((error) => {
        this.alertSink.send(makeEvent("critical", "KEEPER_LOOP_ERROR", error instanceof Error ? error.message : String(error)));
      });
    }, intervalMs);
  }
}
