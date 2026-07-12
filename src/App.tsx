import { useState } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { createPrivyWalletClient } from "./lib/privyWallet";
import { readVaultState, publicClient, type VaultReadState } from "./lib/vaultReads";
import { VAULT_ABI } from "./lib/vaultAbi";
import { VAULTS, BASE_ASSET_ADDRESS } from "./lib/vaults";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Phase A scope only: prove real Privy onboarding + one real signed
// transaction against Arc Testnet, plus read-only vault state. The full
// deposit/withdraw UI is Phase B, gated on this working cleanly. Reverted
// from Circle Wallets to Privy (see experiments/circle-wallets/README.md
// for why), reusing the exact provider/config/wallet-selection pattern
// already proven in design_handoff_vpay/app, not reinvented.
export default function App() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [vaultId, setVaultId] = useState(VAULTS[0].id);
  const [vaultState, setVaultState] = useState<VaultReadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const vault = VAULTS.find((v) => v.id === vaultId)!;
  const appendLog = (line: string) => setLog((prev) => [...prev, line]);

  // Same embedded-wallet selection Vpay already proved
  // (design_handoff_vpay/app/src/pages/VpayApp.tsx): prefer the Privy
  // embedded wallet if present, otherwise fall back to whatever wallet is
  // connected (e.g. an external wallet the user linked).
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;

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

  async function handleRefreshVaultState() {
    if (!userAddress) return;
    setBusy(true);
    try {
      const state = await readVaultState(vault.address, vault.policyAddress, userAddress);
      setVaultState(state);
      appendLog(`Read ${vault.label}: totalAssets=${state.totalAssetsUSDC} USDC, your position=${state.yourPositionUSDC} USDC, maxDeposit=${state.maxDepositUSDC}, maxWithdraw=${state.maxWithdrawUSDC}, paused=${state.paused}`);
    } catch (error) {
      appendLog(`Error reading vault state: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleTestApprove() {
    if (!embeddedWallet || !userAddress) return;
    setBusy(true);
    try {
      appendLog("Submitting a real approve(vault, 0) via Privy (Phase A go/no-go proof)...");
      const walletClient = await createPrivyWalletClient(embeddedWallet);
      const hash = await walletClient.writeContract({
        address: BASE_ASSET_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [vault.address, 0n],
        account: userAddress,
        chain: walletClient.chain!,
      });
      appendLog(`Submitted: ${hash}, waiting for confirmation...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      appendLog(`Confirmed onchain: status=${receipt.status}, txHash=${hash}`);
    } catch (error) {
      appendLog(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Mandate Protocol</h1>

      {/* Visible regardless of wallet-connection state: anyone looking at
          a vault from the outside should be able to see its real, current
          restrictions, not discover them only after a deposit or a
          silently-rejected agent decision. */}
      <label>
        Vault:{" "}
        <select value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
          {VAULTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      {vault.knownLimitations && vault.knownLimitations.length > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffcd39", padding: "1rem", margin: "1rem 0" }}>
          <strong>Known limitations of this vault today:</strong>
          <ul>
            {vault.knownLimitations.map((limitation, i) => (
              <li key={i}>{limitation}</li>
            ))}
          </ul>
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
          <button onClick={logout}>Log out</button>

          <div>
            <button onClick={handleRefreshVaultState} disabled={busy}>
              Read vault state
            </button>{" "}
            <button onClick={handleTestApprove} disabled={busy}>
              Test signing (approve 0)
            </button>
          </div>

          {vaultState && (
            <ul>
              <li>Total assets: {vaultState.totalAssetsUSDC} USDC</li>
              <li>Your position: {vaultState.yourPositionUSDC} USDC</li>
              <li>Max deposit: {vaultState.maxDepositUSDC} USDC</li>
              <li>Max withdraw: {vaultState.maxWithdrawUSDC} USDC</li>
              <li>Paused: {String(vaultState.paused)}</li>
            </ul>
          )}
        </>
      )}

      <h3>Log</h3>
      <pre style={{ background: "#f0f0f0", padding: "1rem", whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
    </div>
  );
}
