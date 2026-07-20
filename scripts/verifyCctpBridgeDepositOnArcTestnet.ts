// Live verification of the exact depositForBurn call MandateVault._bridgeDeposit
// makes, against the real CCTP V2 TokenMessengerV2 on Arc Testnet, using a
// small, disposable test amount from the FACTORY_BOOTSTRAP_DEPLOYER_V4 wallet
// (already funded with real Arc Testnet USDC, holds no privileged role).
//
// Scope note: this calls depositForBurn directly, not through a deployed
// MandateVault's executeDecision(BRIDGE_DEPOSIT). Going through the real
// vault mechanism requires LendingPositionRegistry.chainKeeper to be set for
// the destination chain, which is gated by a real, unconditional 48h
// propose/execute timelock (LendingPositionRegistry.sol) -- not bypassable,
// and not completable within a single live session. This script instead
// tests the exact call MandateVault._bridgeDeposit constructs (same
// parameter values, same real contract) in isolation, which is what
// determines whether that call site is correct.
//
// Independent verification, not just "did the tx revert": decodes the real
// DepositForBurn event Circle's TokenMessengerV2 actually emitted and
// compares every field against what was sent, especially destinationCaller
// and minFinalityThreshold.

import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const USDC_ADDRESS = getAddress("0x3600000000000000000000000000000000000000");
const TOKEN_MESSENGER_V2 = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
const ARBITRUM_SEPOLIA_DOMAIN = 3;
const CCTP_MIN_FINALITY_THRESHOLD = 1000; // matches MandateVault.sol's own constant

// Real CCTP V2 depositForBurn/DepositForBurn ABI, verified against Circle's
// actual source (circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol)
// immediately before writing this script -- not guessed.
const tokenMessengerAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

const depositForBurnEvent = parseAbiItem(
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
);

const usdcAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const account = privateKeyToAccount(process.env.FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY as `0x${string}`);
  const keeperAccount = privateKeyToAccount(process.env.ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY as `0x${string}`);
  const keeperAddress = keeperAccount.address;
  const keeperBytes32 = `0x${"0".repeat(24)}${keeperAddress.slice(2).toLowerCase()}` as `0x${string}`;

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const walletClient = createWalletClient({ account, chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

  console.log(`Sender (FACTORY_BOOTSTRAP_DEPLOYER_V4): ${account.address}`);
  console.log(`Destination keeper (Arbitrum Sepolia): ${keeperAddress}`);
  console.log(`mintRecipient/destinationCaller (bytes32): ${keeperBytes32}`);

  const balanceBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
  console.log(`Sender USDC balance before: ${balanceBefore}`);

  const AMOUNT = 100_000n; // 0.1 USDC, small disposable test amount
  const MAX_FEE = 1_000n; // 0.001 USDC, well under the amount, real Fast Transfer fee ceiling for this test
  if (balanceBefore < AMOUNT) throw new Error(`Sender holds less than ${AMOUNT} USDC units, fund it first.`);

  console.log("\n--- Step 1: approve ---");
  const approveHash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "approve",
    args: [TOKEN_MESSENGER_V2, AMOUNT],
    chain: ARC_TESTNET,
    account,
  });
  console.log(`approve tx: ${approveHash}`);
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`approve status: ${approveReceipt.status}`);

  console.log("\n--- Step 2: depositForBurn (exact MandateVault._bridgeDeposit call shape) ---");
  const depositHash = await walletClient.writeContract({
    address: TOKEN_MESSENGER_V2,
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [AMOUNT, ARBITRUM_SEPOLIA_DOMAIN, keeperBytes32, USDC_ADDRESS, keeperBytes32, MAX_FEE, CCTP_MIN_FINALITY_THRESHOLD],
    chain: ARC_TESTNET,
    account,
  });
  console.log(`depositForBurn tx: ${depositHash}`);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`depositForBurn status: ${depositReceipt.status}`);
  if (depositReceipt.status !== "success") throw new Error("depositForBurn transaction reverted");

  console.log("\n--- Step 3: independently decode the real DepositForBurn event, not just trust the non-revert ---");
  let found = false;
  for (const log of depositReceipt.logs) {
    if (log.address.toLowerCase() !== TOKEN_MESSENGER_V2.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: [depositForBurnEvent], data: log.data, topics: log.topics });
      found = true;
      console.log("Decoded real DepositForBurn event:");
      console.log(decoded.args);

      const checks: Array<[string, boolean]> = [
        ["burnToken == USDC_ADDRESS", decoded.args.burnToken.toLowerCase() === USDC_ADDRESS.toLowerCase()],
        ["amount == AMOUNT", decoded.args.amount === AMOUNT],
        ["depositor == sender", decoded.args.depositor.toLowerCase() === account.address.toLowerCase()],
        ["mintRecipient == keeperBytes32", decoded.args.mintRecipient.toLowerCase() === keeperBytes32.toLowerCase()],
        ["destinationDomain == 3 (Arbitrum Sepolia)", decoded.args.destinationDomain === ARBITRUM_SEPOLIA_DOMAIN],
        ["destinationCaller == keeperBytes32 (restricted, not open)", decoded.args.destinationCaller.toLowerCase() === keeperBytes32.toLowerCase()],
        ["maxFee == MAX_FEE", decoded.args.maxFee === MAX_FEE],
        ["minFinalityThreshold == 1000 (Fast Transfer)", decoded.args.minFinalityThreshold === CCTP_MIN_FINALITY_THRESHOLD],
      ];
      console.log("\nField-by-field verification:");
      let allPassed = true;
      for (const [label, passed] of checks) {
        console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
        if (!passed) allPassed = false;
      }
      if (!allPassed) throw new Error("One or more DepositForBurn event fields did not match the expected values.");
    } catch (err) {
      if (found) throw err;
      // not the DepositForBurn log, skip
    }
  }
  if (!found) throw new Error("No DepositForBurn event found in the transaction receipt logs -- cannot verify the real on-chain effect.");

  const balanceAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
  const delta = balanceBefore - balanceAfter;
  // Arc pays gas in USDC itself (the native currency IS USDC here), so the
  // real delta is AMOUNT burned plus whatever gas the approve+depositForBurn
  // txs consumed -- must be >= AMOUNT, not exactly equal to it.
  console.log(`\nSender USDC balance after: ${balanceAfter} (delta: ${delta}, AMOUNT burned: ${AMOUNT}, remainder is real gas paid in USDC: ${delta - AMOUNT})`);
  if (delta < AMOUNT) throw new Error("USDC balance dropped by less than the deposited/burned amount -- unexpected.");

  console.log("\nAll checks passed. The real depositForBurn call reached Circle's real TokenMessengerV2 on Arc Testnet with the exact parameters MandateVault._bridgeDeposit constructs, verified independently from the decoded event, not just the absence of a revert.");
  console.log(`\nTransaction hash for docs/deployments.md: ${depositHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
