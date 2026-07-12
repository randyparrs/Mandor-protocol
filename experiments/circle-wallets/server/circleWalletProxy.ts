// SHELVED, see experiments/circle-wallets/README.md: this Circle Wallets
// integration is not the active frontend wallet provider (reverted to
// Privy, see src/), kept here working and buildable in case Circle
// Wallets is revisited later, not deleted.
//
// Isolated Circle Wallets REST proxy. This was the ONLY new backend
// surface that integration added, and it never touched
// server/decisionPipeline.ts, server/db/, or server/indexer/. It exists
// purely because Circle's User-Controlled Wallets API requires a secret
// app-level API key (Authorization: Bearer PREFIX:ID:SECRET) that can
// never be exposed client-side, verified live against Circle's own
// official API reference before writing this file
// (docs.circle.com/api-reference/wallets/user-controlled-wallets/...), not
// guessed. `CIRCLE_API_KEY` is read once from process.env, same
// dotenv/process.env convention already used for ANTHROPIC_API_KEY and
// KEEPER_PRIVATE_KEY, never logged, never returned to the client.
import { config as loadDotenv } from "dotenv";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { projectRootPath } from "../../../shared/paths.js";

// projectRootPath, not process.cwd(): confirmed live this project's launch
// tooling doesn't reliably leave process.cwd() pointed at this project's
// own root, the third real occurrence of this exact bug class
// (executor/paperExecutor.ts, server/db/decisionStore.ts before this),
// which is why shared/paths.ts exists, reused here instead of another
// one-off fix. dotenv/config's bare import defaults to
// path.resolve(process.cwd(), ".env"), which silently loads nothing (no
// error) if that resolves to the wrong directory.
loadDotenv({ path: projectRootPath(".env") });

const CIRCLE_API_HOST = "api.circle.com";
const CIRCLE_API_PATH_PREFIX = "/v1/w3s";
const PORT = Number(process.env.CIRCLE_PROXY_PORT ?? 8787);

function loadCircleApiKey(): string {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) {
    throw new Error("CIRCLE_API_KEY is not set. Add it to .env, never hardcode it.");
  }
  return key;
}

// Confirmed live (real test run, not hypothetical): even node:https, more
// reliable than fetch()/undici in this environment, still hit transient
// connection failures (ECONNRESET, "socket hang up") partway through a
// real onboarding run, succeeding only on a third attempt. A real user
// has no way to know to retry manually, so this retries automatically,
// but ONLY for genuine connection-level failures (the request never
// reached Circle, or the response never fully arrived), never for a real
// HTTP error response Circle actually returned (a 4xx/5xx is a real
// answer, retrying it blindly would not fix a bad request and could mask
// a genuine problem). idempotencyKey (set once by the caller, part of the
// same `options.body` reused across every attempt below) makes a retried
// mutating call safe even if an earlier attempt's request secretly did
// reach Circle before the connection dropped.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  return error.message === "socket hang up";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// @notice Uses node:https directly, not the global fetch(). Confirmed
/// live this matters in at least one real environment: fetch() (built on
/// undici) got a TLS-layer ECONNRESET reaching api.circle.com, while
/// node:https and PowerShell's Invoke-WebRequest both reached it fine
/// (real HTTP responses, not resets) from the exact same machine at the
/// exact same time, an undici-specific incompatibility, not a credentials
/// or DNS/firewall problem. node:https is the more broadly-compatible
/// choice here for that reason, not merely a style preference.
async function circleFetch(path: string, options: { method: "GET" | "POST"; body?: unknown; userToken?: string }): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${loadCircleApiKey()}`,
    "Content-Type": "application/json",
    "X-Request-Id": randomUUID(),
  };
  if (options.userToken) headers["X-User-Token"] = options.userToken;
  const body = options.body ? JSON.stringify(options.body) : undefined;
  if (body) headers["Content-Length"] = Buffer.byteLength(body).toString();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await performCircleRequest(path, options.method, headers, body);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !isRetryableConnectionError(error)) throw error;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function performCircleRequest(path: string, method: "GET" | "POST", headers: Record<string, string>, body: string | undefined): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: CIRCLE_API_HOST, path: `${CIRCLE_API_PATH_PREFIX}${path}`, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          return reject(new Error(`Circle API ${method} ${path} returned non-JSON: HTTP ${res.statusCode}`));
        }
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          return reject(new Error(`Circle API ${method} ${path} failed: HTTP ${status} ${JSON.stringify(json)}`));
        }
        resolve(json);
      });
    });
    req.on("error", (error) => reject(error));
    if (body) req.write(body);
    req.end();
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/// @notice Creates a brand-new Circle user. The frontend generates and
/// persists its own random userId (e.g. localStorage) and calls this once
/// per new browser/user, matching Circle's "userId is your own identifier"
/// model (developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user).
async function handleCreateUser(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const userId = body.userId as string | undefined;
  if (!userId) return sendJson(res, 400, { error: "userId is required" });
  const result = await circleFetch("/users", { method: "POST", body: { userId } });
  sendJson(res, 200, result);
}

/// @notice Mints a fresh 60-minute userToken + encryptionKey pair for an
/// existing userId, the credentials the frontend Web SDK needs for every
/// subsequent challenge (developers.circle.com/api-reference/wallets/user-controlled-wallets/get-user-token).
async function handleCreateUserToken(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const userId = body.userId as string | undefined;
  if (!userId) return sendJson(res, 400, { error: "userId is required" });
  const result = await circleFetch("/users/token", { method: "POST", body: { userId } });
  sendJson(res, 200, result);
}

/// @notice Creates the combined PIN/passkey-setup + first-wallet-creation
/// challenge for a brand-new user. blockchains: ["ARC-TESTNET"] (confirmed
/// live against Circle's own supported-blockchains table, see
/// docs/arc-facts-to-verify.md). Needs the user's own X-User-Token, not
/// just the app API key, since this action is scoped to one specific user.
async function handleInitializeUser(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const userToken = body.userToken as string | undefined;
  if (!userToken) return sendJson(res, 400, { error: "userToken is required" });
  const result = await circleFetch("/user/initialize", {
    method: "POST",
    userToken,
    body: { idempotencyKey: randomUUID(), blockchains: ["ARC-TESTNET"], accountType: "EOA" },
  });
  sendJson(res, 200, result);
}

/// @notice Lists this user's wallets (to read walletId/address once the
/// initialize challenge completes). Scoped to the calling user via
/// X-User-Token, not the app-wide API key alone.
async function handleListWallets(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const userToken = body.userToken as string | undefined;
  if (!userToken) return sendJson(res, 400, { error: "userToken is required" });
  const result = await circleFetch("/wallets", { method: "GET", userToken });
  sendJson(res, 200, result);
}

/// @notice Creates a contract-execution challenge (an ERC-20 approve or an
/// ERC-4626 deposit/withdraw call), the step that must happen server-side
/// because it requires CIRCLE_API_KEY
/// (developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge).
/// The frontend then calls sdk.execute(challengeId) to have the user
/// approve via passkey/PIN/social and have Circle's MPC network cosign and
/// broadcast. Never simulates or validates the call itself, that stays
/// the vault contract's/policy's own job; this is a thin, typed pass-
/// through, not a decision-making layer.
async function handleCreateContractExecutionChallenge(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const { userToken, walletId, contractAddress, abiFunctionSignature, abiParameters } = body as {
    userToken?: string;
    walletId?: string;
    contractAddress?: string;
    abiFunctionSignature?: string;
    abiParameters?: unknown[];
  };
  if (!userToken || !walletId || !contractAddress || !abiFunctionSignature) {
    return sendJson(res, 400, { error: "userToken, walletId, contractAddress, and abiFunctionSignature are required" });
  }
  const result = await circleFetch("/user/transactions/contractExecution", {
    method: "POST",
    userToken,
    body: { idempotencyKey: randomUUID(), walletId, contractAddress, abiFunctionSignature, abiParameters: abiParameters ?? [], feeLevel: "MEDIUM" },
  });
  sendJson(res, 200, result);
}

/// @notice Polls a transaction's status by id
/// (developers.circle.com/api-reference/wallets/user-controlled-wallets/get-transaction),
/// state one of INITIATED/CLEARED/QUEUED/SENT/STUCK/CONFIRMED/COMPLETE/
/// FAILED/DENIED/CANCELLED, includes txHash once broadcast.
async function handleGetTransaction(req: http.IncomingMessage, res: http.ServerResponse, transactionId: string) {
  const userToken = req.headers["x-user-token"] as string | undefined;
  if (!userToken) return sendJson(res, 400, { error: "X-User-Token header is required" });
  const result = await circleFetch(`/transactions/${transactionId}`, { method: "GET", userToken });
  sendJson(res, 200, result);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const handler = (async () => {
    if (req.method === "POST" && url.pathname === "/api/circle/users") return handleCreateUser(req, res);
    if (req.method === "POST" && url.pathname === "/api/circle/users/token") return handleCreateUserToken(req, res);
    if (req.method === "POST" && url.pathname === "/api/circle/user/initialize") return handleInitializeUser(req, res);
    if (req.method === "POST" && url.pathname === "/api/circle/wallets/list") return handleListWallets(req, res);
    if (req.method === "POST" && url.pathname === "/api/circle/transactions/contractExecution") return handleCreateContractExecutionChallenge(req, res);
    const txMatch = url.pathname.match(/^\/api\/circle\/transactions\/([^/]+)$/);
    if (req.method === "GET" && txMatch) return handleGetTransaction(req, res, txMatch[1]);
    sendJson(res, 404, { error: "not found" });
  })();

  handler.catch((error: unknown) => {
    console.error(error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.listen(PORT, () => {
  console.log(`circleWalletProxy listening on http://localhost:${PORT}`);
});
