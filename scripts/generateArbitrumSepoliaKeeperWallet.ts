// Generates a fresh, dedicated private key for v4's Arbitrum Sepolia
// chainKeeper role (the per-destination-chain identity that calls
// Aave's Pool.supply()/withdraw() and LendingPositionRegistry's
// reportLendingPosition, see contracts/LendingPositionRegistry.sol).
//
// Deliberately a SEPARATE wallet from KEEPER_PRIVATE_KEY (the existing
// Arc-side executor identity that calls executeDecision): same
// capability-limited, per-chain isolation this project's own v4 design
// settled on after the Radiant Capital security research -- if the Arc
// keeper is ever compromised, that compromise must not automatically
// grant authority to report/move value on Arbitrum Sepolia, and vice
// versa. Each chainKeeper only ever holds authority for its own chain,
// assigned via LendingPositionRegistry.proposeChainKeeper/executeChainKeeper
// (governance-gated, in practice behind the new 2-of-2 Safe), never a
// shared identity across chains.
//
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY=")) {
  throw new Error("ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY=${privateKey}\n`);

console.log(`ARBITRUM_SEPOLIA_KEEPER address: ${account.address}`);
console.log("Fund this address with a small amount of real Arbitrum Sepolia ETH (for gas -- unlike Arc, Arbitrum Sepolia's native gas token is ETH, not USDC) before it can call supply()/withdraw()/reportLendingPosition for real.");
