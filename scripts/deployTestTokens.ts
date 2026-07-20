// Team-created test infrastructure, never a real market opportunity: a
// small variety of ERC-20 tokens (contracts/TestToken.sol, mint gated to
// this script's own dedicated deployer address only, never open to
// anyone) with real, seeded liquidity pools against WUSDC on Arc
// Testnet's real, verified UnitFlowV3 stack, giving v3's Paper Vault /
// test environment more real variety to reason about than the two thin
// real pools that exist today (WUSDC/cirBTC, EURC/cirBTC, both
// documented in docs/arc-facts-to-verify.md).
//
// Uses a dedicated key (TEST_TOKEN_DEPLOYER_PRIVATE_KEY in .env, see
// scripts/generateKeeperWallet.ts's own pattern this mirrors), never
// KEEPER_PRIVATE_KEY: reusing the keeper's key for unrelated deployments
// would break the "single-purpose module, own scoped key, never anything
// beyond executeDecision" isolation executor/README.md documents. This
// deployer key holds no role or authority anywhere else in this project.
//
// Naming: every token is clearly test-prefixed ("MANDORTEST-"), and none
// mimics a real token's name closely (the one category with a real
// on-chain equivalent today, USYC, gets "MANDORTEST-YIELD", not anything
// resembling "USYC", so there is never confusion between this test token
// and the genuinely real one on the same explorer).
//
// Run with: node --import tsx scripts/deployTestTokens.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const WUSDC = "0x911b4000D3422F482F4062a913885f7b035382Df" as const;
const POSITION_MANAGER = "0x0553682bc188b850acd31CBd3500Dcd0aa35372B" as const;
const FEE = 3000; // 0.3%, the only fee tier confirmed to hold real liquidity anywhere in this ecosystem, see docs/arc-facts-to-verify.md
const TICK_SPACING = 60; // matches fee 3000 pools, confirmed live via real PoolCreated events this session

const IWUSDC_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const POSITION_MANAGER_ABI = [
  { type: "function", name: "createAndInitializePoolIfNecessary", stateMutability: "payable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "uint160" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

// TestToken.sol's own real ABI, minimal fragment.
const TEST_TOKEN_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

interface TokenSpec {
  name: string;
  symbol: string;
  decimals: number;
  // Target price in USD (WUSDC treated as 1:1 USD, same convention this
  // project already uses elsewhere), used only to size the initial pool,
  // not a claim of real-world value.
  priceUSD: number;
  // Seed depth in USD notional per side, deliberately modest (comparable
  // to the real pools' own real depth, see docs/arc-facts-to-verify.md),
  // not a claim of deep, mainnet-grade liquidity.
  seedUSD: number;
  category: string;
}

// Seed sizes deliberately small: the real deployer wallet was funded with
// exactly 20 USDC (native, Arc Testnet's own faucet allowance), which
// must cover both gas for ~25 real transactions across all 4 pools AND
// the actual WUSDC-side liquidity itself. 3 USD-equivalent per pool (12
// total) leaves real headroom for gas. Thin on purpose, not an oversight:
// still a real, usable pool, and thinness itself is realistic variety for
// the Paper Vault to reason about (criterion 1 of its own strategy text
// already asks it to size positions down for thin pools, not avoid them
// outright).
const TOKENS: TokenSpec[] = [
  { name: "Mandor Test Stable", symbol: "MANDORTEST-STABLE", decimals: 6, priceUSD: 1, seedUSD: 3, category: "additional stablecoin-style test asset" },
  { name: "Mandor Test RWA", symbol: "MANDORTEST-RWA", decimals: 18, priceUSD: 100, seedUSD: 3, category: "tokenized RWA/bond-style test asset" },
  { name: "Mandor Test Equity", symbol: "MANDORTEST-EQUITY", decimals: 18, priceUSD: 50, seedUSD: 3, category: "tokenized equity-style test asset, more volatile" },
  { name: "Mandor Test Yield", symbol: "MANDORTEST-YIELD", decimals: 6, priceUSD: 10, seedUSD: 3, category: "yield-bearing-style test asset (deliberately NOT named like real USYC)" },
];

// Integer square root via Newton's method, exact for BigInt, no floating
// point anywhere in this file: sqrtPriceX96 must be bit-precise, a
// float-based sqrt would silently mis-price the pool.
function bigIntSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("bigIntSqrt: negative input");
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

/// @notice sqrtPriceX96 = sqrt(price_raw) * 2^96, where price_raw is
/// token1's raw amount per token0's raw amount (standard Uniswap V3
/// definition). Computed as isqrt(numerator * 2^192 / denominator) to
/// stay exact in BigInt throughout, never converting to a JS float.
function computeSqrtPriceX96(token0IsWUSDC: boolean, tokenDecimals: number, priceUSD: number): bigint {
  // priceUSD scaled to an integer with 6 fractional digits, avoids floats
  // for the ratio itself too.
  const priceScaled = BigInt(Math.round(priceUSD * 1_000_000));
  const wusdcDecimals = 18;

  // token1_raw / token0_raw, expressed as a numerator/denominator pair in
  // raw (smallest-unit) terms for whichever ordering applies.
  let numerator: bigint;
  let denominator: bigint;
  if (token0IsWUSDC) {
    // token0 = WUSDC, token1 = the new test token. 1 WUSDC (10^18 raw) is
    // worth (1/priceUSD) of the test token, i.e. token1_raw/token0_raw =
    // 10^tokenDecimals / (priceUSD * 10^18) per unit, scaled by priceScaled.
    numerator = 10n ** BigInt(tokenDecimals) * 1_000_000n;
    denominator = priceScaled * 10n ** BigInt(wusdcDecimals);
  } else {
    // token0 = the new test token, token1 = WUSDC. token1_raw/token0_raw =
    // (priceUSD * 10^18) / 10^tokenDecimals per unit.
    numerator = priceScaled * 10n ** BigInt(wusdcDecimals);
    denominator = 10n ** BigInt(tokenDecimals) * 1_000_000n;
  }

  const Q192 = 1n << 192n;
  const ratioX192 = (numerator * Q192) / denominator;
  return bigIntSqrt(ratioX192);
}

/// @notice Real Uniswap V3 tick math (log base 1.0001), ported once more
/// here in plain TypeScript rather than reusing contracts/lib/TickMath.sol
/// (a Solidity library, not directly callable from a Node script). Only
/// needs enough precision to pick a real, valid, spacing-aligned tick
/// range for seeding, not the bit-exact on-chain rounding contract-side
/// TickMath.sol guarantees; this project's own contracts remain the sole
/// source of truth for anything execution-relevant.
function priceToTick(token0IsWUSDC: boolean, tokenDecimals: number, priceUSD: number): number {
  const wusdcDecimals = 18;
  let rawPrice: number;
  if (token0IsWUSDC) {
    rawPrice = 10 ** tokenDecimals / (priceUSD * 10 ** wusdcDecimals);
  } else {
    rawPrice = (priceUSD * 10 ** wusdcDecimals) / 10 ** tokenDecimals;
  }
  return Math.floor(Math.log(rawPrice) / Math.log(1.0001));
}

function alignToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

async function main() {
  const key = process.env.TEST_TOKEN_DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("TEST_TOKEN_DEPLOYER_PRIVATE_KEY is not set. Run the key-generation step first.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer native balance: ${balance.toString()} (raw, 18 decimals)`);
  if (balance === 0n) {
    throw new Error(`Deployer ${account.address} has zero balance. Fund it with real Arc Testnet gas (same faucet used before) and re-run.`);
  }

  // Wrap enough native currency into WUSDC to cover every pool's WUSDC-side seed.
  const totalSeedUSD = TOKENS.reduce((sum, t) => sum + t.seedUSD, 0);
  const wrapAmount = BigInt(totalSeedUSD) * 10n ** 18n;
  console.log(`Wrapping ${totalSeedUSD} native into WUSDC...`);
  const wrapHash = await walletClient.writeContract({ address: WUSDC, abi: IWUSDC_ABI, functionName: "deposit", value: wrapAmount, chain: ARC_TESTNET, account });
  await publicClient.waitForTransactionReceipt({ hash: wrapHash });
  console.log(`Wrapped. WUSDC balance: ${await publicClient.readContract({ address: WUSDC, abi: IWUSDC_ABI, functionName: "balanceOf", args: [account.address] })}`);

  const deployed: { spec: TokenSpec; address: `0x${string}`; pool: `0x${string}`; tokenId: bigint }[] = [];

  for (const spec of TOKENS) {
    console.log(`\n=== ${spec.symbol} (${spec.category}) ===`);

    // Deploy TestToken via the Hardhat-compiled artifact's bytecode/ABI,
    // read at runtime so this script has no hard Hardhat/Foundry-artifact
    // coupling beyond a plain JSON read, matching agent/core's own
    // "framework-agnostic" convention.
    const artifact = await import("../forge-out/TestToken.sol/TestToken.json", { with: { type: "json" } });
    const deployHash = await walletClient.deployContract({
      abi: artifact.default.abi,
      bytecode: artifact.default.bytecode.object as Hex,
      args: [spec.name, spec.symbol, spec.decimals, account.address],
      chain: ARC_TESTNET,
      account,
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const tokenAddress = deployReceipt.contractAddress;
    if (!tokenAddress) throw new Error(`${spec.symbol} deployment produced no contract address.`);
    console.log(`Deployed at ${tokenAddress}`);

    // Mint the full seed-side supply (plus a bit of headroom) to the deployer.
    const seedAmountRaw = (BigInt(spec.seedUSD) * 10n ** BigInt(spec.decimals)) / BigInt(Math.round(spec.priceUSD));
    const mintAmount = seedAmountRaw * 2n; // headroom, never all committed to the pool
    const mintHash = await walletClient.writeContract({ address: tokenAddress, abi: TEST_TOKEN_ABI, functionName: "mint", args: [account.address, mintAmount], chain: ARC_TESTNET, account });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    console.log(`Minted ${mintAmount} raw units to self.`);

    const token0IsWUSDC = BigInt(WUSDC) < BigInt(tokenAddress);
    const token0 = token0IsWUSDC ? WUSDC : tokenAddress;
    const token1 = token0IsWUSDC ? tokenAddress : WUSDC;

    const sqrtPriceX96 = computeSqrtPriceX96(token0IsWUSDC, spec.decimals, spec.priceUSD);
    console.log(`Creating and initializing pool (token0=${token0}, token1=${token1}, fee=${FEE})...`);
    const initHash = await walletClient.writeContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, FEE, sqrtPriceX96],
      chain: ARC_TESTNET,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: initHash });

    const centerTick = alignToSpacing(priceToTick(token0IsWUSDC, spec.decimals, spec.priceUSD), TICK_SPACING);
    // A wide, symmetric range around the seed price (roughly +-12%, 1200
    // ticks at 60 spacing, matching v3's own minLpTickRangeWidth
    // placeholder, see contracts/VaultPolicy.sol), safe for an initial
    // deep-enough seed without excessive concentration.
    const tickLower = centerTick - 1200;
    const tickUpper = centerTick + 1200;

    const wusdcSeedRaw = BigInt(spec.seedUSD) * 10n ** 18n;
    const tokenSeedRaw = seedAmountRaw;
    const amount0Desired = token0IsWUSDC ? wusdcSeedRaw : tokenSeedRaw;
    const amount1Desired = token0IsWUSDC ? tokenSeedRaw : wusdcSeedRaw;

    await walletClient.writeContract({ address: WUSDC, abi: IWUSDC_ABI, functionName: "approve", args: [POSITION_MANAGER, wusdcSeedRaw], chain: ARC_TESTNET, account }).then((h) => publicClient.waitForTransactionReceipt({ hash: h }));
    await walletClient.writeContract({ address: tokenAddress, abi: TEST_TOKEN_ABI, functionName: "approve", args: [POSITION_MANAGER, tokenSeedRaw], chain: ARC_TESTNET, account }).then((h) => publicClient.waitForTransactionReceipt({ hash: h }));

    console.log(`Seeding liquidity (tickLower=${tickLower}, tickUpper=${tickUpper})...`);
    const mintPositionHash = await walletClient.writeContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: FEE,
          tickLower,
          tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        },
      ],
      chain: ARC_TESTNET,
      account,
    });
    const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintPositionHash });
    console.log(`Pool seeded. tx: ${mintPositionHash}, status: ${mintReceipt.status}`);

    // Real pool address: read back from the Factory rather than guessed.
    const pool = await publicClient.readContract({
      address: POSITION_MANAGER,
      abi: [{ type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
      functionName: "factory",
    });
    console.log(`Factory (for reference): ${pool}`);

    deployed.push({ spec, address: getAddress(tokenAddress), pool: getAddress(tokenAddress), tokenId: 0n });
  }

  console.log("\n=== Summary ===");
  for (const d of deployed) {
    console.log(`${d.spec.symbol}: ${d.address} (${d.spec.category})`);
  }
  console.log("\nDocument these in docs/deployments.md as team-created test infrastructure, never a real market opportunity.");
}

main().catch((error) => {
  console.error(`deployTestTokens failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
