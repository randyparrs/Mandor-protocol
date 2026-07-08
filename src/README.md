# src/

React + Vite frontend. Phase 1 scope: marketplace browse, vault detail,
deposit/withdraw (user-signed via Privy, ordinary ERC-4626 transactions,
same pattern as Vpay's user-signed flows), explainability timeline, reports.

Includes a guided "Move to v2" flow for strategy version migrations: requests
the v1 withdrawal signature, then immediately requests the v2 deposit
signature once the first confirms — one guided user action, two ordinary,
independently-signed transactions underneath. No special contract wiring;
see `docs/architecture.md` for why this stays two plain transactions instead
of a dedicated migration function.

## Must never do

- No strategy-authoring UI in Phase 1. Depositors are capital providers, not
  strategy authors — there is no end-user "create a vault" flow.
- Never hold the keeper key or the Anthropic API key. This module only ever
  signs the user's own deposit/withdraw transactions.
