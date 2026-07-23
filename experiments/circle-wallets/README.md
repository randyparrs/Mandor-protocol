# experiments/circle-wallets/, shelved, not deleted

Circle Wallets (User-Controlled Wallets, `@circle-fin/w3s-pw-web-sdk`) was
tried as the frontend wallet provider instead of Privy, since Circle
Wallets is confirmed live for the Arc DeFi hackathon track and Circle's
own docs list `ARC-TESTNET` as a supported chain. **Decision: reverted to
Privy** (proven via Vpay, see `design_handoff_vpay/app`) after real,
repeated connection instability between the backend proxy and Circle's
API during live testing. This folder keeps the real, working-up-to-a-point
code so the investigation isn't wasted, since Circle Wallets is the
intended migration target, not a permanently abandoned path.

**Migration plan, not just a fallback investigation**: Arc is a Circle
network, and Circle Wallets is its own first-party wallet product for
this ecosystem, distinct from Privy's general-purpose embedded wallets.
The plan is to migrate to it once it reaches a stable, production-ready
version, meaning the connection instability documented below is resolved
(e.g. once Circle's own network path or SDK's HTTP client changes), not
to stay on Privy indefinitely.

## What worked, verified live with real credentials

- Real onboarding: creating a Circle user, minting a user token, and
  running the combined PIN/passkey-setup + first-wallet-creation challenge
  all worked against Circle's real API, confirmed with real HTTP 200
  responses (not mocked).
- The frontend SDK correctly launched Circle's real hosted auth iframe
  (`https://pw-auth.circle.com`) with the correct origin, and a real user
  completed it end to end: a real wallet was created on `ARC-TESTNET`,
  confirmed live via `hasRole`-style verification that the resulting
  wallet held zero protocol roles (as expected, an ordinary depositor EOA).
- `contracts/`, `executor/`, `agent/core/`, `server/decisionPipeline.ts`,
  `server/db/`, and `server/indexer/` were never touched by any of this,
  confirmed both when Circle Wallets was first scoped and again on revert.

## What didn't: real, repeated connection instability

Not "network flakiness" as a vague catch-all. What was actually observed,
in order:
1. Node's global `fetch()` (built on `undici`) got a TLS-layer
   `ECONNRESET` reaching `api.circle.com`, while `node:https` and
   PowerShell's `Invoke-WebRequest` both reached the exact same host
   reliably from the exact same machine at the exact same time. Switched
   `circleWalletProxy.ts` to `node:https` to fix this specific asymmetry.
2. Even after that fix, a real onboarding run still hit `ECONNRESET` and a
   separate `socket hang up`, succeeding only on a third attempt. Added
   automatic retry-with-backoff around every Circle API call
   (`circleFetch` in `server/circleWalletProxy.ts`), reusing the same
   `idempotencyKey` across retries so a retried mutating call can never
   double-create a resource.
3. This is the point the decision was made to revert: even with both
   fixes in place, the connection to Circle's API from this specific
   development setup remained less reliable than it should be for a
   production-quality integration, and continuing to chase it risked the
   hackathon time-box for uncertain payoff.

See the top-level conversation/session notes for the full, explicit
root-cause writeup on whether this looks environment-specific versus a
real fragility a production user could also hit; the short version: the
evidence (native Windows HTTP clients reaching Circle reliably while
Node's own HTTP stacks did not, consistently) points at this specific
development sandbox's network path as the primary suspect, not Circle's
API itself or a fundamental flaw in the SDK's design, but this was not
provable with full certainty from inside that same sandbox.

## Files here

- `server/circleWalletProxy.ts`: the isolated REST proxy (create-user,
  create-user-token, initialize-user, list-wallets,
  create-contract-execution-challenge, get-transaction), with the
  `node:https` + retry-with-backoff fixes already applied.
- `lib/circleWallet.ts`: the frontend wrapper around
  `@circle-fin/w3s-pw-web-sdk` (onboarding, challenge execution, contract
  call + poll-to-terminal-state).
- `polyfills/nodeGlobals.ts`: the Node-builtin (Buffer/process) shim
  `@circle-fin/w3s-pw-web-sdk`'s browser bundle needed, injected via
  esbuild's `optimizeDeps.esbuildOptions.inject` (see the file's own doc
  comment for why a plain top-level import wasn't equivalent).

## To revive this later

1. `npm install @circle-fin/w3s-pw-web-sdk node-stdlib-browser` (both were
   left installed in the root `package.json` even though nothing in the
   shipped `src/` imports them anymore).
2. Wire `vite.config.ts`'s `resolve.alias`/`optimizeDeps` back to the
   `node-stdlib-browser` + `nodeGlobalsShim` setup this file's git history
   shows (removed on revert since Privy needs none of it).
3. Move `server/circleWalletProxy.ts` back to `server/`, add a
   `dev:circle-proxy` script back to `package.json` (`node --use-system-ca
   --import tsx server/circleWalletProxy.ts`, the `--use-system-ca` flag
   was load-bearing in the sandbox this was built in, may not be needed
   elsewhere), and re-add a matching entry to `.claude/launch.json`.
4. `CIRCLE_API_KEY`/`CIRCLE_APP_ID` still need to be in `.env` (never
   committed, see `.gitignore`).

## Cleanup note

Several disposable test users were created in the real Circle account
during this investigation (`mandate-test-diagnostic-*`,
`mandate-test-retry-*`, plus whatever userId the real onboarding run
itself generated). Circle's User-Controlled Wallets REST API has no
`DELETE`/disable-user endpoint (confirmed against its own API reference,
only `GET /v1/w3s/users` exists for users), so these can only be removed
manually from the Circle Developer Console, if the console supports it at
all, not via any script in this repo.
