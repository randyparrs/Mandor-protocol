// Read-only viem calls against the real deployed vaults. No signing key,
// public RPC only, same discipline as the old frontend's src/lib/vaultReads.ts.
//
// RPC_PACING_MS/sequential-never-Promise.all: this exact public RPC
// (https://rpc.testnet.arc.network) rate-limits concurrent requests --
// confirmed live (a Promise.all batch across the 4 vaults' reads returned
// "request limit reached"), same constraint already documented and paced
// around in server/indexer/eventIndexer.ts. Reusing that file's own
// RPC_PACING_MS value here rather than guessing a smaller one.
import { createPublicClient, http, formatUnits } from 'viem';
import { ARC_TESTNET } from './arcChain';
import { VAULT_ABI, ERC20_ABI } from './vaultAbi';
import type { VaultConfig } from './vaults';

export const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const RPC_PACING_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VaultTotals {
  totalAssets: number;
  maxDeposit: number;
}

export interface UserPosition {
  shares: number;
  position: number;
  maxWithdraw: number;
  walletBalance: number;
  allowance: number;
}

/// @notice Vault-level reads only, no connected wallet required. `maxDeposit`
/// takes an address parameter in the ABI, but contracts/MandateVault.sol:481
/// (and the same override in MandateVaultLending.sol/MandateVaultLp.sol)
/// declares it with an unnamed `address` param -- confirmed the override
/// ignores it entirely (a global cap, not per-address), so the zero address
/// here returns the exact same value a real connected user would see.
export async function readVaultTotals(config: VaultConfig): Promise<VaultTotals> {
  const totalAssets = await publicClient.readContract({ address: config.address, abi: VAULT_ABI, functionName: 'totalAssets' });
  await sleep(RPC_PACING_MS);
  const maxDeposit = await publicClient.readContract({ address: config.address, abi: VAULT_ABI, functionName: 'maxDeposit', args: [ZERO_ADDRESS] });
  return {
    totalAssets: Number(formatUnits(totalAssets, config.assetDecimals)),
    maxDeposit: Number(formatUnits(maxDeposit, config.assetDecimals)),
  };
}

/// @notice Per-user reads, called once a real wallet is connected.
export async function readUserPosition(config: VaultConfig, userAddress: `0x${string}`): Promise<UserPosition> {
  const shares = await publicClient.readContract({ address: config.address, abi: VAULT_ABI, functionName: 'balanceOf', args: [userAddress] });
  await sleep(RPC_PACING_MS);
  const maxWithdraw = await publicClient.readContract({ address: config.address, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [userAddress] });
  await sleep(RPC_PACING_MS);
  const walletBalance = await publicClient.readContract({ address: config.assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [userAddress] });
  await sleep(RPC_PACING_MS);
  const allowance = await publicClient.readContract({ address: config.assetAddress, abi: ERC20_ABI, functionName: 'allowance', args: [userAddress, config.address] });
  await sleep(RPC_PACING_MS);
  const position = await publicClient.readContract({ address: config.address, abi: VAULT_ABI, functionName: 'convertToAssets', args: [shares] });

  return {
    shares: Number(formatUnits(shares, config.assetDecimals)),
    position: Number(formatUnits(position, config.assetDecimals)),
    maxWithdraw: Number(formatUnits(maxWithdraw, config.assetDecimals)),
    walletBalance: Number(formatUnits(walletBalance, config.assetDecimals)),
    allowance: Number(formatUnits(allowance, config.assetDecimals)),
  };
}
