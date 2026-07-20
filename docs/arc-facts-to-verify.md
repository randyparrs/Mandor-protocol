# Arc facts to verify before Phase 2 relies on them

None of the following are confirmed. Check each against docs.arc.io (or the
official Arc/Circle docs at the time) before any real contract code assumes
it's true. This project's standing rule: never guess unverified onchain/SDK
facts.

- [ ] ERC-8004 tooling/support for onchain agent identity/attestation
- [ ] Account abstraction support (4337 bundlers and/or 7702-style delegation) on Arc
- [ ] A Forta-equivalent or any real-time onchain monitoring vendor with Arc coverage
- [ ] Private mempool / MEV-protected relay options on Arc
- [ ] Actual USYC token contract address, decimals, and real liquidity depth
      (cirBTC's address is now reasonably well evidenced, see Verified section
      below, USYC is not)
- [ ] Whether the OpenZeppelin `ERC4626` version ultimately pinned in `package.json`
      includes the default virtual-shares offset, verify the specific version,
      don't assume

## Verified (checked live against Arc testnet, not just docs)

- [x] Native USDC (18 decimals) and its ERC-20 interface at
      `0x3600000000000000000000000000000000000000` (6 decimals) share the exact
      same underlying balance, not separate tokens. Confirmed via live
      `eth_getBalance` vs `eth_call balanceOf()` on two real addresses (a test
      wallet and a deployed contract), both an exact truncation match. See
      `docs/architecture.md`, "USDC donation attack" section, for the design
      consequence.
- [x] Transfers to `address(0)` revert on both the native and ERC-20 interface,
      with the same underlying reason (`"Zero address not allowed"`), confirmed
      via live `eth_call` simulation on both paths.
- [x] A real, deployed, verified Uniswap-V3-compatible router exists on Arc
      Testnet: **"UnitFlowV3Router" by ACTFUN** (a token launchpad), NOT the
      official Uniswap Labs deployment announced as an Arc ecosystem partner
      (that one still has no publicly documented address). Router
      `0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01`, Factory
      `0xAb6A8AAb7d490007634ef59d424b5d89688a1971`, Quoter
      `0x121aeB6DEf00F6F67665008CaC1C19805886ed1a`. Verified independently,
      not just trusted secondhand: all three have real deployed bytecode
      (`eth_getCode`), all three are marked verified on Arcscan with source
      matching the standard Uniswap V3 periphery/core file structure exactly
      (renamed), and `Router.factory()` returns the exact known Factory
      address (confirming real cross-wiring, not just independently-deployed
      look-alikes).
- [x] **Router address is NOT hardcoded anywhere.** Confirmed by reading
      `MandateVault.sol`/`MandateVaultDeployer.sol`: the router is a plain
      constructor parameter (`initialSwapRouter_`), stored in the same
      `allowedRouters` mapping `GOVERNANCE` can add to or remove from at any
      time via `setRouterAllowed`. Migrating to the official Uniswap Labs
      router later, once it has a documented address, is a governance
      action, not a code change, same pattern as the oracle feed address.
- [x] **A real pool exists for Mandate's actual target assets, not just a
      launchpad token pair.** Found by reading the Factory's own
      `PoolCreated` events, not assumed. EURC's address
      (`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`) is confirmed against
      Arc's own official docs (docs.arc.io/arc/references/contract-addresses).
      cirBTC's address (`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`) is NOT
      yet listed on that page, but its contract is a Circle-copyrighted
      `FiatTokenProxy` (the exact same proxy pattern Circle uses for
      USDC/EURC itself), strong evidence it is a genuine Circle-issued token
      on this testnet, not a launchpad look-alike that merely reused the
      "cirBTC" symbol, though this is not a 100% official confirmation
      either, `docs.arc.io` simply not listing it yet is the most likely
      explanation, not proof either way.
    - EURC/cirBTC pool (fee 3000, `0xc9Ae7930C2917B755c7e7d38805D8D96E5c162df`):
      real, substantial liquidity, ~2651 EURC and ~0.0064 cirBTC at the
      block pinned in the fork test below.
    - WUSDC/cirBTC pool (fee 3000, `0x254bA0424618113127538eE11e42C1e3c1721225`):
      real liquidity, ~239 WUSDC and ~0.00048 cirBTC at the same pinned
      block. Used for the full `MandateVault.executeDecision` fork test
      since WUSDC matches the vault's real base asset (USDC).
    - The earlier WUSDC/"SAM" pool (a launchpad token, not one of Mandate's
      target assets) is no longer used in the fork test, superseded by the
      two pools above.
      `ISwapRouter.sol` and `MandateVault.sol`'s `SwapLeg` struct match this
      router's real ABI (`exactInputSingle`) directly, no longer a generic
      invented interface. `test/MandateVaultArcFork.t.sol` runs both a
      direct router-level swap and the full atomic swap plus policy
      validation flow through `MandateVault.executeDecision`, against these
      real pools on a fork of Arc Testnet pinned to block `50846709` for
      reproducibility (re-pin to a fresh block, and re-verify reserves with
      the same `eth_call balanceOf` method used here, periodically).

- [x] **Chainlink oracle feed availability on Arc, for USDC/EURC/USYC/cirBTC
      pricing: no real Data Feed exists on Arc today.** Checked live on
      2026-07-11 against Chainlink's own official Price Feed Contract
      Addresses page (docs.chain.link/data-feeds/price-feeds/addresses),
      both the Mainnet and Testnet network selectors: searching "Arc"
      returns "No chains found matching 'arc'" (confirmed via the page's
      own live network-search UI, not a stale cache). Separately confirmed
      via Chainlink's CRE release notes: "Arc Testnet" is listed there
      (added 2026-01-29), but only for CRE (Chainlink Runtime Environment)
      workflow support, a different product, not Data Feeds/price feeds.
      This is despite Arc having joined "Chainlink Scale" (a partnership
      announcement covering CCIP, Data Streams, Data Feeds, and Proof of
      Reserve) around the same time; the announcement is real, but the
      actual Data Feeds product is not yet live on Arc. Consequence: no
      genuinely independent BTC/USD reference price exists for cirBTC yet,
      see `agent/core/tools/getMarketData.ts`'s `hasIndependentReferencePrice`
      and `executor/keeperService.ts`'s `requireIndependentReferencePriceToBuy`,
      which hard-block buying cirBTC onchain until this changes. Revisit by
      re-running the same live search, and if a feed appears, verify it for
      real (`eth_getCode` + a real `latestRoundData()` call) before trusting
      it, same standard as everything else in this file.

- [x] **Pyth Network does have a real, live contract on Arc Testnet with a
      genuine BTC/USD feed, but it cannot serve as cirBTC's independent
      reference price -- not because of deployment status like Chainlink
      above, but because testnet cirBTC itself has no real value to
      reference.** Checked live 2026-07-19: Pyth's own official contract
      address list (docs.pyth.network/price-feeds/core/contract-addresses/evm)
      lists "Arc Network Testnet" at `0x2880aB155794e7179c9eE2e38200202908C17B43`
      (an ERC1967 proxy, real bytecode confirmed via `eth_getCode` at both
      the proxy and its implementation at `0xa2aa501b19aff244d90cc15a4cf739d2725b5729`).
      `priceFeedExists()` returned `true` for the real BTC/USD feed id
      (`0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`,
      from Pyth's own Hermes API), and `getPriceUnsafe()` returned a fresh,
      plausible real price (~$64,600-$64,700 across several live reads).
      Pyth's contract itself is real, this is not the same situation as
      Chainlink's total absence.

      The reason this still cannot be used: Circle's own official docs
      (developers.circle.com/assets/cirbtc-contract-addresses) state, for
      the exact Arc Testnet cirBTC address this project uses
      (`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`, confirmed matching):
      "Testnet tokens have no financial value... the cirBTC tokens in
      circulation on these networks have no financial value, and are not
      backed by real Bitcoin." This is explicitly different from cirBTC on
      Ethereum mainnet, which Circle's own blog describes as genuinely
      "1:1 backed by native BTC, custodied at a regulated Circle entity."
      Testnet cirBTC is a free, unbacked test token with no redemption
      arbitrage mechanism tying its price to real BTC at all.

      Confirmed empirically, not just from the docs: using this project's
      own `getVolatileAssetPriceUSDC` against the real WUSDC/cirBTC pool,
      cirBTC's live pool-implied price was **$597,092.63**, against a
      simultaneous real Pyth BTC/USD read of **$64,721.15** -- a **9.23x
      (~823%) deviation**, not a small tracking error. This is consistent
      with the pool's own known thin, arbitrarily-seeded reserves
      (~440 WUSDC / ~0.00077 cirBTC) having no economic force keeping it
      anchored to real BTC.

      Consequence: wiring Pyth's real BTC/USD price in as cirBTC's
      `referencePriceUSDC` (a `PYTH_REFERENCE_CONFIG` entry was designed but
      explicitly NOT implemented after this finding) would not have
      unblocked anything -- `oracleMaxDeviationBps` (500bps/5% tolerance)
      would fail permanently against an ~823% real gap, just replacing one
      honest, disclosed block (`INDEPENDENT_REFERENCE_PRICE_REQUIRED_TO_BUY`)
      with a different one, while creating a false impression that a real,
      meaningful independent-price check was running. v2/v3/v4/v5 remain
      blocked for cirBTC exactly as before this investigation. Do not
      revisit this path for TESTNET cirBTC without this context. Pyth's
      real Arc deployment may still be the right answer the day either (a)
      Arc mainnet is used with genuinely-backed cirBTC, or (b) a testnet
      cirBTC with a real peg mechanism exists -- re-verify both the oracle
      and cirBTC's own backing status live again at that point, same
      standard as everything else in this file, don't assume either has
      changed.

## Blocking, must be resolved before Phase 2 is considered fully closed

- [ ] **Blocklisted-address transfer behavior, not yet verified.** Confirm
      live on Arc testnet the transfer behavior toward a blocklisted address,
      on both the native USDC interface and the ERC-20 interface, the same
      way the zero-address revert was already confirmed live. This requires
      either finding a real blocklisted address on testnet, or simulating one
      if Circle's testnet environment allows it. Do not assume this behaves
      the same as the zero-address case until it is verified live, treating
      it as "probably the same" is not sufficient to close this item.
