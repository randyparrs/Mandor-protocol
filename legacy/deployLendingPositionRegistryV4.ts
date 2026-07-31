// Deploys the real LendingPositionRegistry for the real v4 vault
// (0xFba09f9466C8469cfA058d7ab99e9807fC8155f0, see docs/deployments.md's
// v4 section). No privileged role gates this constructor (just records the
// vault/policy/roles addresses), so any funded wallet can deploy it --
// uses the ADMIN wallet here only for consistency with every other real
// deploy in this project, not because it needs ADMIN_ROLE.
//
// Does NOT wire it to the vault (vault.setLendingRegistry) or propose a
// chainKeeper -- both of those are onlyGovernance, and go through the Safe
// (2-of-2) as a deliberate first real exercise of that signing flow, not
// this script. This script only deploys the registry and prints the exact
// calldata for those two Safe transactions.
//
// Run with: npx hardhat run scripts/deployLendingPositionRegistryV4.ts --network arcTestnet
import { network } from "hardhat";
import { getAddress, encodeFunctionData, type Hash } from "viem";

const VAULT_V4_ADDRESS = getAddress("0xFba09f9466C8469cfA058d7ab99e9807fC8155f0");
const POLICY_V4_ADDRESS = getAddress("0x6d143406143C7E88C9063AED28E7E288C26969Ef");
const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");
const SAFE_ADDRESS = getAddress("0x504e43cc6d6486fcD812587F5b0325A4c4AAa911");
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614n; // real EVM chainId, distinct from the CCTP domain (3)
const ARBITRUM_SEPOLIA_KEEPER_ADDRESS = getAddress("0xc5c828D0AC3e106C5006c4b62c3eb2405A5462b3");

const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");

const SET_LENDING_REGISTRY_ABI = [
  { type: "function", name: "setLendingRegistry", stateMutability: "nonpayable", inputs: [{ name: "registry", type: "address" }], outputs: [] },
] as const;

const PROPOSE_CHAIN_KEEPER_ABI = [
  { type: "function", name: "proposeChainKeeper", stateMutability: "nonpayable", inputs: [{ name: "chainId", type: "uint256" }, { name: "keeper", type: "address" }], outputs: [] },
] as const;

async function main() {
  const { viem } = await network.connect({ network: "arcTestnet" });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  if (wallets.length < 2) {
    throw new Error(
      "arcTestnet.accounts needs a second entry (ARC_ADMIN_PRIVATE_KEY). Set it with: npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY",
    );
  }
  const admin = wallets[1];
  if (getAddress(admin.account.address) !== ADMIN_GOVERNANCE_ADDRESS) {
    throw new Error(
      `arcTestnet.accounts[1] resolves to ${admin.account.address}, not the expected admin address ${ADMIN_GOVERNANCE_ADDRESS}. Stopping, do not proceed with the wrong signer.`,
    );
  }
  console.log(`Deployer signer confirmed: ${admin.account.address}`);

  async function confirm(txHashPromise: Promise<Hash>, label: string) {
    const hash = await txHashPromise;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} reverted (tx ${hash}). Stopping, do not continue.`);
    }
    console.log(`${label}: ${hash}`);
    return receipt;
  }

  const registry = await viem.deployContract(
    "LendingPositionRegistry",
    [VAULT_V4_ADDRESS, POLICY_V4_ADDRESS, MANDATE_ROLES_ADDRESS],
    { client: { wallet: admin } },
  );
  console.log(`LendingPositionRegistry (v4): ${registry.address}`);

  // Read-only verification, never assumed: confirm the constructor
  // arguments actually landed as configured.
  const liveVault = await registry.read.vault();
  const livePolicy = await registry.read.policy();
  const liveRoles = await registry.read.roles();
  console.log(`Verified onchain: vault=${liveVault}, policy=${livePolicy}, roles=${liveRoles}`);
  if (getAddress(liveVault) !== VAULT_V4_ADDRESS || getAddress(livePolicy) !== POLICY_V4_ADDRESS || getAddress(liveRoles) !== MANDATE_ROLES_ADDRESS) {
    throw new Error("Live constructor arguments do not match what was requested. Do not treat this deployment as complete.");
  }

  const setLendingRegistryCalldata = encodeFunctionData({ abi: SET_LENDING_REGISTRY_ABI, functionName: "setLendingRegistry", args: [registry.address] });
  const proposeChainKeeperCalldata = encodeFunctionData({
    abi: PROPOSE_CHAIN_KEEPER_ABI,
    functionName: "proposeChainKeeper",
    args: [ARBITRUM_SEPOLIA_CHAIN_ID, ARBITRUM_SEPOLIA_KEEPER_ADDRESS],
  });

  console.log("\n=== Next: 2 Safe (2-of-2) transactions, not this script ===");
  console.log(`Safe address: ${SAFE_ADDRESS}\n`);
  console.log("Transaction 1: vault.setLendingRegistry(registry)");
  console.log(`  To:       ${VAULT_V4_ADDRESS}`);
  console.log(`  Value:    0`);
  console.log(`  Data:     ${setLendingRegistryCalldata}\n`);
  console.log(`Transaction 2: registry.proposeChainKeeper(${ARBITRUM_SEPOLIA_CHAIN_ID}, ${ARBITRUM_SEPOLIA_KEEPER_ADDRESS})`);
  console.log(`  To:       ${registry.address}`);
  console.log(`  Value:    0`);
  console.log(`  Data:     ${proposeChainKeeperCalldata}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
