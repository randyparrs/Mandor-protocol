// Prints only the deployer wallet's public address, never the private key.
// Run with: npx hardhat run scripts/showDeployerAddress.ts --network arcTestnet
import { network } from "hardhat";

const { viem } = await network.connect({ network: "arcTestnet" });
const [wallet] = await viem.getWalletClients();
console.log(wallet.account.address);
