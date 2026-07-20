// Simulated, evolving VaultState for the Paper Vault (scripts/paperVaultCycle.ts).
// No real contract exists to read this from, unlike v1/v2 (see
// agent/core/tools/getVaultState.ts), so it is tracked in a small local
// JSON file instead, the same "plain file, not sqlite" simplicity
// PaperExecutor's own JSONL log already uses for paper-mode data. Never
// used for anything with real execution authority.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { projectDataPath } from "./paths.js";
import type { VaultState } from "../agent/core/types.js";
import { PAPER_VAULT_ID } from "../scripts/paperVaultConfig.js";

const STATE_PATH = projectDataPath("paperVaultState.json");

const SEED_STATE: VaultState = {
  vaultId: PAPER_VAULT_ID,
  totalAssetsUSDC: "100.00",
  holdings: [{ asset: "USDC", ledgerAmount: "100.00", valueUSDC: "100.00" }],
  paused: false,
  tradesToday: 0,
  highWaterMarkUSDC: "100.00",
  currentDrawdownBps: 0,
  // The Paper Vault keeps using the existing ENTER/EXIT/REBALANCE action
  // vocabulary to simulate exposure to an LP opportunity's underlying
  // assets, never the real LP_* actions (no NFT/tick simulation here),
  // see this project's v3 design doc. Always empty.
  lpPositions: [],
  // Same reasoning as lpPositions: no real cross-chain lending simulation
  // in the Paper Vault, always empty.
  currentLendingPositions: [],
};

/// @notice Returns the seed state (100 USDC, fully stable) the very first
/// time this ever runs (no file yet), otherwise whatever the last cycle
/// persisted. tradesToday deliberately does NOT reset daily here (unlike
/// a real vault's own onchain tradesToday, which the real contract resets):
/// this file has no real day-boundary concept of its own, an honest
/// simplification for a simulated vault, not a fidelity target this project
/// otherwise cares about.
export async function loadPaperVaultState(): Promise<VaultState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as VaultState;
    // Defensive against a file persisted before lpPositions existed on
    // this shape (a real gap hit once, live, see this project's v3 design
    // doc): default rather than crash on a stale file from an earlier
    // schema version, this file is simulated data with no real-funds
    // consequence either way.
    return { ...parsed, lpPositions: parsed.lpPositions ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return SEED_STATE;
    throw error;
  }
}

export async function savePaperVaultState(state: VaultState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}
