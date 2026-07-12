// Thin frontend wrapper around @circle-fin/w3s-pw-web-sdk + this project's
// own server/circleWalletProxy.ts. Real API shape verified against
// Circle's own bundled react-example (node_modules/@circle-fin/w3s-pw-web-sdk/
// examples/react-example/src/App.js) and its official API reference before
// writing this, not guessed. Onboarding persists only a random, non-secret
// userId in localStorage; userToken/encryptionKey are re-minted each
// session via the proxy (they expire after 60 minutes, see
// server/circleWalletProxy.ts's handleCreateUserToken doc comment) and are
// never persisted.
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
// The package's root export only surfaces W3SSdk itself (verified against
// node_modules/@circle-fin/w3s-pw-web-sdk/dist/src/index.d.ts, no
// "exports" map restricting subpaths in its package.json), so the result/
// error shapes come from its internal types module directly.
import type { ChallengeResult, Error as SdkError } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

const USER_ID_STORAGE_KEY = "mandate.circleUserId";

export interface CircleSession {
  userId: string;
  userToken: string;
  encryptionKey: string;
  sdk: W3SSdk;
}

export interface CircleWallet {
  id: string;
  address: `0x${string}`;
  blockchain: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `request to ${path} failed: HTTP ${response.status}`);
  return json;
}

function getOrCreateUserId(): string {
  const existing = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing) return existing;
  const fresh = `mandate-${crypto.randomUUID()}`;
  localStorage.setItem(USER_ID_STORAGE_KEY, fresh);
  return fresh;
}

/// @notice Full onboarding: ensures the Circle user exists (idempotent,
/// tolerates "already exists" by just proceeding to token creation), mints
/// a fresh userToken/encryptionKey pair, and configures a W3SSdk instance
/// ready to execute challenges. Does not itself create a wallet, see
/// runInitializeChallenge below, this is a separate step so the caller can
/// show "setting up your login..." vs "setting up your wallet..." as
/// distinct UI states.
export async function startCircleSession(): Promise<CircleSession> {
  const userId = getOrCreateUserId();
  const appId = import.meta.env.VITE_CIRCLE_APP_ID;
  if (!appId) throw new Error("VITE_CIRCLE_APP_ID is not set. See src/README.md for setup.");

  try {
    await postJson("/api/circle/users", { userId });
  } catch (error) {
    // Tolerate "user already exists" (userAlreadyExisted, code 155101):
    // getOrCreateUserId already makes this idempotent across sessions on
    // the same browser, but re-running create-user for a returning user
    // must not be fatal.
    if (!(error instanceof Error) || !error.message.includes("155101")) throw error;
  }

  const { data } = await postJson<{ data: { userToken: string; encryptionKey: string } }>("/api/circle/users/token", { userId });

  const sdk = new W3SSdk({ appSettings: { appId }, authentication: { userToken: data.userToken, encryptionKey: data.encryptionKey } });

  return { userId, userToken: data.userToken, encryptionKey: data.encryptionKey, sdk };
}

function executeChallenge(sdk: W3SSdk, challengeId: string): Promise<ChallengeResult> {
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error?: SdkError, result?: ChallengeResult) => {
      if (error) return reject(new Error(`${error.code ?? "unknown"}: ${error.message}`));
      if (!result) return reject(new Error("Circle challenge completed with no result"));
      resolve(result);
    });
  });
}

/// @notice First-time-only: creates the combined PIN/passkey-setup +
/// first-wallet-creation challenge for this user on ARC-TESTNET (Circle's
/// own confirmed chain code, see docs/arc-facts-to-verify.md), then has
/// the SDK present Circle's hosted UI for the user to complete it.
export async function runInitializeChallenge(session: CircleSession): Promise<ChallengeResult> {
  const { data } = await postJson<{ data: { challengeId: string } }>("/api/circle/user/initialize", { userToken: session.userToken });
  return executeChallenge(session.sdk, data.challengeId);
}

/// @notice Lists this user's wallets once they've completed onboarding.
export async function listWallets(session: CircleSession): Promise<CircleWallet[]> {
  const result = await postJson<{ data: { wallets: Array<{ id: string; address: string; blockchain: string }> } }>("/api/circle/wallets/list", {
    userToken: session.userToken,
  });
  return result.data.wallets.map((w) => ({ id: w.id, address: w.address as `0x${string}`, blockchain: w.blockchain }));
}

/// @notice Executes an arbitrary contract call (ERC-20 approve, vault
/// deposit/withdraw) end to end: backend creates the challenge, the SDK
/// presents Circle's hosted UI for the user to approve, then this polls
/// the backend for the transaction's terminal state. Never validates or
/// simulates the call itself, that is the contract's/policy's own job,
/// this is purely a signing/broadcast mechanism.
export async function executeContractCall(
  session: CircleSession,
  walletId: string,
  contractAddress: `0x${string}`,
  abiFunctionSignature: string,
  abiParameters: unknown[],
): Promise<{ txHash: string; state: string }> {
  const { data } = await postJson<{ data: { id: string; challengeId: string } }>("/api/circle/transactions/contractExecution", {
    userToken: session.userToken,
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
  });

  await executeChallenge(session.sdk, data.challengeId);

  return pollTransaction(session, data.id);
}

const TERMINAL_STATES = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

async function pollTransaction(session: CircleSession, transactionId: string): Promise<{ txHash: string; state: string }> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const response = await fetch(`/api/circle/transactions/${transactionId}`, { headers: { "X-User-Token": session.userToken } });
    const json = (await response.json()) as { data: { transaction: { state: string; txHash?: string } } };
    const { state, txHash } = json.data.transaction;
    if (TERMINAL_STATES.has(state)) {
      if (state !== "COMPLETE") throw new Error(`Transaction ${transactionId} ended in state ${state}`);
      return { txHash: txHash ?? "", state };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Transaction ${transactionId} did not reach a terminal state within ${POLL_TIMEOUT_MS}ms`);
}
