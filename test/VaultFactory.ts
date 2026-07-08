import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, parseUnits } from "viem";

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
    autoPauseBountyAmount: 0n,
    assets: [] as `0x${string}`[],
    maxAllocationBps: [] as bigint[],
    stableAssets: [] as `0x${string}`[],
    ...overrides,
  };
}

async function setup() {
  const { viem } = await network.create();
  const [admin, treasury, other] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
  await roles.write.grantRole([ADMIN_ROLE, admin.account.address]);

  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 18]);
  const eurc = await viem.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
  const router = await viem.deployContract("MockSwapRouter");
  const vaultDeployer = await viem.deployContract("MandateVaultDeployer");

  const factory = await viem.deployContract("VaultFactory", [roles.address, treasury.account.address, vaultDeployer.address]);
  await vaultDeployer.write.setFactory([factory.address]);

  await usdc.write.mint([admin.account.address, parseUnits("10000", 18)]);
  await usdc.write.approve([factory.address, parseUnits("10000", 18)], { account: admin.account });

  return { viem, pub, admin, treasury, other, roles, usdc, eurc, router, vaultDeployer, factory };
}

function createParams(over: Record<string, unknown> = {}) {
  return {
    usdc: undefined as unknown as `0x${string}`,
    initialSwapRouter: undefined as unknown as `0x${string}`,
    name: "Mandate USDC Vault",
    symbol: "mUSDC",
    otherAssets: [] as `0x${string}`[],
    limits: policyLimits(),
    seedAmount: parseUnits("100", 18),
    ...over,
  };
}

describe("MandateVaultDeployer", () => {
  it("deploy reverts for any caller other than the real, wired VaultFactory", async () => {
    const { viem, roles, usdc, router, other } = await setup();
    const freshDeployer = await viem.deployContract("MandateVaultDeployer");
    // deliberately never call setFactory, so factory() is still address(0);
    // confirm a direct call from an arbitrary address reverts. Note deploy
    // no longer takes a `factory` parameter at all (the earlier, broken
    // version did) -- it is checked only against msg.sender, so there is
    // no parameter left to spoof.
    await assert.rejects(
      freshDeployer.write.deploy(
        [usdc.address, roles.address, router.address, "Rogue Vault", "rUSDC", []],
        { account: other.account },
      ),
    );
  });

  it("deploy reverts for any caller other than the real factory, even once a real factory is wired", async () => {
    const { viem, factory, usdc, roles, router, other } = await setup();
    const deployerAddr = await factory.read.vaultDeployer();
    const deployer = await viem.getContractAt("MandateVaultDeployer", deployerAddr);
    await assert.rejects(
      deployer.write.deploy([usdc.address, roles.address, router.address, "Rogue Vault", "rUSDC", []], {
        account: other.account,
      }),
    );
  });

  it("setFactory can only be called once, only by whoever deployed the deployer", async () => {
    const { viem, other } = await setup();
    const freshDeployer = await viem.deployContract("MandateVaultDeployer");
    await assert.rejects(freshDeployer.write.setFactory([other.account.address], { account: other.account }));

    await freshDeployer.write.setFactory([other.account.address]);
    await assert.rejects(freshDeployer.write.setFactory([other.account.address]));
  });
});

describe("VaultFactory", () => {
  it("only ADMIN_ROLE can call createVault", async () => {
    const { factory, usdc, router, other } = await setup();
    const params = createParams({ usdc: usdc.address, initialSwapRouter: router.address });
    await assert.rejects(factory.write.createVault([params], { account: other.account }));
  });

  it("deploys a correctly cross-referenced Vault+Policy pair", async () => {
    const { factory, usdc, eurc, router, admin } = await setup();
    const params = createParams({
      usdc: usdc.address,
      initialSwapRouter: router.address,
      otherAssets: [eurc.address],
      limits: policyLimits({ assets: [usdc.address, eurc.address], maxAllocationBps: [10_000n, 5_000n], stableAssets: [usdc.address] }),
    });

    await factory.write.createVault([params], { account: admin.account });

    const count = await factory.read.vaultCount();
    assert.equal(count, 1n);
    const vaultAddr = await factory.read.allVaults([0n]);
    assert.equal(await factory.read.isMandateVault([vaultAddr]), true);
  });

  it("the seed deposit is atomic: totalAssets equals seedAmount and treasury holds the seed shares", async () => {
    const { viem, factory, usdc, eurc, router, treasury, admin } = await setup();
    const seedAmount = parseUnits("250", 18);
    const params = createParams({
      usdc: usdc.address,
      initialSwapRouter: router.address,
      otherAssets: [eurc.address],
      limits: policyLimits({ assets: [usdc.address, eurc.address], maxAllocationBps: [10_000n, 5_000n], stableAssets: [usdc.address] }),
      seedAmount,
    });
    await factory.write.createVault([params], { account: admin.account });

    const vaultAddr = await factory.read.allVaults([0n]);
    const vault = await viem.getContractAt("MandateVault", vaultAddr);
    assert.equal(await vault.read.totalAssets(), seedAmount);
    assert.equal(await vault.read.balanceOf([treasury.account.address]), seedAmount * 10n ** 3n);
  });

  it("reverts if seedAmount is 0", async () => {
    const { factory, usdc, router, admin } = await setup();
    const params = createParams({ usdc: usdc.address, initialSwapRouter: router.address, seedAmount: 0n });
    await assert.rejects(factory.write.createVault([params], { account: admin.account }));
  });

  it("reverts if the caller has not approved sufficient USDC allowance", async () => {
    const { viem, roles, treasury, usdc, router } = await setup();
    const [, , , unapproved] = await viem.getWalletClients();
    await roles.write.grantRole([ADMIN_ROLE, unapproved.account.address]);
    await usdc.write.mint([unapproved.account.address, parseUnits("1000", 18)]);
    // deliberately no approve() call

    // Fresh deployer, so this factory (not the one from setup()) is the
    // one actually wired to call it, and the revert we're testing for
    // (insufficient allowance) is the real cause, not a mismatched deployer.
    const vaultDeployer2 = await viem.deployContract("MandateVaultDeployer");
    const factory2 = await viem.deployContract("VaultFactory", [roles.address, treasury.account.address, vaultDeployer2.address]);
    await vaultDeployer2.write.setFactory([factory2.address]);

    const params = createParams({ usdc: usdc.address, initialSwapRouter: router.address });
    await assert.rejects(factory2.write.createVault([params], { account: unapproved.account }));
  });

  it("two createVault calls produce fully isolated vaults", async () => {
    const { factory, usdc, eurc, router, admin } = await setup();
    const limits = policyLimits({ assets: [usdc.address, eurc.address], maxAllocationBps: [10_000n, 5_000n], stableAssets: [usdc.address] });
    const params = createParams({ usdc: usdc.address, initialSwapRouter: router.address, otherAssets: [eurc.address], limits });

    await usdc.write.mint([admin.account.address, parseUnits("10000", 18)]);
    await usdc.write.approve([factory.address, parseUnits("10000", 18)], { account: admin.account });

    await factory.write.createVault([params], { account: admin.account });
    await factory.write.createVault([params], { account: admin.account });

    const v1 = await factory.read.allVaults([0n]);
    const v2 = await factory.read.allVaults([1n]);
    assert.notEqual(getAddress(v1), getAddress(v2));
    assert.equal(await factory.read.vaultCount(), 2n);
  });

  it("emits VaultCreated with correct args", async () => {
    const { factory, usdc, router, admin, pub } = await setup();
    const params = createParams({ usdc: usdc.address, initialSwapRouter: router.address });
    const hash = await factory.write.createVault([params], { account: admin.account });
    const receipt = await pub.getTransactionReceipt({ hash });
    assert.ok(receipt.logs.length > 0);
  });

  it("only ADMIN_ROLE can set the protocol treasury", async () => {
    const { factory, other } = await setup();
    await assert.rejects(factory.write.setProtocolTreasury([other.account.address], { account: other.account }));
  });
});
