// Generates REAL, but explicitly team-originated, trading volume against
// the 4 team-created MANDORTEST test pools (docs/deployments.md), so the
// Paper Vault's fee-APR estimate (scripts/paperVaultTestTokens.ts) has
// genuine onchain fee-accrual history to read instead of a permanent 0%
// (these pools were seeded via mint(), which does not itself generate
// fees; only real swaps do).
//
// IMPORTANT, same transparency standard as the tokens/pools themselves:
// this is the team's own dedicated test-deployer wallet swapping against
// itself (round-trip: token -> WUSDC -> token), not organic third-party
// demand. Every fee/APR figure derived from this volume must say so
// wherever it reaches the agent's reasoning or any demo material, see
// scripts/paperVaultTestTokens.ts's own doc comment. Never present an
// ENTER decision informed by this data as if it reflects real market
// interest.
//
// Uses TEST_TOKEN_DEPLOYER_PRIVATE_KEY only (same dedicated, single-
// purpose key scripts/deployTestTokens.ts already uses), never
// KEEPER_PRIVATE_KEY.
//
// Run with: node --import tsx scripts/generatePaperVaultTestVolume.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const WUSDC = "0x911b4000D3422F482F4062a913885f7b035382Df" as const;
const ROUTER = "0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01" as const;
const FEE = 3000;

const TOKENS = [
  { symbol: "MANDORTEST-STABLE", address: "0xb5a15b8370984Cd3C5d657d76B8C4Fe3Cf1320D0" as const, pool: "0x7da67d0b3950ccd6090f76fbefaad0355bc0312c" as const },
  { symbol: "MANDORTEST-RWA", address: "0x9e3EfD1B99506e65e61C021b42BdD436c088384f" as const, pool: "0x4a8dfa8f92e6c1f3b02107e515d645f8a8b73f46" as const },
  { symbol: "MANDORTEST-EQUITY", address: "0xbF53Ca85AB6becF290c089fA6135f7f83E624201" as const, pool: "0x4ea5eb558c0a84642a9bc3e2a2cbb042fdac5cb8" as const },
  { symbol: "MANDORTEST-YIELD", address: "0xCB9EdD86ba1FbD08E53E3460990659562c128c4e" as const, pool: "0x6fd54a25189fc7113d8815c643e1054dc62800ed" as const },
];

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const POOL_ABI = [
  { type: "function", name: "feeGrowthGlobal0X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeGrowthGlobal1X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const key = process.env.TEST_TOKEN_DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("TEST_TOKEN_DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Deployer: ${account.address}`);
  console.log("Generating REAL but self-originated round-trip swap volume (token -> WUSDC -> token) against each MANDORTEST pool.\n");

  for (const t of TOKENS) {
    console.log(`=== ${t.symbol} ===`);
    const balance = await publicClient.readContract({ address: t.address, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
    const swapAmount = (balance * 4n) / 10n; // 40% of leftover balance, round trip
    if (swapAmount === 0n) {
      console.log(`Skipping ${t.symbol}: no leftover balance to swap.`);
      continue;
    }
    console.log(`Leg 1: swapping ${swapAmount} raw ${t.symbol} -> WUSDC`);

    await walletClient
      .writeContract({ address: t.address, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, swapAmount], chain: ARC_TESTNET, account })
      .then((h) => publicClient.waitForTransactionReceipt({ hash: h }));

    const wusdcBefore = await publicClient.readContract({ address: WUSDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
    const swap1Hash = await walletClient.writeContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: t.address,
          tokenOut: WUSDC,
          fee: FEE,
          recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
          amountIn: swapAmount,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
      chain: ARC_TESTNET,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: swap1Hash });
    const wusdcAfter = await publicClient.readContract({ address: WUSDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
    const wusdcReceived = wusdcAfter - wusdcBefore;
    console.log(`Leg 1 done (tx ${swap1Hash}). Received ${wusdcReceived} raw WUSDC.`);

    console.log(`Leg 2: swapping ${wusdcReceived} raw WUSDC -> ${t.symbol}`);
    await walletClient
      .writeContract({ address: WUSDC, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, wusdcReceived], chain: ARC_TESTNET, account })
      .then((h) => publicClient.waitForTransactionReceipt({ hash: h }));

    const swap2Hash = await walletClient.writeContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: WUSDC,
          tokenOut: t.address,
          fee: FEE,
          recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
          amountIn: wusdcReceived,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
      chain: ARC_TESTNET,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: swap2Hash });
    console.log(`Leg 2 done (tx ${swap2Hash}).`);

    // Independent verification, same discipline as every other deployment
    // script in this project: read the pool's own real fee accumulators
    // after the round trip, never trust the "tx succeeded" log alone.
    const [feeGrowth0, feeGrowth1] = await Promise.all([
      publicClient.readContract({ address: t.pool, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" }),
      publicClient.readContract({ address: t.pool, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" }),
    ]);
    console.log(`Verified: pool ${t.pool} feeGrowthGlobal0X128=${feeGrowth0}, feeGrowthGlobal1X128=${feeGrowth1} (nonzero confirms real fee accrual occurred).\n`);
  }

  console.log(`Done. Timestamp of this run (record as the fee-observation start): ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error(`generatePaperVaultTestVolume failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
