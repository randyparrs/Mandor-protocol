# Arc Testnet Deployments

**v1 and v2 are DISCONTINUED** (HOLD/REBALANCE only, no real
yield-generating mechanism) -- their full deployment record moved to
`legacy/deployments-v1-v2.md`. This document covers the shared
infrastructure history (VaultFactory generations, governance, CCTP) and
the **ACTIVE** v3/v4/v5 deployments below.

## Mandate USDC Vault (v1) -- DISCONTINUED, see `legacy/deployments-v1-v2.md`

Deployed 2026-07-10, USDC-only, HOLD/REBALANCE only. Full record (addresses,
role assignments, all 15 transactions) moved to
`legacy/deployments-v1-v2.md`. Superseded by v3/v4/v5.

## Mandate USDC+cirBTC Vault (v2) -- DISCONTINUED, see `legacy/deployments-v1-v2.md`

Deployed 2026-07-11, USDC + cirBTC, HOLD/REBALANCE only, same mechanism as
v1. Full record (addresses, policy limits, transactions, known
limitations) moved to `legacy/deployments-v1-v2.md`. Superseded by
v3/v4/v5.

## Second VaultFactory generation, status: deployed 2026-07-16

**Why a second `VaultFactory` instance exists (or will shortly): the
first one cannot create v3.** Discovered 2026-07-16 when the real
`createVault` call for v3 reverted at only 212 gas against the real, live
old factory, the signature of "no matching function selector." Confirmed,
not guessed: the real deployed bytecode at the old `VaultFactory`
(`0xb6B77A2978B1974097727e267BCaAC35ba7ddf12`, `eth_getCode`, 11,237
bytes) does not match current `VaultFactory.sol` source (12,243 bytes
compiled), because `VaultPolicy.ConstructorLimits` (embedded directly in
`VaultFactory.CreateVaultParams`) grew 5 new v3 LP fields
(`minLpTickRangeWidth`/`maxLpPositionValueLossBps`/`maxLpOutOfRangeSeconds`/
`minLpPoolLiquidityRatioBps`/`maxLpAllocationBps`) after the old factory
was deployed for v1, and it was never redeployed since (v2 didn't need
these fields to be new, since `ConstructorLimits` had already grown once
by the time v2 was created, apparently without anyone re-verifying the
deployed factory still matched current source). Replaying the real,
reverted transaction's exact calldata against a local fork with full
traces confirmed this precisely: the encoded function selector for the
new (17-field) struct shape simply does not exist on the real, older
contract.

**The existing `MandateVaultDeployer` cannot simply be pointed at a new
factory either**: its own `factory` field is set exactly once, forever
(`if (factory != address(0)) revert FactoryAlreadySet();`), and is
already permanently bound to the old `VaultFactory`'s address. So a fresh
`MandateVaultDeployer`+`VaultFactory` pair is required, mirroring the
original bootstrap sequence in `legacy/deployArcTestnet.ts` exactly
(`scripts/deployVaultFactoryForV3.ts`): deploy a new
`MandateVaultDeployer`, deploy a new `VaultFactory` reusing the existing,
unaffected `MandateRoles`/`CapitalLimitRegistry`/`protocolTreasury`
(none of which depend on `ConstructorLimits`'s shape), then call
`setFactory` once.

**Confirmed safe for v1 and v2, by reading the code, not assuming:**
`MandateVault.sol`'s `factory` field is only ever checked at runtime in
two places: `setPolicy` (`onlyFactory`, but already permanently consumed
for both live vaults, `policy != address(0)` blocks it regardless of
caller) and `setCapitalLimitRegistry` (`onlyFactory` OR `GOVERNANCE_ROLE`,
so `GOVERNANCE_ROLE` always has an independent path regardless of the old
factory's fate). Neither `VaultPolicy.sol` nor `MandateRoles.sol`
reference `VaultFactory` at all (`MandateRoles` is a plain OpenZeppelin
`AccessControl` registry with 4 role constants, no per-factory allowlist
of any kind, confirmed by reading the full, short source). Two
`VaultFactory` instances coexisting onchain, one that created v1/v2 and a
new one that only ever creates v3+, changes nothing about how v1/v2
operate.

**Which factory created which vault, for future reference:**

| VaultFactory | Address | Created |
|---|---|---|
| First (original) | `0xb6B77A2978B1974097727e267BCaAC35ba7ddf12` | v1 (`0x9D1b2853722bc69C062D044D74DBeFae430422be`), v2 (`0x6a00e9de0b830Fd2Bc37db7C19Ae8b67a0df1862`) -- both discontinued, see `legacy/`. Never used again after this. |
| Second (new) | `0xB6a54F66174D7CE37739945B6Da3b463bbE849D8` | v3 and any future vault, since `ConstructorLimits` matches current source going forward. |

### Contract addresses (second generation)

| Contract | Address | Note |
|---|---|---|
| TickMath | `0x5fe35a5bBD03ce56b0DEDF03666cC3aEfba84633` | New, standalone library, no dependencies. Never deployed to the real chain before this (only ever existed in ephemeral local/forked test state, v1/v2 predate v3's LP math entirely). |
| LiquidityAmounts | `0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140` | New, linked against the real TickMath above. Same "never deployed for real before" situation as TickMath. |
| MandateVaultDeployer (new) | `0x9c6181360E6fDC37BCd82cf6370e0251DA525948` | New, linked against the real LiquidityAmounts above (its own creation bytecode embeds `MandateVault`'s full creation bytecode, which references it). |
| VaultFactory (new) | `0xB6a54F66174D7CE37739945B6Da3b463bbE849D8` | Constructor reused the existing `MandateRoles`/`protocolTreasury`/`CapitalLimitRegistry` addresses as-is, referencing the new `MandateVaultDeployer` above. |

MandateRoles, protocolTreasury, and CapitalLimitRegistry are unchanged,
same addresses as v1/v2 (see the top of this document), reused directly
in the new VaultFactory's constructor, cross-checked live against the old
factory's own `roles()`/`protocolTreasury()`/`capitalLimitRegistry()`
before deploying, not assumed.

### Transactions

All 5, real, sequential, bootstrap deployer `0x57bf9B8D97a845BC508675523d3f1a403cCF7f22`
(a fresh, dedicated, single-purpose key,
`FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY`, `scripts/generateFactoryBootstrapWallet.ts`,
holds no role or authority anywhere else in this project, funded with 20
USDC of real Arc Testnet gas). Needed no privileged role at all
(`MandateVaultDeployer`'s constructor just records `msg.sender`,
`VaultFactory`'s constructor takes plain addresses, the math libraries
are permissionless); the real `ADMIN_ROLE` key is only needed afterward,
once, for the actual `createVault` call.

| # | Step | Tx hash |
|---|---|---|
| 1 | Deploy TickMath | `0x23b474f65cabc0af2bcd6eadbd8baf62b59edc58eb117ac1b2fc3a1ffbc2e27a` |
| 2 | Deploy LiquidityAmounts (linked against TickMath) | `0x4e0414abfa479a2a1cc22f046560ceb174ac3a91287d9956d178ef7da2d37515` |
| 3 | Deploy MandateVaultDeployer (linked against LiquidityAmounts) | `0x5ad265be656dc8b03e5791ec2ac1cb1880d714253b1558da810aab59b5699018` |
| 4 | Deploy VaultFactory (roles/protocolTreasury/CapitalLimitRegistry reused, referencing the new deployer) | `0xd1fa35edaa9e26fd2237cebcde69d6ce583870c2a7c16a0c98cc362927779a3f` |
| 5 | MandateVaultDeployer.setFactory(new VaultFactory) | `0xba9f09fb03dfa12b8c9c58b0db7b5bda2a2365866d5c930aa00b22726acb8254` |

Verified independently after the run, not just trusted from the deploy
script's own console log: fresh `cast call` reads confirming
`MandateVaultDeployer.factory() == the new VaultFactory` and
`VaultFactory.vaultDeployer() == the new MandateVaultDeployer` (circular
reference correct both directions), plus `eth_getCode` confirming real,
non-empty bytecode at the new `MandateVaultDeployer` address.

**A second real gap found and fixed during this same bootstrap, not
anticipated going in:** `TickMath` and `LiquidityAmounts` (the v3 LP math
libraries, see the v3 section below) had never been deployed to the real
Arc Testnet at all before this, only to ephemeral local/forked test
state. `MandateVaultDeployer`'s own creation bytecode (embedding
`MandateVault`'s creation bytecode) still contained an unresolved
`__$...$__` Solidity library-linking placeholder for `LiquidityAmounts`,
which itself had one for `TickMath`. Discovered live (the first raw
deployment attempt failed client-side with "Invalid byte sequence"
before ever reaching the RPC), fixed by deploying both libraries for
real, in dependency order, and manually linking each subsequent
contract's bytecode against the real address (byte-offset substitution
using the compiled artifact's own `linkReferences`, verified correct
length and full placeholder removal before ever spending real gas on it).
Also worth noting for the record: the real Arc Testnet public RPC
rejects `eth_estimateGas` for large contract-creation payloads with
"Invalid parameters were provided to the RPC method" (worked around with
an explicit, generously-sized `gas` parameter instead of relying on
estimation), and enforces a tight per-request rate limit even for a
single isolated call under general load (worked around with an explicit
~2.5s pause between every RPC call in the script).

**Note for v4+, not acted on now, Randy's own flag**: this mismatch
happens every time a new risk-limit field is added to
`VaultPolicy.ConstructorLimits`, since `VaultFactory.CreateVaultParams`
embeds that struct directly, forcing a full, real `VaultFactory`
redeployment each time, whether or not `VaultFactory.sol`'s own logic
changed at all. Worth reconsidering for a future version: a more flexible
limits-passing design (e.g. `VaultFactory` accepting encoded bytes it
passes through to `VaultPolicy`'s constructor unmodified, rather than
embedding the exact struct shape in its own ABI) so adding a new risk
dimension doesn't require redeploying shared factory infrastructure
every time.

## Third VaultFactory generation (v4, cross-chain lending), status: deployed 2026-07-16

v4 adds cross-chain lending (see `LendingPositionRegistry.sol`,
`MandateVault.sol`'s `BRIDGE_DEPOSIT`/`BRIDGE_WITHDRAW` actions).
`VaultPolicy.ConstructorLimits` gained 4 new fields
(`lendingReportStaleAfterSeconds`/`lendingReportMaxDeviationBps`/
`lendingPositionForceUnwindSeconds`/`maxLendingAllocationBps`), so the
real, already-deployed v3 `VaultFactory`'s `createVault` ABI no longer
matches current source -- the exact same reason a fresh factory pair was
needed going from v1/v2 to v3 (see the second-generation section above),
now recurring for the same structural reason Randy already flagged as
worth reconsidering for v5+ (the rigid, embedded `ConstructorLimits`
shape).

**A real, more serious problem surfaced during this bootstrap's own
development, not anticipated going in**: v4's cross-chain lending
additions grew `MandateVault.sol`'s own dispatch logic and the shared
`Decision`/`VaultState` structs enough that `MandateVaultDeployer`
embedding `MandateVault`'s full creation bytecode via `new MandateVault(...)`
pushed `MandateVaultDeployer`'s own runtime to 27,905 bytes measured,
3,329 bytes over the EIP-170 24,576-byte limit -- not closable via the
same trimming techniques that kept v3 under budget without cutting
already-agreed v4 functionality (the `reportLendingPosition` deviation
check, the intentionally-separate stale-withdrawal bounty). Fixed by
rewriting `MandateVaultDeployer` to stop embedding `MandateVault`'s
creation bytecode in Solidity source entirely: the bytecode is now
supplied as a constructor argument (calldata, never compiled-in source)
and stored via a new `BytecodePointer.sol` contract (the standard
"SSTORE2-for-bytecode" pattern) as inert, `EXTCODECOPY`-readable data,
since EIP-170 only limits deployed runtime code size, never
constructor-argument calldata size.

**A second, more fundamental limit surfaced live once that fix was
tested on the real chain**: a single `BytecodePointer` instance is itself
bound by the exact same EIP-170 limit it was built to route around for
`MandateVault`, since its own deployed size equals exactly the data it is
given to store -- and `MandateVault`'s real creation code (26,576 bytes)
is itself over the 24,576-byte limit. Confirmed live via `cast run`
against a real reverted Arc Testnet transaction
(`[CreateContractSizeLimit]`, not a gas problem -- a real, documented
diagnostic detour first ruled out gas via a clean empirical probe
(`scripts/probeArcGasCostPerByte.ts`, small known filler sizes fit a
linear ~216 gas/byte model closely matching standard Ethereum's 200
gas/byte) and a real Foundry fork replay of the exact failing deployment
succeeding with only 5,766,038 gas, before `cast run`'s full trace
revealed the real revert reason). This is a well-documented, known
constraint of the SSTORE2 pattern in general (confirmed against
0xsequence/sstore2's own reference implementation), not Arc-specific.
Fixed by fragmenting `MandateVault`'s creation code across multiple
`BytecodePointer` instances (a generic `bytes[]` array, not a hardcoded
count, so a future version needing 3+ fragments requires no contract
change), each individually checked against `MAX_FRAGMENT_SIZE` (24,000
bytes, a safe round margin under the hard limit) at construction time,
reverting with an explicit `FragmentTooLarge` error rather than the
opaque `CreateContractSizeLimit` this whole detour was spent diagnosing.

### Contract addresses (third generation)

| Contract | Address | Note |
|---|---|---|
| MandateVaultDeployer (new, v4) | `0x5a410338cacb3651c68ae08f22ee8166cad63062` | Fragmented: 2 `BytecodePointer` instances (24,000 + 2,576 bytes), each independently verified byte-identical to the corresponding slice of `MandateVault`'s real, linked creation code (26,576 bytes total) via a fresh `eth_getCode` read, and the full reconstruction independently verified byte-identical to the original. Own runtime: 1,810 bytes, confirming no embedding. |
| VaultFactory (new, v4) | `0x94d5c4b8c6d1fc6dc8496f7764b36052fc1914eb` | Constructor reused the existing `MandateRoles`/`protocolTreasury`/`CapitalLimitRegistry` addresses as-is (cross-checked live against the real v3 `VaultFactory`'s own getters before deploying, not assumed), referencing the new `MandateVaultDeployer` above. |
| LiquidityAmounts (reused, not redeployed) | `0xeC5A52D42E716b9e44CAd7002bE533Cb88B08140` | Same instance from v3's own bootstrap; v4 doesn't touch LP math, so no need to redeploy it or `TickMath`. |

`MandateRoles`, `protocolTreasury`, and `CapitalLimitRegistry` are
unchanged, same addresses as v1/v2/v3 (see the top of this document).

### Transactions

4 real, sequential, bootstrap deployer
`0xaD724299B7CdA00a249A085aFA6A2bA2e29dE217` (a fresh, dedicated,
single-purpose key, `FACTORY_BOOTSTRAP_DEPLOYER_V4_PRIVATE_KEY`,
`scripts/generateFactoryBootstrapWalletV4.ts`, deliberately NOT
`FACTORY_BOOTSTRAP_DEPLOYER_PRIVATE_KEY` reused from v3's own bootstrap,
holds no role or authority anywhere else in this project, funded with 20
USDC of real Arc Testnet gas by Randy directly). Needed no privileged
role at all (`MandateVaultDeployer`'s constructor just records
`msg.sender` and deploys `BytecodePointer` fragments, `VaultFactory`'s
constructor takes plain addresses); the real `ADMIN_ROLE` key is deliberately
NOT used yet -- `scripts/deployVaultV4.ts` (the actual vault creation) is
held off per Randy's own explicit instruction until three real blockers
are resolved (real CCTP TokenMessenger/domain addresses, the 2-of-3 Safe
multisig for new v4 human governance roles, a dedicated Arbitrum Sepolia
keeper wallet).

| # | Step | Tx hash |
|---|---|---|
| 1 | Deploy MandateVaultDeployer (2 fragments) | `0x7973a7cb7e68ac8544952a3afebee73195001af152e0d390b6b9a433f45f768e` |
| 2 | Deploy VaultFactory (roles/protocolTreasury/CapitalLimitRegistry reused, referencing the new deployer) | `0xf5aa8d92fb5c3b50cdabce9773b37a0082e1feef7b1736de7474389d289a8bda` |
| 3 | MandateVaultDeployer.setFactory(new VaultFactory) | `0x01f29b071f5e3e5dd12726bacecb0c13b35afd79ab3486c1370aa24224a5a933` |

(3 transactions, not the 5 v3's own bootstrap needed, since `TickMath`/
`LiquidityAmounts` are reused rather than redeployed.)

Verified independently after the run, not just trusted from the deploy
script's own console log: every fragment's live `eth_getCode` compared
byte-for-byte against the corresponding slice of the linked creation
code; the full reconstruction (all fragments concatenated by the
verification script itself, not via the contract's own convenience view)
compared byte-for-byte against the original; `MandateVaultDeployer`'s own
live runtime size confirmed small; the new `VaultFactory`'s full wiring
(`roles`/`protocolTreasury`/`capitalLimitRegistry`/`vaultDeployer`) and
`MandateVaultDeployer.factory()` cross-checked both directions.

**The specific confirmation Randy asked for explicitly**: the real v3
`VaultFactory` (`0xB6a54F66174D7CE37739945B6Da3b463bbE849D8`)'s full state
(`roles`/`protocolTreasury`/`capitalLimitRegistry`/`vaultDeployer`/
`vaultCount`) was read live BEFORE this bootstrap and re-read live AFTER
it completed -- identical in every field, including `vaultCount` staying
at 1 and `vaultDeployer` still pointing at v3's own deployer
(`0x9c6181360E6fDC37BCd82cf6370e0251DA525948`), never the new one. v3's
factory will continue to create only v3-shaped vaults, exactly as v1/v2's
original factory remained untouched and vault-count-frozen after v3's own
bootstrap.

## Fourth VaultFactory generation (Gen4, for v5), status: deployed 2026-07-19

**A new, previously-unstated class of trigger for needing a fresh
`VaultFactory`, distinct from the `ConstructorLimits`-shape trigger noted
above.** Every prior bootstrap (v1/v2 -> v3, v3 -> v4) was forced by a
*shape* change: a new field added to `VaultPolicy.ConstructorLimits`,
which `VaultFactory.CreateVaultParams` embeds directly, so the old
factory's `createVault` ABI stopped matching current source. v5's own
`ConstructorLimits` shape is IDENTICAL to v4's -- no new fields at all.
v5 only changes `maxDrawdownBps`'s immutable *value* and adds a
`REBALANCE` exemption inside `validateDecision`'s own *logic* (see
`docs/v5-ergodic-rebalancing.md`'s design writeup).

A new factory is still required, for a different, more general reason:
`contracts/VaultFactory.sol` deploys `VaultPolicy` via a direct Solidity
`new VaultPolicy(params.limits)` call. This embeds `VaultPolicy`'s FULL
compiled bytecode -- its entire logic, not just its ABI -- into
`VaultFactory`'s own bytecode, frozen at `VaultFactory`'s own deploy time,
not at the time a vault is created from it. Editing
`contracts/VaultPolicy.sol` and running `forge build` only ever updates
local build artifacts and fresh Foundry test deployments (`forge test`
deploys straight from source for every test, entirely bypassing this
factory-embedding question, which is exactly why the new REBALANCE-exemption
tests passed cleanly even though the bug below was real). It has ZERO
effect on any vault created through an already-deployed factory.

**How this was caught**: a v5 vault was deployed through the existing
Gen3 (v4-era) `VaultFactory` (`0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb`)
with `maxDrawdownBps` correctly set to 1000 via the constructor argument.
Reading `maxDrawdownBps` back independently confirmed 1000, which looked
correct. But a real, live functional call to `validateDecision` --
constructing an actual `REBALANCE` decision against a `VaultState` with
`currentDrawdownBps` above 1000 -- showed `REBALANCE` still failing with
`MAX_DRAWDOWN_EXCEEDED`, identically to `HOLD`. The exemption was never
live, despite the correct constructor argument, because Gen3's own
`VaultFactory` bytecode still embeds the OLD, unconditional
`VaultPolicy.validateDecision` logic from before this session's edit.
**Reading back a constructor argument's value is not sufficient evidence
that a logic change is live** -- only a real functional call against the
actual deployed instance proves it.

**The generalized rule going forward, so this is checked proactively and
not rediscovered**: any edit to `contracts/VaultPolicy.sol`'s logic --
even one that changes zero fields of `ConstructorLimits` -- requires
bootstrapping a new `VaultFactory`+`MandateVaultDeployer` pair before any
vault relying on that logic change is deployed. Before trusting any such
vault, verify with a real functional call exercising the changed logic
path directly (not merely reading back an immutable's value), the same
standard this note itself was written to enforce.

Two v5 deploys made through the stale Gen3 factory before this was caught
are abandoned, never to be used for anything real:
- `0x724C7173584C74342BA9a35c8d15fb5C01cf0CBB` (`VaultPolicy`
  `0x85cC82749C1D7a90cBC421BBCbE129242FB38495`): also carried the wrong
  `maxDrawdownBps` (5000/50%, an earlier, rejected design), on top of
  missing the REBALANCE exemption entirely.
- `0x0994708126158E0F1e57B80992028440253043Af` (`VaultPolicy`
  `0x74AeDd17257710DEd5e55F56E953A0fb5f15B7c0`): `maxDrawdownBps` correctly
  1000, but still missing the REBALANCE exemption (confirmed via the live
  functional call described above).

Both hold a nominal 5 USDC seed each and are otherwise inert (see
`docs/v5-ergodic-rebalancing.md`'s Blocker A/B); no further action needed
on them beyond never treating either as the real v5 vault.

Bootstrap scripts: `scripts/generateFactoryBootstrapWalletV5.ts` (fresh,
single-purpose key, mirrors `generateFactoryBootstrapWalletV4.ts` exactly)
and `scripts/deployVaultFactoryForV5.ts` (mirrors
`deployVaultFactoryForV4.ts`'s exact mechanism: reuses `MandateRoles`/
`CapitalLimitRegistry`/`protocolTreasury`/`LiquidityAmounts` as-is, since
none of them depend on `VaultPolicy`'s logic; independently re-verifies
the new factory's wiring and confirms the Gen3 factory is completely
untouched afterward, same standard as every prior bootstrap).

| # | Step | Tx hash |
|---|---|---|
| 1 | Deploy MandateVaultDeployer (2 fragments, 24000/2450 bytes) | `0x51d9bb6d67f6ff660e08ab5d0a4868280d25cf5a1989e63ddeb92f059f9fda0f` |
| 2 | Deploy VaultFactory (roles/protocolTreasury/CapitalLimitRegistry reused, referencing the new deployer) | `0x3b1f7513ecbeeaa05628a9288bd6540a05b8a02bda35e3999f16cc7532015c36` |
| 3 | MandateVaultDeployer.setFactory(new VaultFactory) | `0xf8697fdb3f427b321253178a6bcb04051e291efa0b2fa2e7e379d1b2347819ed` |

New MandateVaultDeployer (Gen4): `0xc6299e2322e7fc6dec156872aa8c9ca04b863906`
(runtime 1810 bytes, confirming no embedding on the real chain, same as
every prior deployer). New VaultFactory (Gen4): `0x361B4CCBaDC0de931C01084EC9511D8a6BfdE83E`.

Verified independently after the run (not just the deploy script's own
console log, separate calls made directly against the real chain): both
fragment pointers byte-identical to the linked creation code; full
reconstruction byte-identical to the original (26450 bytes); new
`VaultFactory`'s wiring (`roles`/`protocolTreasury`/`capitalLimitRegistry`/
`vaultDeployer`) and `MandateVaultDeployer.factory()` cross-checked both
directions, both correct; `vaultCount=0` (fresh); the real Gen3 (v4-era)
`VaultFactory` (`0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb`) re-read after
the bootstrap and confirmed completely untouched (`vaultCount` still 3,
`vaultDeployer` still its own original deployer).

**v5, the real vault, deployed through this Gen4 factory**:
`MandateVault` `0x95c42f3eBC5c5A5eEc9d716D9aA84aa5EE729667`, `VaultPolicy`
`0xb8A402E5CD24B0358256fA9744838586d9529FcB`. `maxDrawdownBps` independently
re-read as 1000. Critically, verified this time with the real functional
call that actually matters (not just the immutable's value): a live
`validateDecision` call against this exact `VaultPolicy` with
`currentDrawdownBps=1500` (above the 1000 limit) showed `HOLD` correctly
still failing with `MAX_DRAWDOWN_EXCEEDED`, and `REBALANCE` correctly
**passing with zero violations** -- the exemption is genuinely live this
time, not just a correctly-set number. This is the real v5 vault; the two
Gen3-era addresses above remain abandoned.

## v4 governance Safe (2-of-2 multisig), status: deployed 2026-07-16

Real Safe (formerly Gnosis Safe), v1.4.1, deployed directly by Randy and
Eudo via the official app.safe.global UI on Arc Testnet -- not scripted by
the AI agent, since owner wallets and the deploy transaction itself belong to
the real signers, not something to hand a private key over for.

**Live-verified before trusting Arc Testnet support, not assumed**: both
`SafeProxyFactory` and `SafeL2` (v1.4.1) have real, canonical deployments
on chain `5042002` (confirmed by reading
`safe-deployments/main/src/assets/v1.4.1/safe_l2.json` and
`safe_proxy_factory.json` directly), and Arc Testnet has its own real
transaction service in Safe's official chains API
(`https://api.safe.global/tx-service/arc-testnet`), meaning the full
app.safe.global UI experience works here, not just raw SDK/CLI usage.

**Signer threshold, Randy's own explicit reasoning**: 2-of-2, not 2-of-3.
Only two real people are on this project (Randy, Eudo); adding a third
"signer" Randy alone would control defeats the purpose of a multisig
entirely (it would let one person unilaterally hold 2 of 3 keys). The
accepted tradeoff: if either signer is ever unavailable, no governance
action can be approved until they're back -- acceptable for this
project's current size and testnet stage, preferable to a fake third
signer creating a false sense of security.

### Contract address and owners

| Field | Value |
|---|---|
| Safe address | `0x504e43cc6d6486fcD812587F5b0325A4c4AAa911` |
| Owner 1 | `0x92ee0C1C57ECb80A59949E8c3EcB6dB2F687E328` (Randy) |
| Owner 2 | `0xF6C2eeC5adDc1Ad607413478a313310F8708ea5A` (Eudo) |
| Threshold | 2 of 2 |
| Safe version | 1.4.1 |

Verified independently after deployment, not trusted from the app's own
UI screenshot: a direct `getOwners()`/`getThreshold()`/`VERSION()` read
against the real deployed contract on Arc Testnet, confirming both real
owner addresses and the 2-of-2 threshold exactly as intended.

### GOVERNANCE_ROLE granted, status: done 2026-07-17

Real `MandateRoles` (`0x91dC937Cf24cD84B415A1B9AD2f520834334504a`, shared by
v1/v2/v3/v4 alike) now grants `GOVERNANCE_ROLE` to this Safe, run by Randy
himself via `scripts/grantGovernanceRoleToSafe.ts` using the real
`ARC_ADMIN_PRIVATE_KEY` keystore signer
(`0x884687C973e9b7Af697dC34Aed1F09Da06BC4253`).

**Deliberate, Randy's own explicit decision: added alongside the ADMIN
wallet, not instead of it.** The Safe's real propose/sign/execute flow has
never been exercised end to end yet; revoking the ADMIN wallet's
`GOVERNANCE_ROLE` before proving the Safe actually works in practice would
leave this project's entire governance surface (v1/v2/v3/v4) dependent on
an unproven mechanism with no fallback. Both addresses hold
`GOVERNANCE_ROLE` for now. Revoking the ADMIN wallet's role is a separate,
deliberate future step, only after the Safe has completed at least one real
governance action for real (starting with `setLendingRegistry`/
`proposeChainKeeper` below, once a real v4 vault exists).

Tx: `0xaaa3175f6457279efdfce44ca6f4bb209910baec68f8799dfe4db1e6bef09f05`.
Verified independently, not just the script's own log: a fresh
`hasRole(GOVERNANCE_ROLE, ...)` read confirmed `true` for both the Safe and
the ADMIN wallet, and the transaction receipt re-fetched separately
confirmed `status=1 (success)`.

## v4 Arbitrum Sepolia keeper wallet, status: generated and funded 2026-07-16

Fresh, dedicated wallet for v4's Arbitrum Sepolia `chainKeeper` role (the
per-destination-chain identity that will call Aave's
`Pool.supply()`/`withdraw()` and `LendingPositionRegistry.reportLendingPosition`,
see `contracts/LendingPositionRegistry.sol`). Deliberately separate from
`KEEPER_PRIVATE_KEY` (the existing Arc-side executor identity), same
capability-limited, per-chain isolation this project's v4 design settled
on after the Radiant Capital security research: a compromise of the Arc
keeper must never automatically grant authority to report/move value on
Arbitrum Sepolia, and vice versa.

| Field | Value |
|---|---|
| Address | `0xc5c828D0AC3e106C5006c4b62c3eb2405A5462b3` |
| Env var | `ARBITRUM_SEPOLIA_KEEPER_PRIVATE_KEY` (`scripts/generateArbitrumSepoliaKeeperWallet.ts`) |
| Funded | 0.15 ETH, real Arbitrum Sepolia testnet ETH (native gas on that chain, unlike Arc where gas is USDC), verified live via a direct balance read, not assumed |

**Not yet done**: not yet wired as `chainKeeper` for any real
`LendingPositionRegistry`, since no v4 vault has been created yet
(`scripts/deployVaultV4.ts` held off pending the CCTP blocker below).
Wiring happens via `LendingPositionRegistry.proposeChainKeeper`/
`executeChainKeeper` (governance-gated, in practice behind the new 2-of-2
Safe above) once a real v4 vault exists.

## v4 CCTP cross-chain messaging, status: verified 2026-07-17

The last of the three original v4 blockers Randy flagged. `ICCTPTokenMessenger.sol`
originally shipped with an explicit "TBD, verify before real use" disclaimer
and a guessed CCTP V1 `depositForBurn` signature (4 params). Live research
against Circle's real, published source
(`circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol` and
`FinalityThresholds.sol`) found the real deployed contracts are CCTP **V2**,
not V1 -- a 7-param `depositForBurn` (`amount, destinationDomain,
mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold`).
Fixed in `ICCTPTokenMessenger.sol` and `MandateVault._bridgeDeposit`; every
`BridgeLeg` test construction across the suite updated for the new `maxFee`
field. Full suite re-run clean after the fix: 92/92 tests passed, 0 failed,
`MandateVault` runtime margin unchanged (+169 bytes) -- see
`test/MandateVault.t.sol`, `test/MandateVaultArcFork.t.sol`,
`test/MandateVaultBridgeLegSafety.t.sol`, `test/MandateVaultInvariant.t.sol`.

### Real, live-verified addresses and domains

**Correction (2026-07-17)**: an earlier pass at this table conflated
TokenMessengerV2 and MessageTransmitterV2 as the same contract at the same
address. They are two distinct real contracts (TokenMessengerV2 calls into
MessageTransmitterV2 internally to actually emit the cross-chain message).
Both share the same address across chains (Circle deploys CCTP V2
deterministically), but the two addresses are different from each other.
Caught by live-verifying the wiring itself rather than trusting the earlier
note: `TokenMessengerV2.localMessageTransmitter()` was called directly on
both real chains and returned the real MessageTransmitterV2 address both
times, and `MessageTransmitterV2.localDomain()` was called directly on both
chains and returned the expected domain both times -- not assumed from a
lookup table.

| Chain | TokenMessengerV2 | MessageTransmitterV2 | CCTP domain (`localDomain()`, live) |
|---|---|---|---|
| Arc Testnet | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | 26 |
| Arbitrum Sepolia | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | 3 |

Both addresses confirmed non-empty via a live `eth_getCode` read on both real
chains (2,175 bytes for TokenMessengerV2, non-empty on each), and
`TokenMessengerV2.localMessageTransmitter()` confirmed to return the real
MessageTransmitterV2 address live on both chains -- the actual real, correct
CCTP wiring for both chains this project bridges between, not assumed from
address matching alone.

### Design decisions confirmed with Randy

- **`destinationCaller`**: set to the same address as `mintRecipient` (the
  destination chain's own dedicated `chainKeeper`, e.g. the Arbitrum Sepolia
  keeper wallet above for an Arc-to-Arbitrum leg), never `bytes32(0)`. This
  means only that specific keeper wallet can ever call `receiveMessage()`/
  complete the mint on the destination chain -- no open completion any
  relayer could trigger.
- **`minFinalityThreshold`**: `CCTP_MIN_FINALITY_THRESHOLD = 1000`
  (`FINALITY_THRESHOLD_CONFIRMED`, CCTP "Fast Transfer", ~8-20s), the
  project's default for every bridge leg, not the slower
  `FINALITY_THRESHOLD_FINALIZED = 2000` (~15-19 min standard finality).
  Reasoning: downstream Aave supply already depends on real-time execution,
  and staleness/deviation checks elsewhere in the design already bound the
  risk a faster, less-final transfer could introduce.
- **`maxFee`**: supplied fresh by the keeper at execution time from the
  current CCTP Fast Transfer market fee, never a hardcoded contract
  constant -- same "keeper supplies real, current values" convention already
  used for `SwapLeg.minAmountOut`.

### Live verification, status: done 2026-07-17

Real `depositForBurn` call executed on Arc Testnet
(`scripts/verifyCctpBridgeDepositOnArcTestnet.ts`), using the exact same
parameter values `MandateVault._bridgeDeposit` constructs (real
TokenMessengerV2, real USDC, `destinationDomain` 3, `mintRecipient`/
`destinationCaller` both the real Arbitrum Sepolia keeper address as
`bytes32`, `minFinalityThreshold` 1000), from the `FACTORY_BOOTSTRAP_DEPLOYER_V4`
wallet (already funded, holds no privileged role), a small disposable test
amount (0.1 USDC).

**Scope note**: this calls `depositForBurn` directly, not through a deployed
vault's `executeDecision(BRIDGE_DEPOSIT)`. Going through the real vault
mechanism requires `LendingPositionRegistry.chainKeeper` to be set for the
destination chain, which is gated by a real, unconditional 48h
propose/execute timelock -- not bypassable, and not completable within a
single live session. This verifies the exact call `_bridgeDeposit` makes
(same parameters, same real contract), which is what determines whether that
call site is correct; it does not exercise the vault's own
role-checking/policy-validation path around that call, which the existing
Foundry unit/fuzz suite already covers with a mocked `ICCTPTokenMessenger`.

**Independently verified, not just the absence of a revert**: the real
`DepositForBurn` event Circle's TokenMessengerV2 actually emitted was decoded
(event ABI confirmed fresh against Circle's real source immediately before
running this) and every field checked against the expected value --
`destinationCaller` and `minFinalityThreshold` both confirmed exactly as
decided above, not merely that the transaction succeeded.

| Check | Result |
|---|---|
| `burnToken` == real Arc USDC | PASS |
| `amount` == 100,000 (0.1 USDC) | PASS |
| `depositor` == sender | PASS |
| `mintRecipient` == Arbitrum Sepolia keeper (bytes32) | PASS |
| `destinationDomain` == 3 | PASS |
| `destinationCaller` == Arbitrum Sepolia keeper (bytes32, restricted) | PASS |
| `maxFee` == 1,000 (0.001 USDC) | PASS |
| `minFinalityThreshold` == 1000 (Fast Transfer) | PASS |

Sender's real USDC balance also independently re-read after the call and
confirmed to have dropped by at least the burned amount (the exact delta
included real gas, since Arc's native currency is USDC itself).

| # | Step | Tx hash |
|---|---|---|
| 1 | USDC.approve(TokenMessengerV2, 0.1 USDC) | `0xdc11679112472c08811c345813ec22827a8cab11d46717e9e5558b39c271a490` |
| 2 | TokenMessengerV2.depositForBurn(...) | `0xa161b2221c5b58b558d47876e4b9e4ed9b30af985df34a04d441837821a7e7f7` |

**Not yet done**: the corresponding mint on Arbitrum Sepolia was not
followed up on (no relayer/attestation flow triggered or awaited) --
out of scope for verifying the burn-side call site's correctness. No
real `depositForBurn` call has been executed through the actual vault
mechanism yet, since that requires a real v4 vault plus the 48h
`chainKeeper` timelock to elapse, both still pending.

### Full atomic path fork test, status: done 2026-07-17

Randy flagged a real gap after the live verification above: the isolated
`depositForBurn` call proved the CCTP interaction is correct, but never
exercised `MandateVault.executeDecision(BRIDGE_DEPOSIT)` itself -- the
atomic guarantee that role check, ledger debit, the CCTP call, and
`LendingPositionRegistry` position creation all happen (or all revert)
together, in one transaction. The real 48h `chainKeeper` timelock blocks
proving this live, but a fork test can skip the wait with `vm.warp`, the
same technique already used for every other timelocked flow in this suite
(`_enablePositionManager`).

**A second, real Foundry/Arc-fork limitation surfaced building this test**:
Arc's real native-USDC-as-ERC20 token depends on at least two Arc-specific
precompiles Foundry's local fork EVM cannot execute at all (confirmed live:
their bytecode is literally `0x01`, not real EVM bytecode, reverting with
`EvmError: StackUnderflow` when Foundry tries to interpret it as an
opcode) -- one gating `transferFrom` via `isBlocklisted` (a pure boolean
query, safely mocked to its real, live-confirmed return value), and one
performing the actual value movement backing the ERC20 interface.
Empirically confirmed the second one cannot be safely mocked for a scenario
needing more than one real transfer in the same test: mocking it to always
succeed lets exactly one real `transferFrom` through, but persists no real
balance state anywhere Foundry can see, so a second real `transferFrom`
(which the real TokenMessengerV2's own internal burn logic needs, to pull
funds from the vault) always fails with "transfer amount exceeds balance"
regardless -- confirmed by trying it, not assumed. Faking that second
transfer's real value-movement semantics correctly would mean
reimplementing Arc's own precompile logic, fabricating behavior rather than
verifying real code.

**Resolution, confirmed with Randy**: a real fork (real native USDC, real
`MandateVault`, real `LendingPositionRegistry`, real 48h timelock skipped
via `vm.warp`), with `MockCCTPTokenMessenger` (`contracts/test/MockCCTPTokenMessenger.sol`,
implements the exact real `ICCTPTokenMessenger` interface, records the call
it received, moves no tokens) standing in for the real TokenMessengerV2 --
since the real CCTP interaction itself was already independently verified
live above, all 8 fields. A deliberate, documented split, not a gap.

`test/MandateVaultArcFork.t.sol`'s
`test_executeDecisionBridgeDeposit_fullPathAtomicWithRealVaultAndMockedCctpMessenger`:
funds the vault with a real transfer from `FACTORY_BOOTSTRAP_DEPLOYER_V4`
(pinned at a recent block where its real balance is confirmed live),
executes `BRIDGE_DEPOSIT` for real, and asserts, in the same transaction:
the ledger debited by exactly the bridged amount, exactly one
`LendingPositionRegistry` position created (`IN_TRANSIT_OUT`, correct
`chainId`/`principalUSDC`/`currentValueUSDC`/`lastReportedAt`), and the
mock CCTP messenger's recorded call matches every decided parameter
(`destinationDomain`, `mintRecipient`, `destinationCaller`, `maxFee`,
`minFinalityThreshold`, `burnToken`, caller). Passing. Full suite re-run
clean after adding it: 93/93 tests passed, 0 failed.

## Mandate USDC Cross-Chain Lending Vault (v4, real vault) -- ACTIVE, status: deployed 2026-07-17

The real v4 vault itself, `scripts/deployVaultV4.ts`, run by Randy with the
real `ARC_ADMIN_PRIVATE_KEY` keystore signer
(`0x884687C973e9b7Af697dC34Aed1F09Da06BC4253`). USDC-only base asset (no
otherAssets, unlike v2/v3), real CCTP TokenMessengerV2 wired at construction
time.

**Lending policy values, Randy's own confirmed decision (2026-07-17)**:
three (`lendingReportStaleAfterSeconds`, `lendingReportMaxDeviationBps`,
`lendingPositionForceUnwindSeconds`) were already recorded as his own
confirmed starting placeholders in `VaultPolicy.sol`'s own doc comments
from an earlier round; `maxLendingAllocationBps` was freshly decided at
30% (3000 bps), deliberately more conservative than v3's 50% LP cap --
his own reasoning: v3's LP risk is verifiable entirely on Arc in the same
transaction (via `slot0()`/TWAP), while v4's cross-chain lending risk
depends on the destination-chain keeper reporting honestly, with the
deviation check as the only real-time defense, so a smaller share of NAV
should ever be exposed to that distinct risk category.
`minStableAllocationBps` set to 7000 (70%), the exact complement of
`maxLendingAllocationBps`, so the vault's own real, Arc-verifiable ledger
never drops below a majority of NAV even at the maximum permitted
cross-chain exposure.

### Contract addresses

| Contract | Address |
|---|---|
| MandateVault (v4) | `0xFba09f9466C8469cfA058d7ab99e9807fC8155f0` |
| VaultPolicy (v4) | `0x6d143406143C7E88C9063AED28E7E288C26969Ef` |
| VaultFactory (v4, reused) | `0x94d5c4B8c6D1fc6dC8496F7764B36052Fc1914eb` |
| cctpTokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |

### Transactions

| # | Step | Tx hash |
|---|---|---|
| 1 | Admin approves VaultFactory for 5 USDC seed | `0x902af74b97c18882f7d3ccf9ad1a15787187ba1ab9c62f58bd5c2c58e40c1c73` |
| 2 | createVault (v4) | `0x2bae748680ad008a6d54e8e18ad0203c728c886b2367fddd92e3c61ae53a1a1a` |

Verified independently after the run, not just the script's own log: both
transaction receipts re-fetched separately confirmed `status=1 (success)`;
fresh reads of `vault.asset()` (real native USDC),
`vault.policy()`/`vault.factory()`/`vault.cctpTokenMessenger()` (all
matching), `vault.totalAssets()` (5,000,000, the exact 5 USDC seed
deposit), and `policy.maxLendingAllocationBps()`/`policy.minStableAllocationBps()`
(3000/7000, matching what was requested).

### LendingPositionRegistry deployed and wired, status: done 2026-07-17

`scripts/deployLendingPositionRegistryV4.ts` deployed the real registry for
this vault (no privileged role gates the constructor, run with the ADMIN
wallet only for consistency, not because it needed `ADMIN_ROLE`):

| Contract | Address |
|---|---|
| LendingPositionRegistry (v4) | `0x17d471bA284635Db88a47361083bA9748CF4688c` |

Verified independently: fresh reads of `registry.vault()`/`registry.policy()`/
`registry.roles()` all matched, and `vault.lendingRegistry()` read `0x0`
before wiring, confirming it was genuinely unset beforehand.

**The Safe's first two real governance actions, both executed 2-of-2 (Randy
+ Eudo) via app.safe.global's Transaction Builder, not a private-key
script** -- the deliberate first real exercise of the Safe's full
propose/sign/execute flow, per Randy's own explicit choice (see the
GOVERNANCE_ROLE section above):

1. **`vault.setLendingRegistry(registry)`** -- one-shot, no timelock.
   Randy proposed and signed, Eudo confirmed, executed. Verified
   independently: `vault.lendingRegistry()` now reads
   `0x17d471bA284635Db88a47361083bA9748CF4688c`, matching the deployed
   registry.
2. **`registry.proposeChainKeeper(421614, 0xc5c828D0AC3e106C5006c4b62c3eb2405A5462b3)`**
   -- starts the real, unconditional 48h timelock
   (`CHAIN_KEEPER_CHANGE_TIMELOCK`, `LendingPositionRegistry.sol`). Same
   Safe flow: Randy proposed and signed, Eudo confirmed, executed. Verified
   independently: `registry.pendingChainKeeper(421614)` reads the real
   Arbitrum Sepolia keeper address, `registry.chainKeeperExecutableAt(421614)`
   reads `1784496005` (2026-07-19 21:20:05 UTC, ~48h out), and
   `registry.chainKeeper(421614)` still correctly reads `address(0)` (not
   yet active, confirming the timelock is genuinely enforced, not a no-op).

**Not yet done**: `registry.executeChainKeeper(421614)` -- permissionless,
callable by anyone once the timelock above elapses (2026-07-19 21:20:05
UTC). No real `BRIDGE_DEPOSIT` has been attempted through this vault yet;
that also requires the chainKeeper to actually be active first.

## Mandate USDC+cirBTC Yield Vault (v3, LP mechanism) -- ACTIVE, status: deployed 2026-07-16

v3 adds a genuinely different capability on top of v1/v2's simple balance
rebalancing: the agent evaluates and opens/manages real Uniswap-V3-style
liquidity-provider (LP) positions on the real, verified UnitFlowV3 DEX,
seeking real fee income rather than taking directional bets. USDC base
asset, cirBTC AND WUSDC as the second/third registered assets: unlike v2
(cirBTC only), v3 needs WUSDC registered too, since the only
real-liquidity pool this vault could ever open a position on is
WUSDC/cirBTC, and `MandateVault._lpOpen` requires both pool tokens to
already be registered. Skipping WUSDC would mean the mechanism could
never actually be used in this instance, even once cirBTC's
independent-price restriction (below) eventually lifts, guaranteeing a
throwaway v4 for an unrelated reason, the same pattern v1/v2 already
lived through.

Deployed via `scripts/deployVaultV3.ts` against the new (second-generation)
`VaultFactory` (`0xB6a54F66174D7CE37739945B6Da3b463bbE849D8`, see the
section directly above): its first real run attempt reverted against the
OLD factory, revealing the second-`VaultFactory`-generation issue; after
that bootstrap completed, this script ran successfully against the new
factory.

### Contract addresses

| Contract | Address |
|---|---|
| VaultFactory (new, second generation) | `0xB6a54F66174D7CE37739945B6Da3b463bbE849D8` |
| MandateVault v3 | `0x907C61F958805Ba7b8fAEaCe0aAa5c2a93472718` |
| VaultPolicy v3 | `0x2e8F2AA8CDc5DBA82353428aE9c0C5966704ab5d` |
| cirBTC (second registered asset) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |
| WUSDC (third registered asset) | `0x911b4000D3422F482F4062a913885f7b035382Df` |

### Policy limits, verified live via independent `cast call` reads, not trusted from the deploy script's own log

The deploy script's own final verification step false-positived
(`liveMinLpTickRangeWidth !== POLICY_LIMITS.minLpTickRangeWidth`
comparing a plain JS `number` from `int24` against a `bigint` literal,
which is always unequal for `!==` in JS regardless of value, since JS
never coerces across that boundary): fixed in the script (compare via
`BigInt(...)` on both sides), but before fixing anything, every one of
the 9 policy values below was independently re-verified with a direct
`cast call` against the real, deployed `VaultPolicy`, confirming the
real deployment was correct all along and the false alarm was purely in
the verification code, not the onchain state:

- `minStableAllocationBps`: 8000 (80%)
- `maxAllocationBpsPerAsset[cirBTC]`: 2000 (20%)
- `maxAllocationBpsPerAsset[USDC]`: 10000 (100%)
- `maxAllocationBpsPerAsset[WUSDC]`: 10000 (100%, matches the base
  asset's own cap, see `scripts/deployVaultV3.ts`'s own doc comment on
  why)
- `minLpTickRangeWidth`: 1200
- `maxLpPositionValueLossBps`: 300 (3%)
- `maxLpOutOfRangeSeconds`: 172800 (48h)
- `minLpPoolLiquidityRatioBps`: 5000 (50%)
- `maxLpAllocationBps`: 5000 (50% of NAV across all open positions)

`totalAssets()` independently confirmed at 5,000,000 (5 USDC, the seed
deposit).

### Transactions

Bootstrap deployer wallet is not the signer here: these are the real
`ADMIN_ROLE` holder's transactions, `0x884687C973e9b7Af697dC34Aed1F09Da06BC4253`,
run by Randy in his own terminal (keystore-protected
`ARC_ADMIN_PRIVATE_KEY`, never handled by the AI agent), the only step in this
whole v3 rollout that needed that key opened.

| # | Step | Tx hash |
|---|---|---|
| 1 | USDC.approve(new VaultFactory, 5 USDC) | `0x34e1798cb48d4c8c04fa8fe2609a595ebc6a2149bc313d45345e816e7a634172` |
| 2 | VaultFactory.createVault (deploys MandateVault v3 + VaultPolicy v3 internally, USDC + cirBTC + WUSDC) | `0x3afdd8855806fa55bcfca151eef7a2ca9d085bff08593628e8febeb5e840490d` |
| 3 | MandateVault.proposePositionManager (48h timelock started, executable at unix 1784312286) | `0xce10c707959a57ca6bb9ca7e04fa621819597fc2695ac3477ad9aff12417bf17` |
| 4 | WUSDC/cirBTC pool.increaseObservationCardinalityNext(50) (real TWAP warm-up started) | `0xb5a3718b6e775fb77b62423c258acc22b435e64b86ebf30e194e7f871b0b39c6` |

`positionManager` is not yet active: `executePositionManager()` must be
called (permissionlessly, by anyone) once the 48h timelock elapses,
before any real `LP_OPEN`/`LP_INCREASE`/etc. leg can execute (and even
then, `requireIndependentReferencePriceForLp` still hard-blocks real
execution today, see below).

### Real onchain infrastructure this targets, verified

Same as v2's own verification (WUSDC/cirBTC pool, real router/quoter),
plus, specific to v3:
- `UnitFlowV3PositionManager` at `0x0553682bc188b850acd31CBd3500Dcd0aa35372B`:
  real ERC-721 position custody, standard `mint`/`increaseLiquidity`/
  `decreaseLiquidity`/`collect`/`burn`/`positions()`, confirmed cross-wired
  to the real Factory, confirmed the instance whose call actually
  triggered the most recent real `PoolCreated` event on it.
- New Solidity math libraries `contracts/lib/TickMath.sol`,
  `contracts/lib/LiquidityAmounts.sol`: standard, audited, unmodified
  Uniswap V3 ports, made `public`/external-linked libraries (not
  `internal`) specifically to fit under the EIP-170 24,576-byte contract
  size limit alongside the rest of `MandateVault.sol`'s LP logic (`via_ir`
  compilation + `optimizer_runs=1`, see `foundry.toml`/`hardhat.config.ts`).
- 4 new fork tests against this real infrastructure (9 total in the file)
  (`test/MandateVaultArcFork.t.sol`): a real position minted, real
  `totalAssets()` valuation of it, a real out-of-range mint reverting, a
  real `EMERGENCY_EXIT_TO_STABLE` closing a real open position (bug 1
  below), and a real proof that `totalAssets()` resists a same-block spot
  price manipulation (bug 3 below), each independently verified against
  real onchain infrastructure, not mocks.

### Same disclosed restriction as v2, extended to LP_OPEN/LP_INCREASE

`executor/keeperService.ts`'s `requireIndependentReferencePriceForLp`
extends the exact same hard block as v2's cirBTC `ENTER` restriction: no
genuinely independent reference price exists for cirBTC on Arc today, so
opening or increasing any real position touching it is refused before
ever building an LP leg. Since both of this project's only two
real-liquidity pools involve cirBTC, **real `LP_OPEN`/`LP_INCREASE`
execution is blocked today**, same documented, disclosed situation as v2,
until an independent cirBTC feed exists. The mechanism itself is real and
fork-tested, not the gap. `LP_DECREASE`/`LP_COLLECT`/`LP_CLOSE` are never
gated by this (reducing exposure is always allowed).

### Three real bugs found and fixed before this vault was considered ready, 2026-07-14 to 2026-07-15

The first two found while reviewing whether `EMERGENCY_EXIT_TO_STABLE`
(the protocol's unconditional safety valve) genuinely covers a real open
LP position, not just simple ledger holdings. The third found answering
Randy's own pre-deployment security questions (whether `slot0()`'s
manipulable spot price could affect deposit/withdraw share pricing, and
whether a depositor could self-sandwich an LP action). All three verified
with real fork tests and unit tests, not just read from the code:

1. **`MandateVault.executeDecision`'s LP-leg dispatch gate never actually
   fired for `LP_INCREASE`/`LP_DECREASE`/`LP_COLLECT`/`LP_CLOSE`.** The
   gate checked `lpLeg.pool != address(0)`, but every one of those four
   actions' real leg (built by `executor/keeperService.ts`'s `buildLpLeg`)
   sets `pool == address(0)` by convention (identity comes from `tokenId`
   instead, only `LP_OPEN` uses `pool`). This made the entire post-open LP
   lifecycle silently unreachable. Fixed: the gate now also fires on
   `lpLeg.tokenId != 0`. `_executeLpLeg` also gained a new dispatch branch
   so `EMERGENCY_EXIT_TO_STABLE` carrying a populated leg is treated as an
   implicit close, and `executor/keeperService.ts` gained
   `closeAllOpenLpPositions`/`executeWithLpUnwind`: a real
   `EMERGENCY_EXIT_TO_STABLE` now closes every open LP position first
   (each its own transaction, decision.action kept as
   `EMERGENCY_EXIT_TO_STABLE` throughout so every one benefits from
   `VaultPolicy`'s unconditional bypass), then sweeps ledger holdings to
   stable, proven by a real fork test
   (`test_emergencyExitToStable_closesARealOpenLpPosition`) and a
   dedicated `KeeperService` unit test.
2. **A breached LP position blocked its own targeted remediation.**
   `VaultPolicy.validateDecision`'s `currentLpPositions` loop had no
   exemption for the exact position named by `decision.lpTokenId`, so a
   position that failed the value-loss/out-of-range/pool-liquidity-drop
   check was rejected by the very pre-check that `LP_DECREASE`/
   `LP_COLLECT`/`LP_CLOSE` needed to pass to fix it, contradicting the
   contract's own documented intent. Fixed: the loop now skips the 3
   health checks specifically for the position matching
   `decision.lpTokenId` when the action is one of those three, every
   other open position in the same vault is still fully evaluated. Same
   fix mirrored in `agent/policy/offchainPolicyCheck.ts` (the offchain
   pre-check must never diverge from onchain). Proven by dedicated tests
   in both `test/VaultPolicy.t.sol` and `test/offchainPolicyCheck.ts`,
   including a test confirming the exemption never leaks to a different,
   non-targeted breached position.
3. **A real, live NAV-manipulation exposure via `slot0()`'s spot price.**
   `MandateVault._valuePosition` (feeding `totalAssets()`, which
   `deposit()`/`withdraw()`/`mint()`/`redeem()`, standard un-overridden
   ERC-4626, all read live and fully permissionlessly) used the pool's
   live `slot0()` spot price to compute an open LP position's real
   token0/token1 composition. A single-block attack (manipulate the
   pool's spot price with a large swap, deposit/withdraw at the
   manipulated NAV, reverse the swap) could extract value from other
   depositors the moment any LP position existed; unlike a simple ERC-20
   holding (valued from `lastKnownPriceUSDC`, a price cached only from the
   keeper's own last executed decision, never read live),
   an LP position's real composition structurally depends on price at
   read time and cannot be cached the same way.
   `requireIndependentReferencePriceForLp` does not protect this at all
   (it only gates the keeper proposing new `LP_OPEN`/`LP_INCREASE`,
   `deposit`/`withdraw` never go through the keeper). Fixed: `_valuePosition`
   now values a position's dollar composition via a real Uniswap V3 TWAP
   (`observe()`, a 30-minute window, `LP_VALUATION_TWAP_SECONDS`) instead
   of the live spot price; `inRange`/`currentPoolLiquidity` (real-time
   risk-monitoring signals for `VaultPolicy`'s own checks) deliberately
   still use the live tick, only the dollar valuation changed. No separate
   gate is needed at `LP_OPEN` time: `executeDecision`'s own POST-state
   check already re-values the just-minted position, so a pool whose TWAP
   isn't yet queryable (a default-initialized pool only stores 1
   observation) already reverts the whole mint atomically, for free, from
   existing control flow. Real, permissionless prerequisite before any
   real `LP_OPEN` on a given pool: `increaseObservationCardinalityNext`
   must be called on it with enough real elapsed time beforehand
   (`scripts/deployVaultV3.ts` now does this for the real WUSDC/cirBTC
   pool as part of deployment itself, giving it a head start while
   `LP_OPEN` stays independently gated on the cirBTC restriction above).
   Depositor self-sandwich (Randy's second question) was confirmed
   structurally impossible regardless: `deposit()`/`withdraw()` are
   standard, unmodified ERC-4626 with zero LP side effects, and
   `executeDecision` (including any LP leg) is `onlyKeeper`-gated, so an
   ordinary depositor has no code path to trigger an LP action in the same
   transaction as their own deposit. Proven by a new, direct fork test,
   `test_lpValuation_resistsSingleBlockSpotPriceManipulation`: a real
   ~100 WUSDC swap against the real, thin (~239 WUSDC) pool moves its live
   `slot0()` spot price by a large, real amount in one block, but
   `totalAssets()`, read immediately after in the same block, moves by
   less than 2%, not the direction a spot-price-based valuation would
   have moved.

## Team-created test tokens and pools (v3 test infrastructure, 2026-07-14)

**Not real market opportunities.** Deployed purely to give v3's Paper
Vault and test environment real, varied liquidity to reason about, beyond
the two thin real pools that exist on Arc Testnet today (WUSDC/cirBTC,
EURC/cirBTC, both fee 3000, see `docs/arc-facts-to-verify.md`). Every
token below is a plain `contracts/TestToken.sol` (mint gated to a single
dedicated deployer address, `Ownable`, never open to anyone), deployed
and seeded entirely by `scripts/deployTestTokens.ts`, run with a fresh,
single-purpose key (`TEST_TOKEN_DEPLOYER_PRIVATE_KEY` in `.env`, funded
with 20 USDC from the standard Arc Testnet faucet, `0x1c88554eb4BE53D239d10Cf07D3F062f25ce2e88`)
that holds no role or authority anywhere else in this project, deliberately
never `KEEPER_PRIVATE_KEY` (would have broken that key's own documented
single-purpose isolation, see `executor/README.md`).

Naming: every symbol is clearly `MANDORTEST-`-prefixed. For the one
category with a real, genuine on-chain equivalent already confirmed this
session (USYC, see `docs/arc-facts-to-verify.md`), the test token is
named `MANDORTEST-YIELD`, deliberately NOT anything resembling "USYC",
so there is never confusion between this test token and the real one on
the same explorer.

Each is paired against WUSDC (`0x911b4000D3422F482F4062a913885f7b035382Df`)
at fee 3000, the only fee tier confirmed to hold real liquidity anywhere
in this ecosystem. Seed depth is deliberately small (~3 USD-equivalent
per side per pool): the real deployer wallet was funded with exactly the
standard 20 USDC faucet allowance, which had to cover both this seeding
and gas for all 25 real transactions across the 4 pools (~0.52 USDC
total gas spent, confirmed via the wallet's real remaining balance after
the run, not assumed). Thin on purpose, not an accident: still real,
confirmed liquidity (verified live via `pool.liquidity()` and real
non-zero balances on both sides for every pool, independently, not just
trusted from the deploy script's own console output), and thinness
itself is realistic variety for the Paper Vault's own strategy text to
reason about (its criterion 1 already asks it to size positions down for
thin pools, not avoid them outright).

| Token | Address | Category | Pool (vs WUSDC, fee 3000) |
|---|---|---|---|
| MANDORTEST-STABLE | `0xb5a15b8370984Cd3C5d657d76B8C4Fe3Cf1320D0` | Additional stablecoin-style test asset (~$1) | `0x7da67d0b3950ccd6090f76fbefaad0355bc0312c` |
| MANDORTEST-RWA | `0x9e3EfD1B99506e65e61C021b42BdD436c088384f` | Tokenized RWA/bond-style test asset (~$100) | `0x4a8dfa8f92e6c1f3b02107e515d645f8a8b73f46` |
| MANDORTEST-EQUITY | `0xbF53Ca85AB6becF290c089fA6135f7f83E624201` | Tokenized equity-style test asset, more volatile (~$50) | `0x4ea5eb558c0a84642a9bc3e2a2cbb042fdac5cb8` |
| MANDORTEST-YIELD | `0xCB9EdD86ba1FbD08E53E3460990659562c128c4e` | Yield-bearing-style test asset (~$10) | `0x6fd54a25189fc7113d8815c643e1054dc62800ed` |

None of these are wired into any real vault's registered-asset list, v1's
or v2's `VaultPolicy` limits, or `agent/core/systemPrompt.ts`/
`scripts/runDecisionCycle.ts`'s real strategy text. They exist solely for
the Paper Vault / test environment to have real variety to evaluate, and
must never be presented to a depositor as a real market opportunity.

### Team-generated test trading volume (2026-07-14)

These 4 pools were seeded via `mint()` only, which does not itself
generate LP fees (only real swaps do), so their `feeGrowthGlobal0X128`/
`feeGrowthGlobal1X128` accumulators started at exactly 0. To give the
Paper Vault's fee-APR estimate (`scripts/paperVaultTestTokens.ts`) genuine
onchain data to read instead of a permanent 0%, `scripts/generatePaperVaultTestVolume.ts`
executed a real round-trip swap (token -> WUSDC -> token) against each of
the 4 pools, using the same dedicated `TEST_TOKEN_DEPLOYER_PRIVATE_KEY`
wallet, at 2026-07-14T19:27:48.669Z.

**This was the team's own wallet trading against itself, not organic
third-party demand.** Every fee/APR figure derived from this volume
carries that disclosure wherever it reaches the agent's own reasoning
(`scripts/paperVaultTestTokens.ts`'s `computeFeeApr`, embedded directly in
the text shown to the model) and must carry it in any demo material too.
An ENTER decision informed by this data must never be presented as
reflecting real market interest.

| Pool | Swap tx 1 (token -> WUSDC) | Swap tx 2 (WUSDC -> token) | feeGrowthGlobal0X128 after | feeGrowthGlobal1X128 after |
|---|---|---|---|---|
| MANDORTEST-STABLE | `0x0fad8652fab5a66e11ddd6f198ec4fe2286fb78f5d83e737c1e3dec229998eeb` | `0x6747df806c18ce7faed2bb4b855ef70243a959a5dc2ab324aab09b415829a000` | `23826867538069958967208431379910978609211` | `24469692961536167723888626968` |
| MANDORTEST-RWA | `0x0e5ab45a608ca0974b4b0ab61c276684d0ae0292a8bf110253bd67c45f7b36d1` | `0xe753b4b6a0b9a0f62e164e208a73d8828ca2128752b555d07079f7466af11942` | `236446698110416895393944723174182241` | `2427814307660041804929223281554821` |
| MANDORTEST-EQUITY | `0x0eea7810edc025ab4091a8fd584b811c1eac392803821c84f805931bf110009d` | `0x356115359fa15836f490990e993ed88c6cc537f5682a7cc98342a369308b8a7f` | `171297497650199055990266333753760222` | `3519784677136147756920099962455539` |
| MANDORTEST-YIELD | `0xbe39d17e6296976d5c0e86cb2de989299bc0ff2216882ca182d5a7b55c05cf5b` | `0x1f2fc4838a6d6f1564d5156b305de894436ef53c546f5b1944d57c41bd915006` | `76096959023264291536437725459481639764785` | `7816856950203213681808401287` |

Verified independently after the run by reading each pool's own
`feeGrowthGlobal0X128`/`feeGrowthGlobal1X128` (nonzero confirms real fee
accrual, not just a trusted console log). Real Paper Vault cycle run
immediately after (`scripts/paperVaultCycle.ts`, 2026-07-14T19:29Z):
the agent correctly identified the naive annualized extrapolation from
this data (~34,800%+ APR) as a statistically unreliable artifact of the
extremely short (~0.03h) observation window and explicitly wash-trading
origin, and declined to certify the strategy's 5%-minimum-fee-APR trigger
on that basis, holding instead. Disclosed exactly as designed, without
being pre-filtered by any code-side threshold: the agent's own judgment
correctly discounted it.
