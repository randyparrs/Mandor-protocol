// Deploys the real v6 MandateVault+VaultPolicy pair: USDC-only base asset,
// cross-chain lending capability wired via the real CCTP TokenMessengerV2,
// identical mechanism to v4 (see docs/deployments.md's v4 CCTP section),
// PLUS a 10% performance fee on genuine yield generated (never on
// depositor principal, see contracts/MandateVaultLending.sol's own
// _accrueFee doc comment). v4 itself is unaffected by this deployment and
// keeps running exactly as before; it moves to legacy/ only later, once
// v6 is verified live.
//
// Requires the new Gen6 VaultFactory from scripts/deployVaultFactoryForV6.ts
// to already be deployed -- VAULT_FACTORY_ADDRESS below is its real,
// already-deployed address.
//
// Only creates the vault itself. LendingPositionRegistry is deliberately
// NOT deployed here, same precedent as v4/v3: wired AFTER the vault+policy
// pair already exists, via MandateVault.setLendingRegistry (a one-shot
// GOVERNANCE_ROLE-gated call) -- LendingPositionRegistry's own constructor
// requires the real vault address, which does not exist until this
// script's createVault call returns. That step, plus proposeChainKeeper
// for v6's own Arbitrum Sepolia keeper wiring, is a separate follow-up
// once this vault is live, through the Safe (2-of-2), same governance
// path already used for v4's own onboarding.
//
// Run with: npx hardhat run scripts/deployVaultV6.ts --network arcTestnet
//
// Requires hardhat.config.ts's arcTestnet.accounts[1] (ARC_ADMIN_PRIVATE_KEY,
// set via `npx hardhat keystore set ARC_ADMIN_PRIVATE_KEY`) to actually be
// the real admin address's key, verified live below before spending
// anything. createVault is onlyAdmin (ADMIN_ROLE), unaffected by
// GOVERNANCE_ROLE.
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
// The real Gen6 VaultFactory, deployed 2026-07-27 via
// scripts/deployVaultFactoryForV6.ts (see its own console output for the
// full bootstrap summary: new MandateVaultDeployer, reused shared infra,
// and confirmation that v5's own VaultFactory was left completely
// untouched). Supersedes the abandoned Gen5 bootstrap
// (0x931e441418a9e1c0a4816a4e485cbb888fac0ec9), which embedded the
// oversized contracts/MandateVault.sol variant and was never used.
const VAULT_FACTORY_ADDRESS = getAddress("0x39fdec814f02b985fc1f8bbbbbe2538d0fee62e5");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
// Real, live-verified CCTP V2 TokenMessengerV2, same address on Arc Testnet
// and Arbitrum Sepolia, identical to v4's own wiring (see
// contracts/interfaces/ICCTPTokenMessenger.sol's own doc comment).
const CCTP_TOKEN_MESSENGER = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");

// ---------------------------------------------------------------------
// Deployment parameters. Base/lending risk limits are identical to v4's
// own confirmed values (v6 reuses v4's exact mechanism, see
// scripts/v6StrategyText.ts). The only genuinely new parameter is
// performanceFeeBps.
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC Cross-Chain Lending Vault (v6)";
const VAULT_SYMBOL = "mUSDCv6";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, same minimal-real-capital sizing as v1-v5

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%, same as v1-v5
  maxTradesPerDay: 5n, // same as v1-v5
  minStableAllocationBps: 7000n, // same as v4, see that script's own reasoning
  oracleMaxStalenessSeconds: 3600n, // same as v1-v5
  oracleMaxDeviationBps: 500n, // same as v1-v5
  maxDrawdownSpeedBpsPerWindow: 300n, // same as v1-v5
  drawdownSpeedWindowSeconds: 3600n, // same as v1-v5
  // Lending fields: identical to v4's own confirmed values.
  lendingReportStaleAfterSeconds: 86_400n, // 24h
  lendingReportMaxDeviationBps: 200n, // 2%
  lendingPositionForceUnwindSeconds: 604_800n, // 7 days
  maxLendingAllocationBps: 3000n, // 30%
  // v6-only: 10%, confirmed 2026-07-24 (see this project's own README
  // Phase 4 note). Charged only on genuine yield above its own dedicated
  // price-per-share high-water-mark, never on principal.
  performanceFeeBps: 1000n,
};
const MAX_ALLOCATION_BPS_USDC = 10000n; // the only registered asset, no reason to cap below what's needed

async function main() {
  if (VAULT_FACTORY_ADDRESS === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("VAULT_FACTORY_ADDRESS is still the placeholder zero address. Run scripts/deployVaultFactoryForV6.ts first, then paste its real Gen6 VaultFactory address in here.");
  }

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

  // 2. Create the v6 vault: USDC-only, no otherAssets (same as v4 -- its
  // whole purpose is bridging USDC out, not swapping into another local
  // asset), real cctpTokenMessenger wired at construction time.
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
      // Lending fields: identical to v4's own confirmed values.
      lendingReportStaleAfterSeconds: POLICY_LIMITS.lendingReportStaleAfterSeconds,
      lendingReportMaxDeviationBps: POLICY_LIMITS.lendingReportMaxDeviationBps,
      lendingPositionForceUnwindSeconds: POLICY_LIMITS.lendingPositionForceUnwindSeconds,
      maxLendingAllocationBps: POLICY_LIMITS.maxLendingAllocationBps,
      performanceFeeBps: POLICY_LIMITS.performanceFeeBps,
    },
    seedAmount: SEED_AMOUNT,
    cctpTokenMessenger: CCTP_TOKEN_MESSENGER,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v6: USDC, cross-chain lending-enabled, 10% performance fee)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVaultLending v6: ${vaultAddress}`);
  // MandateVaultLending, not MandateVault: this is the real deployed
  // bytecode, and using its own ABI (not the LP-bearing MandateVault's)
  // keeps feeHighWaterMarkPricePerShare/accrueFee() available on this
  // typed instance for later verification steps.
  const vault = await viem.getContractAt("MandateVaultLending", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v6: ${policyAddress}`);

  // Read-only verification, never assumed: confirm the policy limits,
  // performanceFeeBps, and the cctpTokenMessenger wiring actually landed
  // as configured.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxUsdc = await policy.read.maxAllocationBpsPerAsset([USDC_ADDRESS]);
  const liveLendingReportStaleAfterSeconds = await policy.read.lendingReportStaleAfterSeconds();
  const liveLendingReportMaxDeviationBps = await policy.read.lendingReportMaxDeviationBps();
  const liveLendingPositionForceUnwindSeconds = await policy.read.lendingPositionForceUnwindSeconds();
  const liveMaxLendingAllocationBps = await policy.read.maxLendingAllocationBps();
  const livePerformanceFeeBps = await policy.read.performanceFeeBps();
  const liveCctpTokenMessenger = await vault.read.cctpTokenMessenger();
  console.log(
    `Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[USDC]=${liveMaxUsdc}, ` +
      `lendingReportStaleAfterSeconds=${liveLendingReportStaleAfterSeconds}, lendingReportMaxDeviationBps=${liveLendingReportMaxDeviationBps}, ` +
      `lendingPositionForceUnwindSeconds=${liveLendingPositionForceUnwindSeconds}, maxLendingAllocationBps=${liveMaxLendingAllocationBps}, ` +
      `performanceFeeBps=${livePerformanceFeeBps}, cctpTokenMessenger=${liveCctpTokenMessenger}`,
  );
  if (
    BigInt(liveMinStable) !== POLICY_LIMITS.minStableAllocationBps ||
    BigInt(liveMaxUsdc) !== MAX_ALLOCATION_BPS_USDC ||
    BigInt(liveLendingReportStaleAfterSeconds) !== POLICY_LIMITS.lendingReportStaleAfterSeconds ||
    BigInt(liveLendingReportMaxDeviationBps) !== POLICY_LIMITS.lendingReportMaxDeviationBps ||
    BigInt(liveLendingPositionForceUnwindSeconds) !== POLICY_LIMITS.lendingPositionForceUnwindSeconds ||
    BigInt(liveMaxLendingAllocationBps) !== POLICY_LIMITS.maxLendingAllocationBps ||
    BigInt(livePerformanceFeeBps) !== POLICY_LIMITS.performanceFeeBps ||
    getAddress(liveCctpTokenMessenger) !== CCTP_TOKEN_MESSENGER
  ) {
    throw new Error("Live policy limits or cctpTokenMessenger do not match what was requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v6 deployment summary ===");
  console.log(`VaultFactory (v6, Gen6):  ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVaultLending v6: ${vaultAddress}`);
  console.log(`VaultPolicy v6:         ${policyAddress}`);
  console.log(`cctpTokenMessenger:     ${CCTP_TOKEN_MESSENGER}`);
  console.log(`Assets:                 USDC only (base asset)`);
  console.log(`maxLendingAllocationBps: ${POLICY_LIMITS.maxLendingAllocationBps} bps (${Number(POLICY_LIMITS.maxLendingAllocationBps) / 100}%)`);
  console.log(`performanceFeeBps:      ${POLICY_LIMITS.performanceFeeBps} bps (${Number(POLICY_LIMITS.performanceFeeBps) / 100}%)`);
  console.log(
    "\nNot yet done: LendingPositionRegistry is not yet deployed or wired to this vault (vault.setLendingRegistry). " +
      "That, plus proposeChainKeeper for v6's own Arbitrum Sepolia keeper, is the next step, through the Safe (2-of-2), " +
      "same governance path already used for v4's own onboarding. After that, verify the performance fee with a real " +
      "functional accrueFee() call against genuine reported yield, not just by reading performanceFeeBps's value.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
