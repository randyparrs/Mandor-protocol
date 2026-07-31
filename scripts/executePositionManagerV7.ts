// Finalizes v7's positionManager proposal once the real 48h
// POSITION_MANAGER_CHANGE_TIMELOCK has elapsed (executable at 2026-07-29
// 20:31 UTC, see LpPositionRegistry.proposePositionManager's own tx).
// Permissionless -- any funded wallet can call this, no Safe/governance
// needed for this step (only proposePositionManager itself was governance-
// gated). Reverts cleanly if called before the timelock elapses, so
// running this too early is harmless, not destructive.
//
// Run with: npx hardhat run scripts/executePositionManagerV7.ts --network arcTestnet
import { network } from "hardhat";
import { getAddress } from "viem";

const LP_POSITION_REGISTRY_V7_ADDRESS = getAddress("0x87a2a1920ea07847dd3fffdb11fe0cc66bfcd357");

async function main() {
  const { viem } = await network.connect({ network: "arcTestnet" });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const admin = wallets[1] ?? wallets[0];
  console.log(`Caller: ${admin.account.address} (permissionless call, any funded wallet works)`);

  const registry = await viem.getContractAt("LpPositionRegistry", LP_POSITION_REGISTRY_V7_ADDRESS);

  const executableAt = await registry.read.pendingPositionManagerExecutableAt();
  const now = BigInt(Math.floor(Date.now() / 1000));
  console.log(`pendingPositionManagerExecutableAt: ${executableAt} (${new Date(Number(executableAt) * 1000).toISOString()}), now: ${now} (${new Date(Number(now) * 1000).toISOString()})`);
  if (now < executableAt) {
    throw new Error(`Timelock has not elapsed yet -- ${executableAt - now} seconds remaining. Stopping, do not force this.`);
  }

  const hash = await admin.writeContract({ address: LP_POSITION_REGISTRY_V7_ADDRESS, abi: registry.abi, functionName: "executePositionManager", args: [] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`executePositionManager reverted (tx ${hash}).`);
  }
  console.log(`executePositionManager(): ${hash}`);

  // Read-only verification, never assumed.
  const livePositionManager = await registry.read.positionManager();
  console.log(`Verified onchain: registry.positionManager() = ${livePositionManager}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
