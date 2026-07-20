// Generates a fresh, dedicated private key purely to deploy v4's new
// MandateVaultDeployer+VaultFactory pair. Deliberately a NEW wallet, never
// FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY (v3's bootstrap wallet) reused --
// same single-purpose, never-reused-across-bootstraps discipline already
// applied when v3's own factory pair was bootstrapped (see
// scripts/generateFactoryBootstrapWallet.ts's own doc comment).
//
// Needed because v4's ConstructorLimits gained 4 new lending-specific
// fields (lendingReportStaleAfterSeconds/lendingReportMaxDeviationBps/
// lendingPositionForceUnwindSeconds/maxLendingAllocationBps), so the real,
// already-deployed v3 VaultFactory's createVault ABI no longer matches
// current source, same reasoning that already forced the v1/v2 -> v3
// factory bootstrap.
//
// Neither MandateVaultDeployer's constructor nor VaultFactory's own
// deployment step needs any privileged role (confirmed by reading both
// contracts again for v4: MandateVaultDeployer.constructor just records
// msg.sender and deploys BytecodePointer fragments, VaultFactory's
// constructor takes plain addresses), so this key never touches
// ADMIN_ROLE/GOVERNANCE_ROLE and holds no authority anywhere else in this
// project, same isolation discipline as every other single-purpose wallet
// here. The real ADMIN key is only needed later, for the actual
// createVault call against this new factory (deployVaultV4.ts, held off
// per Randy's explicit instruction until the three real v4 blockers --
// CCTP TokenMessenger/domain, the 2-of-3 Safe multisig, the Arbitrum
// Sepolia keeper wallet -- are resolved).
//
// The private key is appended straight to .env (already gitignored) and
// never printed, logged, or returned to the caller, only the derived
// public address is.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = path.join(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (existing.includes("FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY=")) {
  throw new Error("FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY already exists in .env, refusing to overwrite. Remove it first if you really want a new one.");
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

fs.appendFileSync(envPath, `\nFACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY=${privateKey}\n`);

console.log(`FACTORY_BOOTSTRAP_DEPLOYER_V4 address: ${account.address}`);
console.log("Fund this address with a small amount of real Arc Testnet gas (native currency, same faucet used before: https://faucet.circle.com), then run scripts/deployVaultFactoryForV4.ts.");
