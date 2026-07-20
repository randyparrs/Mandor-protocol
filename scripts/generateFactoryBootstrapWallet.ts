// Generates a fresh, dedicated private key purely to deploy a new
// MandateVaultDeployer+VaultFactory pair (see scripts/deployVaultFactoryForV3.ts's
// own doc comment for why a new pair is needed: the real, already-deployed
// VaultFactory's bytecode predates VaultPolicy.ConstructorLimits' 5 new
// v3 LP fields, so its createVault ABI no longer matches current source).
// Neither MandateVaultDeployer's constructor nor VaultFactory's own
// deployment step needs any privileged role (confirmed by reading both
// contracts: MandateVaultDeployer.constructor just records msg.sender,
// VaultFactory's constructor takes plain addresses), so this key never
// touches ADMIN_ROLE/GOVERNANCE_ROLE and holds no authority anywhere else
// in this project, same isolation discipline as
// scripts/generateKeeperWallet.ts and TEST_TOKEN_DEPLOYER_PRIVATE_KEY.
// The real ADMIN key is only needed once, for the final createVault call
// against the new factory, minimizing how many times that keystore needs
// to be opened.
//
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY=")) {
  throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nFACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY=${privateKey}\n`);

console.log(`FACTORY_BOOTSTRAP_DEPLOYER address: ${account.address}`);
console.log("Fund this address with a small amount of real Arc Testnet gas (native currency, same faucet used before), then run scripts/deployVaultFactoryForV3.ts.");
