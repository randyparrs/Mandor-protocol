// Finalizes v6's Arbitrum Sepolia chainKeeper proposal once the real 48h
// CHAIN_KEEPER_CHANGE_TIMELOCK has elapsed (executable at 2026-07-29
// 13:24 UTC, see LendingPositionRegistry.proposeChainKeeper's own tx).
// Permissionless -- any funded wallet can call this, no Safe/governance
// needed for this step (only proposeChainKeeper itself was governance-
// gated). Reverts cleanly if called before the timelock elapses, so
// running this too early is harmless, not destructive.
//
// Run with: npx hardhat run scripts/executeChainKeeperV6.ts --network arcTestnet
import { network } from "hardhat";
import { getAddress } from "viem";

const LENDING_POSITION_REGISTRY_V6_ADDRESS = getAddress("0x7130Ec4656f518951725Da97F515462aE45dd3E7");
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614n;

async function main() {
  const { viem } = await network.connect({ network: "arcTestnet" });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const admin = wallets[1] ?? wallets[0];
  console.log(`Caller: ${admin.account.address} (permissionless call, any funded wallet works)`);

  const registry = await viem.getContractAt("LendingPositionRegistry", LENDING_POSITION_REGISTRY_V6_ADDRESS);

  const executableAt = await registry.read.chainKeeperExecutableAt([ARBITRUM_SEPOLIA_CHAIN_ID]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  console.log(`chainKeeperExecutableAt: ${executableAt} (${new Date(Number(executableAt) * 1000).toISOString()}), now: ${now} (${new Date(Number(now) * 1000).toISOString()})`);
  if (now < executableAt) {
    throw new Error(`Timelock has not elapsed yet -- ${executableAt - now} seconds remaining. Stopping, do not force this.`);
  }

  const hash = await admin.writeContract({ address: LENDING_POSITION_REGISTRY_V6_ADDRESS, abi: registry.abi, functionName: "executeChainKeeper", args: [ARBITRUM_SEPOLIA_CHAIN_ID] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`executeChainKeeper reverted (tx ${hash}).`);
  }
  console.log(`executeChainKeeper(${ARBITRUM_SEPOLIA_CHAIN_ID}): ${hash}`);

  // Read-only verification, never assumed.
  const liveChainKeeper = await registry.read.chainKeeper([ARBITRUM_SEPOLIA_CHAIN_ID]);
  console.log(`Verified onchain: registry.chainKeeper(${ARBITRUM_SEPOLIA_CHAIN_ID}) = ${liveChainKeeper}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
