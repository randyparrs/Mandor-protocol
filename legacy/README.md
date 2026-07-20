# Legacy: v1 and v2 (discontinued)

This folder holds the original deploy scripts and deployment records for
the protocol's **first iteration**:

- **v1** (`Mandate USDC Vault`, USDC-only)
- **v2** (`Mandate USDC+cirBTC Vault`, USDC + cirBTC)

Both are **discontinued**. Their strategy was HOLD/REBALANCE only, with no
real yield-generating mechanism -- the agent could hold or rebalance
between registered assets, but never seek yield (no LP, no lending, no
threshold-based rebalancing target). They were superseded by:

- **v3** -- real Uniswap-V3-style liquidity provision (yield-seeking)
- **v4** -- cross-chain lending via CCTP
- **v5** -- ergodic rebalancing (threshold-based target-weight strategy,
  validated by real historical backtests)

See `docs/deployments.md` for the full, current deployment history (v3/v4/v5,
active) and `legacy/deployments-v1-v2.md` for v1/v2's own deployment
record.

**`contracts/MandateVault.sol` and `contracts/VaultPolicy.sol` are NOT
duplicated here and remain in `contracts/` at the repo root, unmoved.**
Both are single, monolithic files shared by all five vault versions --
v3/v4/v5 depend on the exact same source v1/v2 were originally deployed
from, so there is no separate "v1 contract" or "v2 contract" to isolate.
Only what is genuinely version-specific -- the deploy scripts and the
deployment write-up -- lives here.

## Contents

- `deployArcTestnet.ts` -- v1's original full bootstrap script (roles,
  deployer, registry, factory, and the first vault, all in one script).
- `deployVaultV2.ts` -- v2's dedicated deploy script (reuses v1's already-
  deployed `VaultFactory`).
- `deployments-v1-v2.md` -- the real, live deployment record for both
  (addresses, transaction hashes, policy limits), extracted verbatim from
  `docs/deployments.md`.
