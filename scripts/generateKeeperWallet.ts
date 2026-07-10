// Generates a fresh, dedicated private key for the KEEPER role (the
// executor service's onchain identity, only ever calls executeDecision).
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("KEEPER_PRIVATE_KEY=")) {
  throw new Error("KEEPER_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nKEEPER_PRIVATE_KEY=${privateKey}\n`);

console.log(`KEEPER address: ${account.address}`);
