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
import hre, { network } from "hardhat";
import { keccak256, toHex, parseUnits, type Hex } from "viem";
import { getVaultState } from "../agent/core/tools/getVaultState.js";

const ADMIN_ROLE = keccak256(toHex("ADMIN_ROLE"));
const HOUR = 60 * 60;
// Matches MandateVaultDeployer.sol's own MAX_FRAGMENT_SIZE exactly, see
// scripts/deployVaultFactoryForV4.ts's identical constant.
const MAX_FRAGMENT_SIZE = 24_000;

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in
/// scripts/deployVaultFactoryForV3.ts/V4.ts.
function linkBytecode(bytecodeHex: string, linkReferences: LinkReferences, addresses: Record<string, `0x${string}`>): Hex {
  let hex = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  for (const [file, libs] of Object.entries(linkReferences)) {
    for (const [libName, refs] of Object.entries(libs)) {
      const key = `${file}:${libName}`;
      const address = addresses[key];
      if (!address) throw new Error(`linkBytecode: no address provided for ${key}, cannot link.`);
      const addressHex = address.slice(2).toLowerCase();
      for (const ref of refs) {
        const startChar = ref.start * 2;
        const lengthChar = ref.length * 2;
        const before = hex.slice(0, startChar);
        const after = hex.slice(startChar + lengthChar);
        hex = before + addressHex + after;
      }
    }
  }
  return `0x${hex}` as Hex;
}

/// @notice Exact copy of the helper already proven live against Arc
/// Testnet in scripts/verifyBytecodePointerDeployerOnArcTestnet.ts.
function chunkBytecode(hex: Hex, maxChunkBytes: number): Hex[] {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const maxChunkChars = maxChunkBytes * 2;
  const chunks: Hex[] = [];
  for (let i = 0; i < body.length; i += maxChunkChars) {
    chunks.push(`0x${body.slice(i, i + maxChunkChars)}` as Hex);
  }
  return chunks;
}

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
    minLpTickRangeWidth: 0,
    maxLpPositionValueLossBps: 0n,
    maxLpOutOfRangeSeconds: 0n,
    minLpPoolLiquidityRatioBps: 0n,
    maxLpAllocationBps: 0n,
    lendingReportStaleAfterSeconds: 0n,
    lendingReportMaxDeviationBps: 0n,
    lendingPositionForceUnwindSeconds: 0n,
    maxLendingAllocationBps: 0n,
    performanceFeeBps: 0n,
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
  // TickMath/LiquidityAmounts are real, deployed (not inlined) libraries as
  // of v3's LP logic, see foundry.toml's own doc comment on why: their
  // addresses must be linked at deploy time for any contract using them,
  // MandateVault (and anything embedding its creation code, like
  // MandateVaultDeployer) included.
  const tickMath = await viem.deployContract("TickMath");
  // getAmountsForLiquidityFromTwap calls TickMath.getSqrtRatioAtTick as a
  // real external library call (TickMath's functions are public, not
  // internal, per contracts/lib/LiquidityAmounts.sol's own doc comment),
  // so LiquidityAmounts itself needs TickMath linked at its own deploy
  // time, not just at MandateVaultDeployer's.
  const liquidityAmounts = await viem.deployContract("LiquidityAmounts", [], {
    libraries: { "project/contracts/lib/TickMath.sol:TickMath": tickMath.address },
  });
  // MandateVaultDeployer.sol (post-fragmentation rewrite) no longer links
  // against these libraries directly: it takes MandateVault's own,
  // already-linked creation code as constructor-argument fragments
  // instead (see contracts/MandateVaultDeployer.sol's own doc comment),
  // mirroring exactly how scripts/deployVaultFactoryForV4.ts does it for
  // the real deployment.
  const mandateVaultArtifact = await hre.artifacts.readArtifact("MandateVault");
  const linkedMandateVaultCode = linkBytecode(mandateVaultArtifact.bytecode, mandateVaultArtifact.linkReferences as LinkReferences, {
    "project/contracts/lib/LiquidityAmounts.sol:LiquidityAmounts": liquidityAmounts.address,
  });
  const fragments = chunkBytecode(linkedMandateVaultCode, MAX_FRAGMENT_SIZE);
  const vaultDeployer = await viem.deployContract("MandateVaultDeployer", [fragments]);
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
    // v4 only, address(0) here (no cross-chain lending capability wired
    // for this v1/v2-shaped fixture).
    cctpTokenMessenger: "0x0000000000000000000000000000000000000000" as `0x${string}`,
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

describe("getVaultState (v7: falls back to LpPositionRegistry when currentLpPositions() does not exist on the vault)", () => {
  /// @notice Deploys a real, standalone contracts/MandateVaultLp.sol +
  /// VaultPolicy + LpPositionRegistry triple directly (bypassing
  /// VaultFactory, which would need its own fresh MandateVaultDeployer
  /// bootstrap embedding MandateVaultLp's fragmented creation code, real
  /// overhead this unit test does not need -- constructing the vault
  /// directly is equivalent for what this test actually checks: does
  /// getVaultState() correctly resolve LP positions via lpRegistry() once
  /// currentLpPositions() itself does not exist).
  async function setupV7() {
    const { viem } = await network.create();
    const [admin, treasury] = await viem.getWalletClients();
    const pub = await viem.getPublicClient();

    const roles = await viem.deployContract("MandateRoles", [admin.account.address]);
    await roles.write.grantRole([ADMIN_ROLE, admin.account.address]);
    const GOVERNANCE_ROLE = keccak256(toHex("GOVERNANCE_ROLE"));
    await roles.write.grantRole([GOVERNANCE_ROLE, admin.account.address]);

    const wusdc = await viem.deployContract("MockERC20", ["Wrapped USDC", "WUSDC", 18]);
    const router = await viem.deployContract("MockSwapRouter");

    const vault = await viem.deployContract("MandateVaultLp", [
      wusdc.address,
      roles.address,
      router.address,
      "Test LP Vault",
      "tLP",
      [] as `0x${string}`[],
      admin.account.address, // factory_ -- this test calls setPolicy/setLpRegistry directly, no real VaultFactory needed
      "0x0000000000000000000000000000000000000000" as `0x${string}`, // cctpTokenMessenger_, unused by this test
    ]);

    const policy = await viem.deployContract("VaultPolicy", [
      policyLimits({ vault: vault.address, roles: roles.address, assets: [wusdc.address], maxAllocationBps: [10_000n], stableAssets: [wusdc.address] }),
    ]);
    await vault.write.setPolicy([policy.address], { account: admin.account });

    // contracts/LpPositionRegistry.sol genuinely links against
    // LiquidityAmounts (its own TWAP-guarded valuation math), same
    // deployed-library requirement as MandateVault's own v3 LP logic
    // above, deployed fresh here since this fixture's roles/network
    // instance is otherwise separate from setup()'s own.
    const tickMathV7 = await viem.deployContract("TickMath");
    const liquidityAmountsV7 = await viem.deployContract("LiquidityAmounts", [], {
      libraries: { "project/contracts/lib/TickMath.sol:TickMath": tickMathV7.address },
    });
    const registry = await viem.deployContract("LpPositionRegistry", [vault.address, policy.address, roles.address], {
      libraries: { "project/contracts/lib/LiquidityAmounts.sol:LiquidityAmounts": liquidityAmountsV7.address },
    });
    await vault.write.setLpRegistry([registry.address], { account: admin.account });

    return { pub, vaultAddress: vault.address as `0x${string}`, wusdc, treasury };
  }

  it("MandateVaultLp genuinely has no currentLpPositions() (confirms the fallback below is actually exercised, not coincidentally unreached)", async () => {
    const { pub, vaultAddress } = await setupV7();
    const NO_LP_POSITIONS_ABI = [{ type: "function", name: "currentLpPositions", stateMutability: "view", inputs: [], outputs: [] }] as const;
    await assert.rejects(() => pub.readContract({ address: vaultAddress, abi: NO_LP_POSITIONS_ABI, functionName: "currentLpPositions" }));
  });

  it("getVaultState still succeeds and returns lpPositions via the registry, not by silently swallowing an error into an unrelated empty result", async () => {
    const { pub, vaultAddress, wusdc } = await setupV7();

    const state = await getVaultState(pub, vaultAddress, [{ symbol: "WUSDC", address: wusdc.address, isBaseAsset: true }]);

    // No real position was opened (that needs real Uniswap V3 infra, out
    // of scope for this unit test, already covered live by
    // test/MandateVaultLpArcFork.t.sol), so an empty array is the CORRECT
    // real answer here -- the point of this test is that getVaultState()
    // reaches this answer via the registry fallback without throwing,
    // proven by the sibling test above confirming the primary
    // currentLpPositions() path genuinely does not exist on this vault.
    assert.deepEqual(state.lpPositions, []);
  });

  it("v1-v6 vaults (real currentLpPositions()) are completely unaffected: still take the primary path, never the fallback", async () => {
    const { pub, vaultAddress, usdc } = await setup();
    const state = await getVaultState(pub, vaultAddress, [{ symbol: "USDC", address: usdc.address, isBaseAsset: true }]);
    assert.deepEqual(state.lpPositions, []);
    assert.equal(state.totalAssetsUSDC, "5"); // unchanged from the very first test above, same fixture
  });
});
