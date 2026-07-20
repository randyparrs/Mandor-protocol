// Generates a fresh, dedicated private key purely to deploy v5's new
// MandateVaultDeployer+VaultFactory pair (Gen4). Deliberately a NEW wallet,
// never FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY (v4's own bootstrap
// wallet, already spent on that specific purpose) or any earlier one --
// same single-purpose, never-reused-across-bootstraps discipline already
// applied for every prior factory generation.
//
// Needed because of a real, live-verified gap: contracts/VaultFactory.sol
// deploys VaultPolicy via `new VaultPolicy(params.limits)`, a direct
// Solidity `new`, which embeds VaultPolicy's FULL compiled bytecode into
// VaultFactory's own bytecode at VaultFactory's own deploy time, not at
// the time a vault is created from it. This means ANY logic change inside
// contracts/VaultPolicy.sol -- even with zero change to ConstructorLimits'
// shape, unlike every prior factory bootstrap's own trigger -- requires a
// brand new VaultFactory, because the currently-live (Gen3, v4-era)
// VaultFactory at 0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb has the OLD
// VaultPolicy logic (predating the REBALANCE/maxDrawdownBps exemption)
// permanently baked in. Confirmed empirically, not assumed: a live
// validateDecision call against a v5 vault deployed through Gen3 showed
// REBALANCE still failing MAX_DRAWDOWN_EXCEEDED during a high-drawdown
// state, identically to HOLD -- proof the exemption was never actually
// live, despite the constructor's maxDrawdownBps argument itself being
// correctly 1000. See docs/deployments.md's "VaultPolicy logic changes
// always need a new factory" note for the full writeup of this lesson.
//
// Neither MandateVaultDeployer's constructor nor VaultFactory's own
// deployment step needs any privileged role (same as every prior
// bootstrap: MandateVaultDeployer.constructor just records msg.sender and
// deploys BytecodePointer fragments, VaultFactory's constructor takes
// plain addresses), so this key never touches ADMIN_ROLE/GOVERNANCE_ROLE
// and holds no authority anywhere else in this project, same isolation
// discipline as every other single-purpose wallet here. The real ADMIN
// key is only needed afterward, once, for the actual createVault call
// (scripts/deployVaultV5.ts, pointed at this new factory).
//
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY=")) {
  throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nFACTORY_BOOTSTRAP_DEPLOYER_V5_PRIVATE_KEY=${privateKey}\n`);

console.log(`FACTORY_BOOTSTRAP_DEPLOYER_V5 address: ${account.address}`);
console.log("Fund this address with a small amount of real Arc Testnet gas (native currency, same faucet used before: https://faucet.circle.com), then run scripts/deployVaultFactoryForV5.ts.");
