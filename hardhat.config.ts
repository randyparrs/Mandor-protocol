import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: "0.8.28",
  networks: {
    arcTestnet: {
      type: "http",
      chainType: "generic",
      url: "https://rpc.testnet.arc.network",
      chainId: 5042002,
      // Private key stored encrypted via Hardhat's keystore.
      // Set with: npx hardhat keystore set ARC_PRIVATE_KEY
      accounts: [configVariable("ARC_PRIVATE_KEY")],
    },
  },
});
