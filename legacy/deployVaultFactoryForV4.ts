// Deploys a fresh MandateVaultDeployer+VaultFactory pair for v4, reusing
// the already-deployed, unaffected MandateRoles/CapitalLimitRegistry/
// protocolTreasury/LiquidityAmounts as-is (all verified live below, not
// assumed) -- same bootstrap shape already proven for v3
// (scripts/deployVaultFactoryForV3.ts), with two real differences:
//
// 1. MandateVaultDeployer's constructor now takes FRAGMENTS
//    (bytes[] memory), not a single bytes blob: a single BytecodePointer
//    is itself bound by the same EIP-170 24,576-byte limit this whole
//    mechanism exists to route around for MandateVault, and MandateVault's
//    real creation code (26,576 bytes as of this v4 addition) is over
//    that limit. Confirmed live via `cast run` on Arc Testnet
//    (CreateContractSizeLimit, not a gas problem), then fixed and
//    independently re-verified live (every fragment's eth_getCode +
//    the full reconstruction, byte for byte) before being trusted here.
//    See contracts/MandateVaultDeployer.sol and
//    test/MandateVaultDeployerBytecode.t.sol.
// 2. TickMath does NOT need to be redeployed (v4 doesn't touch LP math);
//    only LiquidityAmounts (already real and deployed from v3's own
//    bootstrap) needs linking into MandateVault's creation code.
//
// Why a new VaultFactory is needed at all, same reasoning as v3's own
// bootstrap: v4's ConstructorLimits gained 4 new lending-specific fields
// (lendingReportStaleAfterSeconds/lendingReportMaxDeviationBps/
// lendingPositionForceUnwindSeconds/maxLendingAllocationBps), so the real,
// already-deployed v3 VaultFactory's createVault ABI no longer matches
// current source.
//
// Confirmed safe for v1/v2/v3 before running this, same verification
// already done twice before: MandateVault.sol's `factory` field is used
// at runtime in exactly two places (setPolicy, onlyFactory but already
// permanently consumed for every live vault; setCapitalLimitRegistry,
// onlyFactory OR GOVERNANCE_ROLE, so GOVERNANCE always has an independent
// path regardless of any factory's fate). VaultPolicy.sol,
// LendingPositionRegistry.sol, and MandateRoles.sol never reference
// VaultFactory at all. Three VaultFactory instances coexisting onchain
// (v1/v2's original, v3's, and this new one for v4+) is fully safe -- this
// script independently re-reads the v3 VaultFactory's own state AFTER
// this bootstrap completes, confirming it is completely untouched, not
// merely assumed unaffected.
//
// Needs NO privileged role at all: MandateVaultDeployer's constructor just
// records msg.sender and deploys BytecodePointer fragments, VaultFactory's
// constructor takes plain addresses, BytecodePointer is a permissionless
// library-shaped contract. Run with the dedicated, freshly-generated
// FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY
// (scripts/generateFactoryBootstrapWalletV4.ts), never
// FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY (v3's own bootstrap wallet,
// already spent on that specific purpose) or any other key with real
// authority elsewhere in this project. The real ADMIN key is only needed
// afterward, once, for the actual createVault call
// (scripts/deployVaultV4.ts) -- explicitly HELD OFF deliberately until
// the three real v4 blockers (CCTP TokenMessenger/
// domain addresses, the 2-of-3 Safe multisig, the Arbitrum Sepolia keeper
// wallet) are resolved, one at a time.
//
// Plain viem, no Hardhat network/account config dependency, same pattern
// scripts/deployVaultFactoryForV3.ts already uses for a freshly-generated,
// not-in-hardhat-config key: reads compiled artifacts directly from
// forge-out/.
//
// Run with: node --import tsx scripts/deployVaultFactoryForV4.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

// ---------------------------------------------------------------------
// Real, already-deployed, unaffected addresses, cross-checked live against
// the real v3 VaultFactory below, not assumed. See docs/deployments.md's
// v3 bootstrap section for where these came from.
// ---------------------------------------------------------------------
const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");
const CAPITAL_LIMIT_REGISTRY_ADDRESS = getAddress("0x83983fd592168391303141DB723FfCB463D25081");
const PROTOCOL_TREASURY_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const V3_VAULT_FACTORY_ADDRESS = getAddress("0xB6a54F66174D7CE37739945B6Da3b463bbE849D8");
const LIQUIDITY_AMOUNTS_ADDRESS = getAddress("0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140");

const MAX_FRAGMENT_SIZE = 24_000; // matches MandateVaultDeployer.sol's own MAX_FRAGMENT_SIZE exactly

const V3_FACTORY_ABI = [
  { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "capitalLimitRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const NEW_FACTORY_STATE_ABI = V3_FACTORY_ABI;

const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in
/// scripts/deployVaultFactoryForV3.ts.
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
    chunks.push((`0x${body.slice(i, i + maxChunkChars)}`) as Hex);
  }
  return chunks;
}

async function main() {
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY is not set. Run scripts/generateFactoryBootstrapWalletV4.ts first.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Bootstrap deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Native balance: ${balance.toString()} raw (18 decimals). Needs enough for ~4 real transactions' gas.`);
  if (balance === 0n) {
    throw new Error(`${account.address} has zero balance. Fund it with real Arc Testnet gas (faucet.circle.com) and re-run.`);
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

  // 0. Live cross-check against the real v3 VaultFactory, never trusting
  // the hardcoded constants above alone, and capturing its FULL current
  // state now so it can be compared byte-for-byte after this bootstrap
  // completes -- the actual proof that v3 stays untouched, not an
  // assumption.
  await sleep(RPC_PACING_MS);
  const v3RolesBefore = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v3TreasuryBefore = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v3RegistryBefore = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v3DeployerBefore = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v3VaultCountBefore = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v3 VaultFactory BEFORE: roles=${v3RolesBefore}, protocolTreasury=${v3TreasuryBefore}, capitalLimitRegistry=${v3RegistryBefore}, vaultDeployer=${v3DeployerBefore}, vaultCount=${v3VaultCountBefore}`);
  if (
    v3RolesBefore.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    v3TreasuryBefore.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    v3RegistryBefore.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("Live values read from the real v3 VaultFactory do not match the hardcoded constants above. Stopping, do not proceed with mismatched addresses.");
  }

  // 1. Read and link MandateVault's real, current creation bytecode
  // against the real, already-deployed LiquidityAmounts, then split into
  // EIP-170-safe fragments.
  const mandateVaultArtifact = await import("../forge-out/MandateVault.sol/MandateVault.json", { with: { type: "json" } });
  const linkedMandateVaultCode = linkBytecode(mandateVaultArtifact.default.bytecode.object, mandateVaultArtifact.default.bytecode.linkReferences, {
    "contracts/lib/LiquidityAmounts.sol:LiquidityAmounts": LIQUIDITY_AMOUNTS_ADDRESS,
  });
  console.log(`Linked MandateVault creation code: ${(linkedMandateVaultCode.length - 2) / 2} bytes`);
  if (linkedMandateVaultCode.includes("__$")) {
    throw new Error("Linked MandateVault creation code still contains an unresolved placeholder. Stopping.");
  }
  const fragments = chunkBytecode(linkedMandateVaultCode, MAX_FRAGMENT_SIZE);
  console.log(`Split into ${fragments.length} fragments: ${fragments.map((f) => (f.length - 2) / 2).join(", ")} bytes each`);

  // 2. Deploy MandateVaultDeployer with the fragments.
  await sleep(RPC_PACING_MS);
  const deployerArtifact = await import("../forge-out/MandateVaultDeployer.sol/MandateVaultDeployer.json", { with: { type: "json" } });
  const deployerHash = await walletClient.deployContract({
    abi: deployerArtifact.default.abi,
    bytecode: deployerArtifact.default.bytecode.object as Hex,
    args: [fragments],
    chain: ARC_TESTNET,
    account,
    // Empirically confirmed via a real Foundry fork of this exact chain
    // (5,766,038 gas) and a real, independently-verified live deployment
    // during this mechanism's own verification pass -- ample headroom
    // above that, see docs/deployments.md's v4 section.
    gas: 8_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const deployerReceipt = await publicClient.waitForTransactionReceipt({ hash: deployerHash });
  if (deployerReceipt.status !== "success") {
    throw new Error(`MandateVaultDeployer deployment reverted (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed}). Stopping.`);
  }
  const deployerAddress = deployerReceipt.contractAddress;
  if (!deployerAddress) throw new Error("MandateVaultDeployer deployment produced no contract address.");
  console.log(`New MandateVaultDeployer (v4): ${deployerAddress} (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed})`);

  // 3. Deploy the new VaultFactory, reusing the existing roles/treasury/
  // registry, referencing the new deployer.
  await sleep(RPC_PACING_MS);
  const factoryArtifact = await import("../forge-out/VaultFactory.sol/VaultFactory.json", { with: { type: "json" } });
  const factoryHash = await walletClient.deployContract({
    abi: factoryArtifact.default.abi,
    bytecode: factoryArtifact.default.bytecode.object as Hex,
    args: [MANDATE_ROLES_ADDRESS, PROTOCOL_TREASURY_ADDRESS, deployerAddress, CAPITAL_LIMIT_REGISTRY_ADDRESS],
    chain: ARC_TESTNET,
    account,
    gas: 6_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  const factoryAddress = factoryReceipt.contractAddress;
  if (factoryReceipt.status !== "success" || !factoryAddress) {
    throw new Error(`New VaultFactory deployment failed (tx ${factoryHash}).`);
  }
  console.log(`New VaultFactory (v4): ${factoryAddress} (tx ${factoryHash})`);

  // 4. Wire them together, exactly once.
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "setFactory", args: [factoryAddress], chain: ARC_TESTNET, account }),
    `setFactory(${factoryAddress}) on the new MandateVaultDeployer`,
  );

  // 5. Independent verification, fragment by fragment, never trusting
  // this script's own earlier steps alone.
  await sleep(RPC_PACING_MS);
  const fragmentCount = await publicClient.readContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "fragmentCount" }) as bigint;
  if (Number(fragmentCount) !== fragments.length) {
    throw new Error(`Live fragmentCount() (${fragmentCount}) does not match the number of fragments supplied (${fragments.length}). Stopping.`);
  }
  let reconstructed = "0x";
  for (let i = 0; i < fragments.length; i++) {
    await sleep(RPC_PACING_MS);
    const pointerAddress = await publicClient.readContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "mandateVaultCodePointers", args: [BigInt(i)] }) as `0x${string}`;
    await sleep(RPC_PACING_MS);
    const pointerCode = await publicClient.getCode({ address: pointerAddress });
    if (!pointerCode || pointerCode.toLowerCase() !== fragments[i].toLowerCase()) {
      throw new Error(`Fragment ${i}'s live pointer bytecode does NOT match the fragment fed into the constructor. Stopping, do not trust this deployment.`);
    }
    console.log(`Fragment ${i} pointer ${pointerAddress}: verified byte-identical (${(pointerCode.length - 2) / 2} bytes).`);
    reconstructed += pointerCode.slice(2);
  }
  if (reconstructed.toLowerCase() !== linkedMandateVaultCode.toLowerCase()) {
    throw new Error("Independently reconstructed bytecode does NOT match the original linked MandateVault creation code. Stopping.");
  }
  console.log(`Verified: full reconstruction is byte-identical to the original (${(reconstructed.length - 2) / 2} bytes).`);

  await sleep(RPC_PACING_MS);
  const deployerCode = await publicClient.getCode({ address: deployerAddress });
  const deployerCodeSize = deployerCode ? (deployerCode.length - 2) / 2 : 0;
  if (deployerCodeSize === 0 || deployerCodeSize > 3000) {
    throw new Error(`MandateVaultDeployer's real runtime is ${deployerCodeSize} bytes -- expected small and non-zero. Stopping.`);
  }
  console.log(`Verified: MandateVaultDeployer's own runtime is small (${deployerCodeSize} bytes), confirming no embedding on the real chain.`);

  // 6. Independent verification of the new VaultFactory's own wiring.
  await sleep(RPC_PACING_MS);
  const newFactoryRoles = await publicClient.readContract({ address: factoryAddress, abi: NEW_FACTORY_STATE_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const newFactoryTreasury = await publicClient.readContract({ address: factoryAddress, abi: NEW_FACTORY_STATE_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const newFactoryRegistry = await publicClient.readContract({ address: factoryAddress, abi: NEW_FACTORY_STATE_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const newFactoryDeployer = await publicClient.readContract({ address: factoryAddress, abi: NEW_FACTORY_STATE_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const liveFactoryOnDeployer = await publicClient.readContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "factory" });
  console.log(`New VaultFactory wiring: roles=${newFactoryRoles}, protocolTreasury=${newFactoryTreasury}, capitalLimitRegistry=${newFactoryRegistry}, vaultDeployer=${newFactoryDeployer}`);
  console.log(`New MandateVaultDeployer's factory=${liveFactoryOnDeployer}`);
  if (
    newFactoryRoles.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    newFactoryTreasury.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    newFactoryRegistry.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase() ||
    newFactoryDeployer.toLowerCase() !== deployerAddress.toLowerCase() ||
    liveFactoryOnDeployer.toLowerCase() !== factoryAddress.toLowerCase()
  ) {
    throw new Error("New VaultFactory/MandateVaultDeployer wiring does not match what was requested. Do not treat this bootstrap as complete.");
  }

  // 7. The critical confirmation this bootstrap must prove: the real v3
  // VaultFactory must remain COMPLETELY untouched by this bootstrap --
  // re-read its full state now and diff against what was captured in
  // step 0, not merely assume nothing changed because this script never
  // wrote to it.
  await sleep(RPC_PACING_MS);
  const v3RolesAfter = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v3TreasuryAfter = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v3RegistryAfter = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v3DeployerAfter = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v3VaultCountAfter = await publicClient.readContract({ address: V3_VAULT_FACTORY_ADDRESS, abi: V3_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v3 VaultFactory AFTER:  roles=${v3RolesAfter}, protocolTreasury=${v3TreasuryAfter}, capitalLimitRegistry=${v3RegistryAfter}, vaultDeployer=${v3DeployerAfter}, vaultCount=${v3VaultCountAfter}`);
  if (
    v3RolesAfter.toLowerCase() !== v3RolesBefore.toLowerCase() ||
    v3TreasuryAfter.toLowerCase() !== v3TreasuryBefore.toLowerCase() ||
    v3RegistryAfter.toLowerCase() !== v3RegistryBefore.toLowerCase() ||
    v3DeployerAfter.toLowerCase() !== v3DeployerBefore.toLowerCase() ||
    v3VaultCountAfter !== v3VaultCountBefore
  ) {
    throw new Error("The real v3 VaultFactory's state changed after this bootstrap! This must never happen -- stop and investigate immediately, do not treat anything here as complete.");
  }
  console.log("Verified: the real v3 VaultFactory is completely untouched (identical state before and after), and its own vaultDeployer still points to v3's own deployer, unaffected -- it will continue to create only v3-shaped vaults.");

  console.log("\n=== New v4 VaultFactory bootstrap summary ===");
  console.log(`MandateRoles (reused):          ${MANDATE_ROLES_ADDRESS}`);
  console.log(`CapitalLimitRegistry (reused):  ${CAPITAL_LIMIT_REGISTRY_ADDRESS}`);
  console.log(`protocolTreasury (reused):      ${PROTOCOL_TREASURY_ADDRESS}`);
  console.log(`LiquidityAmounts (reused):      ${LIQUIDITY_AMOUNTS_ADDRESS}`);
  console.log(`New MandateVaultDeployer (v4):  ${deployerAddress}`);
  console.log(`New VaultFactory (v4):          ${factoryAddress}`);
  console.log(`v3 VaultFactory (untouched):    ${V3_VAULT_FACTORY_ADDRESS}, still creates only v3 vaults, vaultCount=${v3VaultCountAfter}`);
  console.log("\nNext: hold off on scripts/deployVaultV4.ts (the real vault creation) until the three real blockers are resolved:");
  console.log("  1. Real CCTP TokenMessenger address + domain ID (Arc + Arbitrum Sepolia).");
  console.log("  2. The 2-of-3 Safe multisig for new v4 human governance roles.");
  console.log("  3. A dedicated, funded Arbitrum Sepolia keeper wallet.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
