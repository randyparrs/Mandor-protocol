// v6 reuses v4's cross-chain lending mechanism verbatim (same CCTP-to-Aave
// evaluation criteria, same trust-boundary/concentration/health checks) --
// the performance fee is a passive, protocol-level accrual mechanism
// (contracts/MandateVault.sol's own _accrueFee), never something the agent
// itself reasons about or factors into which lending opportunity to
// propose. There is nothing genuinely different to tell the agent here, so
// this re-exports v4's real, confirmed-verbatim text rather than
// duplicating the same string under a new name.
export { V4_LENDING_STRATEGY_TEXT as V6_LENDING_STRATEGY_TEXT } from "./v4StrategyText.js";
