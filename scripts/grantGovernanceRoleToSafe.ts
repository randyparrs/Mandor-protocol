// Grants GOVERNANCE_ROLE on the shared MandateRoles (used by v1/v2/v3/v4
// alike, see docs/deployments.md) to the real v4 governance Safe
// (2-of-2 multisig of the project's real signers), alongside the existing
// ADMIN wallet, not replacing it. A deliberate decision: keep both holders for now
// -- the Safe's real propose/sign/execute flow has never been exercised
// end to end yet, and revoking the ADMIN wallet's GOVERNANCE_ROLE before
// proving the Safe works in practice would leave this project's entire
// governance surface (v1/v2/v3/v4) dependent on an unproven mechanism
// with no fallback. Revoking ADMIN's GOVERNANCE_ROLE is a deliberate,
// separate future step, only after the Safe has completed at least one
// real governance action (starting with setLendingRegistry/
// proposeChainKeeper once a real v4 vault exists).
//
// Run with: npx hardhat run scripts/grantGovernanceRoleToSafe.ts --network arcTestnet
//
// Requires hardhat.config.ts's arcTestnet.accounts[1] (ARC_ADMIN_PRIVATE_KEY,
// set via `npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY`) to actually be
// the real admin address's key, verified live below before doing anything.
import { network } from "hardhat";
import { getAddress, type Hash } from "viem";

const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const SAFE_ADDRESS = getAddress("0x504e43cc6d6486fcD812587F5b0325A4c4AAa911");

async function main() {
  const { viem } = await network.connect({ network: "arcTestnet" });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  if (wallets.length < 2) {
    throw new Error(
      "arcTestnet.accounts needs a second entry (ARC_ADMIN_PRIVATE_KEY) for the real ADMIN_ROLE holder. Set it with: npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY",
    );
  }
  const admin = wallets[1];

  // Verify live, never assume the configured key actually is the admin
  // address, before doing anything.
  if (getAddress(admin.account.address) !== ADMIN_GOVERNANCE_ADDRESS) {
    throw new Error(
      `arcTestnet.accounts[1] resolves to ${admin.account.address}, not the expected admin address ${ADMIN_GOVERNANCE_ADDRESS}. Stopping, do not proceed with the wrong signer.`,
    );
  }
  console.log(`Admin signer confirmed: ${admin.account.address}`);

  const roles = await viem.getContractAt("MandateRoles", MANDATE_ROLES_ADDRESS);
  const GOVERNANCE_ROLE = await roles.read.GOVERNANCE_ROLE();
  const DEFAULT_ADMIN_ROLE = await roles.read.DEFAULT_ADMIN_ROLE();

  // Confirm the admin wallet actually holds DEFAULT_ADMIN_ROLE (the role
  // that grantRole itself requires here, MandateRoles never remaps a
  // role's admin away from the OpenZeppelin default), before spending gas
  // on a call that would just revert.
  const adminHasDefaultAdminRole = await roles.read.hasRole([DEFAULT_ADMIN_ROLE, admin.account.address]);
  if (!adminHasDefaultAdminRole) {
    throw new Error(`${admin.account.address} does not hold DEFAULT_ADMIN_ROLE on MandateRoles. Cannot grant GOVERNANCE_ROLE. Stopping.`);
  }

  const safeAlreadyHasRole = await roles.read.hasRole([GOVERNANCE_ROLE, SAFE_ADDRESS]);
  if (safeAlreadyHasRole) {
    console.log(`Safe (${SAFE_ADDRESS}) already holds GOVERNANCE_ROLE. Nothing to do.`);
    return;
  }

  async function confirm(txHashPromise: Promise<Hash>, label: string) {
    const hash = await txHashPromise;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} reverted (tx ${hash}). Stopping, do not continue.`);
    }
    console.log(`${label}: ${hash}`);
    return receipt;
  }

  await confirm(
    roles.write.grantRole([GOVERNANCE_ROLE, SAFE_ADDRESS], { account: admin.account }),
    `Granted GOVERNANCE_ROLE to Safe (${SAFE_ADDRESS})`,
  );

  // Read-only verification, never assumed: confirm the Safe actually holds
  // the role now, AND confirm the ADMIN wallet still holds it too (this
  // script only ever adds, a deliberate decision not to revoke yet).
  const safeHasRoleAfter = await roles.read.hasRole([GOVERNANCE_ROLE, SAFE_ADDRESS]);
  const adminHasRoleAfter = await roles.read.hasRole([GOVERNANCE_ROLE, ADMIN_GOVERNANCE_ADDRESS]);
  console.log(`Verified onchain: Safe hasRole(GOVERNANCE_ROLE)=${safeHasRoleAfter}, ADMIN wallet hasRole(GOVERNANCE_ROLE)=${adminHasRoleAfter}`);
  if (!safeHasRoleAfter) {
    throw new Error("Safe does not hold GOVERNANCE_ROLE after the grant transaction. Do not treat this as complete.");
  }
  if (!adminHasRoleAfter) {
    throw new Error("ADMIN wallet unexpectedly lost GOVERNANCE_ROLE (this script never revokes it). Investigate before proceeding.");
  }

  console.log("\n=== GOVERNANCE_ROLE grant summary ===");
  console.log(`MandateRoles:      ${MANDATE_ROLES_ADDRESS}`);
  console.log(`GOVERNANCE_ROLE now held by: ${ADMIN_GOVERNANCE_ADDRESS} (unchanged), ${SAFE_ADDRESS} (new)`);
  console.log("Revoking the ADMIN wallet's GOVERNANCE_ROLE is a deliberate, separate future step, not done here.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
