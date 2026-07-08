# contracts/

Solidity contracts. Phase 1 status: design only, nothing implemented yet.

- `MandateVault.sol` — ERC-4626 vault, one instance per vault. Custodies
  whatever assets a decision moves it into. Executes swaps atomically
  (policy check + swap + receive proceeds in one transaction) — never hands
  funds to an off-chain custody wallet, unlike Vpay's swap pattern. Tracks its
  own internal accounting for USDC (never trusts live `balanceOf(address(this))`
  for share-price math) because Arc's native USDC and its ERC-20 interface
  share one balance — verified live, see `docs/architecture.md`.
- `VaultPolicy.sol` — immutable per-vault policy gate (max allocation per
  asset, max drawdown, max trades/day, min stable allocation, oracle
  staleness/deviation limits). Pure deterministic `view` logic, no AI
  involvement, no string/reasoning parameter in its interface — reasoning
  text is structurally incapable of influencing this contract. Only its
  pause flag is mutable, and pause never blocks withdrawals.
  Also exposes `checkAndAutoPause(vaultId)`, **permissionless** (anyone can
  call it, same escalation pattern as `P2PMarket.sol`'s `expire()`) — it only
  actually pauses if an objective condition is true (oracle deviation above
  `oracleMaxDeviationBps`, or drawdown speed above
  `maxDrawdownSpeedBpsPerWindow` within `drawdownSpeedWindowSeconds`),
  independent of the human `PAUSER` role. On a successful trigger it pays
  `autoPauseBountyAmount` (from the vault's own assets) to the caller — do
  not skip this payout, it's what keeps the permissionless path real instead
  of theoretical (see `docs/architecture.md`).
- `VaultFactory.sol` — deploys Vault+Policy pairs; atomically seeds the
  protocol-owned anti-inflation deposit at creation time.
- `VaultRegistry.sol` — canonical on-chain vault list, roles, and the
  `strategyAuthor` field (kept generic on purpose, see `docs/architecture.md`
  §"Why Agent Studio isn't designed here").
- `CapitalLimitRegistry.sol` — deposit caps, deliberately kept out of the
  immutable `VaultPolicy` since caps are meant to move over time as a vault
  proves itself; mutable only by `GOVERNANCE`, behind a timelock.
- `access/Roles.sol`, `governance/Timelock.sol` — RBAC constants and the OZ
  timelock wrapper for any fund-safety-affecting parameter change.

## Must never do

- Never add a mutable code path to `VaultPolicy`'s limits. A different risk
  profile is a new Vault+Policy pair, never a parameter change on a live one.
- Never let `pause()` block `withdraw`/`redeem`. Pause only blocks new
  deposits and new decision execution.
- Never let a `GOVERNANCE` oracle feed switch take effect without checking
  the new feed's price against the previous feed's last known price within
  `oracleMaxDeviationBps` — a plain address swap with no continuity check is
  a known DeFi attack vector.
- Never build a v1-to-v2 capital migration function. Migration between
  strategy versions is manual withdraw + redeposit by design, so v2 code can
  never reach v1's funds. See `docs/architecture.md`.
- Never use live `balanceOf(address(this))` for USDC share-price/totalAssets
  math. Verified live on Arc testnet: native USDC and its ERC-20 interface
  share one balance, so a plain unsolicited transfer to the vault changes
  that reading instantly, any time, not just at first deposit. Use the
  vault's own internal accounting ledger instead.
- Never let a failed pushed transfer (e.g. the auto-pause bounty) revert a
  safety-critical state change. Flip `paused` before attempting the payout,
  and tolerate the payout failing.
