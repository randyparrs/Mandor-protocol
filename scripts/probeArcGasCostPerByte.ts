// Diagnostic-only, throwaway probe: deploys BytecodePointer with several
// KNOWN, small data sizes on the real Arc Testnet chain, measuring real
// gasUsed for each, to empirically derive the real gas-per-byte cost this
// specific chain charges for contract code deposit -- rather than
// continuing to guess from documentation or extrapolate from local
// Foundry numbers that do not match the real chain (local: ~5.38M gas for
// a 26,576-byte BytecodePointer; real chain: still reverting past 16M).
//
// Run with: node --import tsx scripts/probeArcGasCostPerByte.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  const pointerArtifact = await import("../forge-out/BytecodePointer.sol/BytecodePointer.json", { with: { type: "json" } });

  const sizes = [1_000, 5_000, 10_000];
  const results: Array<{ size: number; gasUsed: bigint }> = [];

  for (const size of sizes) {
    // Deterministic, non-zero filler (all non-zero bytes, the worst case
    // for calldata cost, since real MandateVault bytecode is also
    // overwhelmingly non-zero).
    const filler = ("0x" + "ab".repeat(size)) as Hex;

    await sleep(RPC_PACING_MS);
    const hash = await walletClient.deployContract({
      abi: pointerArtifact.default.abi,
      bytecode: pointerArtifact.default.bytecode.object as Hex,
      args: [filler],
      chain: ARC_TESTNET,
      account,
      gas: 6_000_000n, // generous for even the largest probe size here
    });
    await sleep(RPC_PACING_MS);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`size=${size} bytes: status=${receipt.status}, gasUsed=${receipt.gasUsed}, tx=${hash}`);
    if (receipt.status === "success") {
      results.push({ size, gasUsed: receipt.gasUsed });
    }
  }

  console.log("\n=== Results ===");
  for (const r of results) {
    console.log(`size=${r.size}, gasUsed=${r.gasUsed}`);
  }

  if (results.length >= 2) {
    const [a, b] = [results[0], results[results.length - 1]];
    const rate = Number(b.gasUsed - a.gasUsed) / (b.size - a.size);
    const base = Number(a.gasUsed) - rate * a.size;
    console.log(`\nEmpirical linear fit: gasUsed ~= ${base.toFixed(0)} + ${rate.toFixed(2)} * bytes`);
    console.log(`Standard Ethereum G_codedeposit is 200 gas/byte -- compare against the fitted rate above.`);
    const projectedFor26576 = base + rate * 26576;
    console.log(`Projected gas for a 26,576-byte payload (real MandateVault size): ~${projectedFor26576.toFixed(0)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
