// Thin helper around a connected Privy wallet, mirroring the real, proven
// pattern from design_handoff_vpay/app/src/lib/chain.ts's
// createPrivySigner, simplified: this project calls known ERC-4626/ERC-20
// functions directly via viem's writeContract, so a plain WalletClient is
// enough, no generic "signAndSend a raw tx" abstraction needed.
import { createWalletClient, custom, type WalletClient } from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { ARC_TESTNET } from "./arcChain";

export async function createPrivyWalletClient(wallet: ConnectedWallet): Promise<WalletClient> {
  const provider = await wallet.getEthereumProvider();
  return createWalletClient({
    account: wallet.address as `0x${string}`,
    chain: ARC_TESTNET,
    transport: custom(provider),
  });
}
