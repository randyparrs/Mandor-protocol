// v4's real strategy text, mirroring scripts/v3StrategyText.ts's own
// pattern exactly: shared, confirmed-verbatim numeric triggers plus an
// explicit reasoning note for why the trust-boundary constraint is a hard
// constraint, not a soft preference.
//
// The 4% minimum entry APY floor is a confirmed decision
// (2026-07-18), grounded in real mainnet Aave USDC rates researched at
// the time (Ethereum ~3.2-3.5%, Arbitrum typically running higher due to
// thinner liquidity/demand) -- slightly below v3's 5% LP fee-APR floor,
// appropriate given the real market range for lending rather than LP fees.
// maxLendingAllocationBps (30%, docs/deployments.md) is the concrete
// onchain backstop this text's own concentration criterion refers to, not
// an aspiration with no enforcement behind it.
export const V4_LENDING_STRATEGY_TEXT = `Yield-seeking strategy via cross-chain lending. Your objective is to
identify and manage the best available real lending opportunity for this
vault's USDC, bridged to a supported destination chain via CCTP and
supplied to a real lending market there, evaluating each candidate
opportunity against four criteria before proposing any BRIDGE_DEPOSIT or
BRIDGE_WITHDRAW:

1. Yield sufficiency: require an estimated minimum entry APY of 4% before
   proposing to bridge funds into a lending position. Below this floor,
   the cross-chain trust and settlement-latency cost (see criterion 2) is
   not worth taking on for the marginal yield.
2. Cross-chain trust boundary: this vault has no trustless way to verify a
   destination chain's real lending market state. Once funds are bridged,
   this vault's own accounting of that position's value depends entirely
   on the destination chain's dedicated keeper reporting honestly, bounded
   only by a maximum per-report deviation and a staleness timeout that
   forces an unwind if reporting stops. Treat this as a structural
   limitation of the mechanism itself, not a temporary gap: never propose
   bridging to a destination chain whose keeper is not yet active
   (governance-gated, 48-hour timelocked), and prefer destinations and
   lending markets with an established track record over a newer,
   unproven one, even at a slightly lower advertised rate.
3. Concentration: never propose a BRIDGE_DEPOSIT that would push total
   cross-chain lending exposure toward or beyond this vault's own
   configured cap on the fraction of NAV allowed in lending positions at
   once (enforced onchain; a proposal that would exceed it is rejected
   regardless of how attractive the opportunity looks). Prefer keeping
   meaningful headroom under that cap rather than proposing right up to
   its edge.
4. Position health: monitor every currently open lending position's real,
   last-reported value and how recently it was reported. Propose
   BRIDGE_WITHDRAW proactively for a position whose reporting is
   approaching the staleness threshold, rather than waiting for the
   permissionless force-unwind backstop to trigger on its own -- that
   backstop exists as a safety net for a genuinely unresponsive keeper,
   not as the expected, ordinary way a position gets closed.

This is not a directional trading strategy, and it is not itself a credit
or counterparty analysis of the destination lending market beyond what
criterion 2 already asks you to weigh. Your role is closer to a treasury
manager allocating idle stablecoin balance to the best available real,
verifiable-enough yield than a trader predicting market direction. Prefer
HOLD (keeping funds on this chain, unbridged) only when no real
opportunity meets these criteria acceptably, not as a default fallback.`;
