// Deploys a fresh MandateVaultDeployer+VaultFactory pair (Gen4), reusing
// the already-deployed, unaffected MandateRoles/CapitalLimitRegistry/
// protocolTreasury/LiquidityAmounts as-is (all verified live below, not
// assumed) -- same bootstrap shape already proven for v3 and v4
// (scripts/deployVaultFactoryForV3.ts, scripts/deployVaultFactoryForV4.ts).
//
// Why this is needed, and why it's a DIFFERENT trigger than every prior
// bootstrap: v1/v2 -> v3 and v3 -> v4 were both forced by a
// ConstructorLimits SHAPE change (new fields added), so the old factory's
// createVault ABI stopped matching current source. This one is different:
// v5's ConstructorLimits shape is IDENTICAL to v4's (no new fields at all
// -- v5 only changes maxDrawdownBps's VALUE and adds a REBALANCE exemption
// inside validateDecision's own LOGIC). It still needs a new factory,
// because contracts/VaultFactory.sol deploys VaultPolicy via a direct
// Solidity `new VaultPolicy(params.limits)` call, which embeds VaultPolicy's
// FULL compiled bytecode into VaultFactory's own bytecode at VaultFactory's
// own deploy time -- not at the time a vault is created from it. Editing
// contracts/VaultPolicy.sol and running `forge build` only ever affects
// local build artifacts and fresh Foundry test deployments (which is
// exactly why `forge test` correctly passed the new REBALANCE-exemption
// tests -- Forge deploys straight from source for each test, entirely
// bypassing this factory-embedding question). It has ZERO effect on any
// vault created through the currently-live Gen3 (v4-era) VaultFactory at
// 0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb, which still has the OLD,
// unconditional maxDrawdownBps check baked in from before this session's
// edit. Confirmed empirically, not assumed: a live validateDecision call
// against a v5 vault deployed through that Gen3 factory showed REBALANCE
// failing MAX_DRAWDOWN_EXCEEDED during a high-drawdown state, identically
// to HOLD -- direct proof the exemption was never live there, despite the
// constructor's maxDrawdownBps argument itself correctly reading 1000.
//
// The generalized lesson this bootstrap exists to act on: ANY logic change
// inside contracts/VaultPolicy.sol requires a new factory bootstrap, even
// with zero ConstructorLimits shape change -- see docs/deployments.md's
// own dedicated note on this, added specifically so this class of gap is
// checked proactively before the next VaultPolicy.sol edit, not
// rediscovered by another live functional-call surprise.
//
// Confirmed safe for v1/v2/v3/v4 before running this, same reasoning
// already verified twice before: MandateVault.sol's `factory` field is
// only used at runtime in setPolicy (onlyFactory, already permanently
// consumed for every live vault) and setCapitalLimitRegistry (onlyFactory
// OR GOVERNANCE_ROLE, so GOVERNANCE always has an independent path
// regardless of any factory's fate). VaultPolicy.sol, LendingPositionRegistry.sol,
// and MandateRoles.sol never reference VaultFactory at all. Four
// VaultFactory instances coexisting onchain (v1/v2's original, v3's, v4's,
// and this new one for v5+) is fully safe -- this script independently
// re-reads the v4 VaultFactory's own state AFTER this bootstrap completes,
// confirming it is completely untouched, not merely assumed unaffected.
//
// Needs NO privileged role at all, same as every prior bootstrap:
// MandateVaultDeployer's constructor just records msg.sender and deploys
// BytecodePointer fragments, VaultFactory's constructor takes plain
// addresses, BytecodePointer is a permissionless library-shaped contract.
// Run with the dedicated, freshly-generated
// FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY
// (scripts/generateFactoryBootstrapWalletV5.ts), never any earlier
// bootstrap key or any other key with real authority elsewhere in this
// project. The real ADMIN key is only needed afterward, once, for the
// actual createVault call (scripts/deployVaultV5.ts, re-pointed at this
// new factory's address).
//
// MandateVault.sol itself has NOT changed this session (only
// contracts/VaultPolicy.sol did), so the exact same fragmentation approach
// and the exact same already-deployed LiquidityAmounts address from v3/v4's
// own bootstrap apply unchanged here -- TickMath is not needed either,
// same reasoning v4's own bootstrap already established (v5 doesn't touch
// LP math).
//
// Plain viem, no Hardhat network/account config dependency, same pattern
// scripts/deployVaultFactoryForV4.ts already uses for a freshly-generated,
// not-in-hardhat-config key: reads compiled artifacts directly from
// forge-out/.
//
// Run with: node --import tsx scripts/deployVaultFactoryForV5.ts
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
// the real v4 (Gen3) VaultFactory below, not assumed. See
// docs/deployments.md's v4 bootstrap section for where these came from --
// identical to what scripts/deployVaultFactoryForV4.ts already used, since
// none of this shared infra changed for v5.
// ---------------------------------------------------------------------
const MANDATE_ROLES_ADDRESS = getAddress("0x91dC937Cf24cD84B415A1B9AD2f520834334504a");
const CAPITAL_LIMIT_REGISTRY_ADDRESS = getAddress("0x83983fd592168391303141DB723FfCB463D25081");
const PROTOCOL_TREASURY_ADDRESS = getAddress("0x884687C973e9b7Af697dC34Aed1F09Da06BC4253");
const V4_VAULT_FACTORY_ADDRESS = getAddress("0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb");
const LIQUIDITY_AMOUNTS_ADDRESS = getAddress("0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140");

const MAX_FRAGMENT_SIZE = 24_000; // matches MandateVaultDeployer.sol's own MAX_FRAGMENT_SIZE exactly

const V4_FACTORY_ABI = [
  { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "capitalLimitRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const NEW_FACTORY_STATE_ABI = V4_FACTORY_ABI;

const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in
/// scripts/deployVaultFactoryForV4.ts.
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
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY is not set. Run scripts/generateFactoryBootstrapWalletV5.ts first.");
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

  // 0. Live cross-check against the real v4 (Gen3) VaultFactory, never
  // trusting the hardcoded constants above alone, and capturing its FULL
  // current state now so it can be compared byte-for-byte after this
  // bootstrap completes -- the actual proof that v4 stays untouched, not
  // an assumption.
  await sleep(RPC_PACING_MS);
  const v4RolesBefore = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v4TreasuryBefore = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v4RegistryBefore = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v4DeployerBefore = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v4VaultCountBefore = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v4 VaultFactory BEFORE: roles=${v4RolesBefore}, protocolTreasury=${v4TreasuryBefore}, capitalLimitRegistry=${v4RegistryBefore}, vaultDeployer=${v4DeployerBefore}, vaultCount=${v4VaultCountBefore}`);
  if (
    v4RolesBefore.toLowerCase() !== MANDATE_ROLES_ADDRESS.toLowerCase() ||
    v4TreasuryBefore.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase() ||
    v4RegistryBefore.toLowerCase() !== CAPITAL_LIMIT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("Live values read from the real v4 VaultFactory do not match the hardcoded constants above. Stopping, do not proceed with mismatched addresses.");
  }

  // 1. Read and link MandateVault's real, current creation bytecode
  // against the real, already-deployed LiquidityAmounts, then split into
  // EIP-170-safe fragments. MandateVault.sol itself is unchanged this
  // session, only contracts/VaultPolicy.sol is -- this step is byte-for-byte
  // identical in mechanism to v4's own bootstrap.
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
    // Same gas headroom already empirically confirmed for v4's own
    // bootstrap (see docs/deployments.md's v4 section) -- MandateVault's
    // creation code is unchanged this session, so the same figure applies.
    gas: 8_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const deployerReceipt = await publicClient.waitForTransactionReceipt({ hash: deployerHash });
  if (deployerReceipt.status !== "success") {
    throw new Error(`MandateVaultDeployer deployment reverted (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed}). Stopping.`);
  }
  const deployerAddress = deployerReceipt.contractAddress;
  if (!deployerAddress) throw new Error("MandateVaultDeployer deployment produced no contract address.");
  console.log(`New MandateVaultDeployer (Gen4, for v5): ${deployerAddress} (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed})`);

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
  console.log(`New VaultFactory (Gen4, for v5): ${factoryAddress} (tx ${factoryHash})`);

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

  // 7. The critical confirmation: the real v4 (Gen3) VaultFactory must
  // remain COMPLETELY untouched by this bootstrap -- re-read its full
  // state now and diff against what was captured in step 0, not merely
  // assume nothing changed because this script never wrote to it.
  await sleep(RPC_PACING_MS);
  const v4RolesAfter = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const v4TreasuryAfter = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "protocolTreasury" });
  await sleep(RPC_PACING_MS);
  const v4RegistryAfter = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "capitalLimitRegistry" });
  await sleep(RPC_PACING_MS);
  const v4DeployerAfter = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "vaultDeployer" });
  await sleep(RPC_PACING_MS);
  const v4VaultCountAfter = await publicClient.readContract({ address: V4_VAULT_FACTORY_ADDRESS, abi: V4_FACTORY_ABI, functionName: "vaultCount" });
  console.log(`v4 VaultFactory AFTER:  roles=${v4RolesAfter}, protocolTreasury=${v4TreasuryAfter}, capitalLimitRegistry=${v4RegistryAfter}, vaultDeployer=${v4DeployerAfter}, vaultCount=${v4VaultCountAfter}`);
  if (
    v4RolesAfter.toLowerCase() !== v4RolesBefore.toLowerCase() ||
    v4TreasuryAfter.toLowerCase() !== v4TreasuryBefore.toLowerCase() ||
    v4RegistryAfter.toLowerCase() !== v4RegistryBefore.toLowerCase() ||
    v4DeployerAfter.toLowerCase() !== v4DeployerBefore.toLowerCase() ||
    v4VaultCountAfter !== v4VaultCountBefore
  ) {
    throw new Error("The real v4 VaultFactory's state changed after this bootstrap! This must never happen -- stop and investigate immediately, do not treat anything here as complete.");
  }
  console.log("Verified: the real v4 (Gen3) VaultFactory is completely untouched (identical state before and after), and its own vaultDeployer still points to v4's own deployer, unaffected -- it will continue to create only OLD-VaultPolicy-logic vaults (irrelevant going forward, since v4 itself never needed the REBALANCE exemption).");

  console.log("\n=== New Gen4 VaultFactory bootstrap summary ===");
  console.log(`MandateRoles (reused):          ${MANDATE_ROLES_ADDRESS}`);
  console.log(`CapitalLimitRegistry (reused):  ${CAPITAL_LIMIT_REGISTRY_ADDRESS}`);
  console.log(`protocolTreasury (reused):      ${PROTOCOL_TREASURY_ADDRESS}`);
  console.log(`LiquidityAmounts (reused):      ${LIQUIDITY_AMOUNTS_ADDRESS}`);
  console.log(`New MandateVaultDeployer (Gen4): ${deployerAddress}`);
  console.log(`New VaultFactory (Gen4):         ${factoryAddress}`);
  console.log(`v4 VaultFactory (untouched):     ${V4_VAULT_FACTORY_ADDRESS}, still creates only OLD-VaultPolicy-logic vaults, vaultCount=${v4VaultCountAfter}`);
  console.log("\nNext: update scripts/deployVaultV5.ts's VAULT_FACTORY_ADDRESS to this new Gen4 factory address, then run it to redeploy v5. After that, verify the REBALANCE exemption with a real functional validateDecision call (an actual over-threshold drawdown decision), not just by reading maxDrawdownBps's value -- the same check that caught this bug in the first place.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
