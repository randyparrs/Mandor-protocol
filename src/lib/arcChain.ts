// Copied verbatim from executor/keeperService.ts's already-verified
// ARC_TESTNET constant (RPC/chainId already used and confirmed live
// elsewhere in this project, see hardhat.config.ts's arcTestnet entry),
// never re-derived here.
import { defineChain } from "viem";

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
