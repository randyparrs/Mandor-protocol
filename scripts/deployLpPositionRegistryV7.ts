// Deploys the real LpPositionRegistry for the real v7 vault. No privileged
// role gates this constructor (just records the vault/policy/roles
// addresses), so any funded wallet can deploy it -- uses the ADMIN wallet
// here only for consistency with every other real deploy in this project
// (see scripts/deployLendingPositionRegistryV4.ts's own reasoning), not
// because it needs ADMIN_ROLE.
//
// Unlike LendingPositionRegistry, this contract genuinely needs
// contracts/lib/LiquidityAmounts.sol linked (an external library, `public
// pure` functions, see that library's own real bytecode.linkReferences,
// confirmed via the compiled artifact): reuses the SAME already-deployed
// LiquidityAmounts instance every prior LP-capable bootstrap (v3, v4, v5)
// already links against (0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140) --
// same library, unchanged, no reason to redeploy it a second time.
//
// Does NOT wire it to the vault (vault.setLpRegistry) or propose a
// positionManager -- both of those are onlyGovernance, and go through the
// Safe (2-of-2), same flow already proven for v4/v6's LendingPositionRegistry.
// This script only deploys the registry and prints the exact calldata for
// those two Safe transactions.
//
// Run with: npx hardhat run scripts/deployLpPositionRegistryV7.ts --network arcTestnet
import { network } from "hardhat";
import { getAddress, encodeFunctionData, type Hex, type Hash } from "viem";

const LIQUIDITY_AMOUNTS_ADDRESS = getAddress("0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140");
const POSITION_MANAGER_ADDRESS = getAddress("0x0553682bc188b850acd31CBd3500Dcd0aa35372B");
const SAFE_ADDRESS = getAddress("0x504e43cc6d6486fcD812587F5b0325A4c4AAa911");

const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");

// The real v7 vault and its VaultPolicy, deployed 2026-07-27 via
// scripts/deployVaultV7.ts (createVault tx
// 0x39993e565789b2a22d16d814fa6187212337caa35fea780f47bacc079de65437),
// independently re-verified live (vault.policy()/vault.asset()/
// vault.totalAssets() all match) before being pasted in here, not just
// copied from the script's own console output.
const VAULT_V7_ADDRESS = getAddress("0x9EF3E5896f2Cec68f8C5D7F61574c77dD2C410e4");
const POLICY_V7_ADDRESS = getAddress("0x1A904c43072564c9F6d95735E7A0c62f4bb63e5a");
const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");

const SET_LP_REGISTRY_ABI = [
  { type: "function", name: "setLpRegistry", stateMutability: "nonpayable", inputs: [{ name: "registry", type: "address" }], outputs: [] },
] as const;

const PROPOSE_POSITION_MANAGER_ABI = [
  { type: "function", name: "proposePositionManager", stateMutability: "nonpayable", inputs: [{ name: "newPositionManager", type: "address" }], outputs: [] },
] as const;

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in every prior
/// LiquidityAmounts-linking bootstrap (scripts/deployVaultFactoryForV3/4/5.ts).
function linkBytecode(bytecodeHex: string, linkReferences: LinkReferences, addresses: Record<string, `0x${string}`>): Hex {
  let hex = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  for (const [file, libs] of Object.entries(linkReferences)) {
    for (const [libName, refs] of Object.entries(libs)) {
      const key = `${file}:${libName}`;
      const address = addresses[key];
      if (!address) throw new Error(`linkBytecode: no address provided for ${key}, cannot link.`);
      const addressHex = address.slice(2).toLowerCase();
      for (const ref of refs) {
        const startChar = ref.start * 2;
        const lengthChar = ref.length * 2;
        const before = hex.slice(0, startChar);
        const after = hex.slice(startChar + lengthChar);
        hex = before + addressHex + after;
      }
    }
  }
  return `0x${hex}` as Hex;
}

async function main() {
  if (VAULT_V7_ADDRESS === getAddress("0x0000000000000000000000000000000000000000") || POLICY_V7_ADDRESS === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("VAULT_V7_ADDRESS/POLICY_V7_ADDRESS are still placeholder zero addresses. Run scripts/deployVaultV7.ts first, then paste its real addresses in here.");
  }

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

  // Read and link LpPositionRegistry's real, current creation bytecode
  // against the real, already-deployed LiquidityAmounts.
  const registryArtifact = await import("../forge-out/LpPositionRegistry.sol/LpPositionRegistry.json", { with: { type: "json" } });
  const linkedCreationCode = linkBytecode(registryArtifact.default.bytecode.object, registryArtifact.default.bytecode.linkReferences, {
    "contracts/lib/LiquidityAmounts.sol:LiquidityAmounts": LIQUIDITY_AMOUNTS_ADDRESS,
  });
  console.log(`Linked LpPositionRegistry creation code: ${(linkedCreationCode.length - 2) / 2} bytes`);
  if (linkedCreationCode.includes("__$")) {
    throw new Error("Linked LpPositionRegistry creation code still contains an unresolved placeholder. Stopping.");
  }

  const deployHash = await admin.deployContract({
    abi: registryArtifact.default.abi,
    bytecode: linkedCreationCode,
    args: [VAULT_V7_ADDRESS, POLICY_V7_ADDRESS, MANDATE_ROLES_ADDRESS],
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
    throw new Error(`LpPositionRegistry deployment failed (tx ${deployHash}).`);
  }
  const registryAddress = deployReceipt.contractAddress;
  console.log(`LpPositionRegistry (v7): ${registryAddress} (tx ${deployHash})`);

  // Read-only verification, never assumed: confirm the constructor
  // arguments actually landed as configured.
  const registry = await viem.getContractAt("LpPositionRegistry", registryAddress);
  const liveVault = await registry.read.vault();
  const livePolicy = await registry.read.policy();
  const liveRoles = await registry.read.roles();
  console.log(`Verified onchain: vault=${liveVault}, policy=${livePolicy}, roles=${liveRoles}`);
  if (getAddress(liveVault) !== VAULT_V7_ADDRESS || getAddress(livePolicy) !== POLICY_V7_ADDRESS || getAddress(liveRoles) !== MANDATE_ROLES_ADDRESS) {
    throw new Error("Live constructor arguments do not match what was requested. Do not treat this deployment as complete.");
  }

  const setLpRegistryCalldata = encodeFunctionData({ abi: SET_LP_REGISTRY_ABI, functionName: "setLpRegistry", args: [registryAddress] });
  const proposePositionManagerCalldata = encodeFunctionData({
    abi: PROPOSE_POSITION_MANAGER_ABI,
    functionName: "proposePositionManager",
    args: [POSITION_MANAGER_ADDRESS],
  });

  console.log("\n=== Next: 2 Safe (2-of-2) transactions, not this script ===");
  console.log(`Safe address: ${SAFE_ADDRESS}\n`);
  console.log("Transaction 1: vault.setLpRegistry(registry)");
  console.log(`  To:       ${VAULT_V7_ADDRESS}`);
  console.log(`  Value:    0`);
  console.log(`  Data:     ${setLpRegistryCalldata}\n`);
  console.log(`Transaction 2: registry.proposePositionManager(${POSITION_MANAGER_ADDRESS})`);
  console.log(`  To:       ${registryAddress}`);
  console.log(`  Value:    0`);
  console.log(`  Data:     ${proposePositionManagerCalldata}`);
  console.log("\nNote: proposePositionManager only PROPOSES the position manager -- LpPositionRegistry's own 48h POSITION_MANAGER_CHANGE_TIMELOCK must still elapse before registry.executePositionManager() (permissionless) can be called.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
