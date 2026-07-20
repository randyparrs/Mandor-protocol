// Deploys a fresh MandateVaultDeployer+VaultFactory pair, reusing the
// already-deployed, unaffected MandateRoles/CapitalLimitRegistry/
// protocolTreasury as-is (all verified live below, not assumed).
//
// Why this is needed: the real, already-deployed VaultFactory
// (0xb6B77A2978B1974097727e267BCaAC35ba7ddf12, used to create v1 and v2)
// predates v3's 5 new VaultPolicy.ConstructorLimits fields
// (minLpTickRangeWidth/maxLpPositionValueLossBps/maxLpOutOfRangeSeconds/
// minLpPoolLiquidityRatioBps/maxLpAllocationBps). Confirmed live, not
// guessed: its real deployed bytecode (11,237 bytes via eth_getCode) does
// not match current VaultFactory.sol source (12,243 bytes compiled), and
// replaying its real createVault calldata against a local fork reverts
// immediately at 212 gas, the signature of "no matching function
// selector," since CreateVaultParams.limits' encoded shape changed. The
// existing MandateVaultDeployer can't simply be pointed at a new
// VaultFactory either: its own `factory` field is set exactly once,
// forever (confirmed by reading MandateVaultDeployer.sol's setFactory:
// `if (factory != address(0)) revert FactoryAlreadySet();`), and it is
// already non-zero (the old VaultFactory's address). So both contracts
// need a fresh pair, mirroring the original bootstrap sequence in
// scripts/deployArcTestnet.ts exactly (deploy MandateVaultDeployer,
// deploy VaultFactory referencing it, call setFactory once).
//
// Also deploys TickMath and LiquidityAmounts for the first time on the
// real chain: discovered live (MandateVaultDeployer's own creation
// bytecode, which embeds MandateVault's full creation bytecode, still
// contains an unresolved `__$...$__` library-linking placeholder for
// LiquidityAmounts, and LiquidityAmounts' own bytecode has one for
// TickMath in turn), these v3 LP math libraries were only ever deployed
// to ephemeral local/forked test state (every Foundry/Hardhat test run
// deploys fresh copies that vanish afterward), never to the real chain,
// since v1/v2 predate them entirely. Real link order: TickMath first (no
// dependencies), then LiquidityAmounts (linked against TickMath), then
// MandateVaultDeployer (linked against LiquidityAmounts).
//
// Confirmed safe for v1/v2 before running this (see docs/deployments.md's
// own new section on this): MandateVault.sol's `factory` field is used at
// runtime in exactly two places, setPolicy (onlyFactory, but already
// permanently consumed for both live vaults, policy != address(0)) and
// setCapitalLimitRegistry (onlyFactory OR GOVERNANCE_ROLE, so GOVERNANCE
// always has an independent path regardless of the old factory's fate).
// VaultPolicy.sol and MandateRoles.sol never reference VaultFactory at
// all. Two VaultFactory instances coexisting onchain, one having created
// v1/v2 and a new one only ever creating v3+, is fully safe.
//
// Needs NO privileged role at all: MandateVaultDeployer's constructor
// just records msg.sender, VaultFactory's constructor takes plain
// addresses, TickMath/LiquidityAmounts are permissionless libraries. Run
// with the dedicated, freshly-generated
// FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY (scripts/generateFactoryBootstrapWallet.ts),
// never KEEPER_PRIVATE_KEY or the real admin key, holds no authority
// anywhere else in this project. The real ADMIN key is only needed
// afterward, once, for the actual createVault call
// (scripts/deployVaultV3.ts, updated separately to point at the new
// factory address this script outputs).
//
// Plain viem, no Hardhat network/account config dependency, same pattern
// scripts/deployTestTokens.ts already uses for a freshly-generated,
// not-in-hardhat-config key: reads compiled artifacts directly from
// forge-out/.
//
// Run with: node --import tsx scripts/deployVaultFactoryForV3.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

// ---------------------------------------------------------------------
// Real, already-deployed, unaffected addresses, cross-checked live
// against the real (old) VaultFactory below, not assumed.
// ---------------------------------------------------------------------
const MANDATE_ROLES_ADDRESS = "0x91dC937Cf24cD84B415A1B9AD2f520834334504a" as const;
const CAPITAL_LIMIT_REGISTRY_ADDRESS = "0x83983fd592168391303141DB723FfCB463D25081" as const;
const PROTOCOL_TREASURY_ADDRESS = "0x884687C973e9b7Af697dC34Aed1F09Da06BC4253" as const;
const OLD_VAULT_FACTORY_ADDRESS = "0xb6B77A2978B1974097727e267BCaAC35ba7ddf12" as const;

const OLD_FACTORY_ABI = [
  { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "capitalLimitRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const DEPLOYER_ABI = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "setFactory", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
] as const;

const FACTORY_STATE_ABI = [
  { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "capitalLimitRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// The real Arc Testnet public RPC enforces a tight per-request rate
// limit (confirmed live: a single isolated call succeeds, but two reads
// fired back-to-back trip "request limit reached", HTTP 429, code
// -32011). A short pause between every RPC call, reads included, is
// required, not optional, for this script to complete at all.
const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Substitutes every unresolved `__$<hash>$__` library-linking
/// placeholder in a raw creation-bytecode hex string with a real deployed
/// address, using the artifact's own linkReferences (exact byte offsets,
/// never a blind string replace that could miss or over-match). Standard
/// Solidity linking, done manually here since this script reads compiled
/// artifacts directly (see this file's own top-of-file note), not via
/// Hardhat's own libraries option.
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

async function main() {
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY is not set. Run scripts/generateFactoryBootstrapWallet.ts first.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Bootstrap deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Native balance: ${balance.toString()} raw (18 decimals). Needs enough for ~5 real transactions' gas.`);
  if (balance === 0n) {
    throw new Error(`${account.address} has zero balance. Fund it with real Arc Testnet gas (standard faucet) and re-run.`);
  }

  // Live cross-check against the real, already-deployed old factory,
  // never trusting the hardcoded constants above alone. Paced (see
  // RPC_PACING_MS's own doc comment), the real public RPC's rate limit
  // is tight enough that two reads fired back-to-back reliably trip it.
  await sleep(RPC_PACING_MS);
  const liveRoles = await publicClient.readContract({ address: OLD_VAULT_FACTORY_ADDRESS, abi: OLD_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const liveTreasury = await publicClient.readContract({ address: OLD_VAULT_FACTORY_ADDRESS, abi: OLD_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const liveRegistry = await publicClient.readContract({ address: OLD_VAULT_FACTORY_ADDRESS, abi: OLD_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  console.log(`Live-verified from the old factory: roles=${liveRoles}, protocolTreasury=${liveTreasury}, capitalLimitRegistry=${liveRegistry}`);
  if (
    liveRoles.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    liveTreasury.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    liveRegistry.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("Live values read from the old VaultFactory do not match the hardcoded constants above. Stopping, do not proceed with mismatched addresses.");
  }

  async function deployRaw(label: string, abi: readonly unknown[], bytecode: Hex, gas: bigint): Promise<`0x${string}`> {
    const hash = await walletClient.deployContract({ abi: abi as [], bytecode, args: [], chain: ARC_TESTNET, account, gas });
    await sleep(RPC_PACING_MS);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${label} deployment failed or produced no contract address (tx ${hash}). Stopping, do not continue.`);
    }
    console.log(`${label}: ${receipt.contractAddress} (tx ${hash})`);
    return receipt.contractAddress;
  }

  async function confirm(txHashPromise: Promise<Hex>, label: string) {
    const hash = await txHashPromise;
    await sleep(RPC_PACING_MS);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} reverted (tx ${hash}). Stopping, do not continue.`);
    }
    console.log(`${label}: ${hash}`);
    return receipt;
  }

  // 1. Deploy TickMath, standalone, no library dependencies of its own
  // (confirmed: empty linkReferences).
  await sleep(RPC_PACING_MS);
  const tickMathArtifact = await import("../forge-out/TickMath.sol/TickMath.json", { with: { type: "json" } });
  const tickMathAddress = await deployRaw("New TickMath", tickMathArtifact.default.abi, tickMathArtifact.default.bytecode.object as Hex, 3_000_000n);

  // 2. Deploy LiquidityAmounts, linked against the real TickMath address
  // just deployed.
  await sleep(RPC_PACING_MS);
  const liquidityAmountsArtifact = await import("../forge-out/LiquidityAmounts.sol/LiquidityAmounts.json", { with: { type: "json" } });
  const liquidityAmountsLinked = linkBytecode(liquidityAmountsArtifact.default.bytecode.object, liquidityAmountsArtifact.default.bytecode.linkReferences, {
    "contracts/lib/TickMath.sol:TickMath": tickMathAddress,
  });
  const liquidityAmountsAddress = await deployRaw("New LiquidityAmounts", liquidityAmountsArtifact.default.abi, liquidityAmountsLinked, 3_000_000n);

  // 3. Deploy a fresh MandateVaultDeployer, linked against the real
  // LiquidityAmounts address just deployed (its own creation bytecode
  // embeds MandateVault's full creation bytecode, which references
  // LiquidityAmounts). No constructor args, no privileged role needed
  // (deployer = msg.sender only).
  await sleep(RPC_PACING_MS);
  const deployerArtifact = await import("../forge-out/MandateVaultDeployer.sol/MandateVaultDeployer.json", { with: { type: "json" } });
  const deployerLinked = linkBytecode(deployerArtifact.default.bytecode.object, deployerArtifact.default.bytecode.linkReferences, {
    "contracts/lib/LiquidityAmounts.sol:LiquidityAmounts": liquidityAmountsAddress,
  });
  const deployerAddress = await deployRaw("New MandateVaultDeployer", deployerArtifact.default.abi, deployerLinked, 6_000_000n);

  // 4. Deploy a fresh VaultFactory (no library dependencies, confirmed:
  // empty linkReferences), reusing the existing roles/treasury/registry,
  // referencing the new deployer.
  await sleep(RPC_PACING_MS);
  const factoryArtifact = await import("../forge-out/VaultFactory.sol/VaultFactory.json", { with: { type: "json" } });
  const factoryHash = await walletClient.deployContract({
    abi: factoryArtifact.default.abi,
    bytecode: factoryArtifact.default.bytecode.object as Hex,
    args: [MANDATE_ROLES_ADDRESS, PROTOCOL_TREASURY_ADDRESS, deployerAddress, CAPITAL_LIMIT_REGISTRY_ADDRESS],
    chain: ARC_TESTNET,
    account,
    // Explicit gas, bypassing eth_estimateGas: the real public RPC
    // rejects gas estimation for large creation payloads with "Invalid
    // parameters were provided to the RPC method," confirmed live.
    gas: 6_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  const factoryAddress = factoryReceipt.contractAddress;
  if (!factoryAddress) throw new Error("VaultFactory deployment produced no contract address.");
  console.log(`New VaultFactory: ${factoryAddress} (tx ${factoryHash})`);

  // 5. Wire them together, exactly once, real permissionless-by-caller
  // check enforced onchain (only the account that deployed the new
  // MandateVaultDeployer can call this).
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: deployerAddress, abi: DEPLOYER_ABI, functionName: "setFactory", args: [factoryAddress], chain: ARC_TESTNET, account }),
    `setFactory(${factoryAddress}) on the new MandateVaultDeployer`,
  );

  // Read-only verification, never assumed: confirm the wiring actually
  // landed as intended.
  await sleep(RPC_PACING_MS);
  const liveFactoryOnDeployer = await publicClient.readContract({ address: deployerAddress, abi: DEPLOYER_ABI, functionName: "factory" });
  await sleep(RPC_PACING_MS);
  const liveRolesOnNewFactory = await publicClient.readContract({ address: factoryAddress, abi: FACTORY_STATE_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const liveTreasuryOnNewFactory = await publicClient.readContract({ address: factoryAddress, abi: FACTORY_STATE_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const liveRegistryOnNewFactory = await publicClient.readContract({ address: factoryAddress, abi: FACTORY_STATE_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const liveDeployerOnNewFactory = await publicClient.readContract({ address: factoryAddress, abi: FACTORY_STATE_ABI, functionName: "vaultDeployer" });
  console.log(
    `Verified onchain: new deployer's factory=${liveFactoryOnDeployer}, new factory's roles=${liveRolesOnNewFactory}, ` +
      `protocolTreasury=${liveTreasuryOnNewFactory}, capitalLimitRegistry=${liveRegistryOnNewFactory}, vaultDeployer=${liveDeployerOnNewFactory}`,
  );
  if (
    liveFactoryOnDeployer.toLowerCase() !== factoryAddress.toLowerCase() ||
    liveRolesOnNewFactory.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    liveTreasuryOnNewFactory.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    liveRegistryOnNewFactory.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase() ||
    liveDeployerOnNewFactory.toLowerCase() !== deployerAddress.toLowerCase()
  ) {
    throw new Error("Live wiring does not match what was requested. Do not treat this bootstrap as complete.");
  }

  console.log("\n=== New VaultFactory bootstrap summary ===");
  console.log(`MandateRoles (reused):          ${MANDATE_ROLES_ADDRESS}`);
  console.log(`CapitalLimitRegistry (reused):  ${CAPITAL_LIMIT_REGISTRY_ADDRESS}`);
  console.log(`protocolTreasury (reused):      ${PROTOCOL_TREASURY_ADDRESS}`);
  console.log(`New TickMath:                   ${tickMathAddress}`);
  console.log(`New LiquidityAmounts:           ${liquidityAmountsAddress}`);
  console.log(`New MandateVaultDeployer:       ${deployerAddress}`);
  console.log(`New VaultFactory:               ${factoryAddress}`);
  console.log(`\nOld VaultFactory (${OLD_VAULT_FACTORY_ADDRESS}) is untouched, still owns v1 and v2, never used again for new vaults.`);
  console.log(`Next: update scripts/deployVaultV3.ts's VAULT_FACTORY_ADDRESS to ${factoryAddress}, then run it with the real ADMIN key.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
