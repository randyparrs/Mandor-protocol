import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, parseUnits } from "viem";

const PAUSER_ROLE = keccak256(toHex("PAUSER_ROLE"));
const KEEPER_ROLE = keccak256(toHex("KEEPER_ROLE"));
const GOVERNANCE_ROLE = keccak256(toHex("GOVERNANCE_ROLE"));

const HOUR = 60 * 60;
const HOLD = 0;
const REBALANCE = 1;
const EMERGENCY_EXIT_TO_STABLE = 4;

function policyLimits(overrides: Record<string, unknown> = {}) {
  return {
    vault: undefined as unknown as `0x${string}`,
    roles: undefined as unknown as `0x${string}`,
    maxDrawdownBps: 1000n,
    maxTradesPerDay: 5n,
    minStableAllocationBps: 2000n,
    oracleMaxStalenessSeconds: BigInt(HOUR),
    oracleMaxDeviationBps: 500n,
    maxDrawdownSpeedBpsPerWindow: 300n,
    drawdownSpeedWindowSeconds: BigInt(HOUR),
    assets: [] as `0x${string}`[],
    maxAllocationBps: [] as bigint[],
    stableAssets: [] as `0x${string}`[],
    ...overrides,
  };
}

async function setup() {
  const { viem } = await network.create();
  const [admin, pauser, keeper, governance, other, user1, user2] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
  await roles.write.grantRole([PAUSER_ROLE, pauser.account.address]);
  await roles.write.grantRole([KEEPER_ROLE, keeper.account.address]);
  await roles.write.grantRole([GOVERNANCE_ROLE, governance.account.address]);

  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 18]);
  const eurc = await viem.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
  const router = await viem.deployContract("MockSwapRouter");

  const vault = await viem.deployContract("MandateVault", [
    usdc.address,
    roles.address,
    router.address,
    "Mandate USDC Vault",
    "mUSDC",
    [eurc.address],
    admin.account.address,
  ]);

  const limits = policyLimits({
    vault: vault.address,
    roles: roles.address,
    assets: [usdc.address, eurc.address],
    maxAllocationBps: [10_000n, 5_000n],
    stableAssets: [usdc.address],
  });
  const policy = await viem.deployContract("VaultPolicy", [limits]);
  await vault.write.setPolicy([policy.address], { account: admin.account });

  for (const user of [user1, user2]) {
    await usdc.write.mint([user.account.address, parseUnits("1000", 18)]);
    await usdc.write.approve([vault.address, parseUnits("1000", 18)], { account: user.account });
  }

  return { viem, pub, admin, pauser, keeper, governance, other, user1, user2, roles, usdc, eurc, router, vault, policy };
}

function decision(action: number, overrides: Record<string, unknown> = {}) {
  return {
    action,
    asset: "0x0000000000000000000000000000000000000000",
    amount: 0n,
    targetAllocations: [],
    ...overrides,
  };
}

describe("MandateVault", () => {
  it("deploys with the correct asset and starts at zero totalAssets", async () => {
    const { vault, usdc } = await setup();
    assert.equal(getAddress(await vault.read.asset()), getAddress(usdc.address));
    assert.equal(await vault.read.totalAssets(), 0n);
  });

  it("deposit mints expected shares and increases totalAssets by exactly the deposited amount", async () => {
    const { vault, user1 } = await setup();
    const amount = parseUnits("100", 18);
    await vault.write.deposit([amount, user1.account.address], { account: user1.account });
    assert.equal(await vault.read.totalAssets(), amount);
    assert.equal(await vault.read.balanceOf([user1.account.address]), amount * 10n ** 3n); // decimals offset = 3
  });

  it("an unsolicited direct transfer does not change totalAssets, convertToShares, or convertToAssets", async () => {
    const { vault, usdc, user1, other } = await setup();
    const amount = parseUnits("100", 18);
    await vault.write.deposit([amount, user1.account.address], { account: user1.account });

    const totalBefore = await vault.read.totalAssets();
    const sharesBefore = await vault.read.convertToShares([amount]);
    const assetsBefore = await vault.read.convertToAssets([amount]);

    await usdc.write.mint([other.account.address, parseUnits("500", 18)]);
    await usdc.write.transfer([vault.address, parseUnits("500", 18)], { account: other.account });

    assert.equal(await vault.read.totalAssets(), totalBefore, "donation must not change totalAssets");
    assert.equal(await vault.read.convertToShares([amount]), sharesBefore);
    assert.equal(await vault.read.convertToAssets([amount]), assetsBefore);
  });

  it("maxDeposit/maxMint return 0 and deposit/mint revert while paused", async () => {
    const { vault, policy, pauser, user1 } = await setup();
    await policy.write.pause({ account: pauser.account });

    assert.equal(await vault.read.maxDeposit([user1.account.address]), 0n);
    assert.equal(await vault.read.maxMint([user1.account.address]), 0n);
    await assert.rejects(
      vault.write.deposit([parseUnits("10", 18), user1.account.address], { account: user1.account }),
    );
  });

  it("withdraw/redeem succeed while paused, never blocked", async () => {
    const { vault, policy, pauser, user1 } = await setup();
    const amount = parseUnits("100", 18);
    await vault.write.deposit([amount, user1.account.address], { account: user1.account });
    await policy.write.pause({ account: pauser.account });

    await vault.write.withdraw([parseUnits("10", 18), user1.account.address, user1.account.address], {
      account: user1.account,
    });
    assert.equal(await vault.read.totalAssets(), parseUnits("90", 18));
  });

  it("only KEEPER_ROLE can call executeDecision", async () => {
    const { vault, other, pub } = await setup();
    const ts = (await pub.getBlock()).timestamp;
    await assert.rejects(
      vault.write.executeDecision(
        [decision(HOLD), [{ asset: "0x0000000000000000000000000000000000000000", price: 0n, referencePrice: 0n, updatedAt: ts }], []],
        { account: other.account },
      ),
    );
  });

  it("executeDecision reverts with DecisionRejected when the vault is paused", async () => {
    const { vault, policy, pauser, keeper } = await setup();
    await policy.write.pause({ account: pauser.account });
    await assert.rejects(vault.write.executeDecision([decision(HOLD), [], []], { account: keeper.account }));
  });

  it("EMERGENCY_EXIT_TO_STABLE succeeds via executeDecision even while paused", async () => {
    const { vault, policy, pauser, keeper } = await setup();
    await policy.write.pause({ account: pauser.account });
    await vault.write.executeDecision([decision(EMERGENCY_EXIT_TO_STABLE), [], []], { account: keeper.account });
  });

  it("tradesToday increments on non-HOLD actions and HOLD never increments it", async () => {
    const { vault, usdc, user1, keeper } = await setup();
    // A funded vault (matching the real VaultFactory-seeded scenario) so
    // the min-stable-allocation check has a real, compliant state to check
    // against instead of an empty, all-zero-bps vault.
    await vault.write.deposit([parseUnits("1000", 18), user1.account.address], { account: user1.account });

    await vault.write.executeDecision([decision(HOLD), [], []], { account: keeper.account });
    assert.equal(await vault.read.tradesToday(), 0n);

    await vault.write.executeDecision([decision(REBALANCE), [], []], { account: keeper.account });
    assert.equal(await vault.read.tradesToday(), 1n);
  });

  it("executeDecision moves the ledger correctly through a compliant swap", async () => {
    const { vault, usdc, eurc, router, user1, keeper, pub } = await setup();
    await vault.write.deposit([parseUnits("1000", 18), user1.account.address], { account: user1.account });

    // Seed the mock router with EURC so it can pay out the swap.
    await eurc.write.mint([router.address, parseUnits("10000", 6)]);

    const ts = (await pub.getBlock()).timestamp;
    const swapAmount = parseUnits("100", 18);
    const targetAllocations = [
      { asset: usdc.address, targetWeightBps: 9000 },
      { asset: eurc.address, targetWeightBps: 1000 },
    ];
    const prices = [{ asset: eurc.address, price: parseUnits("1", 18), referencePrice: parseUnits("1", 18), updatedAt: ts }];
    const swaps = [
      {
        router: router.address,
        tokenIn: usdc.address,
        tokenOut: eurc.address,
        fee: 500,
        amountIn: swapAmount,
        minAmountOut: parseUnits("90", 6),
        deadline: ts + 3600n,
        sqrtPriceLimitX96: 0n,
      },
    ];

    await vault.write.executeDecision([decision(REBALANCE, { targetAllocations }), prices, swaps], {
      account: keeper.account,
    });

    assert.equal(await vault.read.ledgerOf([usdc.address]), parseUnits("900", 18));
    assert.equal(await vault.read.ledgerOf([eurc.address]), parseUnits("100", 6));
  });

  it("executeDecision reverts (rolling back the swap) when the actual post-swap state violates policy", async () => {
    const { vault, usdc, eurc, router, user1, keeper, pub } = await setup();
    await vault.write.deposit([parseUnits("1000", 18), user1.account.address], { account: user1.account });
    await eurc.write.mint([router.address, parseUnits("10000", 6)]);

    // EURC's cap is 5000 bps; claim a compliant target (REBALANCE's pre-check
    // uses current state, which is 100% USDC and thus passes), but actually
    // swap far more than the claimed target allows, so the post-check must
    // catch the real resulting allocation and revert the whole transaction.
    const ts = (await pub.getBlock()).timestamp;
    const targetAllocations = [
      { asset: usdc.address, targetWeightBps: 4000 },
      { asset: eurc.address, targetWeightBps: 6000 }, // exceeds EURC's 5000 bps cap
    ];
    const prices = [{ asset: eurc.address, price: parseUnits("1", 18), referencePrice: parseUnits("1", 18), updatedAt: ts }];
    const swaps = [
      {
        router: router.address,
        tokenIn: usdc.address,
        tokenOut: eurc.address,
        fee: 500,
        amountIn: parseUnits("700", 18),
        minAmountOut: parseUnits("690", 6),
        deadline: ts + 3600n,
        sqrtPriceLimitX96: 0n,
      },
    ];

    await assert.rejects(
      vault.write.executeDecision([decision(REBALANCE, { targetAllocations }), prices, swaps], {
        account: keeper.account,
      }),
    );
    // Ledger must be untouched, the whole transaction reverted.
    assert.equal(await vault.read.ledgerOf([usdc.address]), parseUnits("1000", 18));
    assert.equal(await vault.read.ledgerOf([eurc.address]), 0n);
  });

  it("payAutoPauseBounty reverts for any caller other than the configured policy", async () => {
    const { vault, other, user1 } = await setup();
    await assert.rejects(vault.write.payAutoPauseBounty([user1.account.address], { account: other.account }));
  });

  it("only GOVERNANCE_ROLE can set autoPauseBountyAmount, and it defaults to 0", async () => {
    const { vault, governance, other } = await setup();
    assert.equal(await vault.read.autoPauseBountyAmount(), 0n);
    await assert.rejects(vault.write.setAutoPauseBountyAmount([1n], { account: other.account }));
    await vault.write.setAutoPauseBountyAmount([5n], { account: governance.account });
    assert.equal(await vault.read.autoPauseBountyAmount(), 5n);
  });

  it("setPolicy can only be called once, only by the factory", async () => {
    const { vault, policy, admin, other } = await setup();
    await assert.rejects(vault.write.setPolicy([policy.address], { account: other.account }));
    await assert.rejects(vault.write.setPolicy([policy.address], { account: admin.account }));
  });

  it("end-to-end: checkAndAutoPause triggers, the bounty lands, totalAssets decreases by exactly that amount", async () => {
    const { viem, admin, governance, roles, other, user1 } = await setup();
    // Fresh deploy with a nonzero bounty this time.
    const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 18]);
    const eurc = await viem.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const router = await viem.deployContract("MockSwapRouter");
    const vault = await viem.deployContract("MandateVault", [
      usdc.address,
      roles.address,
      router.address,
      "Mandate USDC Vault",
      "mUSDC",
      [eurc.address],
      admin.account.address,
    ]);
    const limits = policyLimits({
      vault: vault.address,
      roles: roles.address,
      assets: [usdc.address, eurc.address],
      maxAllocationBps: [10_000n, 5_000n],
      stableAssets: [usdc.address],
    });
    const policy = await viem.deployContract("VaultPolicy", [limits]);
    await vault.write.setPolicy([policy.address], { account: admin.account });
    await vault.write.setAutoPauseBountyAmount([parseUnits("1", 18)], { account: governance.account });

    await usdc.write.mint([user1.account.address, parseUnits("1000", 18)]);
    await usdc.write.approve([vault.address, parseUnits("1000", 18)], { account: user1.account });
    await vault.write.deposit([parseUnits("1000", 18), user1.account.address], { account: user1.account });

    const totalBefore = await vault.read.totalAssets();
    const state = {
      currentDrawdownBps: 500,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      currentHoldings: [],
      prices: [],
    };
    await policy.write.checkAndAutoPause([state], { account: other.account });

    assert.equal(await policy.read.paused(), true);
    assert.equal(await vault.read.totalAssets(), totalBefore - parseUnits("1", 18));
  });

  it("sweepDust moves only the unaccounted excess, never touching ledgered funds, after the 48h timelock elapses", async () => {
    const { vault, usdc, governance, user1, other, pub } = await setup();
    await vault.write.deposit([parseUnits("100", 18), user1.account.address], { account: user1.account });
    await usdc.write.mint([other.account.address, parseUnits("50", 18)]);
    await usdc.write.transfer([vault.address, parseUnits("50", 18)], { account: other.account });

    await vault.write.proposeSweepDust([usdc.address, governance.account.address], { account: governance.account });
    await assert.rejects(vault.write.executeSweepDust([usdc.address], { account: other.account }));

    const timelock = await vault.read.SWEEP_DUST_TIMELOCK();
    const ts = (await pub.getBlock()).timestamp;
    await pub.request({ method: "evm_setNextBlockTimestamp" as any, params: [`0x${(ts + timelock + 1n).toString(16)}`] as any });
    await vault.write.executeSweepDust([usdc.address], { account: other.account });

    assert.equal(await usdc.read.balanceOf([governance.account.address]), parseUnits("50", 18));
    assert.equal(await vault.read.totalAssets(), parseUnits("100", 18), "ledgered funds must be untouched");
  });

  it("a large accidental direct transfer is never sweepable instantly, and PAUSER_ROLE can cancel a pending sweep before it executes", async () => {
    const { vault, usdc, governance, pauser, user1, other } = await setup();
    await vault.write.deposit([parseUnits("100", 18), user1.account.address], { account: user1.account });
    await usdc.write.mint([other.account.address, parseUnits("1000", 18)]);
    await usdc.write.transfer([vault.address, parseUnits("1000", 18)], { account: other.account });

    await vault.write.proposeSweepDust([usdc.address, governance.account.address], { account: governance.account });
    await vault.write.cancelSweepDust([usdc.address], { account: pauser.account });

    await assert.rejects(vault.write.executeSweepDust([usdc.address], { account: other.account }));
    assert.equal(await usdc.read.balanceOf([governance.account.address]), 0n, "a cancelled sweep must never take effect");
  });

  it("only GOVERNANCE_ROLE can propose a router allowlist change or a dust sweep, and only PAUSER_ROLE can cancel a pending sweep", async () => {
    const { vault, usdc, other, router } = await setup();
    await assert.rejects(vault.write.proposeRouterAllowed([router.address, true], { account: other.account }));

    await usdc.write.mint([vault.address, parseUnits("10", 18)]);
    await assert.rejects(vault.write.proposeSweepDust([usdc.address, other.account.address], { account: other.account }));

    const { vault: vault2, usdc: usdc2, governance: governance2, other: other2 } = await setup();
    await usdc2.write.mint([vault2.address, parseUnits("10", 18)]);
    await vault2.write.proposeSweepDust([usdc2.address, governance2.account.address], { account: governance2.account });
    await assert.rejects(vault2.write.cancelSweepDust([usdc2.address], { account: other2.account }));
  });

  it("a router allowlist change is never instantaneous, and cannot execute before the 48h timelock elapses", async () => {
    const { vault, governance, other, viem } = await setup();
    // A fresh, not-yet-allowlisted router, distinct from the one already
    // set at construction (which is allowed from block zero and would make
    // this test's "starts false" assumption wrong).
    const candidateRouter = await viem.deployContract("MockSwapRouter");

    await vault.write.proposeRouterAllowed([candidateRouter.address, true], { account: governance.account });
    assert.equal(await vault.read.allowedRouters([candidateRouter.address]), false);

    await assert.rejects(vault.write.executeRouterAllowed([candidateRouter.address], { account: other.account }));

    // Read the exact executableAt the contract actually recorded, rather
    // than reconstructing it from a separately-fetched block timestamp,
    // which can drift by a second or two against the real value. The
    // timestamp is set for the very next block only, immediately before
    // the transaction that actually needs it, no intermediate empty-block
    // mine in between, so there's no extra auto-incremented block for the
    // real call to land in one second later than intended.
    const executableAt = await vault.read.routerChangeExecutableAt([candidateRouter.address]);
    const pub = await viem.getPublicClient();
    await pub.request({ method: "evm_setNextBlockTimestamp" as any, params: [`0x${(executableAt - 1n).toString(16)}`] as any });
    await assert.rejects(vault.write.executeRouterAllowed([candidateRouter.address], { account: other.account }));

    await pub.request({ method: "evm_setNextBlockTimestamp" as any, params: [`0x${(executableAt + 1n).toString(16)}`] as any });
    await vault.write.executeRouterAllowed([candidateRouter.address], { account: other.account });
    assert.equal(await vault.read.allowedRouters([candidateRouter.address]), true);
  });

  it("PAUSER_ROLE can cancel a pending router change before it executes, stopping a malicious proposal during the delay", async () => {
    const { vault, governance, pauser, other, viem } = await setup();
    const candidateRouter = await viem.deployContract("MockSwapRouter");

    await vault.write.proposeRouterAllowed([candidateRouter.address, true], { account: governance.account });
    assert.notEqual(await vault.read.routerChangeExecutableAt([candidateRouter.address]), 0n);

    await vault.write.cancelRouterAllowedChange([candidateRouter.address], { account: pauser.account });
    assert.equal(await vault.read.routerChangeExecutableAt([candidateRouter.address]), 0n);
    assert.equal(await vault.read.pendingRouterChange([candidateRouter.address]), false);

    // Once cancelled, there is nothing left to execute, timelock or not.
    await assert.rejects(vault.write.executeRouterAllowed([candidateRouter.address], { account: other.account }));
    assert.equal(await vault.read.allowedRouters([candidateRouter.address]), false);
  });

  it("only PAUSER_ROLE can cancel a pending router change, and cancelling with nothing pending reverts", async () => {
    const { vault, governance, other, pauser, viem } = await setup();
    const candidateRouter = await viem.deployContract("MockSwapRouter");
    await vault.write.proposeRouterAllowed([candidateRouter.address, true], { account: governance.account });

    await assert.rejects(vault.write.cancelRouterAllowedChange([candidateRouter.address], { account: governance.account }));
    await assert.rejects(vault.write.cancelRouterAllowedChange([candidateRouter.address], { account: other.account }));

    const neverProposedRouter = await viem.deployContract("MockSwapRouter");
    await assert.rejects(vault.write.cancelRouterAllowedChange([neverProposedRouter.address], { account: pauser.account }));
  });

  it("maxDeposit is uncapped when no capitalLimitRegistry is set, the default in every other test in this file", async () => {
    const { vault, admin } = await setup();
    assert.equal(await vault.read.capitalLimitRegistry(), "0x0000000000000000000000000000000000000000");
    const maxDeposit = await vault.read.maxDeposit([admin.account.address]);
    assert.equal(maxDeposit > parseUnits("1000000000", 18), true);
  });

  it("maxDeposit is capped to exactly the remaining room once a capitalLimitRegistry is wired, and only the factory or GOVERNANCE can wire it", async () => {
    const { vault, roles, admin, governance, other, user1, usdc, viem } = await setup();
    const registry = await viem.deployContract("CapitalLimitRegistry", [roles.address, parseUnits("1000", 18)]);

    await assert.rejects(vault.write.setCapitalLimitRegistry([registry.address], { account: other.account }));

    // admin.account.address is the vault's factory_ per setup() above, so
    // this proves the factory-callable half of the dual gate.
    await vault.write.setCapitalLimitRegistry([registry.address], { account: admin.account });
    assert.equal(await vault.read.capitalLimitRegistry(), getAddress(registry.address));

    // GOVERNANCE can also change it afterwards, e.g. to swap in a smarter
    // Phase 4 registry later without redeploying the vault.
    const registry2 = await viem.deployContract("CapitalLimitRegistry", [roles.address, parseUnits("1000", 18)]);
    await vault.write.setCapitalLimitRegistry([registry2.address], { account: governance.account });
    assert.equal(await vault.read.capitalLimitRegistry(), getAddress(registry2.address));

    await vault.write.deposit([parseUnits("400", 18), user1.account.address], { account: user1.account });
    assert.equal(await vault.read.maxDeposit([user1.account.address]), parseUnits("600", 18));

    // Mint/approve well beyond the remaining room, so the only thing that
    // can block this next deposit is the registry cap itself, not an
    // incidental balance/allowance shortfall.
    await usdc.write.mint([user1.account.address, parseUnits("1000", 18)]);
    await usdc.write.approve([vault.address, parseUnits("2000", 18)], { account: user1.account });
    await assert.rejects(vault.write.deposit([parseUnits("601", 18), user1.account.address], { account: user1.account }));
  });
});
