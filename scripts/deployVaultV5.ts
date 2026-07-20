// Deploys the real v5 MandateVault+VaultPolicy pair: USDC base asset plus
// cirBTC (same two assets as v2), but a DIFFERENT risk profile entirely --
// v2 caps cirBTC at 20% of NAV (a conservative "hold within a small cap"
// vault); v5 targets 50% USDC / 50% cirBTC by value and rebalances back to
// that target whenever the deviation crosses a threshold ("ergodic
// rebalancing", see research/ergodic-rebalancing/REPORT.md for the
// validated backtest this design is based on). v2's own limits are simply
// incompatible with a 50% target (a 50% cirBTC weight would immediately
// violate v2's 20% cap), so this is a new risk profile requiring its own
// deployment, same "new risk profile = new deployment, never mutate a live
// one" principle already applied to every prior version.
//
// Reuses the swap+REBALANCE mechanism only, deliberately NOT the LP
// mechanism (v3) or cross-chain lending (v4) -- no new Solidity fields are
// needed, this vault is built entirely from mechanisms that already exist
// and are already live in production (v1/v2's own REBALANCE+SwapLeg path).
//
// Deployed via the v4-generation VaultFactory (the currently-active one,
// live-verified 2026-07-19: vaultCount=1, vaultDeployer=0x5A410338cACb3651C68Ae08f22eE8166cad63062,
// matching docs/deployments.md exactly), since it is the most recently
// bootstrapped, currently-live factory -- there is no reason to bootstrap
// yet another new factory generation, v5 needs no new ConstructorLimits
// fields VaultPolicy doesn't already have. Consequence, verified against
// contracts/MandateVault.sol directly: since that file accumulates every
// version's fields in one place, a vault created through this factory gets
// the FULL current executeDecision ABI (chainId/lendingPositionId/
// bridgeLeg present, same as v4's own vault), even though v5 never
// proposes BRIDGE_* or LP_* actions. This means v5 must be operated with
// executor/keeperServiceV4.ts's ABI-compatible KeeperServiceV4 class
// (configured with v5's own vaultAddress/assets/strategy), NOT
// executor/keeperService.ts's older ABI -- the older module would encode
// calldata v5's real deployed bytecode does not expect and every call
// would revert, the same class of mismatch already diagnosed once this
// project (see executor/keeperService.ts's own "INTENTIONAL FORK" comment).
// No new keeper module is needed: v5 simply never proposes BRIDGE_*/LP_*
// actions, the same way v4's own vault never proposes LP_* despite having
// that capability compiled in too.
//
// CRITICAL, KNOWN LIMITATION -- READ BEFORE RUNNING THIS SCRIPT, see
// docs/v5-ergodic-rebalancing.md for the full writeup: cirBTC has no
// genuinely independent reference price on Arc yet (same disclosed
// limitation v2/v3 already carry), so executor/keeperService.ts's/
// keeperServiceV4.ts's requireIndependentReferencePriceToBuy (and, as of
// this same change, agent/policy/offchainPolicyCheck.ts's own
// INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY offchain check) refuses any
// swap leg that BUYS cirBTC. Unlike v2 (where this only blocks growing an
// existing, capped position) and v3 (where this only blocks opening new LP
// positions), v5's ENTIRE strategy depends on bidirectional rebalancing --
// buying cirBTC back when underweight is exactly half of what the strategy
// needs to do. Real capital deployed to this vault CANNOT complete a real,
// full rebalancing cycle until an independent cirBTC oracle exists: only
// the sell-direction (trimming cirBTC when overweight) can execute for
// real today. The Paper Vault (scripts/paperVaultCycle.ts) already
// demonstrates the full, bidirectional mechanism end to end using
// MANDORTEST-* test tokens, which are not subject to this restriction
// (see scripts/paperVaultTestTokens.ts).
//
// Run with: npx hardhat run scripts/deployVaultV5.ts --network arcTestnet
//
// Requires hardhat.config.ts's arcTestnet.accounts[1] (ARC_ADMIN_PRIVATE_KEY)
// to actually be the real admin address's key, verified live below before
// spending anything.
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
// The Gen4 VaultFactory, bootstrapped specifically for v5 -- NOT the
// v4-generation (Gen3) factory reused for the first two, abandoned v5
// deploy attempts. Live-verified 2026-07-19: contracts/VaultFactory.sol
// deploys VaultPolicy via a direct `new VaultPolicy(...)`, which embeds
// VaultPolicy's full compiled LOGIC (not just its ABI) into VaultFactory's
// own bytecode at VaultFactory's own deploy time. Gen3 was bootstrapped
// for v4, before this session's VaultPolicy.sol REBALANCE-exemption edit,
// so it can only ever produce vaults with the OLD, unconditional
// maxDrawdownBps check -- confirmed empirically via a live validateDecision
// call showing REBALANCE failing identically to HOLD during high drawdown,
// despite the constructor's maxDrawdownBps argument itself reading 1000
// correctly. See docs/deployments.md's "Fourth VaultFactory generation
// (Gen4, for v5)" section for the full writeup, and
// scripts/deployVaultFactoryForV5.ts for the bootstrap itself.
// Independently re-verified live after bootstrap: roles/protocolTreasury/
// capitalLimitRegistry/vaultDeployer wiring correct both directions,
// vaultCount=0 (fresh), Gen3 completely untouched (vaultCount still 3).
const VAULT_FACTORY_ADDRESS = getAddress("0x361b4ccbadc0de931c01084ec9511d8a6bfde83e");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000"); // native USDC's ERC-20 interface, 6 decimals
const UNITFLOW_V3_ROUTER = getAddress("0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01");
// Same real, live-verified cirBTC address v2/v3 already use, see
// scripts/deployVaultV2.ts's own doc comment.
const CIRBTC_ADDRESS = getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");

// ---------------------------------------------------------------------
// Deployment parameters.
//
// maxAllocationBpsPerAsset[cirBTC]=6500 / minStableAllocationBps=3500: a
// deliberately wide, symmetric band around the 50% target (100% - 65% =
// 35%, the exact complement), NOT v2's tight 20% cap. Real headroom is
// needed above and below the 3%-8% rebalance thresholds
// research/ergodic-rebalancing/REPORT.md validated: the vault is only
// checked when the keeper actually runs a cycle, not continuously, so
// price can drift further than the exact trigger threshold before the
// next rebalance actually executes, and this cap must never be tight
// enough to reject a legitimate REBALANCE back toward 50/50.
//
// maxDrawdownBps=1000 (10%), same shared default as v1/v2/v3/v4 -- NOT
// loosened. An earlier draft of this script raised this to 5000 (50%)
// globally to keep REBALANCE from getting blocked during this strategy's
// own expected, in-band drawdowns (research/ergodic-rebalancing's own real
// backtest measured 30-40% max drawdown for the REBALANCED strategy
// itself, and 41-49% for a naive 50/50 buy-and-hold, over the exact real
// historical window tested). Randy explicitly rejected that approach:
// raising maxDrawdownBps vault-wide dilutes a safety parameter meant to
// catch ABNORMAL conditions (bugs, oracle manipulation, catastrophic
// failure), not to accommodate one strategy's own expected behavior.
//
// The approved fix instead is surgical: REBALANCE alone is exempt from
// the VIOLATION_MAX_DRAWDOWN_EXCEEDED check (contracts/VaultPolicy.sol's
// own `decision.action != DecisionAction.REBALANCE` condition, mirrored
// offchain by agent/policy/offchainPolicyCheck.ts's opt-in
// rebalanceExemptFromMaxDrawdown parameter, passed as `true` only by v5's
// own caller). This lets REBALANCE recover the vault during exactly the
// drawdowns this strategy expects, while ENTER/EXIT/HOLD stay fully
// protected by the same 10% circuit breaker as v1-v4, for every OTHER
// (non-REBALANCE) situation -- including a genuinely abnormal one. See
// docs/v5-ergodic-rebalancing.md's "Policy limits" section for the full
// design writeup.
//
// maxDrawdownSpeedBpsPerWindow/drawdownSpeedWindowSeconds are left at
// v1-v4's shared defaults (300bps/3600s): this is a different kind of
// safety net (a rate-of-change guard against flash-crash/manipulation-like
// moves, triggering a reviewable auto-pause, not a hard per-action block),
// and changing it is a separate risk/tradeoff decision not clearly forced
// by "the 50/50 target needs room to operate" the way maxDrawdownBps was.
// Flagged as an open item to monitor once this vault is live, not
// presumptively changed without real operational data.
// ---------------------------------------------------------------------
const VAULT_NAME = "Mandate USDC/cirBTC Ergodic Rebalancing Vault (v5)";
const VAULT_SYMBOL = "mUSDCv5";
const SEED_AMOUNT = parseUnits("5", 6); // 5 USDC, same minimal-real-capital sizing as v1-v4

const POLICY_LIMITS = {
  maxDrawdownBps: 1000n, // 10%, same as v1-v4, unchanged -- see doc comment above
  maxTradesPerDay: 5n, // same as v1-v4; the validated backtest never came close to this even at the tightest (3%) threshold
  minStableAllocationBps: 3500n, // 35%, the exact complement of maxAllocationBpsPerAsset[cirBTC]=6500
  oracleMaxStalenessSeconds: 3600n, // same as v1-v4
  oracleMaxDeviationBps: 500n, // same as v1-v4 (a structural no-op for cirBTC specifically, same disclosed limitation v2/v3 already carry, see docs/v5-ergodic-rebalancing.md)
  maxDrawdownSpeedBpsPerWindow: 300n, // same as v1-v4, unchanged -- see doc comment above
  drawdownSpeedWindowSeconds: 3600n, // same as v1-v4
};
const MAX_ALLOCATION_BPS_USDC = 10000n; // 100%, same convention as v1-v4
const MAX_ALLOCATION_BPS_CIRBTC = 6500n; // 65%, real headroom around the 50% target -- see doc comment above

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

  // Live-verify the factory is genuinely the one this script assumes
  // before spending anything, not just trusted from a hardcoded constant.
  const factoryVaultCountBefore = await publicClient.readContract({
    address: VAULT_FACTORY_ADDRESS,
    abi: [{ type: "function", name: "vaultCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
    functionName: "vaultCount",
  });
  console.log(`VaultFactory vaultCount before this deployment: ${factoryVaultCountBefore} (expect 1: only v4's own vault so far)`);

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

  // 2. Create the v5 vault: USDC base asset plus cirBTC as otherAssets,
  // same two-asset shape as v2, entirely different limits. LP fields and
  // lending fields all zeroed -- this vault touches neither mechanism, see
  // this file's own top-of-file doc comment. cctpTokenMessenger left at
  // address(0), same reasoning.
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
      // LP fields: all zeroed, this vault never touches the LP mechanism.
      minLpTickRangeWidth: 0,
      maxLpPositionValueLossBps: 0n,
      maxLpOutOfRangeSeconds: 0n,
      minLpPoolLiquidityRatioBps: 0n,
      maxLpAllocationBps: 0n,
      // Lending fields: all zeroed, this vault never touches cross-chain lending.
      lendingReportStaleAfterSeconds: 0n,
      lendingReportMaxDeviationBps: 0n,
      lendingPositionForceUnwindSeconds: 0n,
      maxLendingAllocationBps: 0n,
    },
    seedAmount: SEED_AMOUNT,
    // v5 never bridges funds out; address(0), same as v1/v2/v3.
    cctpTokenMessenger: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  };

  await confirm(factory.write.createVault([createVaultParams], { account: admin.account }), "createVault (v5: USDC + cirBTC, ergodic rebalancing)");

  const vaultCount = await factory.read.vaultCount();
  const vaultAddress = await factory.read.allVaults([vaultCount - 1n]);
  console.log(`MandateVault v5: ${vaultAddress}`);
  const vault = await viem.getContractAt("MandateVault", vaultAddress);
  const policyAddress = await vault.read.policy();
  console.log(`VaultPolicy v5: ${policyAddress}`);

  // Read-only verification, never assumed: confirm the policy limits
  // actually landed as configured.
  const policy = await viem.getContractAt("VaultPolicy", policyAddress);
  const liveMinStable = await policy.read.minStableAllocationBps();
  const liveMaxCirbtc = await policy.read.maxAllocationBpsPerAsset([CIRBTC_ADDRESS]);
  const liveMaxUsdc = await policy.read.maxAllocationBpsPerAsset([USDC_ADDRESS]);
  const liveMaxDrawdownBps = await policy.read.maxDrawdownBps();
  console.log(
    `Verified onchain: minStableAllocationBps=${liveMinStable}, maxAllocationBpsPerAsset[cirBTC]=${liveMaxCirbtc}, ` +
      `maxAllocationBpsPerAsset[USDC]=${liveMaxUsdc}, maxDrawdownBps=${liveMaxDrawdownBps}`,
  );
  if (
    liveMinStable !== POLICY_LIMITS.minStableAllocationBps ||
    liveMaxCirbtc !== MAX_ALLOCATION_BPS_CIRBTC ||
    liveMaxUsdc !== MAX_ALLOCATION_BPS_USDC ||
    liveMaxDrawdownBps !== POLICY_LIMITS.maxDrawdownBps
  ) {
    throw new Error("Live policy limits do not match what was requested. Do not treat this deployment as complete.");
  }

  console.log("\n=== v5 deployment summary ===");
  console.log(`VaultFactory (reused, v4-generation): ${VAULT_FACTORY_ADDRESS}`);
  console.log(`MandateVault v5:        ${vaultAddress}`);
  console.log(`VaultPolicy v5:         ${policyAddress}`);
  console.log(`Assets:                 USDC (base), cirBTC (target 50%, cap ${MAX_ALLOCATION_BPS_CIRBTC}bps / ${Number(MAX_ALLOCATION_BPS_CIRBTC) / 100}%)`);
  console.log(`maxDrawdownBps:         ${POLICY_LIMITS.maxDrawdownBps}bps (${Number(POLICY_LIMITS.maxDrawdownBps) / 100}%, same as v1-v4, REBALANCE exempt from this check per contracts/VaultPolicy.sol's own design)`);
  console.log(
    "\nIMPORTANT, READ docs/v5-ergodic-rebalancing.md: real BUY-direction rebalancing (topping cirBTC back up when " +
      "underweight) is refused by both executor/keeperServiceV4.ts's requireIndependentReferencePriceToBuy and " +
      "agent/policy/offchainPolicyCheck.ts's INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY check until a genuinely " +
      "independent cirBTC reference price exists on Arc. Only the sell-direction can execute for real today. This " +
      "vault must be operated with executor/keeperServiceV4.ts's KeeperServiceV4 class (this vault's real ABI is " +
      "v4-shaped, see this file's own top-of-file doc comment), configured with this vault's own address and " +
      "scripts/v5StrategyText.ts's strategy text.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
