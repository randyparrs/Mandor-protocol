// Real, user-signed ERC-4626 deposit/withdraw calls. No custom contract
// wiring: deposit/withdraw/approve are the vault's/base asset's own
// standard functions (see src/lib/vaultAbi.ts's doc comment), this file
// only sequences them and waits for each receipt, same discipline as
// executor/keeperService.ts's own sequential-confirm pattern.
import type { WalletClient } from "viem";
import { VAULT_ABI, ERC20_ABI } from "./vaultAbi";
import { BASE_ASSET_ADDRESS, BASE_ASSET_DECIMALS } from "./vaults";
import { publicClient } from "./vaultReads";
import { parseRawAmount } from "../../shared/money";

async function submitAndWait(walletClient: WalletClient, request: Parameters<WalletClient["writeContract"]>[0]): Promise<`0x${string}`> {
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted onchain.`);
  }
  return hash;
}

/// @notice Approves exactly the requested amount, not an unlimited
/// allowance: least-privilege, matches this project's conservative
/// posture elsewhere. A future deposit past this exact amount needs a
/// fresh approve, a deliberate tradeoff, not an oversight.
export async function approveSpend(walletClient: WalletClient, userAddress: `0x${string}`, vaultAddress: `0x${string}`, amountHuman: string): Promise<`0x${string}`> {
  const amountRaw = parseRawAmount(amountHuman, BASE_ASSET_DECIMALS);
  return submitAndWait(walletClient, {
    address: BASE_ASSET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vaultAddress, amountRaw],
    account: userAddress,
    chain: walletClient.chain!,
  });
}

export async function depositToVault(walletClient: WalletClient, userAddress: `0x${string}`, vaultAddress: `0x${string}`, amountHuman: string): Promise<`0x${string}`> {
  const amountRaw = parseRawAmount(amountHuman, BASE_ASSET_DECIMALS);
  return submitAndWait(walletClient, {
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "deposit",
    args: [amountRaw, userAddress],
    account: userAddress,
    chain: walletClient.chain!,
  });
}

/// @notice Withdraws by asset amount (not shares), capped by the vault's
/// own maxWithdraw (see src/lib/vaultReads.ts's doc comment: already nets
/// out the liquid-ledger floor onchain, never recomputed here).
export async function withdrawFromVault(walletClient: WalletClient, userAddress: `0x${string}`, vaultAddress: `0x${string}`, amountHuman: string): Promise<`0x${string}`> {
  const amountRaw = parseRawAmount(amountHuman, BASE_ASSET_DECIMALS);
  return submitAndWait(walletClient, {
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "withdraw",
    args: [amountRaw, userAddress, userAddress],
    account: userAddress,
    chain: walletClient.chain!,
  });
}
