// Live, throwaway verification of MandateVaultDeployer's fragmented
// BytecodePointer + CREATE2 mechanism (see
// contracts/MandateVaultDeployer.sol's own top-of-file comment) on the
// real Arc Testnet chain -- NOT the real v4 VaultFactory bootstrap, a
// disposable instance whose only purpose is proving this new low-level
// deployment mechanism behaves identically on the real chain to what the
// local Foundry test suite (test/MandateVaultDeployerBytecode.t.sol)
// already proved locally.
//
// Fragmentation was found necessary, not optional: a single BytecodePointer
// instance is itself bound by the same EIP-170 24,576-byte limit this
// mechanism exists to route around for MandateVault, and MandateVault's
// real creation code (26,576 bytes) is over that limit. Confirmed live via
// `cast run` on a real reverted transaction (`[CreateContractSizeLimit]`,
// not a gas problem -- an earlier version of this script spent real
// diagnostic effort ruling out gas before finding this, see
// docs/deployments.md's v4 section for the full trail).
//
// Verifies, each via an independent, fresh read, never trusting this
// script's own success message:
// 1. MandateVaultDeployer's own real, live bytecode size stays small
//    (confirms no embedding on the real chain, not just locally).
// 2. EVERY fragment pointer's real, live eth_getCode matches EXACTLY the
//    corresponding slice of the locally-linked MandateVault creation
//    bytecode (byte for byte, not "close enough").
// 3. The FULL reconstruction (all fragments concatenated, in order) is
//    byte-identical to the original linked creation code -- not just each
//    fragment individually.
// 4. A real vault deployed through deploy() on the real chain has the
//    correct real onchain state (factory, roles, registered assets,
//    cctpTokenMessenger).
//
// Uses FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY (the same wallet from v3's
// factory bootstrap): reused deliberately, not a violation of this
// project's key-isolation discipline -- that discipline is about never
// mixing KEEPER/ADMIN authority into a bootstrap wallet, not about a
// single-use-per-transaction rule, and this wallet holds no privileged
// role anywhere else. This script never touches VaultFactory or any real
// vault's actual creation; the "factory" here is set to this same
// disposable wallet, one-shot, purely so deploy() has something to check
// against.
//
// Run with: node --import tsx scripts/verifyBytecodePointerDeployerOnArcTestnet.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

// Real, already-deployed, unaffected addresses, see docs/deployments.md's
// v3 bootstrap section.
const LIQUIDITY_AMOUNTS_ADDRESS = getAddress("0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140");
const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000");

// Matches MandateVaultDeployer.sol's own MAX_FRAGMENT_SIZE exactly -- a
// safe, round margin under EIP-170's hard 24,576-byte limit, not the
// exact boundary, since BytecodePointer's own deployed size equals its
// data length exactly.
const MAX_FRAGMENT_SIZE = 24_000;

const RPC_PACING_MS = 2500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LinkReferences {
  [file: string]: { [lib: string]: Array<{ start: number; length: number }> };
}

/// @notice Exact copy of the helper already proven in
/// scripts/deployVaultFactoryForV3.ts (byte-offset placeholder
/// substitution using the artifact's own linkReferences), reused here
/// rather than reinvented.
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

/// @notice Splits bytecode into fragments no larger than maxChunkBytes,
/// in order. MandateVaultDeployer doesn't care how chunking happened,
/// only that fragments are correct and in order (see that contract's own
/// doc comment), so this doesn't need to match the Solidity test's own
/// independent _chunkBytecode implementation byte for byte -- both must
/// simply produce a correct split.
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
  const key = process.env.FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(key as Hex);

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Verification wallet: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Native balance: ${balance.toString()} raw (18 decimals).`);
  if (balance === 0n) {
    throw new Error(`${account.address} has zero balance. Fund it with real Arc Testnet gas and re-run.`);
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

  // 1. Read and link MandateVault's real, current creation bytecode
  // against the real, already-deployed LiquidityAmounts, then split into
  // fragments -- exactly the steps the real v4 factory bootstrap will
  // also need, done here first against a disposable instance.
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
  for (const [i, f] of fragments.entries()) {
    if ((f.length - 2) / 2 > MAX_FRAGMENT_SIZE) throw new Error(`Fragment ${i} exceeds MAX_FRAGMENT_SIZE, chunking bug. Stopping.`);
  }

  // 2. Deploy MandateVaultDeployer, passing the fragments array as its
  // constructor argument (never type(MandateVault).creationCode from
  // Solidity source, see MandateVaultDeployer.sol's own doc comment).
  await sleep(RPC_PACING_MS);
  const deployerArtifact = await import("../forge-out/MandateVaultDeployer.sol/MandateVaultDeployer.json", { with: { type: "json" } });
  // Empirically derived, not guessed: a real Foundry fork of this exact
  // chain succeeded with 5,766,038 gas for this same construction (see
  // docs/deployments.md's v4 section); ample headroom above that.
  const deployerHash = await walletClient.deployContract({
    abi: deployerArtifact.default.abi,
    bytecode: deployerArtifact.default.bytecode.object as Hex,
    args: [fragments],
    chain: ARC_TESTNET,
    account,
    gas: 8_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const deployerReceipt = await publicClient.waitForTransactionReceipt({ hash: deployerHash });
  if (deployerReceipt.status !== "success") {
    throw new Error(`MandateVaultDeployer deployment reverted (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed}). Stopping, do not continue.`);
  }
  const deployerAddress = deployerReceipt.contractAddress;
  if (!deployerAddress) throw new Error("MandateVaultDeployer deployment produced no contract address.");
  console.log(`Throwaway MandateVaultDeployer: ${deployerAddress} (tx ${deployerHash}, gasUsed ${deployerReceipt.gasUsed})`);

  // 3. Independent verification #1: MandateVaultDeployer's own REAL,
  // live bytecode size stays small, confirming no embedding on the real
  // chain, not just locally.
  await sleep(RPC_PACING_MS);
  const deployerCode = await publicClient.getCode({ address: deployerAddress });
  const deployerCodeSize = deployerCode ? (deployerCode.length - 2) / 2 : 0;
  console.log(`Live MandateVaultDeployer runtime size: ${deployerCodeSize} bytes`);
  if (deployerCodeSize === 0) {
    throw new Error("MandateVaultDeployer has zero deployed code -- the deployment did not actually succeed, regardless of what the transaction receipt claimed. Stopping.");
  }
  if (deployerCodeSize > 3000) {
    throw new Error(`MandateVaultDeployer's real runtime is ${deployerCodeSize} bytes, larger than expected -- possible embedding regression. Stopping.`);
  }

  // 4. Independent verification #2: EVERY fragment pointer's real, live
  // eth_getCode matches EXACTLY the corresponding slice this script fed
  // into the constructor -- never trusting this script's own deploy step
  // alone, and never trusting only the FIRST fragment.
  await sleep(RPC_PACING_MS);
  const fragmentCount = await publicClient.readContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "fragmentCount" }) as bigint;
  console.log(`Live fragmentCount(): ${fragmentCount}`);
  if (Number(fragmentCount) !== fragments.length) {
    throw new Error(`Live fragmentCount() (${fragmentCount}) does not match the number of fragments supplied (${fragments.length}). Stopping.`);
  }

  let reconstructed = "0x";
  for (let i = 0; i < fragments.length; i++) {
    await sleep(RPC_PACING_MS);
    const pointerAddress = await publicClient.readContract({
      address: deployerAddress,
      abi: deployerArtifact.default.abi,
      functionName: "mandateVaultCodePointers",
      args: [BigInt(i)],
    }) as `0x${string}`;
    await sleep(RPC_PACING_MS);
    const pointerCode = await publicClient.getCode({ address: pointerAddress });
    if (!pointerCode || pointerCode.toLowerCase() !== fragments[i].toLowerCase()) {
      throw new Error(`Fragment ${i}'s live pointer bytecode does NOT match the fragment fed into the constructor. Stopping, do not trust this deployment.`);
    }
    console.log(`Fragment ${i} pointer ${pointerAddress}: verified byte-identical (${(pointerCode.length - 2) / 2} bytes).`);
    reconstructed += pointerCode.slice(2);
  }

  // 5. Independent verification #3: the FULL reconstruction (all
  // fragments concatenated, in order, computed HERE by this script, not
  // via the contract's own mandateVaultCreationCode() view) is
  // byte-identical to the original linked creation code.
  if (reconstructed.toLowerCase() !== linkedMandateVaultCode.toLowerCase()) {
    throw new Error("Independently reconstructed bytecode (fragments concatenated by this script) does NOT match the original linked MandateVault creation code. Stopping.");
  }
  console.log(`Verified: independently reconstructed bytecode is byte-identical to the original (${(reconstructed.length - 2) / 2} bytes).`);

  // Consistency check: the contract's own convenience view agrees too.
  await sleep(RPC_PACING_MS);
  const onchainReconstruction = await publicClient.readContract({
    address: deployerAddress,
    abi: deployerArtifact.default.abi,
    functionName: "mandateVaultCreationCode",
  }) as Hex;
  if (onchainReconstruction.toLowerCase() !== linkedMandateVaultCode.toLowerCase()) {
    throw new Error("mandateVaultCreationCode() view does NOT match the original linked creation code. Stopping.");
  }
  console.log("Verified: mandateVaultCreationCode() view agrees with the independent reconstruction.");

  // 6. Deploy a fully disposable, isolated MandateRoles for this test
  // instance -- deliberately NOT the real, shared MandateRoles
  // (0x91dC937Cf24cD84B415A1B9AD2f520834334504a). Granting this wallet
  // KEEPER_ROLE on the REAL shared roles contract would be a real,
  // unauthorized change to shared production infrastructure just to run
  // a disposable test; a throwaway roles contract keeps this instance
  // fully isolated while still allowing a real, live executeDecision
  // proof, not just a deposit proof.
  await sleep(RPC_PACING_MS);
  const rolesArtifact = await import("../forge-out/MandateRoles.sol/MandateRoles.json", { with: { type: "json" } });
  const rolesHash = await walletClient.deployContract({
    abi: rolesArtifact.default.abi,
    bytecode: rolesArtifact.default.bytecode.object as Hex,
    args: [account.address],
    chain: ARC_TESTNET,
    account,
  });
  await sleep(RPC_PACING_MS);
  const rolesReceipt = await publicClient.waitForTransactionReceipt({ hash: rolesHash });
  if (rolesReceipt.status !== "success" || !rolesReceipt.contractAddress) {
    throw new Error(`Throwaway MandateRoles deployment failed (tx ${rolesHash}).`);
  }
  const throwawayRolesAddress = rolesReceipt.contractAddress;
  console.log(`Throwaway MandateRoles: ${throwawayRolesAddress} (tx ${rolesHash})`);

  const rolesAbi = [
    { type: "function", name: "KEEPER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
    { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [] },
  ] as const;
  await sleep(RPC_PACING_MS);
  const keeperRole = await publicClient.readContract({ address: throwawayRolesAddress, abi: rolesAbi, functionName: "KEEPER_ROLE" });
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: throwawayRolesAddress, abi: rolesAbi, functionName: "grantRole", args: [keeperRole, account.address], chain: ARC_TESTNET, account }),
    "grantRole(KEEPER_ROLE, this wallet) on the throwaway roles",
  );

  // 7. setFactory to this same disposable wallet, one-shot, purely to
  // exercise deploy() for real -- never the real VaultFactory.
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: deployerAddress, abi: deployerArtifact.default.abi, functionName: "setFactory", args: [account.address], chain: ARC_TESTNET, account }),
    "setFactory(throwaway wallet)",
  );

  // 8. Deploy a real, throwaway test vault through the new mechanism,
  // wired to the throwaway roles contract above (not the real, shared
  // one). simulateContract predicts the real return value (the
  // CREATE2'd vault's address) against the CURRENT chain state
  // immediately before broadcasting, then writeContract sends that exact
  // same call for real -- the correct way to learn a write function's
  // return value from a real transaction, not an after-the-fact guess.
  await sleep(RPC_PACING_MS);
  const deployArgs = [
    USDC_ADDRESS,
    throwawayRolesAddress,
    "0x0000000000000000000000000000000000000000",
    "Throwaway v4 Mechanism Test",
    "vTEST",
    [],
    "0x0000000000000000000000000000000000000000",
  ] as const;
  const { result: predictedVaultAddress, request } = await publicClient.simulateContract({
    address: deployerAddress,
    abi: deployerArtifact.default.abi,
    functionName: "deploy",
    args: deployArgs,
    account,
    gas: 7_000_000n,
  });
  await sleep(RPC_PACING_MS);
  const deployHash = await walletClient.writeContract(request);
  await sleep(RPC_PACING_MS);
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== "success") throw new Error(`deploy() reverted (tx ${deployHash}).`);
  console.log(`deploy() (real, throwaway vault via CREATE2): ${deployHash}`);
  console.log(`Predicted (and now real) vault address: ${predictedVaultAddress}`);

  // 8. Independent verification #4: the predicted address actually holds
  // real, deployed code, and that vault's real onchain state is correct
  // -- fresh reads, never assumed from the simulation alone.
  await sleep(RPC_PACING_MS);
  const vaultCode = await publicClient.getCode({ address: predictedVaultAddress as `0x${string}` });
  if (!vaultCode || vaultCode === "0x") {
    throw new Error(`No code found at the predicted vault address ${predictedVaultAddress}. Stopping, do not trust this deployment.`);
  }
  console.log(`Verified: real code exists at ${predictedVaultAddress} (${(vaultCode.length - 2) / 2} bytes).`);

  const vaultAbi = [
    { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "roles", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "isRegisteredAsset", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "cctpTokenMessenger", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  ] as const;
  await sleep(RPC_PACING_MS);
  const liveFactory = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: vaultAbi, functionName: "factory" });
  await sleep(RPC_PACING_MS);
  const liveRoles = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: vaultAbi, functionName: "roles" });
  await sleep(RPC_PACING_MS);
  const liveIsRegistered = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: vaultAbi, functionName: "isRegisteredAsset", args: [USDC_ADDRESS] });
  await sleep(RPC_PACING_MS);
  const liveCctpMessenger = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: vaultAbi, functionName: "cctpTokenMessenger" });
  console.log(`Verified onchain: factory=${liveFactory}, roles=${liveRoles}, isRegisteredAsset(USDC)=${liveIsRegistered}, cctpTokenMessenger=${liveCctpMessenger}`);
  if (
    liveFactory.toLowerCase() !== account.address.toLowerCase() ||
    liveRoles.toLowerCase() !== throwawayRolesAddress.toLowerCase() ||
    liveIsRegistered !== true ||
    liveCctpMessenger.toLowerCase() !== "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("Live vault state does not match what was requested. Do not treat this deployment as verified.");
  }

  // 9. Deploy and wire a throwaway VaultPolicy -- normally VaultFactory's
  // job (deploy MandateVault, deploy VaultPolicy, call setPolicy, all in
  // one atomic transaction), done manually here since this script calls
  // MandateVaultDeployer.deploy() directly, bypassing VaultFactory
  // entirely (deliberately, to isolate testing the deployment mechanism
  // itself). Without this, maxDeposit() returns 0 while policy is unset
  // (see MandateVault.sol), so a real deposit would correctly revert with
  // ERC4626ExceededMaxDeposit -- confirmed live on the first version of
  // this script, not a bug in the mechanism, just a missing setup step.
  const policyArtifact = await import("../forge-out/VaultPolicy.sol/VaultPolicy.json", { with: { type: "json" } });
  const constructorLimits = {
    vault: predictedVaultAddress,
    roles: throwawayRolesAddress,
    maxDrawdownBps: 10_000n,
    maxTradesPerDay: 100n,
    minStableAllocationBps: 0n,
    oracleMaxStalenessSeconds: 86_400n,
    oracleMaxDeviationBps: 10_000n,
    maxDrawdownSpeedBpsPerWindow: 10_000n,
    drawdownSpeedWindowSeconds: 3_600n,
    assets: [USDC_ADDRESS],
    maxAllocationBps: [10_000n],
    stableAssets: [USDC_ADDRESS],
    minLpTickRangeWidth: 0,
    maxLpPositionValueLossBps: 0n,
    maxLpOutOfRangeSeconds: 0n,
    minLpPoolLiquidityRatioBps: 0n,
    maxLpAllocationBps: 0n,
    lendingReportStaleAfterSeconds: 0n,
    lendingReportMaxDeviationBps: 0n,
    lendingPositionForceUnwindSeconds: 0n,
    maxLendingAllocationBps: 0n,
  };
  await sleep(RPC_PACING_MS);
  const policyHash = await walletClient.deployContract({
    abi: policyArtifact.default.abi,
    bytecode: policyArtifact.default.bytecode.object as Hex,
    args: [constructorLimits],
    chain: ARC_TESTNET,
    account,
  });
  await sleep(RPC_PACING_MS);
  const policyReceipt = await publicClient.waitForTransactionReceipt({ hash: policyHash });
  if (policyReceipt.status !== "success" || !policyReceipt.contractAddress) {
    throw new Error(`Throwaway VaultPolicy deployment failed (tx ${policyHash}).`);
  }
  const throwawayPolicyAddress = policyReceipt.contractAddress;
  console.log(`Throwaway VaultPolicy: ${throwawayPolicyAddress} (tx ${policyHash})`);

  const setPolicyAbi = [{ type: "function", name: "setPolicy", stateMutability: "nonpayable", inputs: [{ name: "policy_", type: "address" }], outputs: [] }] as const;
  // setPolicy is onlyFactory -- this wallet IS the throwaway factory (see
  // setFactory step above), so this call is authorized, same as
  // VaultFactory.createVault would do internally for a real vault.
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: predictedVaultAddress as `0x${string}`, abi: setPolicyAbi, functionName: "setPolicy", args: [throwawayPolicyAddress], chain: ARC_TESTNET, account }),
    "setPolicy(throwaway VaultPolicy) on the throwaway vault",
  );

  // 10. Functional checks: a real deposit, and a real HOLD executeDecision
  // with proper access control -- proving the deployed vault doesn't just
  // exist, it behaves correctly.
  const usdcAbi = [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  ] as const;
  await sleep(RPC_PACING_MS);
  const usdcBalance = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
  console.log(`Wallet USDC balance: ${usdcBalance}`);
  const DEPOSIT_AMOUNT = 1_000_000n; // 1 USDC, 6 decimals
  if (usdcBalance < DEPOSIT_AMOUNT) {
    throw new Error(`Wallet holds less than 1 USDC (${usdcBalance}), cannot run the real deposit check. Fund it and re-run.`);
  }

  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [predictedVaultAddress as `0x${string}`, DEPOSIT_AMOUNT], chain: ARC_TESTNET, account }),
    "USDC.approve(throwaway vault, 1 USDC)",
  );

  const erc4626Abi = [
    { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  ] as const;
  await sleep(RPC_PACING_MS);
  const navBeforeDeposit = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: erc4626Abi, functionName: "totalAssets" });
  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({ address: predictedVaultAddress as `0x${string}`, abi: erc4626Abi, functionName: "deposit", args: [DEPOSIT_AMOUNT, account.address], chain: ARC_TESTNET, account }),
    "deposit(1 USDC) on the throwaway vault",
  );
  await sleep(RPC_PACING_MS);
  const navAfterDeposit = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: erc4626Abi, functionName: "totalAssets" });
  await sleep(RPC_PACING_MS);
  const sharesAfterDeposit = await publicClient.readContract({ address: predictedVaultAddress as `0x${string}`, abi: erc4626Abi, functionName: "balanceOf", args: [account.address] });
  console.log(`totalAssets before/after real deposit: ${navBeforeDeposit} -> ${navAfterDeposit}; depositor shares: ${sharesAfterDeposit}`);
  if (navAfterDeposit !== navBeforeDeposit + DEPOSIT_AMOUNT || sharesAfterDeposit === 0n) {
    throw new Error("Real deposit did not update NAV/shares as expected. Do not treat this deployment as verified.");
  }
  console.log("Verified: a real deposit through the fragmentation-deployed vault updates NAV and mints real shares correctly.");

  // Real HOLD executeDecision, using the throwaway KEEPER_ROLE grant above.
  const executeDecisionAbi = [
    {
      type: "function",
      name: "executeDecision",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "decision",
          type: "tuple",
          components: [
            { name: "action", type: "uint8" },
            { name: "asset", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "targetAllocations", type: "tuple[]", components: [{ name: "asset", type: "address" }, { name: "targetWeightBps", type: "uint16" }] },
            { name: "lpPool", type: "address" },
            { name: "tickLower", type: "int24" },
            { name: "tickUpper", type: "int24" },
            { name: "amount0Desired", type: "uint256" },
            { name: "amount1Desired", type: "uint256" },
            { name: "amount0Min", type: "uint256" },
            { name: "amount1Min", type: "uint256" },
            { name: "lpTokenId", type: "uint256" },
            { name: "liquidityToRemove", type: "uint128" },
            { name: "chainId", type: "uint256" },
            { name: "lendingPositionId", type: "uint256" },
          ],
        },
        { name: "prices", type: "tuple[]", components: [{ name: "asset", type: "address" }, { name: "price", type: "uint256" }, { name: "referencePrice", type: "uint256" }, { name: "updatedAt", type: "uint256" }] },
        {
          name: "swaps",
          type: "tuple[]",
          components: [
            { name: "router", type: "address" }, { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
            { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
          ],
        },
        {
          name: "lpLeg",
          type: "tuple",
          components: [
            { name: "pool", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
            { name: "amount0Desired", type: "uint256" }, { name: "amount1Desired", type: "uint256" }, { name: "amount0Min", type: "uint256" }, { name: "amount1Min", type: "uint256" },
            { name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }, { name: "deadline", type: "uint256" },
          ],
        },
        { name: "bridgeLeg", type: "tuple", components: [{ name: "chainId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "positionId", type: "uint256" }, { name: "cctpDestinationDomain", type: "uint32" }, { name: "maxFee", type: "uint256" }] },
      ],
      outputs: [{ type: "bool" }],
    },
  ] as const;
  const holdDecision = {
    action: 0, // HOLD
    asset: "0x0000000000000000000000000000000000000000",
    amount: 0n,
    targetAllocations: [],
    lpPool: "0x0000000000000000000000000000000000000000",
    tickLower: 0,
    tickUpper: 0,
    amount0Desired: 0n,
    amount1Desired: 0n,
    amount0Min: 0n,
    amount1Min: 0n,
    lpTokenId: 0n,
    liquidityToRemove: 0n,
    chainId: 0n,
    lendingPositionId: 0n,
  } as const;
  const emptyLpLeg = {
    pool: "0x0000000000000000000000000000000000000000", fee: 0, tickLower: 0, tickUpper: 0,
    amount0Desired: 0n, amount1Desired: 0n, amount0Min: 0n, amount1Min: 0n, tokenId: 0n, liquidity: 0n, deadline: 0n,
  } as const;
  const emptyBridgeLeg = { chainId: 0n, amount: 0n, positionId: 0n, cctpDestinationDomain: 0, maxFee: 0n } as const;

  await sleep(RPC_PACING_MS);
  await confirm(
    walletClient.writeContract({
      address: predictedVaultAddress as `0x${string}`,
      abi: executeDecisionAbi,
      functionName: "executeDecision",
      args: [holdDecision, [], [], emptyLpLeg, emptyBridgeLeg],
      chain: ARC_TESTNET,
      account,
    }),
    "executeDecision(HOLD) on the throwaway vault (real KEEPER_ROLE holder)",
  );
  console.log("Verified: a real HOLD executeDecision call succeeds through the fragmentation-deployed vault, with real KEEPER_ROLE access control enforced by the throwaway roles contract.");

  console.log("\n=== Throwaway verification summary ===");
  console.log(`MandateVaultDeployer: ${deployerAddress}`);
  console.log(`Fragments:            ${fragments.length}`);
  console.log(`Throwaway roles:      ${throwawayRolesAddress}`);
  console.log(`Throwaway vault:      ${predictedVaultAddress}`);
  console.log(`deploy() tx:          ${deployHash}`);
  console.log("All independent checks passed: no embedding on the real chain, every fragment byte-identical, full reconstruction byte-identical, real vault deployed with correct onchain state, real deposit and real HOLD executeDecision both succeeded.");
  console.log("This is a disposable verification instance -- do not use it for any real v4 vault or funds.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
