# Mandate Protocol: Threat Model (Phase 1)

## Platform-level risks

| Risk | Mitigation |
|---|---|
| Smart contract bug in Vault/Policy drains funds | Vault isolation (one contract instance per vault, blast radius contained to that vault); minimal custom logic on audited OpenZeppelin primitives; immutable Policy; Phase 2 requires Foundry invariant/fuzz tests on Policy + accounting before any real capital, not deferred to Phase 5 |
| Keeper signing key compromised | Key can only call `executeDecision`; that call still routes through the immutable onchain Policy and the atomic swap-and-return pattern, so compromise is bounded to one policy-compliant decision at a time, never arbitrary fund movement; `PAUSER` can freeze new decision execution instantly |
| Ops-confirmation account compromised | Ops confirmation only flips a DB flag, it cannot itself sign or submit anything; the keeper independently re-validates onchain policy regardless of what was "confirmed"; recommend two-person confirmation for decisions above a size threshold |
| Stale proposed decision confirmed late, after market conditions changed | Every queued decision carries a hard `expiresAt`; if not confirmed before then, it auto-expires and is discarded, never confirmable after the fact and never auto-retried |
| Frontend/dependency supply-chain compromise | Frontend never holds vault funds or the keeper key; the only frontend-signed transactions are ordinary user deposit/withdraw calls through standard ERC-4626 semantics |
| Human `PAUSER` too slow to react to a fast-moving attack | A separate, permissionless `checkAndAutoPause` path lets anyone trigger a pause the instant an objective condition (oracle deviation, drawdown speed) is true, independent of the human multisig |
| Permissionless `checkAndAutoPause` never actually gets called in practice | Two layers, not one: a dedicated team-run watcher bot calls it proactively as the primary path, and a small capped bounty (`autoPauseBountyAmount`) rewards whoever's call successfully triggers a pause, so it stays worth calling even if the team's own bot is down |
| Malicious or mispriced oracle swapped in via governance | Oracle feed switches require the new feed's price at switch time to be within a defined deviation of the previous feed's last known price, or the switch reverts |
| Keeper service unavailable, confirmed decisions don't execute | Not a fund-safety risk (withdrawals never route through the keeper), but an availability risk, heartbeat + alerting on the keeper, alert if a confirmed decision sits unexecuted past a timeout |
| A pushed transfer (e.g. the auto-pause bounty) fails because the recipient is a zero/blocklisted address, reverting a safety-critical action | Verified live: transfers to `address(0)` revert on both the native and ERC-20 interface with the same underlying reason. `checkAndAutoPause` flips `paused` before attempting the bounty payout and tolerates a failed payout (logs, doesn't revert) so a bad bounty transfer can never undo the pause. Ordinary withdrawals are pull-based (one user per transaction) and unaffected |
| Compromised or mistaken GOVERNANCE sets `autoPauseBountyAmount` too high, draining a meaningful portion of the vault through a single pause payout | Hard-capped on `MandateVault` at the smaller of 1% current TVL or 1000 USDC (`MAX_AUTO_PAUSE_BOUNTY_BPS`/`MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE`), both non-adjustable constants, not governance parameters. `setAutoPauseBountyAmount` rejects anything above the absolute cap outright, and the percentage cap is recomputed fresh against live `totalAssets()` on every payout, not just checked once at set time, so TVL drift between configuration and payout can't be exploited |
| Malicious router added to the allowlist redirects swap proceeds to an attacker-controlled contract | Router allowlist changes are never instantaneous: `proposeRouterAllowed`/`executeRouterAllowed` enforce a self-contained, code-level 48h timelock (`ROUTER_CHANGE_TIMELOCK`), separate from the general "GOVERNANCE_ROLE should be a TimelockController" deployment convention used for other parameters, given the severity of this specific attack. Execution is permissionless once the timelock elapses, same pattern as `checkAndAutoPause` and `executeDecision` |
| A briefly compromised GOVERNANCE key proposes a malicious router change; the 48h timelock only delays the attack instead of giving a real chance to stop it | `cancelRouterAllowedChange` is gated to `PAUSER_ROLE`, a different role than the `GOVERNANCE_ROLE` that proposes, so a detected malicious proposal can actually be stopped during the delay window by the team or automated monitoring, not just watched on a timer. Reverts if there is no pending change for the router, so a cancellation attempt fails loudly rather than silently no-op-ing |

## Economic attack surface

| Attack | Mitigation |
|---|---|
| ERC-4626 inflation attack | OZ's default virtual shares/assets offset (verify the pinned OZ version actually includes it) plus a protocol-owned minimum seed deposit, atomically deposited by `VaultFactory` in the same transaction that creates the vault |
| Compromised or mistaken GOVERNANCE calls sweepDust to steal real depositor funds | Mathematically bounded, not just access-controlled: the swept amount is always exactly `liveBalance - ledger` at propose time, so the vault's real balance can never drop below the ledger. A compromised call can only ever misdirect accidental donations sitting above the ledger, never ledgered depositor capital. Proven by `testFuzz_sweepDustNeverReducesBalanceBelowLedger` |
| Someone accidentally sends a large direct transfer to the vault (bypassing deposit()); GOVERNANCE sweeps it instantly to any address with no window to notice and ask for it back | `proposeSweepDust`/`executeSweepDust` go through the same 48h timelock as router allowlist changes, and `cancelSweepDust` is gated to PAUSER_ROLE (a different role than the GOVERNANCE_ROLE that proposes), so the team has a real window to stop a pending sweep and return an accidental transfer manually instead of letting it execute. Not a risk to real depositors either way, but keeps this action consistent with how every other GOVERNANCE-controlled fund movement in this design is capped or delayed |
| USDC donation attack (Arc-specific, verified live), native USDC and its ERC-20 interface share one balance, so anyone can inflate what `balanceOf(vault)` shows via a plain native transfer, any time, not just at first deposit | `MandateVault` never uses live `balanceOf(address(this))` for USDC share-price math; it tracks its own internal accounting ledger updated only through `deposit`/`withdraw`/`executeDecision`. Unsolicited transfers sit as unaccounted dust, never affecting share price |
| Oracle manipulation (flash loans / thin liquidity, worst for cirBTC/RWAs) | `oracleMaxStalenessSeconds` and `oracleMaxDeviationBps` are immutable fields in `VaultPolicy` itself; a stale or deviated price auto-rejects the decision and can trigger the per-vault pause; use Chainlink as primary source (verify Arc availability), median-of-sources where more than one feed exists. Feed **switches** (governance changing the address) are separately checked against the outgoing feed's last price, so a swap-in attack can't bypass this by pointing at a fresh, unvalidated feed |
| NAV timing games | NAV computed over a short time window rather than an instantaneous block snapshot; a hard-capped, initially-zero entry/exit fee lever is reserved so it can be turned on without a redeploy |
| MEV / front-running on rebalances | Transaction submission abstracted behind one seam so routing through a private mempool/relay later is a config change, not a rearchitecture (verify Arc's private-relay options exist) |
| Reputation/leaderboard gaming | Out of scope until reputation exists (Phase 4), but `DecisionRecord` already captures per-decision drawdown/violation/anomaly data from Phase 1 onward, so Phase 4 scoring has the raw history it needs |

## Agent-specific threats, in scope now (curator-only launch)

| Threat | Mitigation |
|---|---|
| Prompt injection via external market data feeds | `getMarketData.ts` returns strictly-typed numeric/enum fields wherever possible; unavoidable free text is wrapped in an explicit untrusted-data block, with a system-prompt rule that content there is data to reason about, never an instruction |
| Model drift on silent version updates | Each live vault is hard-pinned to a model version; the agent refuses to run (hard error, not a silent fallback) if no pin exists; migration requires a manual registry update gated by a Paper Vault re-validation pass |
| Anomalous proposal patterns (technically within policy, statistically unusual) | A minimum interval between proposals per vault, independent of the policy's max-trades-per-day limit; any decision whose allocation delta from the last confirmed decision exceeds a statistical threshold is flagged (not auto-blocked) for mandatory ops review |
| Isolation of agent reasoning from agent authority | Enforced at the type/ABI level: `VaultPolicy.validateDecision`'s Solidity signature has no string/reasoning parameter, so it is structurally impossible for reasoning text to influence the onchain gate; in TypeScript, `VaultDecision.reasoning` is read only by explainability/timeline code, never by pipeline or executor branching logic |

## Explicitly out of scope

| Item | Why | What keeps the door open anyway |
|---|---|---|
| Prompt injection via user-submitted strategy text | No user-authored strategy text exists, all vaults are team-curated | `systemPrompt.ts` never concatenates strategy config text into the system prompt; always a separate labeled block |
| Sybil resistance for public agent creation | There is no public agent/vault creation feature. This is not a future phase, it was cut from the roadmap entirely | `strategyAuthor` stays a generic address/identifier field rather than a hardcoded team-only assumption, at no extra cost |
| Cryptographic signature verification on agent-proposed decisions (raised externally, by Grok) | Phase 1's human ops confirmation step (see `docs/architecture.md`, "Ops confirmation") already serves as the authorization layer between a proposed decision and anything executing, a signature scheme would authorize the same step redundantly | Noted here as a real requirement for a future phase, specifically if ops confirmation is ever automated away (e.g. an automated approval service replacing the human reviewer). At that point, the automated approver's authorization must be verified cryptographically, since there would no longer be a human in the loop to trust implicitly |

## Withdrawal and liquidity mechanics

NAV is computed per vault including how illiquid or slower-to-exit positions
(tokenized equities, cirBTC during high volatility) are valued. Standard
synchronous ERC-4626 `redeem` is the default; a two-step request/claim path
is reserved in the interface (not built) for a future phase, in case some
held assets can't always be instantly liquid. A bank-run scenario (many
simultaneous withdrawal attempts exceeding the vault's liquid capital) is an
explicit case to define exact behavior for in Phase 2, not left implicit.

## Capital limits and progressive trust

New vaults start with low TVL limits, increasing progressively (e.g. 500,
1,000, 5,000, 10,000) as reputation grows. There is a real maximum tier, or a
human/governance review step once a vault crosses a significant threshold,
never a fully unlimited tier reachable by reputation score alone. Mechanism
lives in `CapitalLimitRegistry.sol`.

**Built in Phase 2, not deferred: a real, enforced fixed cap, not just a
documented promise.** Since Phase 2 already involves real testnet deposits,
"new vaults start with low capital limits" needed to be an actually enforced
property now, not a plan waiting on Phase 4. `CapitalLimitRegistry.sol`
holds one maximum totalAssets value, applied identically to every vault,
consulted by `MandateVault.maxDeposit` on every deposit attempt, and wired
into every new vault by `VaultFactory` at creation time, before any external
depositor could reach it. The progressive, reputation-based scoring logic
(the actual `500 -> 1,000 -> 5,000 -> 10,000` tiers, evaluated per vault)
remains Phase 4 work; Phase 2 only needed the gate itself to be real.

**Raising the cap goes through its own 48h timelock, not an instant ADMIN
call.** Raising it is the exact action progressive trust exists to gate;
today's single global value limits the practical damage (nothing to target
yet), but Phase 4's per-vault caps would turn an instant increase into a
real attack surface. `proposeMaxTotalAssets`/`executeMaxTotalAssets`
(`ADMIN` proposes, execution permissionless once ready, `PAUSER_ROLE` can
cancel during the delay) apply the same self-contained timelock already
built for the router allowlist and `sweepDust`, to both increases and
decreases symmetrically, so a compromised or mistaken `ADMIN` key raising
the cap can actually be stopped during the window, not just watched.

## Strategy versioning

Strategies support versions (v1, v2, ...), history is never overwritten.
Reputation earned under one strategy thesis does not fully transfer to a
materially different version without at least a reduced trust period or
partial capital-limit reset, so an agent can't build trust conservatively and
then switch to a materially riskier strategy while keeping the old trust
level (Phase 4 rule; the versioning data model exists from Phase 1).

**Migration between versions is manual by design.** A v1 -> v2 move is a
withdraw from v1 plus a deposit into v2, two ordinary transactions, never an
automated cross-vault migration function, an automated migration path would
itself be a new cross-vault code path, cutting directly against vault
isolation. The frontend guides both signatures as one flow; the deposit into
v2 is ordinary enough that the reduced-trust-period rule above applies to it
automatically, so migrated capital never inherits v1's trust level. See
`docs/architecture.md` for the full reasoning.

## Key and secrets management

Anthropic API key: server-side only, never in the frontend, never in the
executor. Keeper signing key: isolated to `executor/keeperService.ts`, no
other module imports it; for a solo/small-team pace, stored in the hosting
provider's encrypted secret store, rotated periodically, a dedicated KMS/HSM
or account-abstraction-based custody is a Phase 5 hardening goal, not a
Phase 1 blocker. Ops confirmation credentials are a separate, ordinary human
login, entirely distinct from the keeper key.

## Monitoring and incident response

Monitored from Phase 1's event-hook design onward: policy-violation events
(should be rare, alert always), pause/unpause events, large/rapid withdrawal
spikes, oracle staleness/deviation events, keeper wallet gas/nonce anomalies,
anomaly flags. `server/indexer/` posts to a notification channel from day
one; a dedicated onchain monitoring vendor (Forta or equivalent) is a Phase 5
"verify and integrate" item, additive to the same event hook. `PAUSER` can
pause a specific vault; a blanket protocol-wide pause is reserved for
genuinely systemic failures (shared oracle or shared keeper compromise).
Pausing only ever blocks new deposits and new decision execution, never
withdrawals. The full written incident-response runbook is a living document
built out alongside Phase 2, not a Phase 1 blocker.

## Compliance

Arc is positioned for institutional/regulated activity, and the Real World
Assets category involves tokenized equities. Phase 1 reserves a no-op
`ComplianceGate` interface hook and `requiresKYC`/`allowedRegions` metadata
fields, without building real enforcement yet, retrofitting compliance hooks
into a live protocol is far harder than reserving them from the start.
