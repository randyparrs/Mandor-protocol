// Deploys the real v4 MandateVault+VaultPolicy pair: USDC-only base asset,
// cross-chain lending capability wired via the real CCTP TokenMessengerV2
// (see docs/deployments.md's v4 CCTP section). Unlike v3, this vault never
// touches the LP mechanism, so every LP-specific ConstructorLimits field is
// zeroed, same harmless-when-unused convention v1/v2 already use for those
// fields.
//
// Reuses the v4 VaultFactory bootstrapped 2026-07-16
// (scripts/deployVaultFactoryForV4.ts), which already wires the shared
// MandateRoles/protocolTreasury/CapitalLimitRegistry as-is -- nothing here
// gets redeployed.
//
// Only creates the vault itself. LendingPositionRegistry is deliberately
// NOT deployed here (mirrors v3's positionManager precedent: wired AFTER
// the vault+policy pair already exists, via MandateVault.setLendingRegistry,
// a one-shot GOVERNANCE_ROLE-gated call) -- LendingPositionRegistry's own
// constructor requires the real vault address, which does not exist until
// this script's createVault call returns. That step, plus
// proposeChainKeeper, is a separate follow-up once this vault is live, and
// now goes through the Safe (2-of-2) rather than a private-key script,
// since GOVERNANCE_ROLE was granted to it 2026-07-17
// (scripts/grantGovernanceRoleToSafe.ts).
//
// Run with: npx hardhat run scripts/deployVaultV4.ts --network arcTestnet
//
// Requires hardhat.config.ts's arcTestnet.accounts[1] (ARC_ADMIN_PRIVATE_KEY,
// set via `npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY`) to actually be
// the real admin address's key, verified live below before spending
// anything. createVault is onlyAdmin (ADMIN_ROLE), not onlyGovernance --
// unaffected by the GOVERNANCE_ROLE change above.
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
// Real, already-deployed addresses, see docs/deployments.md.
// ---------------------------------------------------------------------
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
// The v4 VaultFactory (2026-07-16, scripts/deployVaultFactoryForV4.ts), not
// v1/v2's or v3's. Each generation's own VaultFactory only knows how to
// call its own generation's MandateVaultDeployer, see docs/deployments.md's
// "Third VaultFactory generation" section.
const VAULT_FACTORY_ADDRESS = getAddress("0x94d5c4b8c6d1fc6dc8496f7764b36052fc1914eb");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
// Real, live-verified CCTP V2 TokenMessengerV2, same address on Arc Testnet
// and Arbitrum Sepolia (see contracts/interfaces/ICCTPTokenMessenger.sol's
// own doc comment and docs/deployments.md's v4 CCTP section).
const CCTP_TOKEN_MESSENGER = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");

// ---------------------------------------------------------------------
// Deployment parameters. Base risk limits match v1/v2/v3's exact values
// (same conservative starting point). LP fields all zeroed (v4 never
// touches the LP mechanism). Lending fields: the four values confirmed
// 2026-07-17 (three already recorded as confirmed placeholders in
// VaultPolicy.sol's own doc comments; maxLendingAllocationBps
// is new, 30% rather than v3's 50% LP cap -- deliberately lower:
// v3's LP risk is verifiable entirely on Arc in the same
// transaction, cross-chain lending risk depends on the destination-chain
// keeper reporting honestly, so a smaller share of NAV should ever be
// exposed to that distinct risk).
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC Cross-Chain Lending Vault (v4)";
const VAULT_SYMBOL = "mUSDCv4";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, same minimal-real-capital sizing as v1/v2/v3

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%, same as v1/v2/v3
  maxTradesPerDay: 5n, // same as v1/v2/v3
  // 70%, the exact complement of maxLendingAllocationBps (30%): the vault's
  // own ledger (real, Arc-local, verifiable) must never drop below this
  // share of NAV even with the maximum permitted amount bridged out,
  // matching the "majority of NAV stays in something Arc can
  // verify on its own" reasoning.
  minStableAllocationBps: 7000n,
  oracleMaxStalenessSeconds: 3600n, // same as v1/v2/v3
  oracleMaxDeviationBps: 500n, // same as v1/v2/v3
  maxDrawdownSpeedBpsPerWindow: 300n, // same as v1/v2/v3
  drawdownSpeedWindowSeconds: 3600n, // same as v1/v2/v3
  // v4-only, confirmed values, 2026-07-17.
  lendingReportStaleAfterSeconds: 86_400n, // 24h
  lendingReportMaxDeviationBps: 200n, // 2%
  lendingPositionForceUnwindSeconds: 604_800n, // 7 days
  maxLendingAllocationBps: 3000n, // 30%
};
const MAX_ALLOCATION_BPS_USDC = 10000n; // the only registered asset, no reason to cap below what's needed

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

  // 2. Create the v4 vault: USDC-only, no otherAssets (v4 never holds a
  // second registered asset the way v2/v3 hold cirBTC/WUSDC -- its whole
  // purpose is bridging USDC out, not swapping into another local asset),
  // real cctpTokenMessenger wired at construction time (not a governance
  // setter, see MandateVault.sol's own doc comment on why).
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
      maxAllocationBps: [MAX_ALLOCATION_BPS_USDC],
      stableAssets: [USDC_ADDRESS],
      // LP fields: all zeroed, this vault never touches the LP mechanism.
      minLpTickRangeWidth: 0,
      maxLpPositionValueLossBps: 0n,
      maxLpOutOfRangeSeconds: 0n,
      minLpPoolLiquidityRatioBps: 0n,
      maxLpAllocationBps: 0n,
      // Lending fields: confirmed values, 2026-07-17.
      lendingReportStaleAfterSeconds: POLICY_LIMITS.lendingReportStaleAfterSeconds,
      lendingReportMaxDeviationBps: POLICY_LIMITS.lendingReportMaxDeviationBps,
      lendingPositionForceUnwindSeconds: POLICY_LIMITS.lendingPositionForceUnwindSeconds,
      maxLendingAllocationBps: POLICY_LIMITS.maxLendingAllocationBps,
    },
    seedAmount: SEED_AMOUNT,
    cctpTokenMessenger: CCTP_TOKEN_MESSENGER,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v4: USDC, cross-chain lending-enabled)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVault v4: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVault", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v4: ${policyAddress}`);

  // Read-only verification, never assumed: confirm the policy limits and
  // the cctpTokenMessenger wiring actually landed as configured.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxUsdc = await policy.read.maxAllocationBpsPerAsset([USDC_ADDRESS]);
  const liveLendingReportStaleAfterSeconds = await policy.read.lendingReportStaleAfterSeconds();
  const liveLendingReportMaxDeviationBps = await policy.read.lendingReportMaxDeviationBps();
  const liveLendingPositionForceUnwindSeconds = await policy.read.lendingPositionForceUnwindSeconds();
  const liveMaxLendingAllocationBps = await policy.read.maxLendingAllocationBps();
  const liveCctpTokenMessenger = await vault.read.cctpTokenMessenger();
  console.log(
    `Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[USDC]=${liveMaxUsdc}, ` +
      `lendingReportStaleAfterSeconds=${liveLendingReportStaleAfterSeconds}, lendingReportMaxDeviationBps=${liveLendingReportMaxDeviationBps}, ` +
      `lendingPositionForceUnwindSeconds=${liveLendingPositionForceUnwindSeconds}, maxLendingAllocationBps=${liveMaxLendingAllocationBps}, ` +
      `cctpTokenMessenger=${liveCctpTokenMessenger}`,
  );
  if (
    BigInt(liveMinStable) !== POLICY_LIMITS.minStableAllocationBps ||
    BigInt(liveMaxUsdc) !== MAX_ALLOCATION_BPS_USDC ||
    BigInt(liveLendingReportStaleAfterSeconds) !== POLICY_LIMITS.lendingReportStaleAfterSeconds ||
    BigInt(liveLendingReportMaxDeviationBps) !== POLICY_LIMITS.lendingReportMaxDeviationBps ||
    BigInt(liveLendingPositionForceUnwindSeconds) !== POLICY_LIMITS.lendingPositionForceUnwindSeconds ||
    BigInt(liveMaxLendingAllocationBps) !== POLICY_LIMITS.maxLendingAllocationBps ||
    getAddress(liveCctpTokenMessenger) !== CCTP_TOKEN_MESSENGER
  ) {
    throw new Error("Live policy limits or cctpTokenMessenger do not match what was requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v4 deployment summary ===");
  console.log(`VaultFactory (v4, 2026-07-16):  ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVault v4:        ${vaultAddress}`);
  console.log(`VaultPolicy v4:         ${policyAddress}`);
  console.log(`cctpTokenMessenger:     ${CCTP_TOKEN_MESSENGER}`);
  console.log(`Assets:                 USDC only (base asset)`);
  console.log(`maxLendingAllocationBps: ${POLICY_LIMITS.maxLendingAllocationBps} bps (${Number(POLICY_LIMITS.maxLendingAllocationBps) / 100}%)`);
  console.log(
    "\nNot yet done: LendingPositionRegistry is not yet deployed or wired to this vault (vault.setLendingRegistry). " +
      "That, plus proposeChainKeeper for the Arbitrum Sepolia keeper, is the next step -- now via the Safe (2-of-2), " +
      "since GOVERNANCE_ROLE was granted to it 2026-07-17.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
