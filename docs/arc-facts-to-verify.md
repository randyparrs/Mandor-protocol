# Arc facts to verify before Phase 2 relies on them

None of the following are confirmed. Check each against docs.arc.io (or the
official Arc/Circle docs at the time) before any real contract code assumes
it's true. This project's standing rule: never guess unverified onchain/SDK
facts.

- [ ] Chainlink oracle feed availability on Arc, for USDC/EURC/USYC/cirBTC pricing
- [ ] ERC-8004 tooling/support for onchain agent identity/attestation
- [ ] Account abstraction support (4337 bundlers and/or 7702-style delegation) on Arc
- [ ] A Forta-equivalent or any real-time onchain monitoring vendor with Arc coverage
- [ ] Private mempool / MEV-protected relay options on Arc
- [ ] Actual cirBTC/USYC token contract addresses, decimals, and real liquidity depth
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
      (renamed), `Router.factory()` returns the exact known Factory address
      (confirming real cross-wiring, not just independently-deployed
      look-alikes), and a real pool with real, non-zero liquidity was found
      by reading the Factory's own `PoolCreated` events (WUSDC / "SAM", fee
      3000, pool `0xf8181Ce99783943B7c67467789984a68e8AeaD5d`). `ISwapRouter.sol`
      and `MandateVault.sol`'s `SwapLeg` struct now match this router's real
      ABI (`exactInputSingle`) directly, no longer a generic invented
      interface. `test/MandateVaultArcFork.t.sol` runs the full atomic swap
      plus policy validation flow against this real router and real pool on
      a fork of Arc Testnet, not a mock.

## Blocking, must be resolved before Phase 2 is considered fully closed

- [ ] **Blocklisted-address transfer behavior, not yet verified.** Confirm
      live on Arc testnet the transfer behavior toward a blocklisted address,
      on both the native USDC interface and the ERC-20 interface, the same
      way the zero-address revert was already confirmed live. This requires
      either finding a real blocklisted address on testnet, or simulating one
      if Circle's testnet environment allows it. Do not assume this behaves
      the same as the zero-address case until it is verified live, treating
      it as "probably the same" is not sufficient to close this item.
