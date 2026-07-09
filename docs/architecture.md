# Mandate Protocol: Architecture (Phase 1)

## The one governing decision this whole architecture is built around

Vpay's `agent/core` never signs because Vpay never held pooled third-party
capital, the user's own wallet was always the actor. Mandate Protocol *does*
hold pooled capital, so Vpay's two-halves pattern (propose, then sign) isn't
sufficient alone. Mandate needs a third, non-negotiable gate between the two:
a deterministic on-chain policy check that neither half can bypass.

```
Claude (agent/core)  ->  offchain pre-check  ->  ops confirmation  ->  keeper simulates  ->  onchain VaultPolicy  ->  execution
     proposes              (fast, advisory)      (human, Phase 1)      + submits            (the REAL gate)
```

Nothing left of "onchain VaultPolicy" has any authority. That contract is the
only thing that can actually authorize a fund movement.

## Launch strategy

Only the team creates vaults. Public, user-created AI agents ("Agent Studio")
are cut from the roadmap entirely, not deferred to a later phase, eliminated
as a feature, because the risk of letting strangers create AI-managed vaults
was judged not worth it at any point. This removes prompt-injection-via-user-
strategy-text and sybil-resistance concerns from the design completely; they
are not designed anywhere in this document.

## Folder structure

```
mandate-protocol/
├── contracts/          MandateVault (ERC-4626), VaultPolicy (immutable limits),
│                       VaultFactory, VaultRegistry, CapitalLimitRegistry, roles, timelock
├── agent/core/         framework-agnostic reasoning module: proposeDecision() only
│                       ever builds a structured decision, never signs
├── agent/policy/       offchainPolicyCheck.ts, fast advisory pre-check, never authoritative
├── executor/           keeperService.ts, the one module holding a signing key
├── server/             API, ops confirmation queue, event indexer, reports
├── src/                React/Vite frontend, browse/deposit/withdraw only, no
│                       strategy-authoring UI
├── shared/             wire types used by all of the above
└── docs/               this document, threat-model.md, arc-facts-to-verify.md
```

## Core types

See `shared/decision.ts` (`VaultDecision`, the structured schema Claude must
emit), `shared/policyTypes.ts` (`PolicyLimits`, `PolicyViolation`,
`PolicyCheckResult`), and `shared/vault.ts` (`VaultMetadata`,
`StrategyAuthorRef`, `StrategyVersion`).

Two things enforced at the type/ABI level, not just by convention:
- `VaultDecision.reasoning` is read only by explainability/timeline code. The
  Solidity `validateDecision` signature (see below) has no string parameter at
  all, so reasoning text is structurally incapable of influencing the onchain
  gate.
- `PolicyCheckResult.source` distinguishes `"offchain-precheck"` from
  `"onchain"` so no caller can mistake the fast advisory check for the real
  gate.

There is no end-user `Signer` in the decision path. Depositors don't author or
confirm strategy decisions in Phase 1, they only sign ordinary deposit/
withdraw ERC-4626 transactions via Privy, reusing Vpay's existing user-signing
pattern verbatim. Confirmation of a proposed decision is instead an **ops
action** (a team reviewer, not a wallet signature) in Phase 1, generic enough
(`decisionId` + `confirmedBy` + timestamp) that a future phase could swap in a
wallet signature without restructuring anything else.

**Ops confirmation has a hard expiration.** A proposed decision is only ever
relevant to the market conditions it was proposed under. `QueuedDecision`
(`shared/decision.ts`) carries `queuedAt` and `expiresAt`
(`queuedAt` + a fixed `DECISION_CONFIRMATION_TIMEOUT_SECONDS`, a Phase 1
config value). If no ops confirmation happens before `expiresAt`,
`decisionPipeline.ts` marks the decision `"expired"` automatically and it is
discarded, it can never be confirmed late and rubber-stamped after the fact.
An expired decision is not retried automatically; if the vault still needs
attention, Claude proposes fresh against current state.

## Smart contract architecture

**`VaultPolicy.sol`**, deterministic, no AI, default-immutable. Fully
immutable limits (`maxAllocationBpsPerAsset`, `maxDrawdownBps`,
`maxTradesPerDay`, `minStableAllocationBps`, oracle staleness/deviation
thresholds). No governance path to loosen these on a live policy, a
materially different risk profile means a new Vault+Policy pair via the
factory, never a parameter change. Only `paused` is mutable, gated by the
`PAUSER` role, and it only blocks *new* exposure (deposits, new decision
execution), it never blocks withdrawals, the same discipline Vpay's
`P2PMarket.sol` uses (`whenNotPaused` only on functions that create new
exposure). `validateDecision` is a pure `view` function over a `Decision`
struct and a `VaultState` struct, no string fields cross this boundary.

**Auto-pause is separate from the human `PAUSER` role.** A human multisig is
too slow to react to a fast-moving attack in progress. `VaultPolicy` exposes a
second, **permissionless** function, `checkAndAutoPause(vaultId)`, mirroring
the permissionless-escalation pattern `P2PMarket.sol` already uses for
`expire()`: anyone (or, in practice, an off-chain watcher calling it
proactively) can call it, but it only actually pauses the vault if an
objective, deterministic condition the contract itself checks is true,
oracle deviation above `oracleMaxDeviationBps` at read time, oracle
**staleness** above `oracleMaxStalenessSeconds` (added so a feed that simply
stops updating, with nothing new to deviate from, still proactively pauses
the vault instead of only blocking new trades one at a time through
`validateDecision`), or drawdown speed above a new immutable
`maxDrawdownSpeedBpsPerWindow` within `drawdownSpeedWindowSeconds`. Because the check is permissionless and
purely deterministic, availability doesn't depend on any single bot staying
up, anyone can trigger it once the condition is objectively true, the same
way `expire()` doesn't depend on a privileged caller. The human `PAUSER` role
remains for subjective cases an objective condition can't capture (e.g. "we
don't trust this agent's behavior even though it's technically compliant").

**Explicit Phase 1 decision: pause is the only fallback for a failed or
stale single oracle source, stated here so it is not left implicit.**
`AssetPrice` carries both `price` and `referencePrice` (see
`IVaultPolicy.sol`), and the deviation check between them is a real, useful
sanity check, but Phase 1 does not wire up two genuinely independent
on-chain oracle sources. Both numbers are supplied by the same caller in the
same call; nothing on-chain enforces `referencePrice` comes from a different
provider than `price`. A true secondary source (e.g. a second Chainlink feed,
or a TWAP computed on-chain) is deferred to whenever `OracleRegistry.sol` is
built, the same deferral already used for feed address ownership. Until then,
staleness and deviation checks plus pause (manual and automatic, both
described above) are Phase 1's complete fallback story for a single oracle
source failing. This is an intentional scope decision, not an oversight.

**Permissionless only works if someone actually calls it, so this is a bot
AND a bounty, not permissionless-ness alone.** A purely theoretical
permissionless function that nobody has a reason to call is not real
protection. Two things make it real:
1. A dedicated off-chain watcher bot (the same process already responsible
   for keeper health monitoring, see §Backend) calls `checkAndAutoPause` in a
   loop as the primary, reliable path.
2. `checkAndAutoPause` also triggers a small, adjustable bounty payout
   (`autoPauseBountyAmount`, owned by `MandateVault`, see below for why it
   is not a `VaultPolicy` limit, denominated in the vault's own asset) to
   whoever's call actually triggers a pause, the same incentive pattern
   lending protocols use to keep permissionless liquidations reliable.
   The bounty is the backstop: if the team's bot is ever down, it's still
   worth a stranger's gas to call this, so the mechanism doesn't quietly
   depend on the team's own infrastructure staying up. The bounty is
   deliberately tiny relative to the loss a timely pause prevents, and it is
   only ever paid out of the specific vault that was actually paused, on the
   rare occasion the trigger condition is genuinely true, never a recurring
   cost.

**`autoPauseBountyAmount` lives on `MandateVault`, mutable, not on
`VaultPolicy` as an immutable limit.** Raised as a genuine design question:
risk limits (`maxDrawdownBps`, `maxAllocationBpsPerAsset`, and everything
else in `VaultPolicy`) must stay immutable forever, since they define the
vault's actual risk profile, changing them changes what the vault is. The
bounty is different: it is an economic incentive to keep a permissionless
mechanism reliable, not a risk limit, and it may need to move over time as
gas costs or USDC's effective value context changes. So it is *not* part of
`VaultPolicy.ConstructorLimits` at all. It lives as a plain
`uint256 public autoPauseBountyAmount` on `MandateVault`, defaulting to `0`
at deploy time, adjustable via `setAutoPauseBountyAmount`, gated by
`GOVERNANCE_ROLE` (in practice, the same 48h-timelock convention as any
other fund-safety-relevant parameter). `VaultPolicy.checkAndAutoPause` no
longer knows or decides the amount at all, it only ever triggers
`IAutoPausePayer.payAutoPauseBounty(address to)` (no amount parameter,
removed on purpose so there is nothing left for a caller to spoof);
`MandateVault` alone decides how much of its own funds to pay, using its own
current value. Recommended starting value once GOVERNANCE opts in: 10 USDC
(`10e18`), large enough to be worth a stranger's gas on Arc's cheap fee
market, small enough to be a rounding error against the capital a timely
pause protects. Paying nothing (amount `0`, the default) is a silent no-op,
never a revert, so an operator who hasn't configured a bounty yet doesn't
turn every real auto-pause into a failed call.
`checkAndAutoPause`'s `require(!paused)` guard is what guarantees the bounty
is paid at most once per genuine pause transition, not once per call,
confirmed under repeated spam calls by
`testFuzz_bountyPaidExactlyOncePerPauseTransition` in `test/VaultPolicy.t.sol`.

**`MandateVault.sol`**, ERC-4626, with inflation-attack mitigation applied
twice over: OpenZeppelin's virtual-shares/assets mechanism, *explicitly
enabled* by overriding `_decimalsOffset()` to a nonzero value (verified by
reading OZ 5.6.1's actual `ERC4626.sol`: this defaults to `0`, i.e. no
protection at all, unless a vault overrides it, it is not "on by default" as
earlier phrasing implied), *plus* a protocol-owned minimum seed deposit that
`VaultFactory` deposits atomically in the same transaction that creates the
vault, so there is never a near-zero-shares window to attack. Both are
required; the seed deposit is not a substitute for the offset override, and
vice versa. Swaps execute atomically inside the vault itself
(policy check, swap, receive proceeds, one transaction) rather than through
an off-chain custody wallet like Vpay's `swapExecutor.ts`. This is the one
place this design must go beyond Vpay's proven pattern: Vpay could accept a
brief off-chain custody window because it never held pooled third-party
funds; this protocol cannot accept that for vault capital.

**The swap router interface is the real thing, not a placeholder.**
`ISwapRouter.sol` adopts the standard Uniswap V3 `exactInputSingle` ABI
directly, because a real, deployed, verified router genuinely exists on Arc
Testnet: "UnitFlowV3Router" by ACTFUN (a token launchpad), third-party
standard-Uniswap-V3-compatible infrastructure, explicitly NOT the official
Uniswap Labs deployment announced as an Arc ecosystem partner (that one
still has no publicly documented address). Verified independently, not
trusted secondhand: real deployed bytecode, verified source on Arcscan
matching the standard Uniswap V3 file structure, `Router.factory()`
returning the exact known Factory address, and a real pool with real
liquidity found via the Factory's own `PoolCreated` events. See
`docs/arc-facts-to-verify.md` for full details and addresses.
`test/MandateVaultArcFork.t.sol` runs the full atomic swap plus policy
validation flow against this real router and real pool on a fork of Arc
Testnet, not just the mock (`contracts/test/MockSwapRouter.sol`, which
implements the same real interface so unit tests exercise the exact call
shape used against the real router).

Withdrawals are
never pausable, same rule as above.

**USDC donation attack, verified live on Arc testnet, distinct from the
standard ERC-4626 inflation attack.** Arc's native USDC (18 decimals) and its
ERC-20 interface at `0x3600000000000000000000000000000000000000` (6 decimals)
are not two balances, they're the same balance at two precisions, confirmed
live: a test wallet showed native `4.450809203902973` USDC against ERC-20-view
`4.450809` USDC (an exact truncation, not a rounding difference), and a
deployed contract showed an exact `2.0` USDC match on both. This means anyone
can send plain native USDC directly to `MandateVault`'s address, at **any
time**, completely bypassing `deposit()`, and `balanceOf(address(this))`
changes instantly as a result, a standing donation vector, not just a
narrow first-deposit window like the classic ERC-4626 inflation attack.
**Consequence for implementation:** `MandateVault` must track its own
internal accounting variable for USDC-denominated assets, incremented only by
`deposit()`/`withdraw()`/`executeDecision()`, and `totalAssets()`/share-price
math must use that internal ledger, never a live `balanceOf(address(this))`
read, for the USDC portion. An unsolicited direct transfer sits as unaccounted
dust, it never moves share price for existing depositors, until governance
explicitly sweeps it through a defined, timelocked function (Phase 2 detail;
the "never trust live balanceOf for USDC" rule is decided now, in Phase 1).

**Zero-address transfer reverts apply identically on both interfaces,
verified live.** Simulated a transfer to `address(0)` on the ERC-20 interface:
reverted. Simulated a plain native transfer to `address(0)`: also reverted,
with an explicit reason, `"Zero address not allowed"`, the same rule enforced
at the asset level, not something that only exists in an ERC-20 wrapper.
(Blocklist-specific behavior, e.g. for a sanctioned address, was not
independently verified, no known blocklisted test address was available,
but treat it as governed by the same underlying-asset rule until proven
otherwise.) **Consequence for implementation:** any code path that pushes a
transfer to a recipient outside the caller's own withdrawal (e.g. the
`checkAndAutoPause` bounty payout, or any future batch/sweep operation) must
isolate that transfer's failure so it can never revert or block anything
else. Concretely: `checkAndAutoPause` must flip `paused` **before** attempting
the bounty payout (checks-effects-interactions) and wrap the payout itself in
a low-level call whose failure is tolerated (logged, not reverted), a bounty
that fails to pay out must never mean the pause itself didn't happen. Ordinary
user withdrawals are unaffected by this risk since ERC-4626 `withdraw`/
`redeem` are already pull-based, one user per transaction (a blocked
recipient can only ever fail their own call), this rule matters specifically
for any push-style, multi-recipient code path, and no such path should ever be
added without the same isolate-and-tolerate treatment.

**Capital limits are deliberately *not* part of the immutable policy.**
Deposit caps (progressive-trust tiers, e.g. 500 -> 1,000 -> 5,000 -> 10,000)
genuinely need to move over time as a vault proves itself. Baking them into
the immutable policy would force a redeploy every time a cap increases. They
live in a separate `CapitalLimitRegistry.sol`, mutable only by `GOVERNANCE`
behind a timelock.

**Roles** (least privilege): `ADMIN` (team multisig, create vaults, grant/
revoke roles), `PAUSER` (small multisig, e.g. Randy + brother, pause/unpause
per vault, never touches policy limits or withdrawals), `KEEPER` (the
executor service's onchain identity, can only call `executeDecision`,
nothing else), `GOVERNANCE` (team multisig behind a timelock, the narrow set
of parameters that legitimately change over time: oracle feed address, DEX
router allowlist, capital limit registry values; cannot touch `VaultPolicy`'s
immutable limits, because they're immutable).

**Concrete timelock duration: 48 hours minimum for anything touching
fund-safety-relevant parameters**, matching the common DeFi standard
(Compound and Aave both use timelocks in this range). This is not yet a
deployed constraint (`MandateVault.setRouterAllowed` and the future
`OracleRegistry`/`CapitalLimitRegistry` are plain `onlyGovernance` today,
with no timelock code of their own, per the "router timelocking is a
deployment/ops decision, not vault code" note above), it is achieved
entirely by which address is actually granted `GOVERNANCE_ROLE`. That
address must be an OpenZeppelin `TimelockController` (already installed,
`node_modules/@openzeppelin/contracts/governance/TimelockController.sol`)
deployed with `minDelay = 48 hours`, never an EOA or a plain multisig with
no delay, once real capital is at stake. Documented here as the concrete
planned value so "a timelock" is not left as an undefined concept.

**Oracle feed switches are validated against the outgoing feed's last price.**
An oracle address change is a historically common DeFi attack vector (swap in
a malicious or mispriced feed, then immediately exploit the gap). `GOVERNANCE`
changing the feed still goes through the timelock, but the switch itself
additionally requires the new feed's price at switch time to be within
`oracleMaxDeviationBps` of the previous feed's last known price, if it isn't,
the switch reverts rather than silently taking effect. This makes an oracle
swap subject to the same deviation discipline as any other price read, instead
of being a trusted, unchecked admin action.

**Where "the current feed address" actually lives, decided while implementing
`VaultPolicy.sol`.** It is deliberately NOT stored on `VaultPolicy` itself.
`VaultPolicy`'s whole design point is "immutable except `paused`"; storing a
governance-mutable feed address there would add a second mutable field and
weaken that guarantee. Instead, `validateDecision`/`checkAndAutoPause` receive
price and timestamp as plain arguments (part of `VaultState`), sourced from
wherever `MandateVault`/the keeper reads them at call time. Ownership of "the
current feed address" and the switch-with-continuity-check logic above
belongs to a small, separate `OracleRegistry.sol`, not designed or built in
this round, noted here so it isn't silently forgotten before `MandateVault`
is built.

**Upgradability**: `VaultPolicy` and `VaultFactory` immutable. `MandateVault`
immutable per instance (a new strategy version is a new Vault+Policy pair, not
an upgrade). `VaultRegistry` a simple mutable append-only registry, owned by
`ADMIN`. `CapitalLimitRegistry` mutable, `GOVERNANCE` + timelock only.

**Real deployment sequence, discovered while implementing `VaultFactory`
(not part of the original plan, added here so it is not lost).**
`VaultFactory` deploying both `MandateVault` and `VaultPolicy` directly via
`new` pushed its own bytecode past the EIP-170 24576-byte contract size
limit (Solidity embeds a contract's full creation code into anything that
instantiates it), so `MandateVault`'s creation is split into a dedicated
`MandateVaultDeployer.sol`. That contract has its own circular-dependency
problem, the same shape as `MandateVault`/`VaultPolicy`'s: it must exist
before `VaultFactory` (which takes its address as a constructor argument),
so it cannot take `VaultFactory`'s address as a constructor argument either.
Resolved the same way, with one more step:
1. Deploy `MandateVaultDeployer`.
2. Deploy `VaultFactory`, passing in step 1's address.
3. Call `MandateVaultDeployer.setFactory(address(vaultFactory))`, exactly
   once, restricted to whoever deployed `MandateVaultDeployer` in step 1.

An earlier version of `MandateVaultDeployer.deploy` took the factory address
as a plain parameter with no restriction at all, reasoning that a directly-
deployed rogue vault would just be unregistered in `VaultFactory`'s own
`isMandateVault` mapping. That reasoning was incomplete: anyone could call
`deploy` directly and pass in the real, legitimate `VaultFactory`'s address,
producing a vault whose immutable `factory` field genuinely reads as the
real, known `VaultFactory`, despite never having gone through it. Any future
code trusting that field directly instead of checking the registry would be
fooled. Fixed at the source: `deploy` now takes no `factory` parameter at
all, it only ever uses `msg.sender`, checked against the one-shot `factory`
address set in step 3 above.

**Capital migration v1 -> v2 is manual withdraw + redeposit, by design, not an
oversight.** Since each strategy version is a genuinely separate Vault+Policy
pair (deliberately, so a v2 bug can never reach v1's funds), an automated
"migrate my shares from v1 to v2" function would itself be a new cross-vault
code path, exactly the kind of blast-radius-breaking mechanism vault
isolation exists to prevent. The decision: there is no migration contract or
function. A depositor who wants to move into v2 redeems from v1 (an ordinary,
already-existing withdrawal) and deposits into v2 (an ordinary, already-
existing deposit) as two separate transactions. The frontend can make this
feel like one action (e.g. a "Move to v2" button that submits both
transactions back to back), but at the contract level v1 and v2 never touch
each other. This is documented here explicitly so it is never mistaken for a
gap to fill later.

Confirmed, and made explicit here so neither is accidentally assumed away:
- **Frontend UX**: `src/` is in scope to build a guided two-step "Move to v2"
  flow, a single UI action that requests the v1 withdrawal signature, then
  immediately requests the v2 deposit signature once the first confirms, so
  the user experiences one guided action even though it is two ordinary,
  independently-signed transactions underneath. No contract change, no shared
  state between v1 and v2, the frontend is just sequencing two calls a user
  could always make manually.
- **Reputation still applies the reduced-trust rule.** The reduced-trust-
  period rule for strategy version changes (see Strategy Versioning in
  `docs/threat-model.md`) is keyed on "capital was deposited into v2," not on
  where that capital came from. A migrated deposit is, from the vault's and
  the reputation system's point of view, indistinguishable from a fresh
  deposit into v2, it goes through the exact same `deposit()` call. So a user
  migrating from a trusted v1 position does **not** inherit full trust in v2;
  they get the same reduced-trust period any new v2 depositor gets. This
  needs no special-case code, it falls out automatically from migration
  being "two ordinary transactions," which is itself another reason not to
  build a dedicated migration function that might be tempted to special-case
  this and accidentally carry trust over.

## Why Agent Studio isn't designed here, and why that's safe to leave open

Even though public vault creation is cut from the roadmap, the future
`VaultRegistry.sol`'s `strategyAuthor` field (today only an off-chain TS type
in `shared/vault.ts`, `VaultRegistry.sol` itself is not built yet, see the
"out of scope this round" note in `contracts/README.md`) is planned as a
plain identifier rather than a hardcoded "always the team" assumption, and
`agent/core`'s system prompt is always kept separate from any
strategy-configuration text rather than string-concatenated together.
Neither of these costs anything extra to build this way now, they're just
not designed to assume something that happens to be true today (only the
team authors vaults) will always be architecturally required.

**Requirement for when `VaultRegistry.sol` is actually built (noted now so
it is not forgotten): `strategyAuthor` must only ever be settable through
the `ADMIN`-gated vault-creation flow in `VaultFactory`, with no separate
setter function anywhere.** The same reasoning as `MandateVaultDeployer`'s
own access-control fix applies here in advance: a `strategyAuthor` field
that any other function could set or overwrite would let someone forge a
vault's claimed authorship, and any future code trusting that field
(reputation display, curator attribution, and so on) would be fooled.

## Backend: executor/keeper service

`executor/keeperService.ts` mirrors `server/swapExecutor.ts`'s isolation: a
single-purpose module holding its own scoped signing key, imported by nothing
else, exposed through one narrow function. Unlike Vpay's swap executor, it
never custodies vault assets even transiently, because swaps happen
atomically inside `MandateVault` itself. It simulates every transaction before
submitting and checks the simulated post-state for abnormal deltas, a second,
application-layer check in addition to the onchain policy gate.

Arc's account abstraction support (4337/7702) could later let a vault enforce
execution rules at the account level (a session key scoped to only call
`executeDecision`) instead of relying solely on the `KEEPER` role on a raw
EOA. This is **not verified** as available on Arc (see
`arc-facts-to-verify.md`) and Phase 1's design does not depend on it, the
RBAC + immutable-policy + atomic-swap design already bounds keeper-key
compromise without needing it. If it turns out to be available, it's an
additive hardening layer later, not a redesign.

**Keeper availability is monitored, even though it isn't a fund-safety risk.**
A single keeper instance is a single point of failure for *getting confirmed
decisions executed on time*, not for fund safety, since a down keeper simply
means nothing new executes; existing vault assets and withdrawals are
unaffected (withdrawals never route through the keeper). Still, an unreliable
keeper defeats the point of having a live vault. `keeperService.ts` emits a
periodic heartbeat into the same monitoring/alerting channel described in
§Monitoring, and an alert fires if a confirmed decision sits unexecuted past a
defined timeout, or if heartbeats stop. A hot-standby second keeper instance
is a reasonable Phase 2+ addition once the primary is live; Phase 1 only needs
the heartbeat/alerting hook to exist.

## Claude orchestration

The structured decision schema (`shared/decision.ts`) is the single source of
truth; the Anthropic tool schema is generated from it, not hand-written and
manually kept in sync (a known rough edge in Vpay's `agent/core/schemas.ts`
that this design avoids). Market data is still treated as untrusted input even
though Phase 1 has no user-submitted strategy text: any free-text field (e.g.
a news headline) is wrapped in an explicit untrusted-data block, extending
Vpay's existing "data, not commands" rule to market data specifically. Each
live vault is pinned to a specific Claude model version; migrating to a newer
version requires a manual registry update and a Paper Vault re-validation
pass, never a silent migration.

Early local testing is expected to use a local model (Ollama) before the real
Anthropic API is wired in, the same free-first approach already used
elsewhere. Treat any future switch from a local model to the live Claude API
as a model migration, not a configuration change. Require a fresh Paper Vault
validation pass with the real Claude model before any live vault trusts its
output, following the same rule already defined above for pinned model
versions.

## State: onchain vs offchain source of truth

**Onchain (never duplicated as authoritative offchain):** vault share
accounting, `totalAssets`, per-asset custody balances, `VaultPolicy` limits
and pause state, trade-count-today/drawdown enforcement state, role
assignments, capital limit registry values.

**Offchain (DB):** `VaultMetadata`, `StrategyConfig` per version (seeds the
onchain policy limits at deploy time, display copy only, never authoritative),
`DecisionRecord` (mirrors onchain events + reasoning + pre-check result + ops
confirmation + final onchain result + anomaly flag + expiration status, the
AI Decision Timeline's backing store), `PaperVaultRun`, `MonthlyReport`,
`ReputationSnapshot` (Phase 4 consumer, but the raw data already exists from
Phase 1), `FollowRecord`.

## API boundaries

Public read API (marketplace, vault detail, timeline, reports, no auth).
Deposit/withdraw go directly from the frontend to the contracts via the
user's own Privy wallet, the backend only indexes the resulting events, it
is never in that signing path. An internal, auth-gated ops API confirms or
rejects proposed decisions (team-only in Phase 1). The keeper is not an HTTP
API; it polls for confirmed decisions and submits them onchain.

Paper Vault reuses `proposeDecision` with a `mode: "paper"` context; only the
injected executor changes (a no-op `PaperExecutor` that logs instead of
submitting onchain), the same swappable-implementation-behind-one-interface
seam Vpay uses for test vs. real signers, applied to the executor side.
Monthly report generation is a separate Claude call path with its own system
prompt and zero wiring to the `proposeDecision` tool, so it cannot produce a
`VaultDecision` even in principle.
