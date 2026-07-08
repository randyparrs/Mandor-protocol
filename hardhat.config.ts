import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatFoundry from "@nomicfoundation/hardhat-foundry";

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatFoundry],
  solidity: {
    version: "0.8.28",
    settings: {
      // Matches foundry.toml's optimizer settings. Without this,
      // MandateVaultDeployer.sol exceeds the EIP-170 24576-byte contract
      // size limit under Hardhat's unoptimized default, even though it
      // compiles fine under Foundry, which enables the optimizer by default
      // in this project's config.
      optimizer: { enabled: true, runs: 200 },
    },
  },
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
