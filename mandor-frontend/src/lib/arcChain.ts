// Copied verbatim from the project's real, already-verified ARC_TESTNET
// constant (src/lib/arcChain.ts, itself copied from executor/keeperService.ts,
// RPC/chainId already used and confirmed live elsewhere in this project),
// never re-derived here.
import { defineChain } from "viem";

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
