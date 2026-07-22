// Deploys the real v3 MandateVault+VaultPolicy pair (USDC base asset plus
// cirBTC AND WUSDC, unlike v2's USDC+cirBTC-only pair): WUSDC must be a
// registered asset too, since the only real-liquidity pool this vault
// could ever open a position on is WUSDC/cirBTC, and MandateVault._lpOpen
// requires BOTH pool tokens to already be registered (confirmed by
// reading that function, not assumed). Without WUSDC registered, this
// vault could never open a real position even after an independent
// cirBTC reference price appears, guaranteeing a throwaway v4 for a
// second, unrelated reason, the same pattern v1/v2 already lived through.
// Reuses the already-deployed MandateRoles/VaultFactory/
// CapitalLimitRegistry as-is, mirroring scripts/deployVaultV2.ts's own
// deployment shape.
//
// Real execution of LP_OPEN/LP_INCREASE is hard-blocked today
// (requireIndependentReferencePriceForLp, executor/keeperService.ts): no
// genuinely independent reference price exists for cirBTC on Arc yet, the
// same documented, disclosed situation as v2's cirBTC ENTER restriction.
// This deployment still makes sense: the mechanism is real and
// fork-tested (test/MandateVaultArcFork.t.sol), only live execution
// against real capital is gated, exactly like v2's own precedent.
//
// Also starts the real TWAP warm-up on the real WUSDC/cirBTC pool (step
// 4 below, increaseObservationCardinalityNext): found and fixed
// 2026-07-15, MandateVault._valuePosition values any open LP position via
// a manipulation-resistant TWAP (not the live, flash-manipulable slot0()
// spot price) specifically because totalAssets() is read live and
// permissionlessly by every deposit()/withdraw()/mint()/redeem() call,
// see docs/deployments.md's v3 section for the full writeup. The real
// pool's observationCardinality was still at the Uniswap V3 default (1,
// confirmed live) as of this deployment, meaning the TWAP is not yet
// queryable; starting the cardinality increase now, well ahead of when
// LP_OPEN could ever actually execute (still gated on cirBTC's
// independent-price restriction above), gives it real elapsed time to
// warm up for free.
//
// Run with: npx hardhat run scripts/deployVaultV3.ts --network arcTestnet
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

// Standard Uniswap V3 pool function, no owner/permission needed. Real gas
// cost scales with the increase requested (~20k gas per new slot in real
// Uniswap V3 deployments); 50 is a modest, affordable increase, not the
// full ~1800 slots a literal one-per-second 30-minute window would
// need, but this pool's own real, thin interaction frequency (see
// docs/arc-facts-to-verify.md) means far fewer real observations
// naturally accumulate per unit time than that upper bound assumes.
// Increasing further later, once real usage patterns are known, remains
// available (this call can be repeated, cardinality only ever grows).
const POOL_OBSERVATION_ABI = [
  { type: "function", name: "increaseObservationCardinalityNext", stateMutability: "nonpayable", inputs: [{ name: "observationCardinalityNext", type: "uint16" }], outputs: [] },
] as const;
const OBSERVATION_CARDINALITY_INCREASE = 50;

// ---------------------------------------------------------------------
// Real, already-deployed addresses, see docs/deployments.md. Nothing here
// gets redeployed, VaultFactory already knows its own roles/
// capitalLimitRegistry/protocolTreasury, it wires them into every vault it
// creates automatically.
// ---------------------------------------------------------------------
const ADMIN_GOVERNANCE_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
// The NEW VaultFactory (2026-07-16, scripts/deployVaultFactoryForV3.ts),
// not the original one used for v1/v2. The old one's real deployed
// bytecode predates VaultPolicy.ConstructorLimits' 5 new v3 LP fields, so
// calling createVault against it with the current (17-field) struct
// shape reverted immediately (confirmed live: 212 gas, no matching
// function selector). See docs/deployments.md's "Second VaultFactory
// generation" section for the full writeup and both factories' real
// addresses.
const VAULT_FACTORY_ADDRESS = getAddress("0xB6a54F66174D7CE37739945B6Da3b463bbE849D8");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
const CIRBTC_ADDRESS = getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
// Registered so MandateVault._lpOpen's own isRegisteredAsset check can
// ever pass for the real WUSDC/cirBTC pool (both pool tokens must be
// registered, confirmed by reading that function). Distinct from native
// USDC (this vault's own base asset()); wraps Arc's native gas currency,
// assumed 1:1 USD, same convention this project already uses elsewhere
// for it (agent/core/tools/getMarketData.ts).
const WUSDC_ADDRESS = getAddress("0x911b4000D3422F482F4062a913885f7b035382Df");
const WUSDC_CIRBTC_POOL = getAddress("0x254bA0424618113127538eE11e42C1e3c1721225");
// The real, verified UnitFlowV3PositionManager, see this project's v3
// design doc (item 5): confirmed cross-wired to the real Factory and the
// instance whose call actually triggered the most recent real PoolCreated
// event, not just theoretically compatible.
const POSITION_MANAGER_ADDRESS = getAddress("0x0553682bc188b850acd31CBd3500Dcd0aa35372B");

// ---------------------------------------------------------------------
// Deployment parameters. Base risk limits mirror v2's exact values
// (same conservative starting point, same asset pair); the 5 new LP
// fields match the real, non-zero limits already exercised in
// test/MandateVaultArcFork.t.sol's fork tests (not the harmless-zero
// placeholders v1/v2 use, those are only correct for vaults that never
// touch the LP mechanism).
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC+cirBTC Yield Vault (v3)";
const VAULT_SYMBOL = "mUSDCv3";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, same minimal-real-capital sizing as v1/v2

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%, same as v1/v2
  maxTradesPerDay: 5n, // same as v1/v2
  minStableAllocationBps: 8000n, // 80%, same as v2
  oracleMaxStalenessSeconds: 3600n, // same as v1/v2
  oracleMaxDeviationBps: 500n, // same as v1/v2
  maxDrawdownSpeedBpsPerWindow: 300n, // same as v1/v2
  drawdownSpeedWindowSeconds: 3600n, // same as v1/v2
  // v3-only. See contracts/VaultPolicy.sol's own doc comments on each
  // immutable for what these mean; values match this project's own
  // confirmed concrete triggers (v3 design doc) and the fork-tested
  // fixture in test/MandateVaultArcFork.t.sol's _lpPolicy.
  minLpTickRangeWidth: 1200n,
  maxLpPositionValueLossBps: 300n, // 3%
  maxLpOutOfRangeSeconds: 172_800n, // 48h
  minLpPoolLiquidityRatioBps: 5000n, // 50%
  maxLpAllocationBps: 5000n, // 50% of NAV across all open positions combined
};
const MAX_ALLOCATION_BPS_USDC = 10000n; // can still be up to 100% before any cirBTC position is entered
const MAX_ALLOCATION_BPS_CIRBTC = 2000n; // 20%, consistent with minStableAllocationBps=8000, same as v2
// Generous, matching the base asset's own cap: WUSDC is economically
// ~1:1 USD (wraps Arc's native gas currency), holding it before it is
// committed to an LP position is not itself risky the way holding cirBTC
// is, and it needs headroom to actually fund a real position's WUSDC
// side once real LP_OPEN execution is unblocked.
const MAX_ALLOCATION_BPS_WUSDC = 10000n;

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

  // 2. Create the v3 vault: USDC base asset plus cirBTC AND WUSDC as
  // otherAssets (both real WUSDC/cirBTC pool tokens must be registered
  // for _lpOpen to ever succeed on it, see this file's own top-of-file
  // note), plus the 5 new LP-specific ConstructorLimits fields VaultPolicy
  // now requires.
  const createVaultParams = {
    usdc: USDC_ADDRESS,
    initialSwapRouter: UNITFLOW_V3_ROUTER,
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    otherAssets: [CIRBTC_ADDRESS, WUSDC_ADDRESS] as `0x${string}`[],
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
      assets: [USDC_ADDRESS, CIRBTC_ADDRESS, WUSDC_ADDRESS],
      maxAllocationBps: [MAX_ALLOCATION_BPS_USDC, MAX_ALLOCATION_BPS_CIRBTC, MAX_ALLOCATION_BPS_WUSDC],
      // WUSDC included as stable too (see MAX_ALLOCATION_BPS_WUSDC's own
      // doc comment on why): it counts toward minStableAllocationBps
      // alongside native USDC, cirBTC remains the only non-stable asset.
      stableAssets: [USDC_ADDRESS, WUSDC_ADDRESS],
      minLpTickRangeWidth: POLICY_LIMITS.minLpTickRangeWidth,
      maxLpPositionValueLossBps: POLICY_LIMITS.maxLpPositionValueLossBps,
      maxLpOutOfRangeSeconds: POLICY_LIMITS.maxLpOutOfRangeSeconds,
      minLpPoolLiquidityRatioBps: POLICY_LIMITS.minLpPoolLiquidityRatioBps,
      maxLpAllocationBps: POLICY_LIMITS.maxLpAllocationBps,
    },
    seedAmount: SEED_AMOUNT,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v3: USDC + cirBTC, LP-enabled)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVault v3: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVault", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v3: ${policyAddress}`);

  // 3. Start the positionManager timelock. This is a real 48h delay
  // (POSITION_MANAGER_CHANGE_TIMELOCK, see contracts/MandateVault.sol),
  // there is no way to fast-forward it for a real deployment. Anyone can
  // call vault.executePositionManager() once it elapses (permissionless
  // finalize, same pattern as the router allowlist), this script only
  // starts it.
  await confirm(
    vault.write.proposePositionManager([POSITION_MANAGER_ADDRESS], { account: admin.account }),
    `Proposed positionManager=${POSITION_MANAGER_ADDRESS} (48h timelock started)`,
  );
  const pendingExecutableAt = await vault.read.pendingPositionManagerExecutableAt();
  console.log(`positionManager change executable at unix timestamp ${pendingExecutableAt} (~48h from now). Call vault.executePositionManager() after that, from any address.`);

  // 4. Start the real WUSDC/cirBTC pool's TWAP warm-up (see this file's
  // own top-of-file note on the 2026-07-15 fix this supports). Standard,
  // permissionless Uniswap V3 call, doesn't need any special role, safe
  // to call now even though real LP_OPEN stays gated on the independent-
  // price restriction above, gives the real elapsed-time requirement a
  // head start for free.
  await confirm(
    admin.writeContract({ address: WUSDC_CIRBTC_POOL, abi: POOL_OBSERVATION_ABI, functionName: "increaseObservationCardinalityNext", args: [OBSERVATION_CARDINALITY_INCREASE] }),
    `Increased WUSDC/cirBTC pool observationCardinalityNext to at least ${OBSERVATION_CARDINALITY_INCREASE} (TWAP warm-up started)`,
  );

  // Read-only verification, never assumed: confirm the policy limits
  // actually landed as configured, including the 5 new LP-specific ones.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxCirbtc = await policy.read.maxAllocationBpsPerAsset([CIRBTC_ADDRESS]);
  const liveMaxUsdc = await policy.read.maxAllocationBpsPerAsset([USDC_ADDRESS]);
  const liveMaxWusdc = await policy.read.maxAllocationBpsPerAsset([WUSDC_ADDRESS]);
  const liveMinLpTickRangeWidth = await policy.read.minLpTickRangeWidth();
  const liveMaxLpPositionValueLossBps = await policy.read.maxLpPositionValueLossBps();
  const liveMaxLpOutOfRangeSeconds = await policy.read.maxLpOutOfRangeSeconds();
  const liveMinLpPoolLiquidityRatioBps = await policy.read.minLpPoolLiquidityRatioBps();
  const liveMaxLpAllocationBps = await policy.read.maxLpAllocationBps();
  console.log(
    `Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[cirBTC]=${liveMaxCirbtc}, maxAllocationBpsPerAsset[USDC]=${liveMaxUsdc}, ` +
      `maxAllocationBpsPerAsset[WUSDC]=${liveMaxWusdc}, minLpTickRangeWidth=${liveMinLpTickRangeWidth}, maxLpPositionValueLossBps=${liveMaxLpPositionValueLossBps}, ` +
      `maxLpOutOfRangeSeconds=${liveMaxLpOutOfRangeSeconds}, minLpPoolLiquidityRatioBps=${liveMinLpPoolLiquidityRatioBps}, maxLpAllocationBps=${liveMaxLpAllocationBps}`,
  );
  // Compare via BigInt(...) on both sides, not raw !==: found live
  // 2026-07-16, minLpTickRangeWidth is Solidity int24, which viem decodes
  // as a plain JS number (fits safely, unlike the uint256 fields here,
  // which decode as bigint); a raw `number !== bigint` comparison is
  // ALWAYS true regardless of value (JS never coerces across that
  // boundary for !==), so this check false-positived on a genuinely
  // correct deployment. Confirmed independently via direct cast calls
  // before fixing this, not just assumed.
  if (
    BigInt(liveMinStable) !== POLICY_LIMITS.minStableAllocationBps ||
    BigInt(liveMaxCirbtc) !== MAX_ALLOCATION_BPS_CIRBTC ||
    BigInt(liveMaxWusdc) !== MAX_ALLOCATION_BPS_WUSDC ||
    BigInt(liveMinLpTickRangeWidth) !== POLICY_LIMITS.minLpTickRangeWidth ||
    BigInt(liveMaxLpPositionValueLossBps) !== POLICY_LIMITS.maxLpPositionValueLossBps ||
    BigInt(liveMaxLpOutOfRangeSeconds) !== POLICY_LIMITS.maxLpOutOfRangeSeconds ||
    BigInt(liveMinLpPoolLiquidityRatioBps) !== POLICY_LIMITS.minLpPoolLiquidityRatioBps ||
    BigInt(liveMaxLpAllocationBps) !== POLICY_LIMITS.maxLpAllocationBps
  ) {
    throw new Error("Live policy limits do not match what was requested. Do not treat this deployment as complete.");
  }

  const liveObservationCardinalityNext = await publicClient.readContract({
    address: WUSDC_CIRBTC_POOL,
    abi: [{ type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] }] as const,
    functionName: "slot0",
  });
  console.log(`Verified onchain: WUSDC/cirBTC pool observationCardinalityNext=${liveObservationCardinalityNext[4]} (was 1 before this deployment).`);
  if (liveObservationCardinalityNext[4] < OBSERVATION_CARDINALITY_INCREASE) {
    throw new Error("Pool observationCardinalityNext did not increase as requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v3 deployment summary ===");
  console.log(`VaultFactory (new, 2026-07-16):  ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVault v3:        ${vaultAddress}`);
  console.log(`VaultPolicy v3:         ${policyAddress}`);
  console.log(`Assets:                 USDC (base), cirBTC (max ${MAX_ALLOCATION_BPS_CIRBTC}bps / ${Number(MAX_ALLOCATION_BPS_CIRBTC) / 100}%), WUSDC (max ${MAX_ALLOCATION_BPS_WUSDC}bps, registered so a real WUSDC/cirBTC position can ever be opened)`);
  console.log(`positionManager:        pending, executable at unix ${pendingExecutableAt} (call executePositionManager() after that)`);
  console.log(
    `Real LP_OPEN/LP_INCREASE execution: hard-blocked until an independent cirBTC reference price exists ` +
      `(requireIndependentReferencePriceForLp, executor/keeperService.ts), same disclosed situation as v2's cirBTC ENTER. ` +
      `The real pool's TWAP warm-up has started (see above), so once that restriction lifts, the mechanism does not also need to wait on this.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
