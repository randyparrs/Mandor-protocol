// Read-only viem calls against the real deployed vaults. No signing key,
// no Circle dependency, public RPC only (see src/README.md's "never hold
// the keeper key or the Anthropic API key" rule).
import { createPublicClient, http } from "viem";
import { ARC_TESTNET } from "./arcChain";
import { VAULT_ABI, VAULT_POLICY_ABI, ERC20_ABI } from "./vaultAbi";
import { BASE_ASSET_ADDRESS } from "./vaults";
import { formatRawAmount } from "../../shared/money";

export const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

export interface VaultReadState {
  totalAssetsUSDC: string;
  yourShares: bigint;
  yourPositionUSDC: string;
  maxDepositUSDC: string;
  maxWithdrawUSDC: string;
  allowance: bigint;
  paused: boolean;
}

/// @notice maxDeposit/maxWithdraw are the single source of truth (already
/// net out pause state and the shared CapitalLimitRegistry cap /
/// liquidity floor onchain, see contracts/MandateVault.sol:239-265), never
/// recomputed independently here.
export async function readVaultState(vaultAddress: `0x${string}`, policyAddress: `0x${string}`, userAddress: `0x${string}`): Promise<VaultReadState> {
  const [totalAssets, shares, maxDeposit, maxWithdraw, allowance, paused] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "totalAssets" }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "balanceOf", args: [userAddress] }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "maxDeposit", args: [userAddress] }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "maxWithdraw", args: [userAddress] }),
    publicClient.readContract({ address: BASE_ASSET_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [userAddress, vaultAddress] }),
    publicClient.readContract({ address: policyAddress, abi: VAULT_POLICY_ABI, functionName: "paused" }),
  ]);
  const yourPositionAssets = await publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "convertToAssets", args: [shares] });

  return {
    totalAssetsUSDC: formatRawAmount(totalAssets, 6),
    yourShares: shares,
    yourPositionUSDC: formatRawAmount(yourPositionAssets, 6),
    maxDepositUSDC: formatRawAmount(maxDeposit, 6),
    maxWithdrawUSDC: formatRawAmount(maxWithdraw, 6),
    allowance,
    paused,
  };
}
