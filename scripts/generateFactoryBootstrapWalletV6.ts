// Generates a fresh, dedicated private key purely to deploy v6's new
// MandateVaultDeployer+VaultFactory pair (Gen5). Deliberately a NEW wallet,
// never FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY (v5's own bootstrap
// wallet, already spent on that specific purpose) or any earlier one --
// same single-purpose, never-reused-across-bootstraps discipline already
// applied for every prior factory generation.
//
// Needed for two combined reasons, both real triggers documented in
// docs/deployments.md:
// 1. VaultPolicy.ConstructorLimits gained a new field (performanceFeeBps),
//    the classic shape-change trigger already seen going from v1/v2 to v3
//    and v3 to v4 -- VaultFactory.CreateVaultParams embeds that struct
//    directly, so the currently-live (Gen4, v5-era) VaultFactory's
//    createVault ABI no longer matches current source.
// 2. contracts/MandateVault.sol itself gained new logic (the performance-fee
//    accrual hooks), which MandateVaultDeployer embeds as fragmented
//    bytecode at ITS OWN deploy time -- the same "any logic change to an
//    embedded contract needs a fresh deployer" lesson learned during v5's
//    own Gen4 bootstrap (see docs/deployments.md's "VaultPolicy logic
//    changes always need a new factory" note; the identical reasoning
//    applies to MandateVault.sol changes and MandateVaultDeployer).
//
// Neither MandateVaultDeployer's constructor nor VaultFactory's own
// deployment step needs any privileged role (same as every prior
// bootstrap: MandateVaultDeployer.constructor just records msg.sender and
// deploys BytecodePointer fragments, VaultFactory's constructor takes
// plain addresses), so this key never touches ADMIN_ROLE/GOVERNANCE_ROLE
// and holds no authority anywhere else in this project, same isolation
// discipline as every other single-purpose wallet here. The real ADMIN
// key is only needed afterward, once, for the actual createVault call
// (scripts/deployVaultV6.ts, pointed at this new factory).
//
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("FACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY=")) {
  throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nFACTORY_BOOTSTRAP_DEPLOYER_V6_PRIVATE_KEY=${privateKey}\n`);

console.log(`FACTORY_BOOTSTRAP_DEPLOYER_V6 address: ${account.address}`);
console.log("Fund this address with a small amount of real Arc Testnet gas (native currency, same faucet used before: https://faucet.circle.com), then run scripts/deployVaultFactoryForV6.ts.");
