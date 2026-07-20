import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatFoundry from "@nomicfoundation/hardhat-foundry";

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatFoundry],
  solidity: {
    version: "0.8.28",
    settings: {
      // Matches foundry.toml's optimizer settings exactly. runs: 1 + viaIR
      // (not just runs: 200) became necessary once v3's LP logic pushed
      // MandateVault.sol's real runtime bytecode to 25,498 bytes, over the
      // EIP-170 24,576-byte limit real EVM chains actually enforce at
      // deployment (confirmed via forge build --sizes, not just a compiler
      // warning to ignore): runs: 1 alone only got to 24,956 (still over),
      // viaIR's more aggressive optimization pipeline was needed to get to
      // 22,894, real margin under the limit. Slower to compile, smaller and
      // more gas-efficient-per-call than the legacy pipeline at this low a
      // runs value, an acceptable tradeoff for a testnet/hackathon
      // deployment over raw compile speed.
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
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
