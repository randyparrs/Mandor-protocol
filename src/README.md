# src/

React + Vite frontend. Phase 1 scope: marketplace browse, vault detail,
deposit/withdraw (user-signed, ordinary ERC-4626 transactions, same pattern
as Vpay's user-signed flows), explainability timeline, reports.

**Wallet provider: Privy**, the pattern already proven in
`design_handoff_vpay/app` (`@privy-io/react-auth`, embedded wallets,
`usePrivy`/`useWallets`/`useCreateWallet`). Circle Wallets was tried first
(Circle Wallets is confirmed live for the Arc DeFi hackathon track and
lists `ARC-TESTNET` as a supported chain), but was reverted after real,
repeated connection instability between the backend proxy and Circle's API
during live testing. That work is not deleted, see
`experiments/circle-wallets/README.md` for the full writeup: what was
built, what worked (real onboarding, real hosted-iframe launch, a real
wallet created and verified to hold zero protocol roles), and the exact
root cause of what didn't.

Privy needs no server-side proxy: the SDK's embedded wallet flow is fully
client-side, unlike Circle's User-Controlled Wallets (which required a
secret app-level API key server-side for every meaningful action, see the
experiments writeup). This is the whole reason Privy was the original
Phase 1 choice and the agreed fallback.

**Migration target, not a permanent choice**: Privy is the interim wallet
provider, not the intended long-term one. Arc is a Circle network, and
Circle Wallets is its own first-party wallet product, native to the
ecosystem this project targets. Once Circle Wallets reaches a stable,
production-ready version (the connection instability documented in
`experiments/circle-wallets/README.md` resolved), the plan is to migrate
back to it. See that file's own "To revive this later" section for the
concrete steps.

## Setup

1. Create a Privy app at [dashboard.privy.io](https://dashboard.privy.io),
   add its App ID to the root `.env` as `VITE_PRIVY_APP_ID` (public, safe
   client-side, picked up automatically by Vite's default `VITE_`-prefix
   `import.meta.env` exposure, no custom `vite.config.ts` wiring needed).
2. `npm run dev:frontend` (Vite dev server).
3. `npx tsc -p src/tsconfig.json --noEmit` typechecks the frontend
   separately from the root project (different `lib`/`jsx` settings, see
   `src/tsconfig.json`).

## What's built and proven so far

- `src/lib/vaultReads.ts`, `src/lib/vaultAbi.ts`, `src/lib/vaults.ts`,
  `src/lib/arcChain.ts`: read-only viem calls against the two real deployed
  vaults (`docs/deployments.md`), reusing `shared/money.ts` for formatting.
  `maxDeposit`/`maxWithdraw` are read directly, never recomputed
  client-side (they already net out pause state and the shared
  `CapitalLimitRegistry` cap/liquidity floor onchain). Provider-agnostic,
  unaffected by the Circle-to-Privy revert.
- `src/lib/privyWallet.ts`: `createPrivyWalletClient`, wraps a connected
  Privy wallet's `getEthereumProvider()` in a viem `WalletClient`, the same
  pattern as Vpay's own proven `createPrivySigner`
  (`design_handoff_vpay/app/src/lib/chain.ts`), simplified since this
  project calls known ERC-4626/ERC-20 functions directly via
  `writeContract` rather than a generic raw-tx signer abstraction.
- `src/App.tsx`: minimal Phase-A proof UI (Privy login/wallet-creation,
  read vault state, a "test signing" button that submits a real
  `approve(vault, 0)`). Confirmed live in a real browser: the app renders
  and Privy's SDK correctly validates its App ID at startup (throws a
  clear, explicit error for an unset/invalid one, never silently hangs),
  same expected "blocked on real credentials" state Circle was in before
  its own key was added.
- **Not yet proven**: a real onboarding + real signed transaction against
  the live Arc Testnet vault, blocked on a real `VITE_PRIVY_APP_ID`. Phase
  B (the full deposit/withdraw UI, approve+deposit two-step flow, withdraw
  flow) has not been built yet.

Includes a guided "Move to v2" flow for strategy version migrations: requests
the v1 withdrawal signature, then immediately requests the v2 deposit
signature once the first confirms, one guided user action, two ordinary,
independently-signed transactions underneath. No special contract wiring;
see `docs/architecture.md` for why this stays two plain transactions instead
of a dedicated migration function. Not built yet, later in Phase 1 scope.

## Must never do

- No strategy-authoring UI in Phase 1. Depositors are capital providers, not
  strategy authors, there is no end-user "create a vault" flow.
- Never hold the keeper key or the Anthropic API key. This module only ever
  signs the user's own deposit/withdraw transactions.
