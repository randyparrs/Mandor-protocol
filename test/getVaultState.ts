// Regression coverage for the real, live bug found while building
// agent/policy/offchainPolicyCheck.ts: getVaultState used to return
// totalAssetsUSDC/ledgerAmount/valueUSDC as raw, unformatted integers
// (native on-chain decimals, or an internally-rescaled 18-decimal integer)
// instead of the human-readable decimal strings every consumer of
// VaultState actually expects. See agent/core/README.md's postmortem.
//
// Deliberately uses a 6-decimal USDC mock, not the 18-decimal one every
// other Hardhat fixture in this repo uses (test/VaultFactory.ts,
// test/MandateVault.ts): real Arc USDC is 6-decimal (docs/deployments.md),
// and an 18-decimal mock makes the "scale to 18-decimal internally" step a
// no-op, which is exactly how this bug went unnoticed until a real
// deployment. A 6-decimal fixture is the only way this test can actually
// exercise the scaling path and fail loudly if it regresses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, toHex, parseUnits } from "viem";
import { getVaultState } from "../agent/core/tools/getVaultState.js";

const ADMIN_ROLE = keccak256(toHex("ADMIN_ROLE"));
const HOUR = 60 * 60;

function policyLimits(overrides: Record<string, unknown> = {}) {
  return {
    vault: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    roles: "0x0000000000000000000000000000000000000000" as `0x${string}`,
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
  const [admin, treasury] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
  await roles.write.grantRole([ADMIN_ROLE, admin.account.address]);

  // 6 decimals, matching real Arc USDC, not this repo's usual 18-decimal mock.
  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const router = await viem.deployContract("MockSwapRouter");
  const vaultDeployer = await viem.deployContract("MandateVaultDeployer");
  const capitalLimitRegistry = await viem.deployContract("CapitalLimitRegistry", [roles.address, parseUnits("10000", 6)]);
  const factory = await viem.deployContract("VaultFactory", [roles.address, treasury.account.address, vaultDeployer.address, capitalLimitRegistry.address]);
  await vaultDeployer.write.setFactory([factory.address]);

  const seedAmount = parseUnits("5", 6); // 5 USDC, the same real amount docs/deployments.md's live vault seeded with
  await usdc.write.mint([admin.account.address, seedAmount]);
  await usdc.write.approve([factory.address, seedAmount], { account: admin.account });

  const params = {
    usdc: usdc.address,
    initialSwapRouter: router.address,
    name: "Test Vault",
    symbol: "tUSDC",
    otherAssets: [] as `0x${string}`[],
    limits: policyLimits({ assets: [usdc.address], maxAllocationBps: [10_000n], stableAssets: [usdc.address] }),
    seedAmount,
  };
  await factory.write.createVault([params], { account: admin.account });
  const vaultAddress = await factory.read.allVaults([0n]);

  return { pub, vaultAddress, usdc };
}

describe("getVaultState (regression: human-decimal formatting, not raw integers)", () => {
  it("returns totalAssetsUSDC/ledgerAmount/valueUSDC as human-decimal strings for a real 6-decimal USDC vault", async () => {
    const { pub, vaultAddress, usdc } = await setup();

    const state = await getVaultState(pub, vaultAddress, [{ symbol: "USDC", address: usdc.address, isBaseAsset: true }]);

    // The exact bug that shipped: a 5 USDC seed deposit came back as
    // totalAssetsUSDC "5000000" (raw 6-decimal integer) or
    // "5000000000000000000" (18-decimal wei-style), instead of "5". Assert
    // the exact expected human-decimal string, so any regression back to
    // either raw form fails this test immediately.
    assert.equal(state.totalAssetsUSDC, "5");
    assert.equal(state.highWaterMarkUSDC, "5");
    assert.equal(state.holdings.length, 1);
    assert.equal(state.holdings[0].asset, "USDC");
    assert.equal(state.holdings[0].ledgerAmount, "5");
    assert.equal(state.holdings[0].valueUSDC, "5");

    // A structural invariant that holds regardless of which asset/decimals
    // are involved: totalAssetsUSDC must equal the sum of every holding's
    // valueUSDC once both are correctly formatted onto the same scale. If
    // one field were left raw-scale and the other formatted, this would be
    // off by many orders of magnitude, catching the bug even for amounts a
    // pure magnitude/length heuristic could plausibly miss.
    const sumOfHoldings = state.holdings.reduce((sum, h) => sum + Number(h.valueUSDC), 0);
    assert.equal(Number(state.totalAssetsUSDC), sumOfHoldings);
  });

  it("rejects a caller that never marks any asset isBaseAsset, rather than guessing", async () => {
    const { pub, vaultAddress, usdc } = await setup();
    await assert.rejects(() => getVaultState(pub, vaultAddress, [{ symbol: "USDC", address: usdc.address }]));
  });
});
