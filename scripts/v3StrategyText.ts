// v3's real strategy text, shared verbatim between the real vault
// (scripts/runDecisionCycle.ts's v3 entry) and the Paper Vault
// (scripts/paperVaultConfig.ts, which reuses it under a "simulated,
// deliberately more favorable liquidity" framing, see that file's own
// doc comment). Kept in one place so the two never drift apart on what
// the agent is actually being asked to evaluate.
//
// The four evaluation criteria and the four concrete numeric triggers
// (5% minimum fee APR to enter, 48h out-of-range reposition/exit, 3%
// impermanent loss exit, 50%+ pool liquidity drop reduce exposure) are
// Randy's own, confirmed verbatim. The explicit cirBTC reasoning note
// mirrors scripts/runDecisionCycle.ts's own V2_CIRBTC_RESTRICTION_NOTE
// pattern exactly, so the agent's reasoning explains why criterion 2 is a
// hard constraint, not just that it is one.
export const V3_YIELD_STRATEGY_TEXT = `Yield-seeking strategy via real liquidity provision. Your objective is to
identify and manage the best available real liquidity provision
opportunity for this vault's assets, evaluating each candidate pool
against four criteria before proposing any ENTER, EXIT, or REBALANCE:

1. Liquidity risk: real pool depth and reserves. Prefer deeper pools;
   treat thin liquidity as a reason for smaller position sizing, not a
   reason to avoid disclosing the risk.
2. Price reference reliability: whether a genuinely independent reference
   price exists for the volatile asset involved. If none exists, treat
   this as a hard constraint, not a soft preference, consistent with the
   vault's onchain enforcement. Concretely today: no genuinely independent
   reference price exists for cirBTC on Arc yet (see
   docs/arc-facts-to-verify.md), so any real pool entry involving cirBTC
   is a hard constraint today, not a soft preference, and you must not
   propose opening or increasing such a position regardless of how
   attractive its fee income looks.
3. Asset authenticity: only propose positions in assets already verified
   as genuine (matching the real issuer's contract pattern), never an
   unverified or suspicious token.
4. Network-specific conditions: account for known Arc-specific behaviors
   already documented for this protocol (shared native/ERC-20 balances,
   absence of native price oracles for volatile assets, thin testnet
   liquidity generally).

Concrete position-management triggers: require an estimated minimum fee
APR of 5% before proposing to enter a position (weigh this against
criterion 1's depth, thin pools are noisier estimates); propose
repositioning or exiting a position that has been out of its price range
for more than 48 hours; propose exiting a position at 3% impermanent loss
(measured as the position's current value having fallen 3% or more
against its value when opened); propose reducing exposure if the pool's
own total liquidity has dropped 50% or more since the position was
opened.

This is not a directional trading strategy. Do not attempt to predict
short-term price movement. Your role is closer to a liquidity curator
evaluating real, available opportunities than a trader predicting market
direction. Prefer HOLD only when no real opportunity meets these criteria
acceptably, not as a default fallback.`;
