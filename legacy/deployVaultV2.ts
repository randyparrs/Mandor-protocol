// LEGACY (v2, discontinued): deploys a second MandateVault+VaultPolicy pair
// (USDC base asset plus cirBTC), reusing the already-deployed MandateRoles/
// VaultFactory/CapitalLimitRegistry as-is, see docs/deployments.md and the
// analysis this script followed. Kept here, not in scripts/, for historical
// record only -- v2 (USDC + cirBTC, HOLD/REBALANCE only) has no real yield
// mechanism and is superseded by v3/v4/v5. See legacy/README.md.
// Unlike legacy/deployArcTestnet.ts, this needs the real ADMIN_ROLE holder
// to sign (VaultFactory.createVault is onlyAdmin-gated), never the original
// deployer wallet, which renounced ADMIN_ROLE right after the first deploy.
// Run with: npx hardhat run legacy/deployVaultV2.ts --network arcTestnet
//
// Requires hardhat.config.ts's arcTestnet.accounts[1]
// (ARC_ADMIN_PRIVATE_KEY, set via `npx hardhat keystore set
// ARC_ADMIN_PRIVATE_KEY`) to actually be the real admin address's key,
// verified live below before spending anything.
import { network } from "hardhat";
import { parseUnits, getAddress, type Hash } from "viem";

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

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// ---------------------------------------------------------------------
// Real, already-deployed addresses, see docs/deployments.md. Nothing here
// gets redeployed, VaultFactory already knows its own roles/
// capitalLimitRegistry/protocolTreasury, it wires them into every vault it
// creates automatically.
// ---------------------------------------------------------------------
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const VAULT_FACTORY_ADDRESS = getAddress("0xb6B77A2978B1974097727e267BCaAC35ba7ddf12");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
// Confirmed live moments ago: real deployed bytecode, decimals() == 8,
// symbol() == "cirBTC". WUSDC/cirBTC pool has real confirmed liquidity
// (docs/arc-facts-to-verify.md), the same pair MandateVaultArcFork.t.sol
// already proves a real swap through executeDecision against.
const CIRBTC_ADDRESS = getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");

// ---------------------------------------------------------------------
// Deployment parameters. minStableAllocationBps=8000 (a deliberate
// choice, the more conservative end for this vault's first volatile asset):
// at most 20% of NAV in cirBTC. maxAllocationBpsPerAsset[cirBTC] is set to
// the same 2000bps ceiling for consistency, not a separate, looser number
// that minStableAllocationBps would just override anyway.
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC+cirBTC Vault";
const VAULT_SYMBOL = "mUSDCv2";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, same minimal-real-capital sizing as v1

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%, same as v1
  maxTradesPerDay: 5n, // same as v1
  minStableAllocationBps: 8000n, // 80%, a deliberate, conservative choice for this vault's first volatile asset
  oracleMaxStalenessSeconds: 3600n, // same as v1
  oracleMaxDeviationBps: 500n, // same as v1
  maxDrawdownSpeedBpsPerWindow: 300n, // same as v1
  drawdownSpeedWindowSeconds: 3600n, // same as v1
};
const MAX_ALLOCATION_BPS_USDC = 10000n; // can still be up to 100% before any cirBTC position is entered
const MAX_ALLOCATION_BPS_CIRBTC = 2000n; // 20%, consistent with minStableAllocationBps=8000

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
  // address, before spending anything.
  if (getAddress(admin.account.address) !== ADMIN_GOVERNANCE_ADDRESS) {
    throw new Error(
      `arcTestnet.accounts[1] resolves to ${admin.account.address}, not the expected admin address ${ADMIN_GOVERNANCE_ADDRESS}. Stopping, do not proceed with the wrong signer.`,
    );
  }
  console.log(`Admin signer confirmed: ${admin.account.address}`);

  const usdcBalance = await publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [admin.account.address] });
  console.log(`Admin USDC balance: ${usdcBalance} (need at least ${SEED_AMOUNT} for the seed deposit, plus gas)`);
  if (usdcBalance < SEED_AMOUNT) {
    throw new Error(`Admin address does not hold enough USDC for the ${SEED_AMOUNT} seed deposit. Fund it before running this again.`);
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

  const factory = await viem.getContractAt("VaultFactory", VAULT_FACTORY_ADDRESS);

  // 1. Admin approves the factory to pull the seed deposit from its own address.
  await confirm(
    admin.writeContract({ address: USDC_ADDRESS, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [VAULT_FACTORY_ADDRESS, SEED_AMOUNT] }),
    `Approved VaultFactory for ${SEED_AMOUNT} USDC (seed deposit)`,
  );

  // 2. Create the v2 vault: USDC base asset plus cirBTC as otherAssets.
  // roles/capitalLimitRegistry/protocolTreasury are all wired in
  // automatically by the factory, not passed here, see VaultFactory.sol's
  // createVault, which reads its own immutable fields, never a parameter.
  const createVaultParams = {
    usdc: USDC_ADDRESS,
    initialSwapRouter: UNITFLOW_V3_ROUTER,
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    otherAssets: [CIRBTC_ADDRESS] as `0x${string}`[],
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
      assets: [USDC_ADDRESS, CIRBTC_ADDRESS],
      maxAllocationBps: [MAX_ALLOCATION_BPS_USDC, MAX_ALLOCATION_BPS_CIRBTC],
      stableAssets: [USDC_ADDRESS],
    },
    seedAmount: SEED_AMOUNT,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v2: USDC + cirBTC)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVault v2: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVault", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v2: ${policyAddress}`);

  // Read-only verification, never assumed: confirm the policy limits
  // actually landed as configured, especially the two values that must
  // stay consistent with each other.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxCirbtc = await policy.read.maxAllocationBpsPerAsset([CIRBTC_ADDRESS]);
  const liveMaxUsdc = await policy.read.maxAllocationBpsPerAsset([USDC_ADDRESS]);
  console.log(`Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[cirBTC]=${liveMaxCirbtc}, maxAllocationBpsPerAsset[USDC]=${liveMaxUsdc}`);
  if (liveMinStable !== POLICY_LIMITS.minStableAllocationBps || liveMaxCirbtc !== MAX_ALLOCATION_BPS_CIRBTC) {
    throw new Error("Live policy limits do not match what was requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v2 deployment summary ===");
  console.log(`VaultFactory (reused):  ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVault v2:        ${vaultAddress}`);
  console.log(`VaultPolicy v2:         ${policyAddress}`);
  console.log(`Assets:                 USDC (base), cirBTC (max ${MAX_ALLOCATION_BPS_CIRBTC}bps / ${Number(MAX_ALLOCATION_BPS_CIRBTC) / 100}%)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
