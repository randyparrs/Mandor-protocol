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
      // Both stored encrypted via Hardhat's keystore, never in this file
      // or .env. accounts[0] (ARC_PRIVATE_KEY) is the original deployer
      // wallet, which renounced ADMIN_ROLE/DEFAULT_ADMIN_ROLE right after
      // the first deploy (see docs/deployments.md), it cannot call
      // ADMIN_ROLE-gated functions like VaultFactory.createVault anymore.
      // accounts[1] (ARC_ADMIN_PRIVATE_KEY) is the real team/admin address
      // (0x884687C973e9b7Af697dC34Aed1F09Da06BC4253) that actually holds
      // ADMIN_ROLE, needed for scripts/deployVaultV2.ts.
      // Set with: npx hardhat keystore set ARC_PRIVATE_KEY
      //           npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY
      accounts: [configVariable("ARC_PRIVATE_KEY"), configVariable("ARC_ADMIN_PRIVATE_KEY")],
    },
  },
});
