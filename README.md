# Mandor Protocol

An AI-native investment protocol on Arc Network. Users deposit capital into
vaults; each vault is managed by an autonomous AI agent that proposes
investment decisions.

> **Status note**: This protocol has gone through two iterations. **v1**
> (USDC-only) and **v2** (USDC+cirBTC) were the first iteration --
> HOLD/REBALANCE only, no real yield-generating mechanism -- and are now
> **discontinued** (see [`legacy/`](legacy/)). **v3** (real Uniswap-V3-style
> LP yield), **v4** (cross-chain lending via CCTP), and **v5** (ergodic
> rebalancing) are the current, active product. See
> [`docs/deployments.md`](docs/deployments.md) for the full deployment
> history.

## The one rule everything else is built around

**The AI agent is an advisor, never a custodian.** The AI agent never holds keys,
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

`VaultPolicy`, `MandateVault`, `VaultFactory`, `MandateVaultDeployer`, and
`CapitalLimitRegistry` are deployed and live on Arc Testnet, across five
real vault versions (see `docs/deployments.md` for the full, real address
and transaction history of every one). **v3** (real Uniswap-V3-style LP
yield via UnitFlowV3), **v4** (cross-chain lending, USDC bridged via CCTP
to Aave v3 on Arbitrum Sepolia), and **v5** (ergodic rebalancing, a
threshold-based target-weight strategy validated by real historical
backtests, see `research/ergodic-rebalancing/REPORT.md`, before being
built) are the current, active product; v1/v2 are discontinued, see
`legacy/`. Foundry fuzz coverage (1000 runs per property) and stateful
invariant tests (`test/MandateVaultInvariant.t.sol`) cover the one shared
contract source every version deploys from, not five separate codebases.

`agent/core` is wired to the real Anthropic API, not a mock or a local
model: `proposeDecision` reads real onchain vault state and market data,
then asks the AI agent to produce a structured decision, with prompt-
injection isolation tested against real, non-deterministic model calls
(`agent/core/promptInjection.test.ts`, `npm run test:agent`), not just a
theoretical guard.

The full real pipeline is built and verified end to end: propose (real AI
agent call) -> offchain pre-check (advisory, never authoritative) ->
human confirmation queue with a hard `expiresAt`
(`server/decisionPipeline.ts`) -> keeper execution
(`executor/keeperService.ts` for v1-v3's real deployed ABI shape,
`executor/keeperServiceV4.ts` for v4/v5's) submits and confirms a real
onchain `executeDecision` transaction -> `server/indexer` catches up on
the real onchain events. Persistence (`server/db`, SQLite) survives a
process restart; the queue and event history are not held only in memory.

A working frontend exists (`src/`): Privy-based wallet login, real
deposit/withdraw flows, an AI decision timeline (thinking-token capture,
pause-event transparency), and a Paper Vault demo mode (MANDORTEST test
tokens with a genuinely independent reference price, demonstrating a full
decision cycle end to end even where a real vault is currently blocked
from trading, see `docs/v5-ergodic-rebalancing.md`), all verified against
real testnet transactions, not a mock backend.

Still not built: `VaultRegistry.sol` (the dedicated on-chain contract for
the `strategyAuthor` field), reputation-based progressive capital limit
tiers (`CapitalLimitRegistry` remains the fixed-cap Phase 2 stub), and a
real onchain price oracle (Chainlink and Pyth were both live-verified as
having real infrastructure on Arc Testnet, but neither is currently usable
here, see `docs/arc-facts-to-verify.md`). See `docs/architecture.md` for
the full design.

## Phase plan

- **Phase 1 (done):** architecture, folder structure, shared types, threat
  model, Vault Policy validation logic designed on paper.
- **Phase 2 (done):** `VaultPolicy`, `MandateVault`, `VaultFactory`, and a
  minimal fixed-cap `CapitalLimitRegistry` implemented, with Foundry test
  coverage and invariant tests.
- **Phase 3 (done):** real AI agent wiring (`agent/core`), the
  keeper/executor service, Paper Vault simulation mode, a working
  frontend, and three more vault versions built on top of the same shared
  contracts (v3 LP yield, v4 cross-chain lending, v5 ergodic rebalancing).
- **Phase 4 (not started):** reputation-based progressive capital limits,
  `VaultRegistry.sol`, a real onchain price oracle, any further
  NAV/withdrawal mechanics beyond the existing liquid-ledger-capped
  `maxWithdraw`, and a revenue mechanism for the protocol itself: a
  performance fee (a percentage of yield generated, minted as new vault
  shares to a fee recipient, never touching depositor principal). This is
  a business-model addition, not a change to any vault's investment
  mechanics or strategy logic. First implemented on v6 (reusing v4's
  cross-chain lending mechanism, currently the only strategy generating
  real accruing yield without depending on the pending oracle
  restriction). The intent is for this mechanism to apply across every
  vault at mainnet, not remain specific to v6.
- **Phase 5 (roadmap):** additional vault strategies as network
  infrastructure matures (tokenized RWA, additional volatile pairs once
  real liquidity exists), and progressive expansion toward mainnet.

## Reference

Architectural seed: Vpay https://github.com/eudomar500/vpay-agent, a
sibling project on the same stack (React/Vite, Express, Solidity + OpenZeppelin,
Privy, an AI agent). See `docs/architecture.md` for what is reused and what had to
go beyond Vpay's pattern.
