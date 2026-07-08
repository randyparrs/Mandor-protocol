# agent/policy/

`offchainPolicyCheck.ts` — a fast, advisory TypeScript re-implementation of
`VaultPolicy.sol`'s validation math. Used before ever touching the chain, so
the decision pipeline gets instant feedback instead of waiting on a
transaction.

## Must never do

- Never treat this check as authoritative. Only the on-chain call inside
  `MandateVault.executeDecision` is the real gate. This module can reject
  early to save gas and give fast feedback, but it can never be the reason a
  decision is allowed to execute.
- Never let this implementation drift from the Solidity version silently.
  Phase 2 must run both against the same fixture set in CI.
