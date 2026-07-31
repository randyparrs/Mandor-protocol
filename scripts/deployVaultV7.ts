// Deploys the real v7 MandateVaultLp+VaultPolicy pair: WUSDC base asset
// (NOT native USDC, see the real, load-bearing reason below), EURC as the
// only otherAsset, LP-enabled against the real WUSDC/EURC pool (fee 3000).
//
// Why WUSDC as the BASE asset, unlike every prior version (v1-v6, all
// native-USDC-based): confirmed live 2026-07-27, NO pool exists on the real
// UnitFlowV3 Factory between native USDC (0x3600...) and WUSDC at any fee
// tier (getPool returns address(0) for all of 100/500/3000/10000). WUSDC is
// a real, separate ERC-20 contract that wraps Arc's native gas currency via
// its own deposit()/withdraw() functions, not something obtainable through
// _executeSwapLeg's router-only mechanism -- and this vault (like v3's real
// deployment before it) has no "wrap native currency" action type at all.
// If v7 used native USDC as its base asset the way v3 originally did, it
// would have NO real path to ever acquire WUSDC (one of the two required
// LP pool tokens) in the first place, an immediately load-bearing gap here
// (unlike v3, where this same gap was masked by the separate,
// already-documented cirBTC independent-price block making it moot in
// practice). Using WUSDC as the base asset instead sidesteps this
// entirely: depositors wrap their own native USDC into WUSDC once,
// themselves, before depositing (a real, disclosed extra step compared to
// v1-v6, the tradeoff for being the first LP vault design in this project
// actually able to execute a real position). EURC is reachable from WUSDC
// via the real, deep WUSDC/EURC pool this vault's own LP mechanism targets,
// no separate acquisition problem there.
//
// Requires the new Gen7 VaultFactory from scripts/deployVaultFactoryForV7.ts
// to already be deployed -- VAULT_FACTORY_ADDRESS below is a placeholder
// until that bootstrap actually runs and its real address is pasted in.
//
// Only creates the vault itself. LpPositionRegistry is deliberately NOT
// deployed here, same precedent as v4/v6's LendingPositionRegistry: wired
// AFTER the vault+policy pair already exists, via MandateVaultLp.setLpRegistry
// (a one-shot GOVERNANCE_ROLE-gated call) -- LpPositionRegistry's own
// constructor requires the real vault address, which does not exist until
// this script's createVault call returns. That step
// (scripts/deployLpPositionRegistryV7.ts) is a separate follow-up once this
// vault is live.
//
// Also starts the real WUSDC/EURC pool's TWAP warm-up (step 4 below,
// increaseObservationCardinalityNext), same reasoning as v3's own
// deployment script: MandateVaultLp/LpPositionRegistry value any open LP
// position via a manipulation-resistant TWAP, not the live spot price, so
// the pool needs enough historical observations queryable well before the
// first real LP_OPEN.
//
// Run with: npx hardhat run scripts/deployVaultV7.ts --network arcTestnet
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

const IWUSDC_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

// Standard Uniswap V3 pool function, no owner/permission needed, same
// reasoning and same modest increase as scripts/deployVaultV3.ts's own use.
const POOL_OBSERVATION_ABI = [
  { type: "function", name: "increaseObservationCardinalityNext", stateMutability: "nonpayable", inputs: [{ name: "observationCardinalityNext", type: "uint16" }], outputs: [] },
] as const;
const OBSERVATION_CARDINALITY_INCREASE = 50;

// ---------------------------------------------------------------------
// Real, already-deployed addresses, see docs/deployments.md and this
// project's own live verification 2026-07-27 (docs/arc-facts-to-verify.md).
// ---------------------------------------------------------------------
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
// The real Gen7 VaultFactory, deployed 2026-07-27 via
// scripts/deployVaultFactoryForV7.ts (MandateVaultDeployer:
// 0xee1754a2adb828c8ed43b5d7cb4ad81edc0feeac, tx
// 0x7961fc8e4cc8bc0fa5784392823c06fb724be69384e6d971cbc7886dc1762a18;
// v5 VaultFactory confirmed completely untouched, see that script's own
// verification output).
const VAULT_FACTORY_ADDRESS = getAddress("0xd679f715a2ffb495414db9ee502f971948cece67");
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
const WUSDC_ADDRESS = getAddress("0x911b4000D3422F482F4062a913885f7b035382Df");
const EURC_ADDRESS = getAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a");
const WUSDC_EURC_POOL = getAddress("0x13873aD4296AC255361BeA54681FdCC55eF9c316");
const WUSDC_EURC_FEE = 3000;
// The real, verified UnitFlowV3PositionManager, same one every prior LP
// vault (v3) already uses -- pool-agnostic periphery contract, unaffected
// by which pool it is pointed at.
const POSITION_MANAGER_ADDRESS = getAddress("0x0553682bc188b850acd31CBd3500Dcd0aa35372B");

// ---------------------------------------------------------------------
// Deployment parameters. Base risk limits mirror v3's exact LP-specific
// values (same fork-tested fixture, see test/MandateVaultLpArcFork.t.sol's
// _deployLpVault).
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate WUSDC/EURC LP Vault (v7)";
const VAULT_SYMBOL = "mLPv7";
const SEED_AMOUNT = parseUnits("5", 18); // 5 WUSDC (18 decimals), same minimal-real-capital sizing as v1-v6's own 5 USDC

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n,
  maxTradesPerDay: 20n,
  minStableAllocationBps: 0n, // both WUSDC and EURC are stable-classified (see stableAssets below); this vault's whole purpose is deploying into the LP position, not sitting idle
  oracleMaxStalenessSeconds: 3600n,
  oracleMaxDeviationBps: 500n,
  maxDrawdownSpeedBpsPerWindow: 300n,
  drawdownSpeedWindowSeconds: 3600n,
  minLpTickRangeWidth: 1200n,
  maxLpPositionValueLossBps: 300n, // 3%
  maxLpOutOfRangeSeconds: 172_800n, // 48h
  minLpPoolLiquidityRatioBps: 5000n, // 50%
  maxLpAllocationBps: 5000n, // 50% of NAV across all open positions combined
};
const MAX_ALLOCATION_BPS_WUSDC = 10000n;
const MAX_ALLOCATION_BPS_EURC = 10000n;

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

  if (getAddress(admin.account.address) !== ADMIN_GOVERNANCE_ADDRESS) {
    throw new Error(
      `arcTestnet.accounts[1] resolves to ${admin.account.address}, not the expected admin address ${ADMIN_GOVERNANCE_ADDRESS}. Stopping, do not proceed with the wrong signer.`,
    );
  }
  console.log(`Admin signer confirmed: ${admin.account.address}`);

  if (VAULT_FACTORY_ADDRESS === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("VAULT_FACTORY_ADDRESS is still the placeholder zero address. Run scripts/deployVaultFactoryForV7.ts first, then paste its real Gen7 VaultFactory address in here.");
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

  // 0. Wrap enough native currency into WUSDC to cover the seed deposit,
  // if the admin doesn't already hold enough real WUSDC.
  let wusdcBalance = await publicClient.readContract({ address: WUSDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [admin.account.address] });
  console.log(`Admin WUSDC balance: ${wusdcBalance} (need at least ${SEED_AMOUNT} for the seed deposit)`);
  if (wusdcBalance < SEED_AMOUNT) {
    const shortfall = SEED_AMOUNT - wusdcBalance;
    console.log(`Wrapping ${shortfall} native currency into WUSDC...`);
    await confirm(admin.writeContract({ address: WUSDC_ADDRESS, abi: IWUSDC_ABI, functionName: "deposit", value: shortfall }), "WUSDC.deposit (wrap native currency)");
    wusdcBalance = await publicClient.readContract({ address: WUSDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [admin.account.address] });
    if (wusdcBalance < SEED_AMOUNT) {
      throw new Error(`Wrapping still leaves WUSDC balance (${wusdcBalance}) below the seed amount (${SEED_AMOUNT}). Fund the admin address with more native currency and re-run.`);
    }
  }

  const factory = await viem.getContractAt("VaultFactory", VAULT_FACTORY_ADDRESS);

  // 1. Admin approves the factory to pull the seed deposit from its own address.
  await confirm(
    admin.writeContract({ address: WUSDC_ADDRESS, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [VAULT_FACTORY_ADDRESS, SEED_AMOUNT] }),
    `Approved VaultFactory for ${SEED_AMOUNT} WUSDC (seed deposit)`,
  );

  // 2. Create the v7 vault: WUSDC base asset, EURC as the only otherAsset
  // (both real WUSDC/EURC pool tokens must be registered for LP_OPEN to
  // ever succeed, same requirement v3's own _lpOpen already enforces).
  const createVaultParams = {
    usdc: WUSDC_ADDRESS,
    initialSwapRouter: UNITFLOW_V3_ROUTER,
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    otherAssets: [EURC_ADDRESS] as `0x${string}`[],
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
      assets: [WUSDC_ADDRESS, EURC_ADDRESS],
      maxAllocationBps: [MAX_ALLOCATION_BPS_WUSDC, MAX_ALLOCATION_BPS_EURC],
      stableAssets: [WUSDC_ADDRESS, EURC_ADDRESS],
      minLpTickRangeWidth: POLICY_LIMITS.minLpTickRangeWidth,
      maxLpPositionValueLossBps: POLICY_LIMITS.maxLpPositionValueLossBps,
      maxLpOutOfRangeSeconds: POLICY_LIMITS.maxLpOutOfRangeSeconds,
      minLpPoolLiquidityRatioBps: POLICY_LIMITS.minLpPoolLiquidityRatioBps,
      maxLpAllocationBps: POLICY_LIMITS.maxLpAllocationBps,
      lendingReportStaleAfterSeconds: 0n,
      lendingReportMaxDeviationBps: 0n,
      lendingPositionForceUnwindSeconds: 0n,
      maxLendingAllocationBps: 0n,
      performanceFeeBps: 1000n, // 10%, same design and mechanism as v6's MandateVaultLending
    },
    seedAmount: SEED_AMOUNT,
    // No cross-chain lending capability for v7 (its own strategy is pure
    // LP, not bridging), same address(0) convention v3's own real
    // deployment already used for this field.
    cctpTokenMessenger: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v7: WUSDC + EURC, LP-enabled, 10% performance fee)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVaultLp v7: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVaultLp", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v7: ${policyAddress}`);

  // 3. Start the real WUSDC/EURC pool's TWAP warm-up, same reasoning as
  // v3's own deployment script.
  await confirm(
    admin.writeContract({ address: WUSDC_EURC_POOL, abi: POOL_OBSERVATION_ABI, functionName: "increaseObservationCardinalityNext", args: [OBSERVATION_CARDINALITY_INCREASE] }),
    `Increased WUSDC/EURC pool observationCardinalityNext to at least ${OBSERVATION_CARDINALITY_INCREASE} (TWAP warm-up started)`,
  );

  // Read-only verification, never assumed: confirm the policy limits and
  // performanceFeeBps actually landed as configured.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxWusdc = await policy.read.maxAllocationBpsPerAsset([WUSDC_ADDRESS]);
  const liveMaxEurc = await policy.read.maxAllocationBpsPerAsset([EURC_ADDRESS]);
  const liveMinLpTickRangeWidth = await policy.read.minLpTickRangeWidth();
  const liveMaxLpPositionValueLossBps = await policy.read.maxLpPositionValueLossBps();
  const liveMaxLpOutOfRangeSeconds = await policy.read.maxLpOutOfRangeSeconds();
  const liveMinLpPoolLiquidityRatioBps = await policy.read.minLpPoolLiquidityRatioBps();
  const liveMaxLpAllocationBps = await policy.read.maxLpAllocationBps();
  const livePerformanceFeeBps = await policy.read.performanceFeeBps();
  console.log(
    `Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[WUSDC]=${liveMaxWusdc}, maxAllocationBpsPerAsset[EURC]=${liveMaxEurc}, ` +
      `minLpTickRangeWidth=${liveMinLpTickRangeWidth}, maxLpPositionValueLossBps=${liveMaxLpPositionValueLossBps}, maxLpOutOfRangeSeconds=${liveMaxLpOutOfRangeSeconds}, ` +
      `minLpPoolLiquidityRatioBps=${liveMinLpPoolLiquidityRatioBps}, maxLpAllocationBps=${liveMaxLpAllocationBps}, performanceFeeBps=${livePerformanceFeeBps}`,
  );
  if (
    BigInt(liveMaxWusdc) !== MAX_ALLOCATION_BPS_WUSDC ||
    BigInt(liveMaxEurc) !== MAX_ALLOCATION_BPS_EURC ||
    BigInt(liveMinLpTickRangeWidth) !== POLICY_LIMITS.minLpTickRangeWidth ||
    BigInt(liveMaxLpPositionValueLossBps) !== POLICY_LIMITS.maxLpPositionValueLossBps ||
    BigInt(liveMaxLpOutOfRangeSeconds) !== POLICY_LIMITS.maxLpOutOfRangeSeconds ||
    BigInt(liveMinLpPoolLiquidityRatioBps) !== POLICY_LIMITS.minLpPoolLiquidityRatioBps ||
    BigInt(liveMaxLpAllocationBps) !== POLICY_LIMITS.maxLpAllocationBps ||
    BigInt(livePerformanceFeeBps) !== 1000n
  ) {
    throw new Error("Live policy limits do not match what was requested. Do not treat this deployment as complete.");
  }

  const liveObservationCardinalityNext = await publicClient.readContract({
    address: WUSDC_EURC_POOL,
    abi: [{ type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] }] as const,
    functionName: "slot0",
  });
  console.log(`Verified onchain: WUSDC/EURC pool observationCardinalityNext=${liveObservationCardinalityNext[4]}.`);
  if (liveObservationCardinalityNext[4] < OBSERVATION_CARDINALITY_INCREASE) {
    throw new Error("Pool observationCardinalityNext did not increase as requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v7 deployment summary ===");
  console.log(`VaultFactory (Gen7):     ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVaultLp v7:      ${vaultAddress}`);
  console.log(`VaultPolicy v7:         ${policyAddress}`);
  console.log(`Base asset:             WUSDC (${WUSDC_ADDRESS}), not native USDC -- see this file's own top-of-file note on why`);
  console.log(`Assets:                 WUSDC (base), EURC (max ${MAX_ALLOCATION_BPS_EURC}bps)`);
  console.log(`performanceFeeBps:      1000 (10%)`);
  console.log(
    "\nNot yet done: LpPositionRegistry is not yet deployed or wired to this vault (vault.setLpRegistry, scripts/deployLpPositionRegistryV7.ts), " +
      "and positionManager is not yet proposed on the registry (a separate 48h-timelocked step once the registry exists). " +
      "Unlike v3/v5, this vault is NOT hard-blocked by requireIndependentReferencePriceForLp/ToBuy once STABLE_ASSET_CONFIG's WUSDC/EURC entries are live " +
      "(agent/core/tools/getMarketData.ts) -- this can be the first LP vault in this project to actually execute a real position.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
