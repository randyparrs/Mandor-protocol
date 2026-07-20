// One-off, read-only live verification (not a permanent project script):
// (1) reconfirm whether a real UnitFlowV3 pool pairing NATIVE USDC with
// cirBTC exists today (docs/deployments.md's v2 section disclosed NO such
// pool as of that vault's creation -- re-verifying live before trusting
// that same fact for v5's own design, since v5 uses the identical native
// USDC base asset and pools can be created over time); (2) search for any
// real WETH/WrappedETH-equivalent token pool with genuine liquidity on
// Arc/UnitFlowV3, never checked in this project before, before assuming an
// ETH/USDC v5 variant would be buildable.
//
// Uses testnet.arcscan.app's own real Blockscout-style v2 API for the
// PoolCreated event scan (raw eth_getLogs against the public RPC is capped
// at a 10,000-block range per call, confirmed live, making a full-history
// scan back to genesis impractical at this chain's real height of
// ~52.6M blocks; the explorer's own indexed API has no such per-call
// range limit and paginates real results directly), same
// testnet.arcscan.app/api/v2/... pattern already used elsewhere in this
// project (docs/deployments.md).
import { createPublicClient, http, defineChain, getAddress } from "viem";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const client = createPublicClient({ chain: ARC_TESTNET, transport: http() });

const FACTORY = getAddress("0xAb6A8AAb7d490007634ef59d424b5d89688a1971");
const USDC_NATIVE = getAddress("0x3600000000000000000000000000000000000000");
const CIRBTC = getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
const FEE_TIERS = [100, 500, 3000, 10000];
const POOL_CREATED_TOPIC = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";

const FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
] as const;

const ERC20_MIN_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const POOL_MIN_ABI = [{ type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkPair(label: string, tokenA: `0x${string}`, tokenB: `0x${string}`) {
  console.log(`\n--- ${label} ---`);
  for (const fee of FEE_TIERS) {
    const pool = await client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB, fee] });
    if (pool === ZERO_ADDRESS) {
      console.log(`fee ${fee}: no pool`);
    } else {
      await sleep(1500);
      const liquidity = await client.readContract({ address: pool, abi: POOL_MIN_ABI, functionName: "liquidity" });
      console.log(`fee ${fee}: pool ${pool}, liquidity()=${liquidity}`);
    }
    await sleep(1500);
  }
}

interface PoolCreatedLogItem {
  decoded: { parameters: Array<{ name: string; value: string }> } | null;
}

async function fetchAllPoolCreatedTokenAddresses(): Promise<Set<string>> {
  const tokens = new Set<string>();
  let url = `https://testnet.arcscan.app/api/v2/addresses/${FACTORY}/logs?topic=${POOL_CREATED_TOPIC}`;
  let page = 0;
  while (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Arcscan API returned HTTP ${response.status} on page ${page}`);
    const body = (await response.json()) as { items: PoolCreatedLogItem[]; next_page_params: Record<string, string | number> | null };
    for (const item of body.items) {
      const token0 = item.decoded?.parameters.find((p) => p.name === "token0")?.value;
      const token1 = item.decoded?.parameters.find((p) => p.name === "token1")?.value;
      if (token0) tokens.add(token0.toLowerCase());
      if (token1) tokens.add(token1.toLowerCase());
    }
    page++;
    console.log(`Fetched page ${page} (${body.items.length} events), running unique-token total: ${tokens.size}`);
    if (!body.next_page_params) break;
    const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)])), topic: POOL_CREATED_TOPIC });
    url = `https://testnet.arcscan.app/api/v2/addresses/${FACTORY}/logs?${params.toString()}`;
    await sleep(300);
  }
  return tokens;
}

async function findRealWethLikeToken() {
  console.log("\n--- Scanning ALL real PoolCreated events (via testnet.arcscan.app's indexed API) for any WETH/WrappedETH-like symbol ---");
  const tokens = await fetchAllPoolCreatedTokenAddresses();
  console.log(`Total unique tokens seen across every real pool ever created on this Factory: ${tokens.size}`);

  const candidates: Array<{ address: string; symbol: string }> = [];
  for (const tokenAddr of tokens) {
    try {
      const symbol = await client.readContract({ address: getAddress(tokenAddr), abi: ERC20_MIN_ABI, functionName: "symbol" });
      if (/weth|wrapped\s*eth|^eth$/i.test(symbol)) {
        candidates.push({ address: tokenAddr, symbol });
        console.log(`CANDIDATE: ${tokenAddr} symbol="${symbol}"`);
      }
    } catch {
      // Some addresses among the logged tokens may not respond to symbol() (non-standard token); skip, this is a broad scan.
    }
    await sleep(250);
  }
  if (candidates.length === 0) {
    console.log("RESULT: no token symbol matching /weth|wrapped eth|^eth$/i found among ANY token that has ever appeared in a real PoolCreated event on this Factory.");
  }
  return candidates;
}

async function main() {
  await checkPair("Native USDC / cirBTC (v2/v5's actual base asset pairing)", USDC_NATIVE, CIRBTC);
  await sleep(2000);
  await findRealWethLikeToken();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
