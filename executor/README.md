# executor/

The keeper/executor service. The one module in the whole repo that holds a
signing key. Mirrors Vpay's `server/swapExecutor.ts` isolation pattern:
single-purpose, imported by nothing else, exposed through one narrow
interface.

`keeperService.ts` takes a confirmed decision and: re-runs the offchain
pre-check as a final sanity guard, simulates the transaction (`simulate.ts`),
submits it to `MandateVault.executeDecision(...)`, and does nothing else.

## Must never do

- Never custody vault assets, even transiently. Swaps execute atomically
  inside the vault contract itself; the keeper only assembles and submits the
  transaction.
- Never let the keeper key do anything beyond calling `executeDecision`. It
  has no role authority to pause, change roles, or withdraw funds.
- Never skip simulation before submission.
- Never let the keeper run without a heartbeat. It is not a fund-safety
  single point of failure (withdrawals never route through it), but it is an
  availability one, a confirmed decision sitting unexecuted, or missed
  heartbeats, must alert into the same monitoring channel as everything else
  in `docs/threat-model.md`.

