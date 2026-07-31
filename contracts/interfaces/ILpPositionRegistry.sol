// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVaultPolicy} from "./IVaultPolicy.sol";

/// @notice The external interface of LpPositionRegistry: the v7 satellite
/// contract that owns the full Uniswap-V3-style LP mechanism (NFT custody,
/// mint/increase/decrease/collect/close, TWAP-guarded valuation, the
/// positionManager 48h timelock), same "separate deployed contract, split
/// out specifically to relieve EIP-170 pressure" shape as
/// LendingPositionRegistry. Deliberately NOT wired into VaultFactory.createVault's
/// atomic sequence, same reasoning as v4's lendingRegistry: deployed and
/// wired AFTER the vault+policy pair already exists, via
/// MandateVaultLp.setLpRegistry (one-shot).
///
/// @dev Real, disclosed difference from LendingPositionRegistry: that
/// contract never touches funds (only bookkeeping; the real bridging
/// happens on the vault via CCTP). This one genuinely must, if only
/// transiently within a single transaction -- Uniswap's own
/// positionManager.mint()/increaseLiquidity() requires a real recipient to
/// receive the resulting NFT/tokens, and this registry is that recipient
/// (it holds the position NFT so it can manage it later). The vault pushes
/// exactly the token amounts a leg needs via a plain ERC-20 transfer
/// immediately before calling openPosition/increasePosition; this registry
/// refunds any unused leftover back to the vault, in the same transaction,
/// before returning. See LpPositionRegistry.sol's own top-of-file comment
/// for the full reasoning and the dedicated atomicity test proving this.
interface ILpPositionRegistry {
    /// @dev Mirrors contracts/MandateVault.sol's own LpLeg struct exactly
    /// (same field layout), declared once here as the shared source of
    /// truth for this split, rather than duplicated separately on the
    /// vault and the registry. ABI-wise this changes nothing for
    /// executor/keeperServiceV4.ts: Solidity's ABI encoding is structural
    /// (tuple shape), not tied to which file declares the struct.
    struct LpLeg {
        address pool;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 tokenId;
        uint128 liquidity;
        uint256 deadline;
    }

    /// @notice Opens a brand-new position. Called only by the vault, which
    /// must already have transferred exactly leg.amount0Desired/
    /// amount1Desired of the pool's real token0/token1 to this registry
    /// (via a plain ERC-20 transfer) in the same transaction, immediately
    /// before this call. Returns the real amounts the mint actually
    /// consumed (never assume Desired == consumed); this registry refunds
    /// any unused leftover back to the vault before returning, so the
    /// vault's own ledger debit (by the returned amounts) always matches
    /// its real, net token balance change exactly.
    function openPosition(LpLeg calldata leg, address token0, address token1)
        external
        returns (uint256 tokenId, uint256 amount0Used, uint256 amount1Used);

    /// @notice Adds liquidity to an existing held position. Same
    /// push-then-refund custody shape as openPosition.
    function increasePosition(LpLeg calldata leg, address token0, address token1)
        external
        returns (uint256 amount0Used, uint256 amount1Used);

    /// @notice Removes a fraction of an existing position's liquidity and
    /// sweeps everything currently owed (the just-decreased principal plus
    /// any accrued fees) back to the vault. No tokens need pushing here:
    /// this direction only ever returns value to the vault.
    function decreasePosition(LpLeg calldata leg) external returns (uint256 amount0, uint256 amount1, address token0, address token1);

    /// @notice Pure fee collection, principal/basis unchanged.
    function collectFees(LpLeg calldata leg) external returns (uint256 amount0, uint256 amount1, address token0, address token1);

    /// @notice Fully closes a position: decreases all remaining liquidity,
    /// collects everything owed, burns the NFT, removes it from tracking.
    /// Also the path EMERGENCY_EXIT_TO_STABLE's unwind reaches (see
    /// MandateVaultLp.sol's own _executeLpLeg): closing is always the
    /// correct, safe interpretation regardless of which action label
    /// carries it here.
    function closePosition(LpLeg calldata leg) external returns (uint256 amount0, uint256 amount1, address token0, address token1);

    /// @notice The pool's real token0/token1 for an existing held position,
    /// so the vault can validate/route LP_INCREASE/LP_DECREASE/LP_COLLECT/
    /// LP_CLOSE without needing its own copy of lpPositionPool (that state
    /// now lives entirely on this registry).
    function tokensOf(uint256 tokenId) external view returns (address token0, address token1);

    /// @notice Sum of every held position's current, TWAP-guarded USD
    /// value. Called by MandateVaultLp.totalAssets().
    function totalValueUSDC() external view returns (uint256);

    /// @notice Every held position's full state, for VaultPolicy's
    /// validateDecision. Called by MandateVaultLp._buildState().
    function currentPositions(uint256 nav) external view returns (IVaultPolicy.LpPositionHolding[] memory);

    /// @notice Persists real out-of-range durations for every held
    /// position. Called once per executeDecision (before building either
    /// state), same "anyone can escalate, the contract enforces the real
    /// condition" independence as LendingPositionRegistry's own staleness
    /// tracking, but this one is vault-only since it is folded into the
    /// vault's own executeDecision flow, not a standalone permissionless
    /// entrypoint.
    function syncOutOfRangeTracking() external;

    function positionCount() external view returns (uint256);
}

/// @notice The two read-only vault getters LpPositionRegistry needs for its
/// own USD valuation math (_valueInUSDC's exact same formula, replicated
/// here rather than duplicating price-caching state -- both mappings are
/// already public on MandateVaultLp.sol, no new vault code needed beyond
/// exposing this interface). Deliberately read-only: this registry never
/// writes vault state directly, only ever returns amounts for the vault
/// itself to debit/credit its own ledger.
interface IMandateVaultLpPricing {
    function lastKnownPriceUSDC(address asset) external view returns (uint256);
    function assetDecimals(address asset) external view returns (uint8);
    function isRegisteredAsset(address asset) external view returns (bool);
}
