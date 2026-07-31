# Legacy: v1, v2, and v4 (discontinued)

This folder holds the original deploy scripts and deployment records for
earlier protocol iterations that are no longer active:

- **v1** (`Mandate USDC Vault`, USDC-only)
- **v2** (`Mandate USDC+cirBTC Vault`, USDC + cirBTC)
- **v4** (`Mandate USDC Cross-Chain Lending Vault`, first cross-chain
  lending design, built but never deployed as a vault)

All three are **discontinued**. v1/v2 were HOLD/REBALANCE only, with no
real yield-generating mechanism -- the agent could hold or rebalance between
registered assets, but never seek yield (no LP, no lending, no
threshold-based rebalancing target). v4 was a complete cross-chain lending
design (CCTP to Aave v3 on Arbitrum Sepolia) that was fully built but
ultimately superseded before any vault was deployed -- the mechanism was
redesigned as v6 using `MandateVaultLending.sol` instead of the original
`MandateVault.sol`. They were superseded by:

- **v3** -- real Uniswap-V3-style liquidity provision (yield-seeking)
- **v5** -- ergodic rebalancing (threshold-based target-weight strategy,
  validated by real historical backtests)
- **v6** -- cross-chain lending via CCTP (the v4 design, rebuilt and
  deployed, now active)
- **v7** -- WUSDC/EURC LP yield, first vault with a real executable LP
  position (no cirBTC price-feed blocker)

See `docs/deployments.md` for the full, current deployment history (v3/v5/v6/v7,
active) and `legacy/deployments-v1-v2.md` for v1/v2's own deployment record.
v4 was never deployed, so it has no deployment record.

**`contracts/MandateVault.sol` and `contracts/VaultPolicy.sol` are NOT
duplicated here and remain in `contracts/` at the repo root, unmoved.**
Both are single, monolithic files shared by all active vault versions.
Only what is genuinely version-specific -- the deploy scripts and the
deployment write-up -- lives here.

Note: `scripts/v4StrategyText.ts` is NOT in this folder. It remains in
`scripts/` because `scripts/v6StrategyText.ts` re-exports it directly
(v6's cross-chain lending guidance is verbatim identical to v4's original
strategy text, confirmed when v6 was built).

## Contents

- `deployArcTestnet.ts` -- v1's original full bootstrap script (roles,
  deployer, registry, factory, and the first vault, all in one script).
- `deployVaultV2.ts` -- v2's dedicated deploy script (reuses v1's already-
  deployed `VaultFactory`).
- `deployments-v1-v2.md` -- the real, live deployment record for v1 and v2
  (addresses, transaction hashes, policy limits).
- `deployVaultFactoryForV4.ts` -- Gen4 VaultFactory bootstrap script (the
  factory infrastructure was deployed, but no vault was created from it).
- `deployLendingPositionRegistryV4.ts` -- v4's LendingPositionRegistry deploy
  script.
- `deployVaultV4.ts` -- v4 vault deploy script (was never run; the vault was
  never created).
- `generateFactoryBootstrapWalletV4.ts` -- one-time wallet generator used
  during the Gen4 factory bootstrap.
- `runDecisionCycleV4.ts` / `runDecisionCycleV4.cmd` -- v4's decision cycle
  runner scripts (superseded by `scripts/runDecisionCycle.ts` for the active
  versions).
