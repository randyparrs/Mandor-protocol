import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, hexToString } from "viem";

const PAUSER_ROLE = keccak256(toHex("PAUSER_ROLE"));

const USDC = getAddress("0x111111111111111111111111111111111111111a");
const EURC = getAddress("0x222222222222222222222222222222222222222b");

const HOUR = 60 * 60;

function bytes32ToCode(value: string): string {
  return hexToString(value as `0x${string}`, { size: 32 }).replace(/\0+$/, "");
}

function defaultLimits(overrides: Record<string, unknown> = {}) {
  return {
    vault: undefined as unknown as `0x${string}`,
    roles: undefined as unknown as `0x${string}`,
    maxDrawdownBps: 1000n, // 10%
    maxTradesPerDay: 5n,
    minStableAllocationBps: 2000n, // 20%
    oracleMaxStalenessSeconds: BigInt(HOUR),
    oracleMaxDeviationBps: 500n, // 5%
    maxDrawdownSpeedBpsPerWindow: 300n, // 3%
    drawdownSpeedWindowSeconds: BigInt(HOUR),
    autoPauseBountyAmount: 10n,
    assets: [USDC, EURC],
    maxAllocationBps: [10000n, 5000n],
    stableAssets: [USDC],
    ...overrides,
  };
}

function freshPrice(price: bigint, referencePrice: bigint, updatedAt: bigint, asset: `0x${string}` = USDC) {
  return { asset, price, referencePrice, updatedAt };
}

function holding(asset: `0x${string}`, bps: number) {
  return { asset, currentAllocationBps: bps };
}

const HOLD = 0;
const REBALANCE = 1;
const ENTER = 2;
const EMERGENCY_EXIT_TO_STABLE = 4;

function decision(action: number, overrides: Record<string, unknown> = {}) {
  return { action, asset: USDC, amount: 0n, targetAllocations: [], ...overrides };
}

async function setup() {
  const { viem } = await network.create();
  const [admin, pauser, other] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
  await roles.write.grantRole([PAUSER_ROLE, pauser.account.address]);

  const mockVault = await viem.deployContract("MockVault");

  const limits = defaultLimits({ vault: mockVault.address, roles: roles.address });
  const policy = await viem.deployContract("VaultPolicy", [limits]);

  return { viem, pub, admin, pauser, other, roles, mockVault, policy, limits };
}

async function nowSeconds(pub: Awaited<ReturnType<typeof setup>>["pub"]) {
  const block = await pub.getBlock();
  return block.timestamp;
}

describe("VaultPolicy", () => {
  it("passes a compliant decision with no violations", async () => {
    const { policy, pub } = await setup();
    const ts = await nowSeconds(pub);
    const state = {
      currentDrawdownBps: 100,
      drawdownBpsAtWindowStart: 90,
      tradesToday: 0n,
      currentHoldings: [holding(USDC, 6000), holding(EURC, 4000)],
      prices: [freshPrice(100n, 101n, ts)],
    };
    const [passed, codes] = await policy.read.validateDecision([decision(REBALANCE), state]);
    assert.equal(passed, true);
    assert.equal(codes.length, 0);
  });

  it("flags MAX_ALLOCATION_EXCEEDED when an asset exceeds its cap", async () => {
    const { policy } = await setup();
    const state = {
      currentDrawdownBps: 0,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      // EURC capped at 5000 bps in defaultLimits; 6000 violates it.
      currentHoldings: [holding(USDC, 4000), holding(EURC, 6000)],
      prices: [],
    };
    const [passed, codes] = await policy.read.validateDecision([decision(REBALANCE), state]);
    assert.equal(passed, false);
    assert.ok(codes.map(bytes32ToCode).includes("MAX_ALLOCATION_EXCEEDED"));
  });

  it("flags MIN_STABLE_ALLOCATION_VIOLATED when stable weight is too low", async () => {
    const { policy } = await setup();
    const state = {
      currentDrawdownBps: 0,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      // USDC (the only stable asset) at 1000 bps, below the 2000 bps minimum.
      currentHoldings: [holding(USDC, 1000), holding(EURC, 9000)],
      prices: [],
    };
    const [passed, codes] = await policy.read.validateDecision([decision(REBALANCE), state]);
    assert.equal(passed, false);
    assert.ok(codes.map(bytes32ToCode).includes("MIN_STABLE_ALLOCATION_VIOLATED"));
  });

  it("flags MAX_DRAWDOWN_EXCEEDED when drawdown exceeds the limit", async () => {
    const { policy } = await setup();
    const state = {
      currentDrawdownBps: 2000, // exceeds maxDrawdownBps = 1000
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      currentHoldings: [],
      prices: [],
    };
    const [passed, codes] = await policy.read.validateDecision([decision(HOLD), state]);
    assert.equal(passed, false);
    assert.ok(codes.map(bytes32ToCode).includes("MAX_DRAWDOWN_EXCEEDED"));
  });

  it("flags MAX_TRADES_PER_DAY_EXCEEDED for a trade action, but not for HOLD", async () => {
    const { policy } = await setup();
    const state = {
      currentDrawdownBps: 0,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 5n, // equals maxTradesPerDay = 5
      // Otherwise fully compliant, so only the trades-per-day check differs
      // between the two actions below.
      currentHoldings: [holding(USDC, 10000)],
      prices: [],
    };
    const [tradePassed] = await policy.read.validateDecision([decision(ENTER, { amount: 1n }), state]);
    assert.equal(tradePassed, false);

    const [holdPassed] = await policy.read.validateDecision([decision(HOLD), state]);
    assert.equal(holdPassed, true);
  });

  it("flags ORACLE_STALE and ORACLE_DEVIATION_EXCEEDED", async () => {
    const { policy, pub } = await setup();
    const ts = await nowSeconds(pub);

    const staleState = {
      currentDrawdownBps: 0,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      currentHoldings: [],
      prices: [freshPrice(100n, 100n, ts - BigInt(HOUR * 2))],
    };
    const [stalePassed, staleCodes] = await policy.read.validateDecision([decision(HOLD), staleState]);
    assert.equal(stalePassed, false);
    assert.ok(staleCodes.map(bytes32ToCode).includes("ORACLE_STALE"));

    const deviatedState = {
      currentDrawdownBps: 0,
      drawdownBpsAtWindowStart: 0,
      tradesToday: 0n,
      currentHoldings: [],
      // 20% deviation, exceeds oracleMaxDeviationBps = 5%
      prices: [freshPrice(120n, 100n, ts)],
    };
    const [deviatedPassed, deviatedCodes] = await policy.read.validateDecision([decision(HOLD), deviatedState]);
    assert.equal(deviatedPassed, false);
    assert.ok(deviatedCodes.map(bytes32ToCode).includes("ORACLE_DEVIATION_EXCEEDED"));
  });

  it("flags VAULT_PAUSED for ordinary actions once paused, but EMERGENCY_EXIT_TO_STABLE always passes", async () => {
    const { policy, pauser } = await setup();
    await policy.write.pause({ account: pauser.account });

    const state = {
      currentDrawdownBps: 9999, // deliberately terrible, to prove the emergency exit ignores it
      drawdownBpsAtWindowStart: 0,
      tradesToday: 999n,
      currentHoldings: [],
      prices: [],
    };

    const [holdPassed, holdCodes] = await policy.read.validateDecision([decision(HOLD), state]);
    assert.equal(holdPassed, false);
    assert.ok(holdCodes.map(bytes32ToCode).includes("VAULT_PAUSED"));

    const [emergencyPassed, emergencyCodes] = await policy.read.validateDecision([
      decision(EMERGENCY_EXIT_TO_STABLE),
      state,
    ]);
    assert.equal(emergencyPassed, true);
    assert.equal(emergencyCodes.length, 0);
  });

  it("only PAUSER_ROLE can pause or unpause", async () => {
    const { policy, other } = await setup();
    await assert.rejects(policy.write.pause({ account: other.account }));
  });

  describe("checkAndAutoPause", () => {
    it("does nothing when no trigger condition is met", async () => {
      const { policy, pub } = await setup();
      const ts = await nowSeconds(pub);
      const state = {
        currentDrawdownBps: 100,
        drawdownBpsAtWindowStart: 90,
        tradesToday: 0n,
        currentHoldings: [],
        prices: [freshPrice(100n, 101n, ts)],
      };
      const { result } = await policy.simulate.checkAndAutoPause([state]);
      assert.equal(result[0], false);
      assert.equal(await policy.read.paused(), false);
    });

    it("pauses and pays the bounty when the payout succeeds", async () => {
      const { policy, mockVault, other } = await setup();
      const state = {
        currentDrawdownBps: 500,
        drawdownBpsAtWindowStart: 0, // speed 500 > maxDrawdownSpeedBpsPerWindow (300)
        tradesToday: 0n,
        currentHoldings: [],
        prices: [],
      };
      await policy.write.checkAndAutoPause([state], { account: other.account });
      assert.equal(await policy.read.paused(), true);
      assert.equal(await mockVault.read.payoutCallCount(), 1n);
      assert.equal(getAddress(await mockVault.read.lastPaidTo()), getAddress(other.account.address));
    });

    it("still pauses even when the bounty payout reverts", async () => {
      const { policy, pub, mockVault, other } = await setup();
      await mockVault.write.setShouldRevertPayout([true]);
      const state = {
        currentDrawdownBps: 500,
        drawdownBpsAtWindowStart: 0,
        tradesToday: 0n,
        currentHoldings: [],
        prices: [],
      };
      const hash = await policy.write.checkAndAutoPause([state], { account: other.account });
      const receipt = await pub.getTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", "the outer transaction must not revert");
      assert.equal(await policy.read.paused(), true, "pause must stand even if the bounty payout reverted");
      // A revert inside MockVault rolls back its own state (payoutCallCount
      // included) by EVM design, so the real evidence the payout was
      // attempted-and-failed is that lastPaidTo was never actually set.
      assert.equal(
        await mockVault.read.lastPaidTo(),
        "0x0000000000000000000000000000000000000000",
        "the reverted payout must never have persisted a recipient",
      );
    });

    it("reverts if called again once already paused", async () => {
      const { policy, other } = await setup();
      const state = {
        currentDrawdownBps: 500,
        drawdownBpsAtWindowStart: 0,
        tradesToday: 0n,
        currentHoldings: [],
        prices: [],
      };
      await policy.write.checkAndAutoPause([state], { account: other.account });
      await assert.rejects(policy.write.checkAndAutoPause([state], { account: other.account }));
    });

    it("previewAutoPause matches checkAndAutoPause without changing state", async () => {
      const { policy, other } = await setup();
      const state = {
        currentDrawdownBps: 500,
        drawdownBpsAtWindowStart: 0,
        tradesToday: 0n,
        currentHoldings: [],
        prices: [],
      };
      const [triggered, code] = await policy.read.previewAutoPause([state]);
      assert.equal(triggered, true);
      assert.equal(await policy.read.paused(), false, "preview must not mutate state");

      const { result } = await policy.simulate.checkAndAutoPause([state], { account: other.account });
      assert.equal(result[0], triggered);
      assert.equal(result[1], code);
    });
  });
});
