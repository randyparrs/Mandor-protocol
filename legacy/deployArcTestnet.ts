// LEGACY (v1, discontinued): real deployment to Arc Testnet. Review every
// value below before running. Kept here, not in scripts/, for historical
// record only -- v1 (USDC-only, HOLD/REBALANCE only) has no real yield
// mechanism and is superseded by v3/v4/v5. See legacy/README.md.
// Run with: npx hardhat run legacy/deployArcTestnet.ts --network arcTestnet
//
// Sequence: the deployer wallet's ARC_PRIVATE_KEY, run via the AI agent CLI, holds
// ADMIN_ROLE/DEFAULT_ADMIN_ROLE TEMPORARILY, only long enough to grant the
// other roles and call createVault. The very last steps transfer both roles
// to the real ADMIN/GOVERNANCE address and have the deployer renounce them
// for itself, then a read-only verification block confirms this actually
// happened onchain rather than assuming the renounce calls succeeded.
//
// Every write waits for its own receipt before the next call starts.
// Confirmed by reading @nomicfoundation/hardhat-viem's own source: contract
// instances wrap plain viem write calls, which return a tx hash immediately
// and do not wait for confirmation on their own. With 15 sequential
// transactions in this script, not waiting risks nonce collisions on a real
// network, not assumed safe.
import { network } from "hardhat";
import { parseUnits, getAddress, type Hash } from "viem";

// Hardhat's getContractAt only resolves contract names Hardhat itself
// compiled (artifacts/contracts/**), it does not generate an artifact for
// OpenZeppelin's IERC20 (a node_modules-sourced interface), confirmed by
// checking the artifacts/ directory directly, not assumed. Call the real
// USDC contract's approve() directly through the wallet client with a
// minimal inline ABI instead, bypassing Hardhat's name-based resolution for
// this one external contract.
const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------
// Real addresses, confirmed live, not placeholders.
// ---------------------------------------------------------------------
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const KEEPER_ADDRESS = getAddress("0xdfFDd05D61dbF4074A6C012d22deBfcf0d80c219");
const PAUSER_RANDY_ADDRESS = getAddress("0x6639c0Ea56009EE64e11526221C28B979C698855");
const PAUSER_EUDO_ADDRESS = getAddress("0x24b26f00Fa24FA41ef2EffBa5Be359f9301524f2");
const PROTOCOL_TREASURY_ADDRESS = ADMIN_GOVERNANCE_ADDRESS; // same address for this stage

// Real, verified Arc Testnet addresses, see docs/arc-facts-to-verify.md.
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");

// ---------------------------------------------------------------------
// Deployment parameters. USDC-only for this vault (no otherAssets_): no
// verified swap pool exists yet for native USDC directly against EURC or
// cirBTC (only EURC/cirBTC and WUSDC/cirBTC pools are confirmed). Adding a
// target asset later means a new vault, VaultPolicy is immutable by design,
// a different risk profile is a new Vault+Policy pair, never a parameter
// change on a live one.
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC Vault";
const VAULT_SYMBOL = "mUSDC";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, fits the deployer's ~20 USDC faucet balance with room for gas
const CAPITAL_LIMIT_REGISTRY_CAP = parseUnits("10000", 6); // 10,000 USDC global cap, same for every vault until Phase 4

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%
  maxTradesPerDay: 5n,
  minStableAllocationBps: 10000n, // 100%, honest given USDC is the only registered asset right now
  oracleMaxStalenessSeconds: 3600n,
  oracleMaxDeviationBps: 500n,
  maxDrawdownSpeedBpsPerWindow: 300n,
  drawdownSpeedWindowSeconds: 3600n,
};

async function main() {
  const { viem } = await network.connect({ network: "arcTestnet" });
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  console.log(`Deployer: ${deployer.account.address}`);

  // Waits for the receipt of an already-submitted tx hash before returning,
  // so the next transaction never risks reusing a pending nonce.
  async function confirm(txHashPromise: Promise<Hash>, label: string) {
    const hash = await txHashPromise;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} reverted (tx ${hash}). Stopping, do not continue the deployment.`);
    }
    console.log(`${label}: ${hash}`);
    return receipt;
  }

  // 1. MandateRoles, deployer holds DEFAULT_ADMIN_ROLE + ADMIN_ROLE temporarily.
  const roles = await viem.deployContract("MandateRoles", [deployer.account.address]);
  console.log(`MandateRoles: ${roles.address}`);

  const KEEPER_ROLE = await roles.read.KEEPER_ROLE();
  const PAUSER_ROLE = await roles.read.PAUSER_ROLE();
  const GOVERNANCE_ROLE = await roles.read.GOVERNANCE_ROLE();
  const ADMIN_ROLE = await roles.read.ADMIN_ROLE();
  const DEFAULT_ADMIN_ROLE = await roles.read.DEFAULT_ADMIN_ROLE();

  // 2. Grant the roles that don't need to wait until after createVault.
  await confirm(roles.write.grantRole([KEEPER_ROLE, KEEPER_ADDRESS]), `Granted KEEPER_ROLE to ${KEEPER_ADDRESS}`);
  await confirm(roles.write.grantRole([PAUSER_ROLE, PAUSER_RANDY_ADDRESS]), `Granted PAUSER_ROLE to ${PAUSER_RANDY_ADDRESS} (Randy)`);
  await confirm(roles.write.grantRole([PAUSER_ROLE, PAUSER_EUDO_ADDRESS]), `Granted PAUSER_ROLE to ${PAUSER_EUDO_ADDRESS} (Eudo)`);
  await confirm(roles.write.grantRole([GOVERNANCE_ROLE, ADMIN_GOVERNANCE_ADDRESS]), `Granted GOVERNANCE_ROLE to ${ADMIN_GOVERNANCE_ADDRESS}`);

  // 3. MandateVaultDeployer, split out purely for EIP-170 contract size reasons.
  const vaultDeployer = await viem.deployContract("MandateVaultDeployer", []);
  console.log(`MandateVaultDeployer: ${vaultDeployer.address}`);

  // 4. CapitalLimitRegistry.
  const capitalLimitRegistry = await viem.deployContract("CapitalLimitRegistry", [roles.address, CAPITAL_LIMIT_REGISTRY_CAP]);
  console.log(`CapitalLimitRegistry: ${capitalLimitRegistry.address} (cap ${CAPITAL_LIMIT_REGISTRY_CAP} = 10,000 USDC)`);

  // 5. VaultFactory.
  const factory = await viem.deployContract("VaultFactory", [
    roles.address,
    PROTOCOL_TREASURY_ADDRESS,
    vaultDeployer.address,
    capitalLimitRegistry.address,
  ]);
  console.log(`VaultFactory: ${factory.address}`);

  // 6. Wire MandateVaultDeployer to the real VaultFactory, one-shot.
  await confirm(vaultDeployer.write.setFactory([factory.address]), `MandateVaultDeployer.setFactory(${factory.address})`);

  // 7. Approve the factory to pull the seed deposit from the deployer.
  await confirm(
    deployer.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [factory.address, SEED_AMOUNT],
    }),
    `Approved VaultFactory for ${SEED_AMOUNT} USDC (seed deposit)`,
  );

  // 8. Create the real vault. USDC-only: otherAssets is empty.
  const createVaultParams = {
    usdc: USDC_ADDRESS,
    initialSwapRouter: UNITFLOW_V3_ROUTER,
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    otherAssets: [] as `0x${string}`[],
    limits: {
      vault: "0x0000000000000000000000000000000000000000" as `0x${string}`, // overwritten by createVault
      roles: "0x0000000000000000000000000000000000000000" as `0x${string}`, // overwritten by createVault
      maxDrawdownBps: POLICY_LIMITS.maxDrawdownBps,
      maxTradesPerDay: POLICY_LIMITS.maxTradesPerDay,
      minStableAllocationBps: POLICY_LIMITS.minStableAllocationBps,
      oracleMaxStalenessSeconds: POLICY_LIMITS.oracleMaxStalenessSeconds,
      oracleMaxDeviationBps: POLICY_LIMITS.oracleMaxDeviationBps,
      maxDrawdownSpeedBpsPerWindow: POLICY_LIMITS.maxDrawdownSpeedBpsPerWindow,
      drawdownSpeedWindowSeconds: POLICY_LIMITS.drawdownSpeedWindowSeconds,
      assets: [USDC_ADDRESS],
      maxAllocationBps: [10000n],
      stableAssets: [USDC_ADDRESS],
    },
    seedAmount: SEED_AMOUNT,
  };

  await confirm(factory.write.createVault([createVaultParams]), "createVault");

  const vaultAddress = await factory.read.allVaults([0n]);
  console.log(`MandateVault: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVault", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy: ${policyAddress}`);

  // 9. Transfer admin control to the real ADMIN/GOVERNANCE address.
  await confirm(roles.write.grantRole([ADMIN_ROLE, ADMIN_GOVERNANCE_ADDRESS]), `Granted ADMIN_ROLE to ${ADMIN_GOVERNANCE_ADDRESS}`);
  await confirm(
    roles.write.grantRole([DEFAULT_ADMIN_ROLE, ADMIN_GOVERNANCE_ADDRESS]),
    `Granted DEFAULT_ADMIN_ROLE to ${ADMIN_GOVERNANCE_ADDRESS}`,
  );

  // 10. The deployer renounces both roles for itself. Never assume this
  // succeeded, verified read-only below.
  await confirm(roles.write.renounceRole([ADMIN_ROLE, deployer.account.address]), "Deployer renounced ADMIN_ROLE");
  await confirm(roles.write.renounceRole([DEFAULT_ADMIN_ROLE, deployer.account.address]), "Deployer renounced DEFAULT_ADMIN_ROLE");

  // 11. Read-only verification, never assumed. Throws loudly if the
  // post-deployment role state isn't exactly what it must be.
  const deployerHasAdmin = await roles.read.hasRole([ADMIN_ROLE, deployer.account.address]);
  const deployerHasDefaultAdmin = await roles.read.hasRole([DEFAULT_ADMIN_ROLE, deployer.account.address]);
  const teamHasAdmin = await roles.read.hasRole([ADMIN_ROLE, ADMIN_GOVERNANCE_ADDRESS]);
  const teamHasDefaultAdmin = await roles.read.hasRole([DEFAULT_ADMIN_ROLE, ADMIN_GOVERNANCE_ADDRESS]);

  if (deployerHasAdmin || deployerHasDefaultAdmin) {
    throw new Error(
      `Deployer still holds admin roles after renouncing: ADMIN_ROLE=${deployerHasAdmin}, DEFAULT_ADMIN_ROLE=${deployerHasDefaultAdmin}. Do not treat this deployment as complete.`,
    );
  }
  if (!teamHasAdmin || !teamHasDefaultAdmin) {
    throw new Error(
      `${ADMIN_GOVERNANCE_ADDRESS} does not hold the expected admin roles: ADMIN_ROLE=${teamHasAdmin}, DEFAULT_ADMIN_ROLE=${teamHasDefaultAdmin}. Do not treat this deployment as complete.`,
    );
  }
  console.log("Verified onchain: deployer holds no admin roles, ADMIN_GOVERNANCE_ADDRESS holds both.");

  console.log("\n=== Deployment summary ===");
  console.log(`MandateRoles:          ${roles.address}`);
  console.log(`MandateVaultDeployer:  ${vaultDeployer.address}`);
  console.log(`CapitalLimitRegistry:  ${capitalLimitRegistry.address}`);
  console.log(`VaultFactory:          ${factory.address}`);
  console.log(`MandateVault:          ${vaultAddress}`);
  console.log(`VaultPolicy:           ${policyAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
