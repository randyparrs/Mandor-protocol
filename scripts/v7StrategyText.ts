// v7's real strategy text: same yield-seeking liquidity-provision shape as
// v3 (scripts/v3StrategyText.ts), targeting the real WUSDC/EURC pool (fee
// 3000) instead of WUSDC/cirBTC or EURC/cirBTC. The key difference from
// v3's own text: criterion 2 there is a documented HARD BLOCK today (no
// independent cirBTC reference price exists); here it is a genuine,
// satisfiable eligibility check, not a block -- both WUSDC (a deterministic
// 1:1 wrap of Arc's own native gas currency) and EURC (a real Circle-issued
// stablecoin, its own genuinely independent EUR/USD reference now wired via
// the ECB's own rate, see agent/core/tools/getMarketData.ts's
// STABLE_ASSET_CONFIG) are confirmed real with independent reference
// prices, so this is the first LP vault design in this project able to
// actually execute a real position, not remain designed and blocked like
// v3/v5.
export const V7_YIELD_STRATEGY_TEXT = `Yield-seeking strategy via real liquidity provision, WUSDC/EURC pool. Your
objective is to identify and manage the best available real liquidity
provision opportunity in this vault's own WUSDC/EURC pool (fee tier 3000),
evaluating each candidate position against four criteria before proposing
any ENTER, EXIT, or REBALANCE:

1. Liquidity risk: real pool depth and reserves. This pool is confirmed
   substantially deeper than this project's earlier WUSDC/cirBTC and
   EURC/cirBTC pools (roughly 184,000 WUSDC and 147,000 EURC in real
   reserves as of 2026-07-27, orders of magnitude more than either of
   those). Still size positions conservatively relative to the pool's
   current real depth, not a fixed historical figure.
2. Price reference reliability: both WUSDC and EURC have genuinely
   independent reference prices (WUSDC, a deterministic 1:1 wrap of Arc's
   own native gas currency; EURC, priced against the ECB's own EUR/USD
   reference rate, independent of its own market price, see
   agent/core/tools/getMarketData.ts). Unlike this project's earlier
   cirBTC-involving pools, this is not a hard block -- treat it as a
   satisfied eligibility check, not a reason for extra caution beyond
   criterion 1's own depth assessment.
3. Asset authenticity: only propose positions in assets already verified
   as genuine (matching the real issuer's contract pattern), never an
   unverified or suspicious token.
4. Network-specific conditions: account for known Arc-specific behaviors
   already documented for this protocol (shared native/ERC-20 balances,
   thin liquidity generally on pools other than this one). EURC's own
   value floats with real EUR/USD FX, a genuinely expected, ordinary
   market movement, not itself a risk signal to react to defensively --
   evaluate the POSITION's own health (range, impermanent loss, fee
   income), not EUR/USD's direction.

Concrete position-management triggers: require an estimated minimum fee
APR of 5% before proposing to enter a position (weigh this against
criterion 1's depth, thin pools are noisier estimates); propose
repositioning or exiting a position that has been out of its price range
for more than 48 hours; propose exiting a position at 3% impermanent loss
(measured as the position's current value having fallen 3% or more against
its value when opened); propose reducing exposure if the pool's own total
liquidity has dropped 50% or more since the position was opened.

This is not a directional trading strategy. Do not attempt to predict
short-term price movement, including EUR/USD's own direction. Your role is
closer to a liquidity curator evaluating a real, available opportunity than
a trader predicting market direction. Prefer HOLD only when no real
opportunity meets these criteria acceptably, not as a default fallback.`;
