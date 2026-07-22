// v5's real strategy text: "ergodic rebalancing," a threshold-based
// target-weight strategy validated by real historical backtests, see
// research/ergodic-rebalancing/REPORT.md for the full methodology and
// results this text is grounded in (not asserted without evidence).
//
// Deliberately DIFFERENT disclosure pattern from
// scripts/runDecisionCycle.ts's own V2_CIRBTC_RESTRICTION_NOTE, not a
// copy: v2's note tells the agent to NEVER propose growing cirBTC's
// allocation at all, which is the right call for v2 (a vault whose
// strategy was never built around maintaining a specific weight, just
// occasionally taking a capped position). v5 is different: its entire
// identity IS a symmetric 50/50 target, so telling the agent to simply
// never propose the buy-side half would silently degrade the real
// strategy into a one-way ratchet (sell cirBTC whenever overweight,
// otherwise HOLD forever, monotonically draining cirBTC exposure toward
// zero with no way back) -- a materially different, and arguably
// nonsensical, strategy than either "true ergodic rebalancing" or v2's
// own capped-entry design. This limitation ("this block prevents the
// core mechanism from working with real capital") is exactly this
// ratchet effect, so the honest choice
// here is to have the agent keep proposing the TRUE target-weight
// decision (in both directions), fully transparent in the decision log
// about what the strategy actually wants to do, while being explicitly
// told that buy-direction proposals will currently be refused by a real,
// disclosed safety gate -- not a bug to route around via some other
// action type.
export const V5_ERGODIC_REBALANCING_STRATEGY_TEXT = `Ergodic rebalancing strategy for USDC/cirBTC. Your objective is to maintain
this vault's value split as close to 50% USDC / 50% cirBTC as the real
threshold below allows, by proposing REBALANCE back to exactly that 50/50
target whenever the cirBTC-value weight deviates from 50% by more than 3%
in either direction (i.e. cirBTC's share of total value moves outside the
[47%, 53%] band). This threshold (3%) is not an arbitrary guess: it is the
tightest of three thresholds (3%, 5%, 8%) tested against real historical
BTC/USDC price data, and it produced the best net-of-cost result of the
three in that real backtest (see research/ergodic-rebalancing/REPORT.md).

Propose the honest, symmetric target every time the threshold is crossed,
regardless of direction: a REBALANCE reducing cirBTC's weight back to 50%
when it is overweight, and a REBALANCE increasing cirBTC's weight back to
50% when it is underweight. Do not silently favor one direction, and do
not substitute a different action type (ENTER, LP_*, or anything else) to
try to work around a rejected proposal -- if a proposal is rejected, that
reflects a real, deliberate safety constraint (see below), not a
suggestion to find another path to the same effect.

CRITICAL, REAL LIMITATION, read before proposing anything: cirBTC has no
genuinely independent reference price on Arc yet (see
docs/arc-facts-to-verify.md and docs/v5-ergodic-rebalancing.md). Both this
vault's keeper (executor/keeperServiceV4.ts's requireIndependentReferencePriceToBuy)
and the offchain pre-check (agent/policy/offchainPolicyCheck.ts's
INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY) refuse any action that would
INCREASE cirBTC's allocation, until that changes. This means: today, only
the sell-direction half of this strategy (reducing cirBTC back to 50% when
it is overweight) can actually execute with real capital. A proposal to
buy cirBTC back up to 50% when it is underweight will be rejected at
execution time -- this is expected, disclosed, and not a sign anything is
broken. Keep proposing the honest target-weight decision anyway (never
silently propose HOLD instead to avoid a rejection): the decision log
should always reflect what the true 50/50 strategy actually calls for,
even on the days real execution cannot yet follow through on it.

Two real, honest expectations from the backtest this strategy is based on,
so a result that matches them is not a sign of a problem: this strategy is
expected to underperform simply holding a static 50/50 split during a
strong, sustained one-directional price trend (rebalancing sells some of
the winning asset along the way, capping the upside a static holding would
have fully captured) -- and to outperform it, by a larger margin, during
choppier, sideways conditions (repeatedly buying low and selling high as
the price oscillates without a sustained net move, "harvesting" volatility
a static holding cannot). Do not treat a losing stretch during a clear,
sustained trend as evidence the strategy has stopped working; do treat a
sustained trend (not one or two days of movement) as a real, expected cost
of this strategy's own design, already priced into why it has a net edge
overall across a full historical cycle, not into why it wins on every
single day.

This is not a directional trading strategy. Do not attempt to predict
short-term price movement, and do not deviate from the 50/50 target based
on a view about where cirBTC's price is headed next -- the whole point of
this design is that it does not need to predict direction to have a real,
validated edge.`;

/// @notice Paper Vault demo variant of the exact same strategy, using
/// MANDORTEST-EQUITY (explicitly the "more volatile" of the 4 team-created
/// test tokens, see scripts/paperVaultTestTokens.ts) in place of cirBTC.
/// NOT interchangeable with cirBTC for this purpose by coincidence: cirBTC
/// buys are hard-blocked (both by the real keeper and by
/// agent/policy/offchainPolicyCheck.ts's own INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY
/// check, which the Paper Vault's own pre-check ALSO runs, see
/// scripts/paperVaultCycle.ts), while MANDORTEST-EQUITY has a real,
/// genuinely independent reference price by design (its own fixed
/// seed-time target, distinct from its pool's live spot price, see
/// paperVaultTestTokens.ts's own doc comment on exactly why this class of
/// asset exists) -- so it never trips that check in either direction, and
/// can demonstrate the FULL bidirectional mechanism (buy AND sell) end to
/// end, which cirBTC itself cannot do in paper mode any more than it can
/// with real capital, since checkPolicyOffchain is the SAME shared module
/// either way.
///
/// Not wired into scripts/paperVaultConfig.ts by default -- swapping
/// PAPER_STRATEGY_CONFIG_TEXT over to this text is a one-line, deliberate
/// choice for whenever this specific demo is wanted, see
/// docs/v5-ergodic-rebalancing.md for exactly how, not something this
/// change flips on its own for the Paper Vault's existing v3 LP demo.
export const V5_ERGODIC_REBALANCING_PAPER_DEMO_TEXT =
  "SIMULATED demo vault, no real funds are ever at risk (nothing here executes onchain). " +
  "Demonstrates v5's real ergodic-rebalancing mechanism end to end, both directions, using MANDORTEST-EQUITY " +
  "in place of cirBTC specifically because it has a genuinely independent reference price and is not subject " +
  "to the real INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY block cirBTC itself is (see " +
  "docs/v5-ergodic-rebalancing.md). " +
  `Ergodic rebalancing strategy for USDC/MANDORTEST-EQUITY. Your objective is to maintain
this vault's value split as close to 50% USDC / 50% MANDORTEST-EQUITY as the
threshold below allows, by proposing REBALANCE back to exactly that 50/50
target whenever MANDORTEST-EQUITY's value weight deviates from 50% by more
than 3% in either direction. This mirrors v5's real strategy exactly
(see research/ergodic-rebalancing/REPORT.md for the validated backtest this
threshold comes from), with no buy-side restriction: propose the honest,
symmetric target every time the threshold is crossed, regardless of
direction, the same way v5's real vault would if cirBTC had a genuinely
independent reference price today. This is not a directional trading
strategy; do not attempt to predict short-term price movement.`;
