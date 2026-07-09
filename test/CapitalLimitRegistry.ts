import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, toHex, parseUnits } from "viem";

const ADMIN_ROLE = keccak256(toHex("ADMIN_ROLE"));
const PAUSER_ROLE = keccak256(toHex("PAUSER_ROLE"));

async function setup() {
  const { viem } = await network.create();
  const [admin, pauser, other] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
  await roles.write.grantRole([ADMIN_ROLE, admin.account.address]);
  await roles.write.grantRole([PAUSER_ROLE, pauser.account.address]);
  const registry = await viem.deployContract("CapitalLimitRegistry", [roles.address, parseUnits("10000", 18)]);

  return { viem, pub, admin, pauser, other, roles, registry };
}

describe("CapitalLimitRegistry", () => {
  it("constructor sets the initial value", async () => {
    const { registry } = await setup();
    assert.equal(await registry.read.maxTotalAssetsValue(), parseUnits("10000", 18));
  });

  it("every vault sees the same value", async () => {
    const { registry, admin, other } = await setup();
    assert.equal(await registry.read.maxTotalAssets([admin.account.address]), parseUnits("10000", 18));
    assert.equal(await registry.read.maxTotalAssets([other.account.address]), parseUnits("10000", 18));
  });

  it("only ADMIN_ROLE can propose a maxTotalAssets change", async () => {
    const { registry, other } = await setup();
    await assert.rejects(registry.write.proposeMaxTotalAssets([parseUnits("5000", 18)], { account: other.account }));
  });

  it("a maxTotalAssets change is never instantaneous, and cannot execute before the 48h timelock elapses", async () => {
    const { registry, admin, other, pub } = await setup();
    await registry.write.proposeMaxTotalAssets([parseUnits("5000", 18)], { account: admin.account });
    await assert.rejects(registry.write.executeMaxTotalAssets({ account: other.account }));

    const timelock = await registry.read.MAX_TOTAL_ASSETS_TIMELOCK();
    const ts = (await pub.getBlock()).timestamp;
    await pub.request({ method: "evm_setNextBlockTimestamp" as any, params: [`0x${(ts + timelock + 1n).toString(16)}`] as any });
    await registry.write.executeMaxTotalAssets({ account: other.account });

    assert.equal(await registry.read.maxTotalAssetsValue(), parseUnits("5000", 18));
  });

  it("PAUSER_ROLE can cancel a pending change before it executes, and only PAUSER_ROLE can cancel", async () => {
    const { registry, admin, pauser, other } = await setup();
    await registry.write.proposeMaxTotalAssets([parseUnits("5000", 18)], { account: admin.account });

    await assert.rejects(registry.write.cancelMaxTotalAssets({ account: admin.account }));
    await assert.rejects(registry.write.cancelMaxTotalAssets({ account: other.account }));

    await registry.write.cancelMaxTotalAssets({ account: pauser.account });
    await assert.rejects(registry.write.executeMaxTotalAssets({ account: other.account }));
    assert.equal(await registry.read.maxTotalAssetsValue(), parseUnits("10000", 18), "a cancelled change must never take effect");
  });

  it("cancelling with nothing pending reverts", async () => {
    const { registry, pauser } = await setup();
    await assert.rejects(registry.write.cancelMaxTotalAssets({ account: pauser.account }));
  });
});
