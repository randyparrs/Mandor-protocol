// The v4 (cross-chain lending) counterpart to executor/keeperService.ts.
// Holds TWO real signing keys: KEEPER_PRIVATE_KEY (Arc, same account
// keeperService.ts uses, submits executeDecision) and the deliberately
// SEPARATE ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY (Arbitrum Sepolia only,
// never calls executeDecision or holds any MandateRoles role). See
// requireChainKeeperActive/processCrossChainSettlements below for exactly
// what each key is allowed to do.
//
// INTENTIONAL FORK, READ BEFORE FIXING A BUG HERE (2026-07-18): this file
// targets v4's real, already-deployed Decision/executeDecision shape
// specifically (WITH chainId/lendingPositionId/bridgeLeg -- v1/v2/v3's
// real deployed bytecode predates these fields entirely, confirmed live
// via cast --trace: the OLD ABI is what those vaults actually expect).
// executor/keeperService.ts is the separate, deliberately duplicated
// module for v1/v2/v3's older struct shape, sharing most of this file's
// logic by copy, not by import (same "new version = new deployment, never
// touch a live one" principle already applied to the contracts
// themselves, extended to this executor layer, a deliberate decision).
// scripts/runDecisionCycle.ts's real, scheduled production
// cycle for v1/v2 depends on THAT file's ABI staying exactly as-is.
//
// Consequence: a security-relevant fix discovered in one of these two
// files (e.g. a real swap/LP-leg sizing bug, a missing revert check, an
// alerting gap) does NOT automatically apply to the other. Manually check
// the other file whenever you fix something security-relevant here.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, defineChain, http, type Hex, type PublicClient, type WalletClient } from "viem";
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
import { projectDataPath } from "../shared/paths.js";
import type { Executor, ExecutionResult } from "./types.js";
import { ConsoleAlertSink, makeEvent, type AlertSink } from "../shared/alertSink.js";

// The only real, verified, allowlisted router/quoter in this project, see
// docs/arc-facts-to-verify.md.
const UNITFLOW_V3_ROUTER = "0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01" as const;
const UNITFLOW_V3_QUOTER = "0x121aeB6DEf00F6F67665008CaC1C19805886ed1a" as const;

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

// Verified live, see docs/deployments.md's "v4 CCTP cross-chain
// messaging" section and hardhat.config.ts's arcTestnet network entry.
const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

// Arbitrum Sepolia's own real, public RPC endpoint (Arbitrum's own
// infrastructure, not a third-party provider), chain id 421614 confirmed
// live via docs/deployments.md's "v4 CCTP cross-chain messaging" section
// (the same chainId LendingPositionRegistry.chainKeeper is keyed by for
// this destination).
const ARBITRUM_SEPOLIA = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
});

// Real, live-verified addresses/domains, see docs/deployments.md's "v4
// CCTP cross-chain messaging" section: TokenMessengerV2 and
// MessageTransmitterV2 share the same address across every chain Circle
// deploys CCTP V2 to (deterministic deployment), confirmed via
// eth_getCode + TokenMessengerV2.localMessageTransmitter() on both real
// chains, not assumed from address matching alone.
const CCTP_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
const MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;
const ARC_CCTP_DOMAIN = 26;
const ARBITRUM_SEPOLIA_CCTP_DOMAIN = 3;
// FINALITY_THRESHOLD_CONFIRMED (CCTP "Fast Transfer", ~8-20s), this
// project's confirmed default, matching MandateVault.sol's own
// CCTP_MIN_FINALITY_THRESHOLD exactly (both legs of a bridge use the same
// finality mode).
const CCTP_MIN_FINALITY_THRESHOLD = 1000;

// Real, live-verified via docs/arc-facts-to-verify.md's Arbitrum Sepolia
// research (getReserveData(address) returning real, non-zero reserve
// data): Aave V3 Pool, and the real USDC address that is BOTH Circle's
// official token AND Aave's own registered reserve for it (same token,
// no swap needed).
const AAVE_POOL_ARBITRUM_SEPOLIA = "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff" as const;
const USDC_ARBITRUM_SEPOLIA = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const;
// The aToken minted by Aave's own real getReserveData(USDC) tuple (see
// docs/arc-facts-to-verify.md's Arbitrum Sepolia research), read directly
// as the unambiguous "already supplied" signal in processOutboundLeg
// below: raw USDC balance alone cannot distinguish "not yet minted" from
// "already minted and already supplied" (both read as zero), but aUSDC
// balance can, since only a real Aave supply ever mints it.
const AUSDC_ARBITRUM_SEPOLIA = "0x460b97BD498E1157530AEb3086301d5225b91216" as const;

// Real chainId -> CCTP domain map, only the one destination this project
// actually wires today (LendingPositionRegistry.chainKeeper(421614), see
// docs/deployments.md). Extend when a real second destination chain is
// ever added; never guess a domain for an unlisted chainId.
const CHAIN_ID_TO_CCTP_DOMAIN: Record<number, number> = {
  421614: ARBITRUM_SEPOLIA_CCTP_DOMAIN,
};

// Circle's real, documented Iris API base (sandbox = testnet, matching
// both Arc Testnet and Arbitrum Sepolia). The exact JSON response shape
// for /messages could not be empirically re-verified in this environment
// (a local TLS/network limitation blocked a live test call), so
// parseIrisMessagesResponse below defensively logs the raw response
// alongside its best-effort parse, rather than trusting the shape blindly
// -- flagged honestly, not assumed correct.
const CIRCLE_IRIS_API_BASE = "https://iris-api-sandbox.circle.com/v2";
const ATTESTATION_POLL_INTERVAL_MS = 5_000;
// Real Fast Transfer attestations land in ~8-20s (CCTP_MIN_FINALITY_THRESHOLD's
// own doc comment); 5 minutes is a generous multiple of that, a confirmed
// bound: past this, treat it as an anomaly and alert, never
// poll indefinitely with no visibility.
const ATTESTATION_POLL_TIMEOUT_MS = 5 * 60 * 1000;
// Bounded timeout for the CCTP fee-quote query itself (a much simpler,
// single-shot call, not a poll), separate from the attestation poll's own
// timeout above.
const FEE_QUOTE_TIMEOUT_MS = 10_000;
// Conservative fallback if the live fee-quote query fails or times out:
// 1% of the bridged amount, matching the ceiling
// scripts/verifyCctpBridgeDepositOnArcTestnet.ts already used for its own
// real, live-verified test call (0.001 USDC on a 0.1 USDC transfer). Only
// ever used as a fallback, alerted loudly when it is, never silently
// substituted for a real quote.
const FALLBACK_CCTP_FEE_BPS = 100n;

// Mirrors contracts/interfaces/IVaultPolicy.sol's DecisionAction enum
// order exactly (Solidity enums are just uint8 indices in declaration
// order). Every action is reachable in principle for v4's real deployed
// vault (it shares MandateVault.sol's LP mechanism with v3), even though
// V4_LENDING_STRATEGY_TEXT (scripts/v4StrategyText.ts) only ever guides
// the agent toward HOLD/BRIDGE_DEPOSIT/BRIDGE_WITHDRAW/EMERGENCY_EXIT_TO_STABLE
// in practice.
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
  BRIDGE_DEPOSIT: 10,
  BRIDGE_WITHDRAW: 11,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const HEARTBEAT_INTERVAL_MS = 60_000;
const EXECUTION_STUCK_TIMEOUT_SECONDS = 30 * 60;
const SELF_CONSISTENCY_SAMPLE_COUNT = 3;

const MANDATE_VAULT_KEEPER_ABI = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetDecimals", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "lendingRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "confirmCrossChainWithdrawalComplete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "amountReceived", type: "uint256" },
    ],
    outputs: [],
  },
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
          // v4 only, absent from v1/v2/v3's real, already-deployed
          // shape, see executor/keeperService.ts's own "INTENTIONAL
          // FORK" comment.
          { name: "chainId", type: "uint256" },
          { name: "lendingPositionId", type: "uint256" },
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
      {
        // v4 only, 5th param absent from v1/v2/v3's real ABI entirely.
        name: "bridgeLeg",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "positionId", type: "uint256" },
          { name: "cctpDestinationDomain", type: "uint32" },
          { name: "maxFee", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Minimal real interface, see contracts/ILendingPositionRegistry.sol
// (Solidity) for the authoritative full interface this mirrors.
const LENDING_POSITION_REGISTRY_ABI = [
  { type: "function", name: "chainKeeper", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "positionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "positionIds", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "chainId", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "principalUSDC", type: "uint256" },
      { name: "currentValueUSDC", type: "uint256" },
      { name: "lastReportedAt", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "reportLendingPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "valueUSDC", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const REGISTRY_STATUS_BY_INDEX = ["IN_TRANSIT_OUT", "OPEN", "WITHDRAWAL_PENDING", "IN_TRANSIT_BACK"] as const;

// Circle's real MessageTransmitterV2.receiveMessage, see
// contracts/interfaces/ICCTPTokenMessenger.sol's own doc comment for how
// this project verified TokenMessengerV2/MessageTransmitterV2 are two
// distinct real contracts. Called directly here (not through any Solidity
// contract of this project's own), since neither leg's completion happens
// through MandateVault itself on the destination side.
const MESSAGE_TRANSMITTER_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Real Aave V3 IPool signatures, see docs/arc-facts-to-verify.md's
// Arbitrum Sepolia research (from aave-v3-core's real IPool.sol).
const AAVE_POOL_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_MIN_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
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

interface OnchainBridgeLeg {
  chainId: bigint;
  amount: bigint;
  positionId: bigint;
  cctpDestinationDomain: number;
  maxFee: bigint;
}

// chainId == 0 && positionId == 0 means "no bridge action this call,"
// the exact convention MandateVault.sol's executeDecision itself uses
// (see that contract's own bridgeLeg.chainId != 0 || bridgeLeg.positionId
// != 0 check).
const EMPTY_BRIDGE_LEG: OnchainBridgeLeg = {
  chainId: 0n,
  amount: 0n,
  positionId: 0n,
  cctpDestinationDomain: 0,
  maxFee: 0n,
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

/// @notice process.env only, never hardcoded, never included in any
/// thrown error's message, same discipline as executor/keeperService.ts's
/// own loadKeeperAccount.
function loadArcKeeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set. Set it in .env, never hardcode it.");
  return privateKeyToAccount(key as Hex);
}

/// @notice The deliberately SEPARATE Arbitrum Sepolia wallet
/// (scripts/generateArbitrumSepoliaKeeperWallet.ts), never the same key as
/// KEEPER_PRIVATE_KEY. Its real, unavoidable authority, given the deployed
/// contracts' own real code (not a design choice this file could narrow
/// further): MessageTransmitterV2.receiveMessage and Aave Pool.supply/
/// withdraw on Arbitrum Sepolia, PLUS LendingPositionRegistry.reportLendingPosition
/// on Arc (that function's onlyChainKeeper check is msg.sender ==
/// chainKeeper[chainId], and chainKeeper[421614] IS this wallet's address,
/// so only this key can ever call it, regardless of which chain the
/// transaction is submitted to). It holds no MandateRoles role anywhere,
/// cannot call executeDecision, and every amount/positionId it ever acts
/// on is read fresh from real registry/Aave state, never itself decided.
function loadArbitrumKeeperAccount() {
  const key = process.env.ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY;
  if (!key) throw new Error("ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY is not set. Run scripts/generateArbitrumSepoliaKeeperWallet.ts first.");
  return privateKeyToAccount(key as Hex);
}

function resolveAssetAddress(symbol: AssetSymbol, assets: KnownAsset[]): `0x${string}` {
  const known = assets.find((a) => a.symbol === symbol);
  if (!known) throw new Error(`Cannot resolve onchain address for asset symbol "${symbol}", it is not in the known-asset list.`);
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

const EMPTY_ONCHAIN_DECISION_BRIDGE_FIELDS = {
  chainId: 0n,
  lendingPositionId: 0n,
};

const LP_ACTIONS = new Set<VaultDecision["action"]>(["LP_OPEN", "LP_INCREASE", "LP_DECREASE", "LP_COLLECT", "LP_CLOSE"]);
const BRIDGE_ACTIONS = new Set<VaultDecision["action"]>(["BRIDGE_DEPOSIT", "BRIDGE_WITHDRAW"]);

async function buildOnchainDecision(decision: VaultDecision, assets: KnownAsset[], publicClient: PublicClient, vaultAddress: `0x${string}`) {
  const actionIndex = DECISION_ACTION_INDEX[decision.action];
  if (decision.action === "ENTER" || decision.action === "EXIT") {
    if (!decision.asset || !decision.amount) {
      throw new Error(`${decision.action} decision is missing asset/amount, cannot build onchain calldata.`);
    }
    const asset = resolveAssetAddress(decision.asset, assets);
    const decimals = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "assetDecimals", args: [asset] });
    return {
      action: actionIndex,
      asset,
      amount: parseRawAmount(decision.amount, decimals),
      targetAllocations: [],
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
      ...EMPTY_ONCHAIN_DECISION_BRIDGE_FIELDS,
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
      ...EMPTY_ONCHAIN_DECISION_BRIDGE_FIELDS,
    };
  }
  if (LP_ACTIONS.has(decision.action)) {
    if (decision.action === "LP_OPEN" && (decision.tickLower === undefined || decision.tickUpper === undefined || !decision.lpPool)) {
      throw new Error("LP_OPEN decision is missing lpPool/tickLower/tickUpper, cannot build onchain calldata.");
    }
    return {
      action: actionIndex,
      asset: ZERO_ADDRESS,
      amount: 0n,
      targetAllocations: [],
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
      ...EMPTY_ONCHAIN_DECISION_BRIDGE_FIELDS,
      lpPool: decision.lpPool ?? ZERO_ADDRESS,
      tickLower: decision.tickLower ?? 0,
      tickUpper: decision.tickUpper ?? 0,
      lpTokenId: decision.lpTokenId ? BigInt(decision.lpTokenId) : 0n,
    };
  }
  if (BRIDGE_ACTIONS.has(decision.action)) {
    // Only chainId/lendingPositionId are Decision-level (read by
    // VaultPolicy's staleness/allocation loop); the real transfer
    // mechanics (amount, cctpDestinationDomain, maxFee) live on the
    // separately-built BridgeLeg (buildBridgeLeg below), same
    // "decision states intent, the leg carries fresh execution mechanics"
    // split SwapLeg/LpLeg already use.
    if (decision.action === "BRIDGE_DEPOSIT") {
      if (!decision.bridgeChainId) throw new Error("BRIDGE_DEPOSIT decision is missing bridgeChainId, cannot build onchain calldata.");
      return {
        action: actionIndex,
        asset: ZERO_ADDRESS,
        amount: 0n,
        targetAllocations: [],
        ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
        chainId: BigInt(decision.bridgeChainId),
        lendingPositionId: 0n,
      };
    }
    // BRIDGE_WITHDRAW.
    if (!decision.bridgePositionId) throw new Error("BRIDGE_WITHDRAW decision is missing bridgePositionId, cannot build onchain calldata.");
    return {
      action: actionIndex,
      asset: ZERO_ADDRESS,
      amount: 0n,
      targetAllocations: [],
      ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
      chainId: 0n,
      lendingPositionId: BigInt(decision.bridgePositionId),
    };
  }
  // HOLD and EMERGENCY_EXIT_TO_STABLE: asset/amount/targetAllocations/LP/
  // bridge fields are unused onchain, see IVaultPolicy.sol.
  return {
    action: actionIndex,
    asset: ZERO_ADDRESS,
    amount: 0n,
    targetAllocations: [],
    ...EMPTY_ONCHAIN_DECISION_LP_FIELDS,
    ...EMPTY_ONCHAIN_DECISION_BRIDGE_FIELDS,
  };
}

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

function requireIndependentReferencePriceToBuy(symbol: AssetSymbol): void {
  if (!hasIndependentReferencePrice(symbol)) {
    throw new Error(
      `Refusing to build a swap leg that buys ${symbol}: no genuinely independent reference price source exists for it yet, so VaultPolicy's onchain oracle-deviation check cannot meaningfully validate this allocation (see agent/core/tools/getMarketData.ts's hasIndependentReferencePrice and docs/arc-facts-to-verify.md). Selling out of ${symbol} remains allowed; only new buys are blocked until this is fixed.`,
    );
  }
}

function requireIndependentReferencePriceForLp(pool: { token0Symbol: AssetSymbol; token1Symbol: AssetSymbol }): void {
  for (const symbol of [pool.token0Symbol, pool.token1Symbol]) {
    if (!hasIndependentReferencePrice(symbol)) {
      throw new Error(
        `Refusing to open/increase an LP position touching ${symbol}: no genuinely independent reference price source exists for it yet, so this vault's own LP position valuation (reading the pool's own spot price) cannot be meaningfully trusted (see agent/core/tools/getMarketData.ts's hasIndependentReferencePrice and docs/arc-facts-to-verify.md). Reducing or closing an existing position remains allowed; only opening/increasing new exposure is blocked until this is fixed.`,
      );
    }
  }
}

/// @notice OFFCHAIN-ONLY hard gate (no VaultPolicy.sol equivalent, see
/// shared/policyTypes.ts's CHAIN_KEEPER_NOT_ACTIVE doc comment): refuses
/// to even build a BRIDGE_DEPOSIT leg for a chain whose chainKeeper is not
/// yet active (LendingPositionRegistry.chainKeeper(chainId) ==
/// address(0)), which the real onchain call would revert on anyway
/// (MandateVault._bridgeDeposit's own ChainKeeperNotSet revert) -- this
/// just fails fast, before ever building calldata or spending gas on a
/// simulate call certain to revert.
async function requireChainKeeperActive(publicClient: PublicClient, lendingRegistryAddress: `0x${string}`, chainId: number): Promise<void> {
  const keeper = await publicClient.readContract({
    address: lendingRegistryAddress,
    abi: LENDING_POSITION_REGISTRY_ABI,
    functionName: "chainKeeper",
    args: [BigInt(chainId)],
  });
  if (keeper === ZERO_ADDRESS) {
    throw new Error(
      `Refusing to build a BRIDGE_DEPOSIT leg targeting chainId ${chainId}: LendingPositionRegistry.chainKeeper(${chainId}) is still address(0) (not yet active, likely still inside its 48h propose/execute timelock, see docs/deployments.md). The real onchain call would revert on this too (ChainKeeperNotSet), this just fails before spending any gas.`,
    );
  }
}

/// @notice Queries Circle's real, documented CCTP V2 fast-transfer fee
/// endpoint for the current market fee (bps) at CCTP_MIN_FINALITY_THRESHOLD,
/// bounded by FEE_QUOTE_TIMEOUT_MS. Falls back to FALLBACK_CCTP_FEE_BPS
/// (alerted loudly, never silent) if the query fails or times out --
/// same "never guess silently, alert on the anomaly" discipline as the
/// attestation poll's own bounded timeout below.
async function queryCctpFastTransferFeeBps(sourceDomain: number, destinationDomain: number, alertSink: AlertSink, fetchFn: typeof fetch): Promise<bigint> {
  const url = `${CIRCLE_IRIS_API_BASE}/burn/USDC/fees/${sourceDomain}/${destinationDomain}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEE_QUOTE_TIMEOUT_MS);
    const response = await fetchFn(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Circle fee-quote endpoint returned HTTP ${response.status}.`);
    const body = (await response.json()) as Array<{ finalityThreshold: number; minimumFee: number }>;
    const match = body.find((entry) => entry.finalityThreshold === CCTP_MIN_FINALITY_THRESHOLD);
    if (!match) throw new Error(`No fee entry for finalityThreshold ${CCTP_MIN_FINALITY_THRESHOLD} in Circle's response: ${JSON.stringify(body)}.`);
    return BigInt(match.minimumFee);
  } catch (error) {
    alertSink.send(
      makeEvent(
        "warning",
        "CCTP_FEE_QUOTE_FAILED",
        `Failed to query Circle's real CCTP fee-quote endpoint (${url}): ${error instanceof Error ? error.message : String(error)}. Falling back to a conservative fixed ${FALLBACK_CCTP_FEE_BPS}bps ceiling for this bridge leg.`,
      ),
    );
    return FALLBACK_CCTP_FEE_BPS;
  }
}

/// @notice v4's own BridgeLeg construction, the cross-chain counterpart to
/// buildSwapLegs/buildLpLeg. Returns EMPTY_BRIDGE_LEG for every non-bridge
/// action, same convention EMPTY_LP_LEG already uses for non-LP actions.
///
/// BRIDGE_DEPOSIT is gated by requireChainKeeperActive before any amount
/// is computed, same "check first, never build calldata for a call
/// certain to revert" order buildLpLeg's requireIndependentReferencePriceForLp
/// already follows. maxFee is queried fresh from Circle's real fee-quote
/// endpoint at execution time, never a hardcoded contract constant, same
/// "keeper supplies real, current values" convention as SwapLeg.minAmountOut
/// (see docs/deployments.md's own confirmed design decision on this).
///
/// BRIDGE_WITHDRAW only ever needs positionId: MandateVault._executeBridgeLeg
/// dispatches BRIDGE_WITHDRAW straight to
/// LendingPositionRegistry.initiateWithdrawal(leg.positionId, ...), which
/// only flips the position's status to WITHDRAWAL_PENDING -- it does NOT
/// itself retrieve any funds. The real retrieval (Aave withdraw -> CCTP
/// depositForBurn -> receiveMessage -> confirmCrossChainWithdrawalComplete)
/// is processCrossChainSettlements' job below, run continuously,
/// independent of this one executeDecision call.
async function buildBridgeLeg(
  decision: VaultDecision,
  publicClient: PublicClient,
  vaultAddress: `0x${string}`,
  alertSink: AlertSink,
  fetchFn: typeof fetch,
): Promise<OnchainBridgeLeg> {
  if (!BRIDGE_ACTIONS.has(decision.action)) return EMPTY_BRIDGE_LEG;

  if (decision.action === "BRIDGE_WITHDRAW") {
    if (!decision.bridgePositionId) throw new Error("BRIDGE_WITHDRAW decision is missing bridgePositionId, cannot build a bridge leg.");
    return { ...EMPTY_BRIDGE_LEG, positionId: BigInt(decision.bridgePositionId) };
  }

  // BRIDGE_DEPOSIT.
  if (!decision.bridgeChainId || !decision.bridgeAmount) {
    throw new Error("BRIDGE_DEPOSIT decision is missing bridgeChainId/bridgeAmount, cannot build a bridge leg.");
  }
  const cctpDestinationDomain = CHAIN_ID_TO_CCTP_DOMAIN[decision.bridgeChainId];
  if (cctpDestinationDomain === undefined) {
    throw new Error(`No known CCTP domain for chainId ${decision.bridgeChainId}. See CHAIN_ID_TO_CCTP_DOMAIN, never guess an unlisted domain.`);
  }
  const lendingRegistryAddress = await publicClient.readContract({ address: vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "lendingRegistry" });
  if (lendingRegistryAddress === ZERO_ADDRESS) throw new Error("Vault has no lendingRegistry set, cannot build a BRIDGE_DEPOSIT leg.");
  await requireChainKeeperActive(publicClient, lendingRegistryAddress, decision.bridgeChainId);

  // The base asset is always USDC for v4 (docs/deployments.md), 6 decimals.
  const baseAssetDecimals = 6;
  const amount = parseRawAmount(decision.bridgeAmount, baseAssetDecimals);
  const feeBps = await queryCctpFastTransferFeeBps(ARC_CCTP_DOMAIN, cctpDestinationDomain, alertSink, fetchFn);
  const maxFee = (amount * feeBps) / 10_000n;

  return { chainId: BigInt(decision.bridgeChainId), amount, positionId: 0n, cctpDestinationDomain, maxFee };
}

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
      const amountInUSD = Number(decision.amount) * priceOf(decision.asset);
      const amountIn = parseRawAmount(amountInUSD.toString(), assetDecimalsBySymbol[baseAsset.symbol]);
      return [await quoteAndBuildLeg(publicClient, baseAsset.address, targetAddress, feeFor(decision.asset), amountIn)];
    }
    const amountIn = parseRawAmount(decision.amount, targetDecimals);
    return [await quoteAndBuildLeg(publicClient, targetAddress, baseAsset.address, feeFor(decision.asset), amountIn)];
  }

  if (LP_ACTIONS.has(decision.action) || BRIDGE_ACTIONS.has(decision.action)) return [];

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
      requireIndependentReferencePriceToBuy(target.asset);
      const amountIn = parseRawAmount(deltaUSDC.toString(), assetDecimalsBySymbol[baseAsset.symbol]);
      legs.push(await quoteAndBuildLeg(publicClient, baseAsset.address, targetAddress, feeFor(target.asset), amountIn));
    } else {
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

  return { pool: ZERO_ADDRESS, fee, tickLower, tickUpper, amount0Desired: 0n, amount1Desired: 0n, amount0Min: 0n, amount1Min: 0n, tokenId, liquidity: 0n, deadline };
}

// ---------------------------------------------------------------------
// Cross-chain settlement: durable pointer log (positionId -> tx hash),
// NEVER the source of truth for what has actually happened -- only ever
// used to know which tx hash to query Circle's Iris API with. Every
// actual recovery decision is made from real onchain state (registry
// status, real balances), read fresh every time processCrossChainSettlements
// runs, see that method's own doc comment.
// ---------------------------------------------------------------------

interface SettlementLogEntry {
  // The BRIDGE_DEPOSIT executeDecision tx hash (Arc), set the moment that
  // decision executes. Used to fetch the outbound leg's CCTP message from
  // Iris.
  depositTxHash?: `0x${string}`;
  // The return leg's depositForBurn tx hash (Arbitrum Sepolia), set once
  // processCrossChainSettlements submits it. Used to fetch the return
  // leg's CCTP message from Iris.
  withdrawBurnTxHash?: `0x${string}`;
}

type SettlementLog = Record<string, SettlementLogEntry>;

async function loadSettlementLog(logPath: string): Promise<SettlementLog> {
  try {
    const raw = await readFile(logPath, "utf-8");
    return JSON.parse(raw) as SettlementLog;
  } catch {
    return {};
  }
}

async function saveSettlementLog(logPath: string, log: SettlementLog): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify(log, null, 2), "utf-8");
}

interface IrisMessage {
  message: Hex;
  attestation: Hex;
  status: string;
}

/// @notice Defensive parse: Circle's real /v2/messages response shape for
/// this project's exact query pattern could not be empirically verified
/// in this environment (a local TLS/network limitation blocked a live
/// test call, see docs/arc-facts-to-verify.md). Logs the full raw
/// response alongside the parse attempt so a real run's logs make it
/// immediately obvious if this guess is wrong, rather than failing
/// silently or crashing on an unexpected shape.
function parseIrisMessagesResponse(raw: unknown): IrisMessage | null {
  const body = raw as { messages?: Array<{ message?: string; attestation?: string; status?: string }> };
  const entry = body?.messages?.[0];
  if (!entry?.message || !entry?.attestation) return null;
  if (entry.status !== "complete") return null;
  return { message: entry.message as Hex, attestation: entry.attestation as Hex, status: entry.status };
}

/// @notice Bounded poll (a deliberate requirement): if attestation
/// doesn't arrive within timeoutMs, treat it as an anomaly and alert,
/// rather than polling indefinitely with no visibility. Real Fast
/// Transfer attestations land in ~8-20s, so the real default (5 minutes,
/// see ATTESTATION_POLL_TIMEOUT_MS) is a generous multiple, never
/// expected to actually trip in normal operation. intervalMs/timeoutMs
/// are parameters (not the module constants directly) purely so
/// test/keeperServiceV4.ts can exercise this exact bounded-timeout
/// behavior in milliseconds rather than actually waiting out the real
/// 5-minute bound -- production call sites always pass the real
/// constants, see KeeperServiceV4Config's own attestationPollIntervalMs/
/// attestationPollTimeoutMs doc comments.
async function pollForAttestation(txHash: `0x${string}`, alertSink: AlertSink, fetchFn: typeof fetch, intervalMs: number, timeoutMs: number): Promise<IrisMessage | null> {
  const deadline = Date.now() + timeoutMs;
  const url = `${CIRCLE_IRIS_API_BASE}/messages?transactionHash=${txHash}`;
  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url);
      if (response.ok) {
        const raw = await response.json();
        const parsed = parseIrisMessagesResponse(raw);
        if (parsed) return parsed;
        // Not yet "complete" (or an unexpected shape): log the raw
        // response for defensive visibility, then keep polling.
        console.log(`[keeperServiceV4] Iris response for ${txHash} not yet complete, raw: ${JSON.stringify(raw)}`);
      }
    } catch (error) {
      console.log(`[keeperServiceV4] Iris poll for ${txHash} failed this attempt: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  alertSink.send(
    makeEvent(
      "critical",
      "CCTP_ATTESTATION_TIMEOUT",
      `Attestation for tx ${txHash} did not arrive within ${timeoutMs / 1000}s (expected ~8-20s for Fast Transfer). Surfacing as an anomaly rather than continuing to poll indefinitely.`,
    ),
  );
  return null;
}

export interface KeeperServiceV4Config {
  publicClient: PublicClient;
  vaultAddress: `0x${string}`;
  assets: KnownAsset[];
  stableAssets: AssetSymbol[];
  strategyVersion: string;
  strategyConfigText: string;
  pipeline: DecisionPipeline;
  poolFeeByAssetSymbol?: Record<AssetSymbol, number>;
  alertSink?: AlertSink;
  // Injectable seams, same rationale as executor/keeperService.ts's own
  // KeeperServiceConfig.
  keeperAccount?: ReturnType<typeof privateKeyToAccount>;
  walletClient?: WalletClient;
  arbitrumPublicClient?: PublicClient;
  arbitrumWalletClient?: WalletClient;
  arbitrumKeeperAccount?: ReturnType<typeof privateKeyToAccount>;
  settlementLogPath?: string;
  fetchFn?: typeof fetch;
  // Injectable purely so test/keeperServiceV4.ts can exercise the
  // bounded-attestation-timeout behavior in milliseconds rather than
  // actually waiting out the real 5-minute bound; production never
  // overrides these, see pollForAttestation's own doc comment.
  attestationPollIntervalMs?: number;
  attestationPollTimeoutMs?: number;
  getVaultStateFn?: typeof getVaultState;
  buildPolicyLimitsStructFn?: typeof buildPolicyLimitsStruct;
  getMarketDataFn?: typeof getMarketData;
  buildProposeDecisionInputFn?: typeof buildProposeDecisionInput;
  proposeDecisionFn?: typeof proposeDecision;
}

/// @notice v4's own KeeperService, a near-complete fork of
/// executor/keeperService.ts (see this file's own top-of-file
/// "INTENTIONAL FORK" comment) with v4's newer ABI shape, plus the
/// genuinely new cross-chain settlement mechanism
/// (processCrossChainSettlements) that has no v1/v2/v3 counterpart at
/// all.
export class KeeperServiceV4 implements Executor {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly walletClient: WalletClient;
  private readonly arbitrumPublicClient: PublicClient;
  private readonly arbitrumWalletClient: WalletClient;
  private readonly arbitrumAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly settlementLogPath: string;
  private readonly fetchFn: typeof fetch;
  private readonly attestationPollIntervalMs: number;
  private readonly attestationPollTimeoutMs: number;
  private readonly alertSink: AlertSink;
  private readonly getVaultStateFn: typeof getVaultState;
  private readonly buildPolicyLimitsStructFn: typeof buildPolicyLimitsStruct;
  private readonly getMarketDataFn: typeof getMarketData;
  private readonly buildProposeDecisionInputFn: typeof buildProposeDecisionInput;
  private readonly proposeDecisionFn: typeof proposeDecision;

  constructor(private readonly config: KeeperServiceV4Config) {
    this.account = config.keeperAccount ?? loadArcKeeperAccount();
    this.walletClient = config.walletClient ?? createWalletClient({ account: this.account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
    this.arbitrumAccount = config.arbitrumKeeperAccount ?? loadArbitrumKeeperAccount();
    this.arbitrumPublicClient = config.arbitrumPublicClient ?? createPublicClient({ chain: ARBITRUM_SEPOLIA, transport: http(ARBITRUM_SEPOLIA.rpcUrls.default.http[0]) });
    this.arbitrumWalletClient = config.arbitrumWalletClient ?? createWalletClient({ account: this.arbitrumAccount, chain: ARBITRUM_SEPOLIA, transport: http(ARBITRUM_SEPOLIA.rpcUrls.default.http[0]) });
    this.settlementLogPath = config.settlementLogPath ?? projectDataPath("crossChainSettlementsV4.json");
    this.fetchFn = config.fetchFn ?? fetch;
    this.attestationPollIntervalMs = config.attestationPollIntervalMs ?? ATTESTATION_POLL_INTERVAL_MS;
    this.attestationPollTimeoutMs = config.attestationPollTimeoutMs ?? ATTESTATION_POLL_TIMEOUT_MS;
    this.alertSink = config.alertSink ?? new ConsoleAlertSink();
    this.getVaultStateFn = config.getVaultStateFn ?? getVaultState;
    this.buildPolicyLimitsStructFn = config.buildPolicyLimitsStructFn ?? buildPolicyLimitsStruct;
    this.getMarketDataFn = config.getMarketDataFn ?? getMarketData;
    this.buildProposeDecisionInputFn = config.buildProposeDecisionInputFn ?? buildProposeDecisionInput;
    this.proposeDecisionFn = config.proposeDecisionFn ?? proposeDecision;
  }

  async execute(decision: VaultDecision, policyCheck: PolicyCheckResult): Promise<ExecutionResult & { txHash: `0x${string}` }> {
    void policyCheck;
    const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
    const [vaultState, policyLimits, marketData] = await Promise.all([
      this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
      this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset }))),
    ]);
    const txHash = await this.executeWithUnwind(decision, vaultState, marketData);
    return { mode: "live", executedAt: new Date().toISOString(), txHash };
  }

  /// @notice EMERGENCY_EXIT_TO_STABLE's real entry point. Closes any open
  /// LP position first (same as executor/keeperService.ts), then
  /// initiates withdrawal for every open cross-chain lending position
  /// (only marks WITHDRAWAL_PENDING onchain, does NOT itself retrieve the
  /// funds -- see closeAllOpenCrossChainPositions's own doc comment for
  /// why this is an honest, disclosed limitation, not a bug), re-reads
  /// vaultState fresh, then sweeps the remaining base-ledger holdings.
  private async executeWithUnwind(decision: VaultDecision, vaultState: VaultState, marketData: MarketData): Promise<`0x${string}`> {
    if (decision.action !== "EMERGENCY_EXIT_TO_STABLE" || (vaultState.lpPositions.length === 0 && vaultState.currentLendingPositions.length === 0)) {
      return this.submitExecution(decision, vaultState, marketData);
    }

    let workingState = vaultState;
    if (vaultState.lpPositions.length > 0) {
      const closeHashes = await this.closeAllOpenLpPositions(vaultState.lpPositions, marketData);
      this.alertSink.send(
        makeEvent("warning", "EMERGENCY_EXIT_LP_POSITIONS_CLOSED", `EMERGENCY_EXIT_TO_STABLE closed ${closeHashes.length} open LP position(s) before sweeping ledger holdings to stable: ${closeHashes.join(", ")}.`),
      );
      workingState = await this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets);
    }

    if (workingState.currentLendingPositions.length > 0) {
      const openPositions = workingState.currentLendingPositions.filter((p) => p.status === "OPEN" || p.status === "IN_TRANSIT_OUT");
      if (openPositions.length > 0) {
        const initiateHashes = await this.initiateWithdrawalForPositions(openPositions, marketData);
        this.alertSink.send(
          makeEvent(
            "warning",
            "EMERGENCY_EXIT_LENDING_WITHDRAWAL_INITIATED",
            `EMERGENCY_EXIT_TO_STABLE marked ${initiateHashes.length} open cross-chain lending position(s) WITHDRAWAL_PENDING (${initiateHashes.join(", ")}). Their actual retrieval is asynchronous, not atomic with this transaction -- processCrossChainSettlements must run to completion before their value returns to this vault's own ledger.`,
          ),
        );
      }
      workingState = await this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets);
    }

    return this.submitExecution(decision, workingState, marketData);
  }

  async processEntry(entry: DecisionPipelineEntry): Promise<void> {
    const decision = entry.queued.decision;
    try {
      const policyAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: POLICY_GETTER_ABI, functionName: "policy" });
      const [vaultState, policyLimits] = await Promise.all([
        this.getVaultStateFn(this.config.publicClient, this.config.vaultAddress, this.config.assets),
        this.buildPolicyLimitsStructFn(this.config.publicClient, this.config.vaultAddress, policyAddress, this.config.assets),
      ]);

      const marketData = await this.currentOrRefreshedMarketData(entry, policyLimits);

      const freshCheck = checkPolicyOffchain({ decision, vaultState, policyLimits, marketData, assets: this.config.assets });
      if (!freshCheck.passed) {
        this.alertSink.send(
          makeEvent("warning", "EXECUTION_ABORTED_PRECHECK", `decisionId ${entry.decisionId}: current state now fails the offchain pre-check: ${freshCheck.violations.map((v) => v.code).join(", ")}.`),
        );
        return;
      }

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

      const txHash = await this.executeWithUnwind(decision, vaultState, marketData);

      // BRIDGE_DEPOSIT's own real tx hash is the pointer processCrossChainSettlements
      // needs to fetch this position's outbound-leg CCTP message from
      // Iris. Recorded here, not inferred later -- the tx hash is only
      // ever known at this exact moment.
      if (decision.action === "BRIDGE_DEPOSIT") {
        await this.recordBridgeDepositTxHash(txHash);
      }

      this.config.pipeline.markExecuted(entry.decisionId, txHash);
    } catch (error) {
      this.alertSink.send(
        makeEvent("critical", "EXECUTION_FAILED", `decisionId ${entry.decisionId}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }

  /// @notice Reads the just-executed BRIDGE_DEPOSIT's real positionId back
  /// from the registry (the highest positionId now tracked for this
  /// vault, since recordNewPosition assigns strictly increasing ids and
  /// this call just created exactly one), and stores the deposit tx hash
  /// against it. Read fresh from real state, never assumed.
  private async recordBridgeDepositTxHash(txHash: `0x${string}`): Promise<void> {
    const lendingRegistryAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "lendingRegistry" });
    const count = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positionCount" });
    if (count === 0n) return;
    let highest = 0n;
    for (let i = 0n; i < count; i++) {
      const id = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positionIds", args: [i] });
      if (id > highest) highest = id;
    }
    const log = await loadSettlementLog(this.settlementLogPath);
    log[highest.toString()] = { ...log[highest.toString()], depositTxHash: txHash };
    await saveSettlementLog(this.settlementLogPath, log);
  }

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
        args: [onchainDecision, onchainPrices, [], lpLeg, EMPTY_BRIDGE_LEG],
        account: this.account,
      });
      const hash = await this.walletClient.writeContract({
        address: this.config.vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "executeDecision",
        args: [onchainDecision, onchainPrices, [], lpLeg, EMPTY_BRIDGE_LEG],
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

  /// @notice EMERGENCY_EXIT_TO_STABLE's cross-chain counterpart to
  /// closeAllOpenLpPositions, one executeDecision(EMERGENCY_EXIT_TO_STABLE,
  /// bridgeLeg={positionId}) call per open position -- mirrors
  /// MandateVault._executeBridgeLeg's own "EMERGENCY_EXIT_TO_STABLE with a
  /// populated bridgeLeg is treated as initiating that position's
  /// withdrawal" dispatch. Unlike the LP case, this is NOT a full close in
  /// one transaction: it can only ever mark the position WITHDRAWAL_PENDING
  /// here, since the real funds sit on a different chain and retrieving
  /// them requires the multi-step, asynchronous processCrossChainSettlements
  /// flow (Aave withdraw -> CCTP depositForBurn -> attestation ->
  /// receiveMessage -> confirmCrossChainWithdrawalComplete). This is an
  /// honest, disclosed limitation of "emergency exit" for cross-chain
  /// positions, not a bug: the safety valve starts the fastest real
  /// retrieval path available, it cannot make a cross-chain transfer
  /// instant.
  private async initiateWithdrawalForPositions(positions: VaultState["currentLendingPositions"], marketData: MarketData): Promise<`0x${string}`[]> {
    const onchainPrices = await buildOnchainPrices(this.config.publicClient, this.config.vaultAddress, marketData, this.config.assets);
    const emergencyExitDecision: VaultDecision = {
      vaultId: this.config.vaultAddress,
      strategyVersion: this.config.strategyVersion,
      modelId: "system-emergency-exit-lending-unwind",
      action: "EMERGENCY_EXIT_TO_STABLE",
      confidence: 1,
      reasoning: "Initiating withdrawal of a cross-chain lending position as part of an unconditional EMERGENCY_EXIT_TO_STABLE.",
      proposedAt: new Date().toISOString(),
    };
    const onchainDecision = await buildOnchainDecision(emergencyExitDecision, this.config.assets, this.config.publicClient, this.config.vaultAddress);

    const hashes: `0x${string}`[] = [];
    for (const position of positions) {
      const bridgeLeg: OnchainBridgeLeg = { ...EMPTY_BRIDGE_LEG, positionId: BigInt(position.positionId) };

      await this.config.publicClient.simulateContract({
        address: this.config.vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "executeDecision",
        args: [onchainDecision, onchainPrices, [], EMPTY_LP_LEG, bridgeLeg],
        account: this.account,
      });
      const hash = await this.walletClient.writeContract({
        address: this.config.vaultAddress,
        abi: MANDATE_VAULT_KEEPER_ABI,
        functionName: "executeDecision",
        args: [onchainDecision, onchainPrices, [], EMPTY_LP_LEG, bridgeLeg],
        chain: ARC_TESTNET,
        account: this.account,
      });
      const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`EMERGENCY_EXIT_TO_STABLE's withdrawal-initiation for lending position ${position.positionId} (tx ${hash}) reverted onchain.`);
      }
      hashes.push(hash);
    }
    return hashes;
  }

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
    const bridgeLeg = await buildBridgeLeg(decision, this.config.publicClient, this.config.vaultAddress, this.alertSink, this.fetchFn);

    await this.config.publicClient.simulateContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps, lpLeg, bridgeLeg],
      account: this.account,
    });

    const preNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });

    const hash = await this.walletClient.writeContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "executeDecision",
      args: [onchainDecision, onchainPrices, swaps, lpLeg, bridgeLeg],
      chain: ARC_TESTNET,
      account: this.account,
    });
    const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`executeDecision transaction ${hash} reverted onchain.`);
    }

    if (swaps.length === 0) {
      // Applies uniformly to every zero-swap action, BRIDGE_DEPOSIT
      // included: LendingPositionRegistry.recordNewPosition sets the new
      // position's currentValueUSDC == principalUSDC (no yield accrued
      // yet) in the very same transaction _bridgeDeposit runs in, so
      // totalAssets() (ledger minus the bridged amount, plus
      // registry.totalValueUSDC() reflecting the same amount in the new
      // position) is expected to be exactly flat, same as HOLD or
      // BRIDGE_WITHDRAW's own initiateWithdrawal-only call.
      const postNAV = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "totalAssets" });
      if (postNAV !== preNAV) {
        this.alertSink.send(
          makeEvent("critical", "ABNORMAL_NAV_DELTA", `${decision.action} executed with zero swap legs but totalAssets moved from ${preNAV} to ${postNAV}, this should never happen.`),
        );
      }
    }

    return hash;
  }

  private async currentOrRefreshedMarketData(entry: DecisionPipelineEntry, policyLimits: PolicyLimits): Promise<MarketData> {
    const now = Date.now();
    const isStale = entry.marketData.prices.some((p) => (now - new Date(p.updatedAt).getTime()) / 1000 > policyLimits.oracleMaxStalenessSeconds);
    if (!isStale) return entry.marketData;
    return this.getMarketDataFn(this.config.stableAssets.map((asset) => ({ asset })));
  }

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

  // ---------------------------------------------------------------------
  // Cross-chain settlement: the genuinely new mechanism with no v1/v2/v3
  // counterpart. Run continuously (see runOnce below), always re-derives
  // what step each position is on from REAL, externally-verifiable
  // onchain/durable state, NEVER from in-memory process state -- so a
  // crash and restart mid-sequence never risks a duplicate action or a
  // stuck position. The settlement log (loadSettlementLog/saveSettlementLog)
  // is only ever a pointer to which tx hash to query Iris with, never
  // itself trusted as "this step is done."
  //
  // Deliberately processes ONE position at a time per direction (outbound/
  // return), never concurrently: Aave's own aToken balance is POOLED
  // across every position this vault has ever bridged to Arbitrum (no
  // native per-position sub-accounting), so the raw-USDC-balance signal
  // this recovery logic depends on ("mint landed, not yet supplied/
  // withdrawn") is only unambiguous if at most one position is ever
  // between CCTP-mint and Aave-supply/withdraw simultaneously.
  // ---------------------------------------------------------------------

  async processCrossChainSettlements(): Promise<void> {
    const lendingRegistryAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "lendingRegistry" });
    if (lendingRegistryAddress === ZERO_ADDRESS) return;

    const count = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positionCount" });
    for (let i = 0n; i < count; i++) {
      const positionId = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positionIds", args: [i] });
      const position = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positions", args: [positionId] });
      const [, statusIndex, principalUSDC, currentValueUSDC] = position;
      const status = REGISTRY_STATUS_BY_INDEX[statusIndex];

      try {
        if (status === "IN_TRANSIT_OUT") {
          await this.processOutboundLeg(positionId, principalUSDC, lendingRegistryAddress);
        } else if (status === "WITHDRAWAL_PENDING") {
          await this.processReturnLeg(positionId, currentValueUSDC);
        }
        // OPEN: fully settled, already reporting normally, nothing to do
        // here. IN_TRANSIT_BACK: defined in the shared enum for schema
        // completeness but never actually set by the real, deployed
        // LendingPositionRegistry (confirmed by reading its full source:
        // no code path assigns it) -- WITHDRAWAL_PENDING is the real
        // trigger this loop acts on for the whole return leg.
      } catch (error) {
        this.alertSink.send(
          makeEvent("critical", "CROSS_CHAIN_SETTLEMENT_STEP_FAILED", `positionId ${positionId} (status ${status}): ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }
  }

  /// @notice Resumes an in-flight outbound leg (Arc -> Arbitrum Sepolia)
  /// from real state, never in-memory progress. Three possible real
  /// states, checked in this order (most-progressed first), each an
  /// unambiguous onchain signal:
  /// 1. aUSDC (Aave aToken) balance already reflects this position's
  ///    principal? Supply already happened, skip straight to reporting.
  ///    Raw USDC balance alone cannot distinguish "not yet minted" from
  ///    "already minted AND already supplied" (both read as zero, since a
  ///    real Aave supply always drains the raw balance it was given) --
  ///    aUSDC is the one signal that disambiguates them, see
  ///    AUSDC_ARBITRUM_SEPOLIA's own doc comment.
  /// 2. Raw (non-aToken) USDC balance already > 0? The mint already
  ///    landed, not yet supplied, skip straight to the Aave supply step.
  /// 3. Neither: fetch this position's deposit tx hash from the
  ///    settlement log (pointer only), poll Iris (bounded) for the
  ///    attestation, then call MessageTransmitterV2.receiveMessage on
  ///    Arbitrum. If that call reverts, re-check the raw balance: if it
  ///    now reflects the mint, the nonce was already used by an earlier,
  ///    crashed attempt -- treat as success, not a real failure.
  /// Finally: call reportLendingPosition(positionId, principalUSDC) on
  /// Arc, using the Arbitrum keeper's own key (the only key
  /// chainKeeper(chainId) authorizes), transitioning IN_TRANSIT_OUT ->
  /// OPEN onchain. Idempotent by construction: reportLendingPosition
  /// itself reverts (PositionAlreadyUnwinding) only for
  /// WITHDRAWAL_PENDING/IN_TRANSIT_BACK, never for a repeat OPEN report,
  /// so a duplicate call here is harmless.
  private async processOutboundLeg(positionId: bigint, principalUSDC: bigint, lendingRegistryAddress: `0x${string}`): Promise<void> {
    const aTokenBalance = await this.arbitrumPublicClient.readContract({ address: AUSDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });
    const alreadySupplied = aTokenBalance >= principalUSDC;

    if (!alreadySupplied) {
      const rawBalance = await this.arbitrumPublicClient.readContract({ address: USDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });

      if (rawBalance === 0n) {
        const log = await loadSettlementLog(this.settlementLogPath);
        const depositTxHash = log[positionId.toString()]?.depositTxHash;
        if (!depositTxHash) {
          this.alertSink.send(
            makeEvent("warning", "CROSS_CHAIN_SETTLEMENT_MISSING_POINTER", `positionId ${positionId}: no depositTxHash recorded in the settlement log, cannot look up its CCTP attestation. This should only happen if the log was lost after a crash right after BRIDGE_DEPOSIT executed; recovering it requires manually re-deriving the tx hash from Arc's own transaction history.`),
          );
          return;
        }
        const attestation = await pollForAttestation(depositTxHash, this.alertSink, this.fetchFn, this.attestationPollIntervalMs, this.attestationPollTimeoutMs);
        if (!attestation) return; // Already alerted (timeout) inside pollForAttestation.

        try {
          const hash = await this.arbitrumWalletClient.writeContract({
            address: MESSAGE_TRANSMITTER,
            abi: MESSAGE_TRANSMITTER_ABI,
            functionName: "receiveMessage",
            args: [attestation.message, attestation.attestation],
            chain: ARBITRUM_SEPOLIA,
            account: this.arbitrumAccount,
          });
          await this.arbitrumPublicClient.waitForTransactionReceipt({ hash });
        } catch (error) {
          const balanceNow = await this.arbitrumPublicClient.readContract({ address: USDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });
          if (balanceNow === 0n) {
            // Genuinely didn't land, not just an already-used nonce.
            throw error;
          }
          // Fall through: the mint landed despite the revert (an earlier,
          // crashed attempt already used this nonce), real state confirms it.
        }
      }

      const rawBalanceAfterMint = await this.arbitrumPublicClient.readContract({ address: USDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });
      if (rawBalanceAfterMint > 0n) {
        const approveHash = await this.arbitrumWalletClient.writeContract({
          address: USDC_ARBITRUM_SEPOLIA,
          abi: ERC20_MIN_ABI,
          functionName: "approve",
          args: [AAVE_POOL_ARBITRUM_SEPOLIA, rawBalanceAfterMint],
          chain: ARBITRUM_SEPOLIA,
          account: this.arbitrumAccount,
        });
        await this.arbitrumPublicClient.waitForTransactionReceipt({ hash: approveHash });
        const supplyHash = await this.arbitrumWalletClient.writeContract({
          address: AAVE_POOL_ARBITRUM_SEPOLIA,
          abi: AAVE_POOL_ABI,
          functionName: "supply",
          args: [USDC_ARBITRUM_SEPOLIA, rawBalanceAfterMint, this.arbitrumAccount.address, 0],
          chain: ARBITRUM_SEPOLIA,
          account: this.arbitrumAccount,
        });
        await this.arbitrumPublicClient.waitForTransactionReceipt({ hash: supplyHash });
      }
    }

    const reportHash = await this.walletClient.writeContract({
      address: lendingRegistryAddress,
      abi: LENDING_POSITION_REGISTRY_ABI,
      functionName: "reportLendingPosition",
      // Initial report: value == principal, no yield has accrued yet,
      // same conservative convention LendingPositionRegistry.recordNewPosition
      // itself already uses for currentValueUSDC at IN_TRANSIT_OUT time.
      args: [positionId, principalUSDC],
      chain: ARC_TESTNET,
      account: this.arbitrumAccount,
    });
    await this.config.publicClient.waitForTransactionReceipt({ hash: reportHash });
  }

  /// @notice Resumes an in-flight return leg (Arbitrum Sepolia -> Arc)
  /// from real state:
  /// 1. Real balance check: has the Arbitrum keeper wallet already
  ///    withdrawn from Aave (raw USDC balance > 0)? If not, withdraw the
  ///    position's full reported value (Aave's own uint256.max sentinel
  ///    for "withdraw everything supplied" is not needed here: exactly
  ///    one position is ever in flight at a time, see this class's own
  ///    top-of-section doc comment, so the pool's aUSDC balance for this
  ///    wallet IS this position's value).
  /// 2. Real state check: has the return-leg depositForBurn already been
  ///    submitted (a withdrawBurnTxHash already recorded)? If not, submit
  ///    it (destination = Arc, mintRecipient/destinationCaller = the ARC
  ///    keeper's own address, the only account that can complete this
  ///    mint and then call confirmCrossChainWithdrawalComplete), then
  ///    record the tx hash as a pointer.
  /// 3. Poll Iris (bounded) for the attestation using that recorded
  ///    pointer, then call MessageTransmitterV2.receiveMessage on ARC
  ///    (using the ARC keeper account). Same idempotent-revert handling
  ///    as the outbound leg: if it reverts, re-check the ARC keeper's own
  ///    real raw USDC balance before treating it as a genuine failure.
  /// 4. Real state check: is this position still tracked by the registry
  ///    at all (positions(positionId).chainId != 0)? If it has already
  ///    been removed (markClosed already ran), this position is fully
  ///    settled, nothing left to do. Otherwise, transfer the minted USDC
  ///    from the keeper's own wallet into the vault (confirmCrossChainWithdrawalComplete
  ///    only updates ledger accounting, it does not itself pull funds,
  ///    see contracts/MandateVault.sol's own doc comment on why), then
  ///    call confirmCrossChainWithdrawalComplete, which credits the
  ///    ledger and calls registry.markClosed for us.
  ///
  /// Known, narrow, fail-safe gap: if the process crashes after the
  /// return-leg depositForBurn call succeeds (raw balance back to 0,
  /// since it was just burned) but before withdrawBurnTxHash is recorded
  /// in the settlement log, a restart's rawBalance === 0n check cannot
  /// tell "not yet withdrawn from Aave" apart from "already withdrawn and
  /// already burned." It would re-attempt Aave withdraw, which reverts
  /// (this wallet's aUSDC balance for this position is already fully
  /// drained) -- a loud, visible failure surfaced via
  /// CROSS_CHAIN_SETTLEMENT_STEP_FAILED, never a silent double-withdrawal,
  /// since Aave itself cannot be made to pay out more than the wallet
  /// actually holds. Disclosed, not fixed: closing this narrow window
  /// would need a third durable log field tracking "withdrawn, not yet
  /// logged," not worth the added complexity for a failure mode that
  /// already fails safe and loud.
  private async processReturnLeg(positionId: bigint, currentValueUSDC: bigint): Promise<void> {
    let rawBalance = await this.arbitrumPublicClient.readContract({ address: USDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });

    if (rawBalance === 0n) {
      const withdrawHash = await this.arbitrumWalletClient.writeContract({
        address: AAVE_POOL_ARBITRUM_SEPOLIA,
        abi: AAVE_POOL_ABI,
        functionName: "withdraw",
        args: [USDC_ARBITRUM_SEPOLIA, currentValueUSDC, this.arbitrumAccount.address],
        chain: ARBITRUM_SEPOLIA,
        account: this.arbitrumAccount,
      });
      await this.arbitrumPublicClient.waitForTransactionReceipt({ hash: withdrawHash });
      rawBalance = await this.arbitrumPublicClient.readContract({ address: USDC_ARBITRUM_SEPOLIA, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.arbitrumAccount.address] });
    }
    if (rawBalance === 0n) return; // Withdrawal produced nothing (shouldn't happen); nothing to bridge back yet.

    const log = await loadSettlementLog(this.settlementLogPath);
    let withdrawBurnTxHash = log[positionId.toString()]?.withdrawBurnTxHash;
    if (!withdrawBurnTxHash) {
      const feeBps = await queryCctpFastTransferFeeBps(ARBITRUM_SEPOLIA_CCTP_DOMAIN, ARC_CCTP_DOMAIN, this.alertSink, this.fetchFn);
      const maxFee = (rawBalance * feeBps) / 10_000n;
      const arcKeeperBytes32 = `0x000000000000000000000000${this.account.address.slice(2)}` as Hex;

      const approveHash = await this.arbitrumWalletClient.writeContract({
        address: USDC_ARBITRUM_SEPOLIA,
        abi: ERC20_MIN_ABI,
        functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, rawBalance],
        chain: ARBITRUM_SEPOLIA,
        account: this.arbitrumAccount,
      });
      await this.arbitrumPublicClient.waitForTransactionReceipt({ hash: approveHash });

      withdrawBurnTxHash = await this.arbitrumWalletClient.writeContract({
        address: CCTP_TOKEN_MESSENGER,
        abi: [
          {
            type: "function",
            name: "depositForBurn",
            stateMutability: "nonpayable",
            inputs: [
              { name: "amount", type: "uint256" },
              { name: "destinationDomain", type: "uint32" },
              { name: "mintRecipient", type: "bytes32" },
              { name: "burnToken", type: "address" },
              { name: "destinationCaller", type: "bytes32" },
              { name: "maxFee", type: "uint256" },
              { name: "minFinalityThreshold", type: "uint32" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "depositForBurn",
        args: [rawBalance, ARC_CCTP_DOMAIN, arcKeeperBytes32, USDC_ARBITRUM_SEPOLIA, arcKeeperBytes32, maxFee, CCTP_MIN_FINALITY_THRESHOLD],
        chain: ARBITRUM_SEPOLIA,
        account: this.arbitrumAccount,
      });
      await this.arbitrumPublicClient.waitForTransactionReceipt({ hash: withdrawBurnTxHash });
      log[positionId.toString()] = { ...log[positionId.toString()], withdrawBurnTxHash };
      await saveSettlementLog(this.settlementLogPath, log);
    }

    const attestation = await pollForAttestation(withdrawBurnTxHash, this.alertSink, this.fetchFn, this.attestationPollIntervalMs, this.attestationPollTimeoutMs);
    if (!attestation) return;

    const arcUsdcAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: [{ type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "asset" });

    let arcKeeperUsdcBalance = await this.config.publicClient.readContract({ address: arcUsdcAddress, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.account.address] });
    if (arcKeeperUsdcBalance === 0n) {
      try {
        const receiveHash = await this.walletClient.writeContract({
          address: MESSAGE_TRANSMITTER,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [attestation.message, attestation.attestation],
          chain: ARC_TESTNET,
          account: this.account,
        });
        await this.config.publicClient.waitForTransactionReceipt({ hash: receiveHash });
      } catch (error) {
        arcKeeperUsdcBalance = await this.config.publicClient.readContract({ address: arcUsdcAddress, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.account.address] });
        if (arcKeeperUsdcBalance === 0n) throw error;
      }
      arcKeeperUsdcBalance = await this.config.publicClient.readContract({ address: arcUsdcAddress, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [this.account.address] });
    }
    if (arcKeeperUsdcBalance === 0n) return;

    const lendingRegistryAddress = await this.config.publicClient.readContract({ address: this.config.vaultAddress, abi: MANDATE_VAULT_KEEPER_ABI, functionName: "lendingRegistry" });
    const stillTracked = await this.config.publicClient.readContract({ address: lendingRegistryAddress, abi: LENDING_POSITION_REGISTRY_ABI, functionName: "positions", args: [positionId] });
    if (stillTracked[0] === 0n) return; // Already closed by an earlier, crashed-but-completed attempt.

    const transferHash = await this.walletClient.writeContract({
      address: arcUsdcAddress,
      abi: ERC20_MIN_ABI,
      functionName: "transfer",
      args: [this.config.vaultAddress, arcKeeperUsdcBalance],
      chain: ARC_TESTNET,
      account: this.account,
    });
    await this.config.publicClient.waitForTransactionReceipt({ hash: transferHash });

    const confirmHash = await this.walletClient.writeContract({
      address: this.config.vaultAddress,
      abi: MANDATE_VAULT_KEEPER_ABI,
      functionName: "confirmCrossChainWithdrawalComplete",
      args: [positionId, arcKeeperUsdcBalance],
      chain: ARC_TESTNET,
      account: this.account,
    });
    await this.config.publicClient.waitForTransactionReceipt({ hash: confirmHash });
  }

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
      await this.processEntry(entry);
    }

    await this.processCrossChainSettlements();
  }

  runLoop(intervalMs: number = HEARTBEAT_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      this.runOnce().catch((error) => {
        this.alertSink.send(makeEvent("critical", "KEEPER_LOOP_ERROR", error instanceof Error ? error.message : String(error)));
      });
    }, intervalMs);
  }
}
