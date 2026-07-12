# Arc Testnet Deployments

## Mandate USDC Vault (first real vault, USDC-only)

Deployed 2026-07-10 via `scripts/deployArcTestnet.ts`, run by Randy in his own
terminal (keystore-protected `ARC_PRIVATE_KEY`, never handled by Claude).
Every address, role assignment, and balance below was independently
re-verified live against Arc Testnet after the fact (`eth_getCode`,
`hasRole`, `totalAssets`, and the transaction history itself via the
Blockscout API), not copied from the deploy script's own console output.

USDC-only by design: no verified swap pool exists yet for native USDC
directly against EURC or cirBTC (only EURC/cirBTC and WUSDC/cirBTC pools are
confirmed, see `docs/arc-facts-to-verify.md`). Adding a target asset later
means a new vault (v2), `MandateVault`'s registered asset list is fixed at
construction with no path to add one afterward (confirmed by reading
`_registerAsset`'s only two call sites, both inside the constructor), and
`VaultPolicy` is immutable by design regardless. This matches the existing
"a different risk profile is a new Vault+Policy pair, never a parameter
change on a live one" rule, with the same manual-migration and
reduced-trust-period handling already defined for strategy version changes.

### Contract addresses

| Contract | Address |
|---|---|
| MandateRoles | `0x91dC937Cf24cD84B415A1B9AD2f520834334504a` |
| MandateVaultDeployer | `0xcEc347d22446e8234cfb3836A40F10221Ea58E35` |
| CapitalLimitRegistry | `0x83983fd592168391303141DB723FfCB463D25081` |
| VaultFactory | `0xb6B77A2978B1974097727e267BCaAC35ba7ddf12` |
| MandateVault | `0x9D1b2853722bc69C062D044D74DBeFae430422be` |
| VaultPolicy | `0x5285D175849513b5918aaB5c539b5ED79EEF1A1f` |

### Role assignments (verified live via `hasRole`, not assumed)

| Role | Address | Note |
|---|---|---|
| ADMIN_ROLE, DEFAULT_ADMIN_ROLE, GOVERNANCE_ROLE | `0x884687C973e9b7Af697dC34Aed1F09Da06BC4253` | Team/dedicated address, also `protocolTreasury` |
| KEEPER_ROLE | `0xdfFDd05D61dbF4074A6C012d22deBfcf0d80c219` | Executor service identity, freshly generated for this purpose |
| PAUSER_ROLE | `0x6639c0Ea56009EE64e11526221C28B979C698855` | Randy |
| PAUSER_ROLE | `0x24b26f00Fa24FA41ef2EffBa5Be359f9301524f2` | Eudo |
| (none) | `0xCe90c1806019Cb167F89cB7e8A9Cf5B4C96638A7` | Deployer wallet, held ADMIN_ROLE/DEFAULT_ADMIN_ROLE temporarily during deployment, renounced both, confirmed live it holds neither |

### Vault state at creation

- `totalAssets`: 5 USDC (the seed deposit)
- Base asset: real native USDC, `0x3600000000000000000000000000000000000000`
- Router allowlisted from construction: real UnitFlowV3Router,
  `0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01`
- `CapitalLimitRegistry` cap: 10,000 USDC, same value for every vault until
  Phase 4's per-vault scoring exists

### Transactions

All 15, deployer `0xCe90c1806019Cb167F89cB7e8A9Cf5B4C96638A7`, nonces 78-92,
block range 51112117-51112198. Reconstructed after the fact from the
deployer's own transaction history via the Blockscout API
(`testnet.arcscan.app/api/v2/addresses/{address}/transactions`), matched to
this exact sequence by nonce order, not pasted from terminal output.

| # | Step | Tx hash | Block | Gas used |
|---|---|---|---|---|
| 1 | Deploy MandateRoles | `0x47160c5019ce130bfc8ab7af0ae06d36f977097890f12b6cd236dd025a1535e6` | 51112117 | 374,405 |
| 2 | grantRole(KEEPER_ROLE, KEEPER) | `0x79929929b954188dfa716afa506c72221d3b88d24224980d093bdc014c3147a4` | 51112125 | 51,454 |
| 3 | grantRole(PAUSER_ROLE, Randy) | `0xd87eb3469a264d3e24b0cfc56366774e91a97ad6be65f298857d8b93563a0d60` | 51112130 | 51,442 |
| 4 | grantRole(PAUSER_ROLE, Eudo) | `0xe146df5c3881ff74c4c2b7b6930d015cb944f11a3580ab4c705f43ab7dc5bbe8` | 51112135 | 51,442 |
| 5 | grantRole(GOVERNANCE_ROLE, 0x8846...) | `0x73ce040e610b4c58b6a916c8a2038b4a65c2fe471c1081b7078f6ca0241a5e91` | 51112140 | 51,454 |
| 6 | Deploy MandateVaultDeployer | `0x93ed8a130c717fe036e65cf751c8f9199f97c6bccbcdd1e63b272a12034f920d` | 51112147 | 3,976,443 |
| 7 | Deploy CapitalLimitRegistry | `0x3d52b5349e8ff34a63ca5381d72805faa579748210f0c1eea1996422496dc86b` | 51112154 | 340,414 |
| 8 | Deploy VaultFactory | `0x10d82b60cda0f10470ad7217caa560d1ef11d50d5ff1037f4d61dcab5de87a6c` | 51112159 | 2,522,860 |
| 9 | MandateVaultDeployer.setFactory | `0xd31f2ea4cd5b44a331a9889bc4121a908c0462d07e9097b1ef0c9dcd43352756` | 51112165 | 44,049 |
| 10 | USDC.approve(VaultFactory, 5 USDC) | `0x24b45b432009dd3164299280195799b468c81052bf15147c147a31a20c1a5c96` | 51112170 | 55,438 |
| 11 | VaultFactory.createVault (deploys MandateVault + VaultPolicy internally) | `0x2ec653439bdf959bcbd0fff6d8c7d5e477617145165ac1a22f2a01ae8b6d2685` | 51112175 | 4,677,398 |
| 12 | grantRole(ADMIN_ROLE, 0x8846...) | `0x3f607f71ad70d786d0c789a0f8b446bb8a8fc32cb5199f28bdbb1c259c200faf` | 51112183 | 51,454 |
| 13 | grantRole(DEFAULT_ADMIN_ROLE, 0x8846...) | `0xc065fb65637c7280b2902b550ac78ade368e498c8c6600ea3df0987fdbd68196` | 51112188 | 51,070 |
| 14 | renounceRole(ADMIN_ROLE, deployer) | `0x39ac27eb6d827bc4028829a81f088810bee41ddf47a40b247e3ceb96c2592950` | 51112193 | 25,020 |
| 15 | renounceRole(DEFAULT_ADMIN_ROLE, deployer) | `0xa51b0724095b22ef3c9ffe2c283324fbf7e917c80993def86a73f5bd026a94bd` | 51112198 | 24,636 |

MandateVault and VaultPolicy have no separate top-level deployment
transaction, both were created by internal contract creations inside step
11's transaction (`MandateVaultDeployer.deploy` creates MandateVault,
`VaultFactory.createVault` creates VaultPolicy directly), confirmed by their
addresses having real bytecode (`eth_getCode`) and by `MandateVault.policy()`
returning the exact `VaultPolicy` address above.

**Total real gas used: 12,348,979**, at the live gas price observed at
deploy time (20.2 gwei-equivalent), roughly 0.249 USDC. Within 0.3% of the
~0.25 USDC estimate projected before running, itself cross-checked against a
live `eth_estimateGas` simulation of the four standalone deployments before
running (see git history for that verification, not repeated here).

## Mandate USDC+cirBTC Vault (v2, second real vault)

Deployed 2026-07-11 via `scripts/deployVaultV2.ts`, run by Randy in his own
terminal (keystore-protected `ARC_ADMIN_PRIVATE_KEY`, the real ADMIN_ROLE
holder, never the original deployer wallet, which renounced admin rights
right after the first deploy). Reuses the already-deployed
`MandateRoles`/`MandateVaultDeployer`/`CapitalLimitRegistry`/`VaultFactory`
as-is, VaultFactory wires its own immutable `roles`/`capitalLimitRegistry`/
`protocolTreasury` fields into every vault it creates automatically, nothing
here required a new role grant or a new shared-infrastructure deployment.
Every address and policy limit below was independently re-verified live
(`vaultCount`, `allVaults`, `isMandateVault`, `MandateVault.policy()`/
`VaultPolicy.vault()` cross-referenced both directions, `totalAssets`,
`isRegisteredAsset`, `minStableAllocationBps`, `maxAllocationBpsPerAsset`,
`isStableAsset`), not copied from the deploy script's own console output.

Built specifically so `agent/policy/offchainPolicyCheck.ts`'s ENTER/EXIT
projection and the real swap-leg construction (not built yet) have a real
second asset to execute against, instead of a mock, see the analysis this
deployment followed. cirBTC chosen over EURC: the WUSDC/cirBTC pool has
confirmed real liquidity and is the exact pair
`test/MandateVaultArcFork.t.sol` already proves a real swap through
`executeDecision` against; EURC's only confirmed pool is EURC/cirBTC, not
directly paired with USDC, which the current single-hop `SwapLeg` design
does not support.

### Contract addresses

| Contract | Address |
|---|---|
| VaultFactory (reused, not redeployed) | `0xb6B77A2978B1974097727e267BCaAC35ba7ddf12` |
| MandateVault v2 | `0x6a00e9de0b830Fd2Bc37db7C19Ae8b67a0df1862` |
| VaultPolicy v2 | `0x676a1dd7CF88C768559d9A3ECC60F5Fc5319b9d5` |
| cirBTC (second registered asset) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |

### Policy limits specific to this vault

Per Randy's explicit call, more conservative than a simple "give it room"
default, for this vault's first volatile asset:

- `minStableAllocationBps`: 8000 (80% minimum stable, i.e. at most 20% of
  NAV in cirBTC)
- `maxAllocationBpsPerAsset[cirBTC]`: 2000 (20%), deliberately set to the
  same ceiling `minStableAllocationBps` already implies, not a separate,
  looser number
- `maxAllocationBpsPerAsset[USDC]`: 10000 (can still be up to 100% before
  any cirBTC position is entered)
- Every other limit (`maxDrawdownBps` 1000, `maxTradesPerDay` 5,
  `oracleMaxStalenessSeconds` 3600, `oracleMaxDeviationBps` 500,
  `maxDrawdownSpeedBpsPerWindow` 300, `drawdownSpeedWindowSeconds` 3600)
  reused unchanged from v1, none of these are asset-specific.

### Vault state at creation

- `totalAssets`: 5 USDC (the seed deposit), same minimal-real-capital
  sizing as v1
- Base asset: real native USDC, same as v1
- `CapitalLimitRegistry` cap: shared with v1, 10,000 USDC total, not a
  separate per-vault value (Phase 4 concern, not this stage's)

### Transactions

Both signed by the real ADMIN_ROLE holder,
`0x884687C973e9b7Af697dC34Aed1F09Da06BC4253`. Reconstructed after the fact
from that address's own transaction history via the Blockscout API, not
pasted from terminal output.

| # | Step | Tx hash | Block | Gas used |
|---|---|---|---|---|
| 1 | USDC.approve(VaultFactory, 5 USDC) | `0x406b7bdae1b70eb21693710013687b0f92664af2c575499b32599d577a1c4936` | 51318317 | 55,438 |
| 2 | VaultFactory.createVault (deploys MandateVault v2 + VaultPolicy v2 internally, USDC + cirBTC) | `0x052e66bd1970859dc59dd31b4b72650dda1c69dec9be84df9aabab32ca30cded` | 51318322 | 4,768,427 |

**Total real gas used: 4,823,865**, roughly 0.097 USDC at the same gas price
basis as the first deployment, well within the ~0.10-0.13 USDC estimate
projected before running. Notably cheaper than the first deployment
(0.249 USDC) despite deploying a vault with one more registered asset,
since none of the shared protocol infrastructure needed redeploying.

### Known limitation, discovered after this vault was created

This vault's base asset is native USDC (`0x3600...`, see `vault.asset()`
above), but querying the real UnitFlowV3 Factory live
(`getPool(USDC, cirBTC, fee)` at every standard fee tier) found **no pool
at all** pairing native USDC with cirBTC, and the one USDC/EURC pool that
does exist (`0x3Ca9475a33Dd9401163Eed2ab4963EcA8Fb3BDCC`, fee 100) has
**zero real liquidity** (`liquidity() == 0`, both token balances 0, an
initialized shell nobody ever funded). The only pool with real,
substantial liquidity anywhere verified in this project is WUSDC/cirBTC
(a different token from native USDC, see the "Verified" section of
`docs/arc-facts-to-verify.md`). **This vault cannot execute a real swap
into cirBTC today.** `executor/keeperService.ts`'s real swap-leg
construction is built and verified against real onchain infrastructure
(two Foundry fork tests against the real WUSDC/cirBTC pool), the mechanism
itself is not the gap, this vault's actual base asset simply has nowhere
to trade into cirBTC yet on this DEX. See `executor/README.md` for the
full writeup and the reasoning for not deploying a third vault around
WUSDC to work around it.

### Second restriction, a hard code-level block, not just a liquidity gap

Separately from the liquidity gap above: `agent/core/tools/getMarketData.ts`'s
`getVolatileAssetPriceUSDC` (cirBTC's only price source) sets
`referencePriceUSDC` equal to `priceUSDC` itself, since no genuinely
independent reference price exists for cirBTC today (confirmed live
against Chainlink's own official Price Feed Contract Addresses page, no
Data Feed of any kind is deployed on Arc yet, see
`docs/arc-facts-to-verify.md`). That self-reference makes
`VaultPolicy.sol`'s `oracleMaxDeviationBps` anti-manipulation check a
permanent no-op for cirBTC specifically, the asset with the thinnest,
most manipulable liquidity in this project. `executor/keeperService.ts`'s
`requireIndependentReferencePriceToBuy` hard-blocks (throws before ever
building a swap leg or reaching `simulateContract`) any `ENTER` into
cirBTC or any `REBALANCE` that increases cirBTC's target allocation,
until this changes. Selling is unaffected: `EXIT`, a `REBALANCE`
decreasing cirBTC's target, and `EMERGENCY_EXIT_TO_STABLE` all still work
normally, reducing exposure can never be the harmful direction for this
specific manipulation. **In practice today, this vault can only hold or
reduce cirBTC exposure, never increase it**, independent of the liquidity
gap above. Also disclosed in the vault's own user-facing description
(`src/lib/vaults.ts`'s `knownLimitations`, rendered in `src/App.tsx`
regardless of wallet-connection state) and told directly to the agent
itself (`scripts/runDecisionCycle.ts`'s `V2_CIRBTC_RESTRICTION_NOTE`), so
this is never a silent surprise at any layer, ops, depositor, or agent.
