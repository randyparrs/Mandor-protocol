// Deploys a fresh MandateVaultDeployer+VaultFactory pair (Gen6) for a NEW
// contract, contracts/MandateVaultLending.sol -- not contracts/MandateVault.sol,
// the source every prior version (v1-v5) deploys from. Reuses the
// already-deployed, unaffected MandateRoles/CapitalLimitRegistry/
// protocolTreasury as-is (all verified live below, not assumed) -- same
// bootstrap shape already proven for v3, v4, and v5
// (scripts/deployVaultFactoryForV3.ts, deployVaultFactoryForV4.ts,
// deployVaultFactoryForV5.ts), just embedding a different contract's
// bytecode this time.
//
// Why a SEPARATE contract, not just an edited contracts/MandateVault.sol:
// adding the performance-fee mechanism there (feeHighWaterMarkPricePerShare,
// _accrueFee, accrueFee, _deposit/_withdraw overrides) pushed
// contracts/MandateVault.sol from 169 bytes under EIP-170's 24,576-byte
// deployable-contract limit to 482 bytes OVER it, even at this project's
// most aggressive available optimizer settings (runs=1 + via_ir).
// Extracting the new logic to an external library was measured to cost
// MORE bytecode than it saved (small-function call overhead exceeds what
// it replaces, the same real finding already documented in
// contracts/MandateVault.sol's own _tickCumulativeDelta comment for LP
// math). Properly extracting v3's LP mechanism into its own registry
// contract (mirroring LendingPositionRegistry) is the correct long-term
// fix, deliberately deferred to a dedicated future session. For now:
// contracts/MandateVault.sol stays completely UNCHANGED (v1-v5 keep
// deploying from it exactly as before, verified: git diff shows zero
// change), and contracts/MandateVaultLending.sol is a genuinely separate,
// leaner sibling (same ERC-4626 custody model, no LP mechanism at all)
// used starting with v6. See that file's own top-of-file doc comment for
// the full writeup.
//
// VaultFactory.sol itself needed NO changes either: its own createVault
// only ever types the deployed address as `MandateVault` for its own
// internal convenience (`MandateVault(vaultDeployer.deploy(...))`) to call
// standard-signature functions (setPolicy, ERC-4626 deposit) -- Solidity
// dispatches by function selector, not by which source file actually
// deployed the bytecode at that address, confirmed by reading
// VaultFactory.sol's real source before assuming this would work.
//
// Confirmed safe for v1/v2/v3/v4/v5 before running this, same reasoning
// already verified for every prior bootstrap: MandateVault.sol's `factory`
// field is only used at runtime in setPolicy (onlyFactory, already
// permanently consumed for every live vault) and setCapitalLimitRegistry
// (onlyFactory OR GOVERNANCE_ROLE, so GOVERNANCE always has an independent
// path regardless of any factory's fate). VaultPolicy.sol,
// LendingPositionRegistry.sol, and MandateRoles.sol never reference
// VaultFactory at all. Five VaultFactory instances coexisting onchain
// (v1/v2's original, v3's, v4's, v5's, and this new one for v6+) is fully
// safe -- this script independently re-reads the v5 VaultFactory's own
// state AFTER this bootstrap completes, confirming it is completely
// untouched, not merely assumed unaffected.
//
// Numbered Gen6 because this same script already produced one real,
// now-abandoned bootstrap (Gen5: MandateVaultDeployer 0x8d98e9acb215dd0bcbaab323fd56e10f08c9ccc9,
// VaultFactory 0x931e441418a9e1c0a4816a4e485cbb888fac0ec9) before the pivot
// from an edited contracts/MandateVault.sol to this separate
// contracts/MandateVaultLending.sol -- VaultFactory.vaultDeployer is
// immutable, so Gen5 cannot be pointed at different bytecode and is
// simply never used again, not reused or upgraded.
//
// Needs NO privileged role at all, same as every prior bootstrap:
// MandateVaultDeployer's constructor just records msg.sender and deploys
// BytecodePointer fragments, VaultFactory's constructor takes plain
// addresses, BytecodePointer is a permissionless library-shaped contract.
// Run with the dedicated, freshly-generated
// FACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY
// (scripts/generateFactoryBootstrapWalletV6.ts), never any earlier
// bootstrap key or any other key with real authority elsewhere in this
// project. The real ADMIN key is only needed afterward, once, for the
// actual createVault call (scripts/deployVaultV6.ts, pointed at this new
// factory's address).
//
// LiquidityAmounts (the external library every prior bootstrap had to
// link) is NOT needed here at all: contracts/MandateVaultLending.sol has
// no LP mechanism, so nothing references it. One less step than every
// prior bootstrap, not a reused one.
//
// Plain viem, no Hardhat network/account config dependency, same pattern
// scripts/deployVaultFactoryForV5.ts already uses for a freshly-generated,
// not-in-hardhat-config key: reads compiled artifacts directly from
// forge-out/.
//
// Run with: node --import tsx scripts/deployVaultFactoryForV6.ts
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
// the real v5 (Gen4) VaultFactory below, not assumed. See
// docs/deployments.md's v5 bootstrap section for where these came from --
// identical to what scripts/deployVaultFactoryForV5.ts already used, since
// none of this shared infra changed for v6.
// ---------------------------------------------------------------------
const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");
const CAPITAL_LIMIT_REGISTRY_ADDRESS = getAddress("0x83983fd592168391303141DB723FfCB463D25081");
const PROTOCOL_TREASURY_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const V5_VAULT_FACTORY_ADDRESS = getAddress("0x361B4CCBaDC0de931C01084EC9511D8a6BfdE83E");

const MAX_FRAGMENT_SIZE = 24_000; // matches MandateVaultDeployer.sol's own MAX_FRAGMENT_SIZE exactly

const V5_FACTORY_ABI = [
  { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "capitalLimitRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const NEW_FACTORY_STATE_ABI = V5_FACTORY_ABI;

const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in
/// scripts/deployVaultFactoryForV5.ts.
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
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY is not set. Run scripts/generateFactoryBootstrapWalletV6.ts first.");
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

  // 0. Live cross-check against the real v5 (Gen4) VaultFactory, never
  // trusting the hardcoded constants above alone, and capturing its FULL
  // current state now so it can be compared byte-for-byte after this
  // bootstrap completes -- the actual proof that v5 stays untouched, not
  // an assumption.
  await sleep(RPC_PACING_MS);
  const v5RolesBefore = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v5TreasuryBefore = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v5RegistryBefore = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v5DeployerBefore = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v5VaultCountBefore = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v5 VaultFactory BEFORE: roles=${v5RolesBefore}, protocolTreasury=${v5TreasuryBefore}, capitalLimitRegistry=${v5RegistryBefore}, vaultDeployer=${v5DeployerBefore}, vaultCount=${v5VaultCountBefore}`);
  if (
    v5RolesBefore.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    v5TreasuryBefore.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    v5RegistryBefore.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("Live values read from the real v5 VaultFactory do not match the hardcoded constants above. Stopping, do not proceed with mismatched addresses.");
  }

  // 1. Read MandateVaultLending's real, current creation bytecode, then
  // split into EIP-170-safe fragments. No linking step needed at all:
  // this contract has no LP mechanism, so it references no external
  // library (unlike every prior bootstrap, which had to link
  // LiquidityAmounts). linkBytecode is still called, with an empty map,
  // purely so the "no unresolved placeholder" check below still runs for
  // real, not skipped.
  const mandateVaultArtifact = await import("../forge-out/MandateVaultLending.sol/MandateVaultLending.json", { with: { type: "json" } });
  const creationCode = linkBytecode(mandateVaultArtifact.default.bytecode.object, mandateVaultArtifact.default.bytecode.linkReferences, {});
  console.log(`MandateVaultLending creation code: ${(creationCode.length - 2) / 2} bytes`);
  if (creationCode.includes("__$")) {
    throw new Error("MandateVaultLending creation code contains an unresolved placeholder, but this contract should need no external library linking at all. Stopping.");
  }
  const fragments = chunkBytecode(creationCode, MAX_FRAGMENT_SIZE);
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
    // Same gas headroom already empirically confirmed for v4/v5's own
    // bootstraps -- MandateVaultLending's creation code is smaller, not
    // larger, than MandateVault.sol's, so this ceiling is comfortable.
    gas: 8_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const deployerReceipt = await publicClient.waitForTransactionReceipt({ hash: deployerHash });
  if (deployerReceipt.status !== "success") {
    throw new Error(`MandateVaultDeployer deployment reverted (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed}). Stopping.`);
  }
  const deployerAddress = deployerReceipt.contractAddress;
  if (!deployerAddress) throw new Error("MandateVaultDeployer deployment produced no contract address.");
  console.log(`New MandateVaultDeployer (Gen6, for v6): ${deployerAddress} (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed})`);

  // 3. Deploy the new VaultFactory, reusing the existing roles/treasury/
  // registry, referencing the new deployer. This is the step that actually
  // embeds the CURRENT, fixed contracts/VaultPolicy.sol bytecode (via its
  // own `new VaultPolicy(...)` call inside createVault), the whole point
  // of this bootstrap.
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
  console.log(`New VaultFactory (Gen6, for v6): ${factoryAddress} (tx ${factoryHash})`);

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
  if (reconstructed.toLowerCase() !== creationCode.toLowerCase()) {
    throw new Error("Independently reconstructed bytecode does NOT match the original MandateVaultLending creation code. Stopping.");
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

  // 7. The critical confirmation: the real v5 (Gen4) VaultFactory must
  // remain COMPLETELY untouched by this bootstrap -- re-read its full
  // state now and diff against what was captured in step 0, not merely
  // assume nothing changed because this script never wrote to it.
  await sleep(RPC_PACING_MS);
  const v5RolesAfter = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v5TreasuryAfter = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v5RegistryAfter = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v5DeployerAfter = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v5VaultCountAfter = await publicClient.readContract({ address: V5_VAULT_FACTORY_ADDRESS, abi: V5_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v5 VaultFactory AFTER:  roles=${v5RolesAfter}, protocolTreasury=${v5TreasuryAfter}, capitalLimitRegistry=${v5RegistryAfter}, vaultDeployer=${v5DeployerAfter}, vaultCount=${v5VaultCountAfter}`);
  if (
    v5RolesAfter.toLowerCase() !== v5RolesBefore.toLowerCase() ||
    v5TreasuryAfter.toLowerCase() !== v5TreasuryBefore.toLowerCase() ||
    v5RegistryAfter.toLowerCase() !== v5RegistryBefore.toLowerCase() ||
    v5DeployerAfter.toLowerCase() !== v5DeployerBefore.toLowerCase() ||
    v5VaultCountAfter !== v5VaultCountBefore
  ) {
    throw new Error("The real v5 VaultFactory's state changed after this bootstrap! This must never happen -- stop and investigate immediately, do not treat anything here as complete.");
  }
  console.log("Verified: the real v5 (Gen4) VaultFactory is completely untouched (identical state before and after), and its own vaultDeployer still points to v5's own deployer, unaffected -- it will continue to create only OLD-MandateVault-logic vaults (irrelevant going forward, since v5 itself never needed the fee mechanism).");

  console.log("\n=== New Gen6 VaultFactory bootstrap summary ===");
  console.log(`MandateRoles (reused):          ${MANDATE_ROLES_ADDRESS}`);
  console.log(`CapitalLimitRegistry (reused):  ${CAPITAL_LIMIT_REGISTRY_ADDRESS}`);
  console.log(`protocolTreasury (reused):      ${PROTOCOL_TREASURY_ADDRESS}`);
  console.log(`New MandateVaultDeployer (Gen6): ${deployerAddress}`);
  console.log(`New VaultFactory (Gen6):         ${factoryAddress}`);
  console.log(`v5 VaultFactory (untouched):     ${V5_VAULT_FACTORY_ADDRESS}, still creates only OLD-MandateVault-logic vaults, vaultCount=${v5VaultCountAfter}`);
  console.log("\nNext: run scripts/deployVaultV6.ts against this new Gen6 factory address to create the real v6 vault. After that, verify the performance fee mechanism with a real functional accrueFee() call against genuine reported yield, not just by reading performanceFeeBps's value -- the same standard that caught real bugs in v5's own REBALANCE-exemption rollout.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
