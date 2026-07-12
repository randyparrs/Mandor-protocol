# Mandor Protocol

An AI-native investment protocol on Arc Network. Users deposit capital into
vaults; each vault is managed by an autonomous Claude agent that proposes
investment decisions.

## The one rule everything else is built around

**The AI agent is an advisor, never a custodian.** Claude never holds keys,
never signs a transaction, and never has a direct path to move funds. It only
produces a structured proposal. Every proposal must pass a deterministic,
non-AI, on-chain policy contract before anything executes. A proposal that
fails validation is logged and discarded, never retried automatically.

## Launch strategy

Initial vaults are created and configured only by the team (a curator model,
the same approach established DeFi vault platforms like Gauntlet or Steakhouse
Financial use). There is no public "create your own AI agent" feature, and
there will not be one at any phase, letting strangers create AI-managed
vaults was judged too risky to be worth building at all, not just risky enough
to delay.

## Status

Phase 2 complete. `VaultPolicy`, `MandateVault`, `VaultFactory`,
`MandateVaultDeployer`, and `CapitalLimitRegistry` are implemented, with
Foundry fuzz coverage (1000 runs per property) and real forge invariant
tests (multi-call, stateful fuzzing across arbitrary action sequences via
`test/MandateVaultInvariant.t.sol`), not just single-call property tests.
`CapitalLimitRegistry` is a deliberately minimal Phase 2 stub, one
ADMIN-settable maximum totalAssets value applied identically to every vault,
enforced from the moment a vault is created; reputation-based progressive
tiers are Phase 4. `VaultRegistry.sol` (a dedicated on-chain contract for the
`strategyAuthor` field) is deferred to Phase 4: the canonical vault list it
was meant to provide is already covered by `VaultFactory`'s own
`allVaults`/`isMandateVault`, and `strategyAuthor` has no practical effect
while the team is the sole vault creator. No Claude wiring exists yet, there
is no working frontend or backend. See `docs/architecture.md` for the full
design.

## Phase plan

- **Phase 1 (this state):** architecture, folder structure, shared types,
  threat model, Vault Policy validation logic designed on paper.
- **Phase 2:** `VaultPolicy`, `MandateVault`, `VaultFactory`, and a minimal
  fixed-cap `CapitalLimitRegistry` implemented, with Foundry test coverage
  and invariant tests started immediately, not deferred. `VaultRegistry.sol`
  and progressive/reputation-based capital limits are Phase 4.
- **Phase 3:** real Claude wiring (`agent/core`), the keeper/executor service,
  Paper Vault simulation mode.
- **Phase 4:** reputation, withdrawal/NAV mechanics, oracle aggregation,
  progressive capital limits, `VaultRegistry.sol`.
- **Phase 5:** hardening, audit prep, bug bounty, monitoring, incident-response
  runbook finalized.

## Reference

Architectural seed: Vpay (`C:\Users\randy\Desktop\design_handoff_vpay\app`), a
sibling project on the same stack (React/Vite, Express, Solidity + OpenZeppelin,
Privy, Claude). See `docs/architecture.md` for what is reused and what had to
go beyond Vpay's pattern.
