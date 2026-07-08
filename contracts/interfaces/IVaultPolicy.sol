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
        EMERGENCY_EXIT_TO_STABLE
    }

    struct TargetAllocation {
        address asset;
        uint16 targetWeightBps; // 0-10000
    }

    struct Decision {
        DecisionAction action;
        address asset; // primary asset for ENTER/EXIT, unused otherwise
        uint256 amount; // for ENTER/EXIT, unused otherwise
        TargetAllocation[] targetAllocations; // for REBALANCE, unused otherwise
    }

    struct AssetHolding {
        address asset;
        uint16 currentAllocationBps;
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
    }

    function validateDecision(Decision calldata decision, VaultState calldata state)
        external
        view
        returns (bool passed, bytes32[] memory violationCodes);

    function previewAutoPause(VaultState calldata state) external view returns (bool triggered, bytes32 code);

    function checkAndAutoPause(VaultState calldata state) external returns (bool triggered, bytes32 code);

    function paused() external view returns (bool);
}

/// @notice The one function MandateVault must expose so VaultPolicy can pay
/// the auto-pause bounty out of the vault's own assets. VaultPolicy never
/// holds vault funds itself; it only calls back into its own trusted vault.
interface IAutoPausePayer {
    function payAutoPauseBounty(address to, uint256 amount) external;
}
