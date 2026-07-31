// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The external interface of VaultPolicy: the deterministic,
/// no-AI gate every proposed decision must pass before MandateVault builds
/// a transaction. No string/reasoning field appears anywhere here, by
/// construction, reasoning text is structurally incapable of influencing
/// this contract, it simply has no parameter to carry it.
interface IVaultPolicy {
    enum DecisionAction {
        HOLD,
        REBALANCE,
        ENTER,
        EXIT,
        EMERGENCY_EXIT_TO_STABLE,
        // v3 (yield-seeking LP vault) only. Kept granular, mirroring
        // UnitFlowV3PositionManager's own real function separation
        // (mint/increaseLiquidity/decreaseLiquidity/collect/burn), rather
        // than one consolidated "LP" action, so this contract can apply
        // different rules per operation (e.g. only LP_OPEN needs the
        // range/mint-price-in-range check; LP_CLOSE is always allowed,
        // same as EXIT). Never used by v1/v2's ConstructorLimits (their
        // LP-specific limits are simply never set/checked).
        LP_OPEN,
        LP_INCREASE,
        LP_DECREASE,
        LP_COLLECT,
        LP_CLOSE,
        // v4 (cross-chain lending vault) only. BRIDGE_DEPOSIT burns USDC on
        // this chain via CCTP and opens a new cross-chain lending position;
        // BRIDGE_WITHDRAW initiates retrieval of an existing one. Both are
        // deliberately two actions, not a "BRIDGE" action with a direction
        // flag, same reasoning as LP_OPEN/LP_CLOSE being separate: this
        // contract applies very different rules to opening new exposure
        // versus retrieving it (BRIDGE_WITHDRAW, like LP_CLOSE/EXIT, is
        // always allowed regardless of a position's health). Never used by
        // v1/v2/v3's ConstructorLimits (their lending-specific limits are
        // simply never set/checked).
        BRIDGE_DEPOSIT,
        BRIDGE_WITHDRAW
    }

    /// @notice A cross-chain lending position's lifecycle. IN_TRANSIT_OUT
    /// covers the window between this chain's depositForBurn call and the
    /// destination-chain keeper's first confirmed report (see
    /// reportLendingPosition in MandateVault.sol); WITHDRAWAL_PENDING and
    /// IN_TRANSIT_BACK cover retrieval, entered either from
    /// BRIDGE_WITHDRAW or from an emergency/staleness-triggered unwind, the
    /// same single internal path regardless of trigger (see
    /// LendingPositionRegistry.sol's _initiateWithdrawal). CLOSED is
    /// listed for API completeness but never actually observed in
    /// currentLendingPositions: LendingPositionRegistry.markClosed removes
    /// a position from tracking in the same call that transitions it,
    /// same "gone from the array, not lingering at zero" convention
    /// MandateVault._removeLpPosition already uses for LP_CLOSE.
    enum LendingPositionStatus {
        IN_TRANSIT_OUT,
        OPEN,
        WITHDRAWAL_PENDING,
        IN_TRANSIT_BACK,
        CLOSED
    }

    struct TargetAllocation {
        address asset;
        uint16 targetWeightBps; // 0-10000
    }

    struct Decision {
        DecisionAction action;
        address asset; // primary asset for ENTER/EXIT, unused otherwise
        uint256 amount; // for ENTER/EXIT and BRIDGE_DEPOSIT (amount to burn/bridge), unused otherwise
        TargetAllocation[] targetAllocations; // for REBALANCE, unused otherwise
        // For LP_OPEN/LP_INCREASE/LP_DECREASE/LP_COLLECT/LP_CLOSE only,
        // unused otherwise, same "one shape, action-specific fields"
        // convention as the fields above. lpPool identifies which real
        // UnitFlowV3 pool (LP_OPEN only, e.g. the real WUSDC/cirBTC or
        // EURC/cirBTC pool); tickLower/tickUpper is the proposed price
        // range (LP_OPEN only); amount0Desired/amount1Desired/amount0Min/
        // amount1Min mirror INonfungiblePositionManager.MintParams/
        // IncreaseLiquidityParams exactly (LP_OPEN/LP_INCREASE only);
        // lpTokenId identifies an existing held position (LP_INCREASE/
        // LP_DECREASE/LP_COLLECT/LP_CLOSE only); liquidityToRemove is the
        // amount of liquidity to pull (LP_DECREASE only, mirrors
        // DecreaseLiquidityParams.liquidity).
        address lpPool;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 lpTokenId;
        uint128 liquidityToRemove;
        // For BRIDGE_DEPOSIT/BRIDGE_WITHDRAW only, unused otherwise.
        // chainId is the destination chain (BRIDGE_DEPOSIT, a new position)
        // or the chain the existing position lives on (BRIDGE_WITHDRAW,
        // informational/cross-check only, the position's own stored
        // chainId is authoritative). lendingPositionId identifies an
        // existing position (BRIDGE_WITHDRAW only; unused for
        // BRIDGE_DEPOSIT, whose position id is assigned by MandateVault at
        // execution time, the same reasoning LP_OPEN never takes a
        // caller-supplied tokenId).
        uint256 chainId;
        uint256 lendingPositionId;
    }

    struct AssetHolding {
        address asset;
        uint16 currentAllocationBps;
    }

    /// @notice One held LP position's state, as MandateVault's own
    /// _buildState() assembles it fresh every call (see MandateVault.sol's
    /// _valueLpPositions, never a cached figure). openValueUSDC is set
    /// once when the position is opened (LP_OPEN) and never changes
    /// afterward; currentValueUSDC is recomputed live every call via the
    /// real pool's slot0()/positions() and LiquidityAmounts math, same
    /// "read live external state, only for this one deliberate exception"
    /// reasoning documented in MandateVault.sol. currentAllocationBps
    /// mirrors AssetHolding's own field, symmetric treatment.
    struct LpPositionHolding {
        uint256 tokenId;
        address pool;
        uint16 currentAllocationBps;
        uint256 openValueUSDC;
        uint256 currentValueUSDC;
        bool inRange;
        uint256 outOfRangeSince; // 0 if currently in range or never observed out of range
        uint128 poolLiquidityAtOpen;
        uint128 currentPoolLiquidity;
    }

    /// @notice One held cross-chain lending position's state, as
    /// MandateVault's own _buildState() assembles it fresh every call.
    /// Unlike LpPositionHolding, currentValueUSDC here is NOT recomputed
    /// live from external state MandateVault can itself read -- this chain
    /// has no trustless way to read Arbitrum (or any destination chain's)
    /// state, so currentValueUSDC is exactly whatever the position's own
    /// dedicated chainKeeper last reported via reportLendingPosition,
    /// subject to the staleness haircut described on
    /// lendingReportStaleAfterSeconds in VaultPolicy.sol. This is a
    /// deliberate, disclosed new trust boundary, not an oversight, see
    /// docs/deployments.md's v4 section. principalUSDC is fixed once, at
    /// BRIDGE_DEPOSIT time, and never changes afterward (mirrors
    /// LpPositionHolding.openValueUSDC).
    struct LendingPositionHolding {
        uint256 positionId;
        uint256 chainId;
        LendingPositionStatus status;
        uint16 currentAllocationBps;
        uint256 principalUSDC;
        uint256 currentValueUSDC;
        uint256 lastReportedAt;
    }

    /// @notice Price data for one asset. `referencePrice` is a second,
    /// independent source (e.g. a TWAP or a secondary feed) used purely to
    /// bound deviation risk from a single manipulated feed, VaultPolicy
    /// never stores or switches feed addresses itself, see docs/architecture.md.
    struct AssetPrice {
        address asset;
        uint256 price;
        uint256 referencePrice;
        uint256 updatedAt;
    }

    struct VaultState {
        uint16 currentDrawdownBps;
        uint16 drawdownBpsAtWindowStart; // drawdown as of drawdownSpeedWindowSeconds ago
        uint256 tradesToday;
        AssetHolding[] currentHoldings;
        AssetPrice[] prices;
        // v3 only; always empty for v1/v2/v4 (no LP positions ever held).
        LpPositionHolding[] currentLpPositions;
        // v4 only; always empty for v1/v2/v3 (no cross-chain lending
        // positions ever held).
        LendingPositionHolding[] currentLendingPositions;
    }

    function validateDecision(Decision calldata decision, VaultState calldata state)
        external
        view
        returns (bool passed, bytes32[] memory violationCodes);

    function previewAutoPause(VaultState calldata state) external view returns (bool triggered, bytes32 code);

    function checkAndAutoPause(VaultState calldata state) external returns (bool triggered, bytes32 code);

    function paused() external view returns (bool);

    // v4 only, always 0 for v1/v2/v3's deployed VaultPolicy instances.
    // Exposed here (not just as VaultPolicy's own auto-generated getters)
    // specifically so LendingPositionRegistry, which only ever holds an
    // IVaultPolicy-typed reference (never the concrete VaultPolicy type,
    // same convention MandateVault itself already follows for `policy`),
    // can read them.
    function lendingReportMaxDeviationBps() external view returns (uint256);
    function lendingReportStaleAfterSeconds() external view returns (uint256);
    function lendingPositionForceUnwindSeconds() external view returns (uint256);

    // v6 only, always 0 for v1-v5's deployed VaultPolicy instances. Read by
    // MandateVault's own fee-accrual logic, same exposure pattern as the
    // lending fields above.
    function performanceFeeBps() external view returns (uint256);
}

/// @notice The one function MandateVault must expose so VaultPolicy can
/// trigger the auto-pause bounty payout out of the vault's own assets.
/// VaultPolicy never holds vault funds itself; it only calls back into its
/// own trusted vault. Deliberately no `amount` parameter: the bounty is an
/// economic incentive, not a risk limit, so unlike every other value in
/// VaultPolicy it may need to adjust over time (gas costs, USDC value
/// context). MandateVault owns and decides the current amount itself
/// (a plain GOVERNANCE-adjustable value, see MandateVault.sol), VaultPolicy
/// only ever triggers the callback, it never dictates or even knows the
/// figure.
interface IAutoPausePayer {
    function payAutoPauseBounty(address to) external;
}
