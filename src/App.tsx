import { useState } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { createPrivyWalletClient } from "./lib/privyWallet";
import { readVaultState, type VaultReadState } from "./lib/vaultReads";
import { approveSpend, depositToVault, withdrawFromVault } from "./lib/vaultActions";
import { fetchDecisionTimeline, type DecisionTimelineEntry, type TimelineIndexedEvent } from "./lib/timeline";
import { DecisionTimeline, VaultLevelEvents } from "./components/DecisionTimeline";
import { fetchPaperVaultTimeline, type PaperVaultTimelineEntry } from "./lib/paperVaultTimeline";
import { PaperVaultTimeline } from "./components/PaperVaultTimeline";
import { VAULTS, BASE_ASSET_DECIMALS } from "./lib/vaults";
import { parseRawAmount } from "../shared/money";

// Phase B: full deposit/withdraw UI, built on Phase A's already-verified
// pieces (Privy onboarding, vault reads, real signed transactions, all
// confirmed live end to end, see src/README.md). Reused, not rebuilt: the
// wallet-selection pattern is still Vpay's proven one
// (design_handoff_vpay/app/src/pages/VpayApp.tsx).
function KnownLimitations({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;
  return (
    <div style={{ background: "#fff3cd", border: "1px solid #ffcd39", padding: "1rem", margin: "1rem 0" }}>
      <strong>Known limitations of this vault today:</strong>
      <ul>
        {limitations.map((limitation, i) => (
          <li key={i}>{limitation}</li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [vaultId, setVaultId] = useState(VAULTS[0].id);
  const [vaultState, setVaultState] = useState<VaultReadState | null>(null);
  const [depositAmount, setDepositAmount] = useState("1");
  const [withdrawAmount, setWithdrawAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [timelineEntries, setTimelineEntries] = useState<DecisionTimelineEntry[] | null>(null);
  const [vaultEvents, setVaultEvents] = useState<TimelineIndexedEvent[] | null>(null);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [paperVaultEntries, setPaperVaultEntries] = useState<PaperVaultTimelineEntry[] | null>(null);
  const [paperVaultBusy, setPaperVaultBusy] = useState(false);

  const vault = VAULTS.find((v) => v.id === vaultId)!;
  const appendLog = (line: string) => setLog((prev) => [...prev, line]);

  // Same embedded-wallet selection Vpay already proved
  // (design_handoff_vpay/app/src/pages/VpayApp.tsx): prefer the Privy
  // embedded wallet if present, otherwise fall back to whatever wallet is
  // connected (e.g. an external wallet the user linked).
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;

  async function refreshVaultState() {
    if (!userAddress) return;
    const state = await readVaultState(vault.address, vault.policyAddress, userAddress);
    setVaultState(state);
    return state;
  }

  async function handleConnect() {
    setBusy(true);
    try {
      if (!authenticated) {
        appendLog("Logging in via Privy...");
        login();
        return;
      }
      if (!userAddress) {
        appendLog("Authenticated, no wallet yet, creating one...");
        await createWallet();
      }
    } catch (error) {
      appendLog(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshTimeline() {
    setTimelineBusy(true);
    try {
      const result = await fetchDecisionTimeline(vault.address, vault.policyAddress);
      setTimelineEntries(result.entries);
      setVaultEvents(result.vaultEvents);
    } catch (error) {
      appendLog(`Error loading decision timeline: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimelineBusy(false);
    }
  }

  async function handleRefreshPaperVaultTimeline() {
    setPaperVaultBusy(true);
    try {
      const entries = await fetchPaperVaultTimeline();
      setPaperVaultEntries(entries);
    } catch (error) {
      appendLog(`Error loading paper vault timeline: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPaperVaultBusy(false);
    }
  }

  async function handleRefreshVaultState() {
    if (!userAddress) return;
    setBusy(true);
    try {
      const state = await refreshVaultState();
      if (state) {
        appendLog(`Read ${vault.label}: totalAssets=${state.totalAssetsUSDC} USDC, your position=${state.yourPositionUSDC} USDC, maxDeposit=${state.maxDepositUSDC}, maxWithdraw=${state.maxWithdrawUSDC}, paused=${state.paused}`);
      }
    } catch (error) {
      appendLog(`Error reading vault state: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const depositAmountRaw = (() => {
    try {
      return parseRawAmount(depositAmount || "0", BASE_ASSET_DECIMALS);
    } catch {
      return 0n;
    }
  })();
  const needsApproval = !vaultState || vaultState.allowance < depositAmountRaw;

  async function handleApprove() {
    if (!embeddedWallet || !userAddress) return;
    setBusy(true);
    try {
      appendLog(`Approving ${depositAmount} USDC for ${vault.label}...`);
      const walletClient = await createPrivyWalletClient(embeddedWallet);
      const hash = await approveSpend(walletClient, userAddress, vault.address, depositAmount);
      appendLog(`Approve confirmed: ${hash}`);
      await refreshVaultState();
    } catch (error) {
      appendLog(`Error approving: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit() {
    if (!embeddedWallet || !userAddress) return;
    setBusy(true);
    try {
      appendLog(`Depositing ${depositAmount} USDC into ${vault.label}...`);
      const walletClient = await createPrivyWalletClient(embeddedWallet);
      const hash = await depositToVault(walletClient, userAddress, vault.address, depositAmount);
      appendLog(`Deposit confirmed: ${hash}`);
      await refreshVaultState();
    } catch (error) {
      appendLog(`Error depositing: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!embeddedWallet || !userAddress) return;
    setBusy(true);
    try {
      appendLog(`Withdrawing ${withdrawAmount} USDC from ${vault.label}...`);
      const walletClient = await createPrivyWalletClient(embeddedWallet);
      const hash = await withdrawFromVault(walletClient, userAddress, vault.address, withdrawAmount);
      appendLog(`Withdraw confirmed: ${hash}`);
      await refreshVaultState();
    } catch (error) {
      appendLog(`Error withdrawing: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Mandor Protocol</h1>

      {/* Visible regardless of wallet-connection state: anyone looking at
          a vault from the outside should be able to see its real, current
          restrictions, not discover them only after a deposit or a
          silently-rejected agent decision. */}
      <label>
        Vault:{" "}
        <select
          value={vaultId}
          onChange={(e) => {
            setVaultId(e.target.value);
            // Cleared, not just left stale: a switched vault's timeline
            // must never show the previous vault's entries until refreshed.
            setTimelineEntries(null);
            setVaultEvents(null);
          }}
        >
          {VAULTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <KnownLimitations limitations={vault.knownLimitations ?? []} />

      {/* AI Decision Timeline: visible regardless of wallet-connection
          state, same "explainability for anyone looking, not just a
          depositor" principle as KnownLimitations above, see
          docs/architecture.md's "AI Decision Timeline". */}
      <h2>Decision Timeline</h2>
      <button onClick={handleRefreshTimeline} disabled={timelineBusy}>
        {timelineBusy ? "Loading..." : "Load decision timeline"}
      </button>

      {vaultEvents && (
        <>
          <h3>Pause history</h3>
          <VaultLevelEvents events={vaultEvents} />
        </>
      )}

      {timelineEntries && <DecisionTimeline entries={timelineEntries} />}

      {/* Paper Vault: a separate, synthetic vault (scripts/paperVaultCycle.ts,
          shared/paperVaultState.ts), not tied to the v1/v2 picker above, no
          wallet required to view. Kept in its own section with its own
          heading and its own aggressively-labeled component
          (PaperVaultTimeline), never mixed into the real timeline above,
          per Randy's explicit ask that this can never read as real
          activity, even to someone skimming or screenshotting the page. */}
      <h2>Paper Vault (Simulated Trading, Demo Only)</h2>
      <p style={{ fontSize: 13, color: "#666" }}>
        A separate, permissive-risk demo vault that reasons over real market data but never executes onchain and never touches real funds. Shown here purely to demonstrate a richer variety of AI decisions than the conservative real vaults above typically produce.
      </p>
      <button onClick={handleRefreshPaperVaultTimeline} disabled={paperVaultBusy}>
        {paperVaultBusy ? "Loading..." : "Load paper vault history"}
      </button>
      {paperVaultEntries && (
        <div style={{ marginTop: "1rem" }}>
          <PaperVaultTimeline entries={paperVaultEntries} />
        </div>
      )}

      {!ready && <p>Loading...</p>}

      {ready && !userAddress && (
        <button onClick={handleConnect} disabled={busy}>
          {busy ? "Working..." : authenticated ? "Create Wallet" : "Connect (Privy)"}
        </button>
      )}

      {userAddress && (
        <>
          <p>
            Wallet: <code>{userAddress}</code> (Arc Testnet)
          </p>
          <button onClick={logout}>Log out</button>{" "}
          <button onClick={handleRefreshVaultState} disabled={busy}>
            Read vault state
          </button>

          {vaultState && (
            <ul>
              <li>Total assets: {vaultState.totalAssetsUSDC} USDC</li>
              <li>Your position: {vaultState.yourPositionUSDC} USDC</li>
              <li>Max deposit: {vaultState.maxDepositUSDC} USDC</li>
              <li>Max withdraw: {vaultState.maxWithdrawUSDC} USDC</li>
              <li>Paused: {String(vaultState.paused)}</li>
            </ul>
          )}

          <h3>Deposit</h3>
          {/* Repeated here, not just near the vault picker above: this is
              the actual point of the deposit action, someone who scrolled
              past the selector must still see it right before depositing
              into v2, per Randy's explicit ask. */}
          <KnownLimitations limitations={vault.knownLimitations ?? []} />
          <div>
            <input type="number" min="0" step="any" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="e.g. 1" style={{ width: 100 }} />{" "}
            USDC{" "}
            {needsApproval ? (
              <button onClick={handleApprove} disabled={busy}>
                Approve
              </button>
            ) : (
              <button onClick={handleDeposit} disabled={busy}>
                Deposit
              </button>
            )}
          </div>

          <h3>Withdraw</h3>
          <div>
            <input type="number" min="0" step="any" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="e.g. 1" style={{ width: 100 }} />{" "}
            USDC{" "}
            <button onClick={handleWithdraw} disabled={busy}>
              Withdraw
            </button>
          </div>
        </>
      )}

      <h3>Log</h3>
      <pre style={{ background: "#f0f0f0", padding: "1rem", whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
    </div>
  );
}
