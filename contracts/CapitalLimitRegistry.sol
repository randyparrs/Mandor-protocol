// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ICapitalLimitRegistry} from "./interfaces/ICapitalLimitRegistry.sol";

/// @notice Phase 2 stub for the capital-limit gate promised back in Phase 1
/// (see docs/threat-model.md, "Capital limits and progressive trust"):
/// reputation-based progressive tiers are correctly deferred to Phase 4, but
/// since Phase 2 already involves real testnet deposits, "new vaults start
/// with low capital limits" needs to be a real, enforced property now, not
/// just a documented plan. One `ADMIN`-proposed maximum totalAssets value,
/// applied identically to every vault until Phase 4's per-vault scoring
/// exists.
///
/// Raising this cap is not risk-free like lowering it: raising it is the
/// exact action progressive trust is meant to gate, today the practical
/// blast radius is limited (one global value, not yet targetable at a
/// specific vault), but Phase 4 introduces per-vault differentiated caps,
/// at which point an instant, undelayed increase becomes a real, targeted
/// attack surface. So this goes through the same self-contained,
/// contract-enforced 48h timelock already built and tested for the router
/// allowlist and sweepDust (`proposeMaxTotalAssets`/`executeMaxTotalAssets`,
/// cancellable by `PAUSER_ROLE`), rather than trusting the organizational
/// convention that `GOVERNANCE_ROLE`/`ADMIN_ROLE` happens to be held by a
/// real `TimelockController`: that convention is unverifiable by the
/// contract itself, if the role were ever assigned directly to a plain
/// multisig with no delay, nothing here would catch the misconfiguration.
contract CapitalLimitRegistry is ICapitalLimitRegistry {
    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MAX_TOTAL_ASSETS_TIMELOCK = 48 hours;

    address public immutable roles;
    uint256 public maxTotalAssetsValue;
    uint256 public pendingMaxTotalAssets;
    uint256 public maxTotalAssetsExecutableAt;

    event MaxTotalAssetsProposed(uint256 value, uint256 executableAt);
    event MaxTotalAssetsCancelled(address indexed cancelledBy);
    event MaxTotalAssetsSet(uint256 value);

    error NotAdmin();
    error NotPauser();
    error MaxTotalAssetsNotReady(uint256 executableAt);
    error NoPendingMaxTotalAssets();

    modifier onlyAdmin() {
        if (!IAccessControl(roles).hasRole(ADMIN_ROLE, msg.sender)) revert NotAdmin();
        _;
    }

    modifier onlyPauser() {
        if (!IAccessControl(roles).hasRole(PAUSER_ROLE, msg.sender)) revert NotPauser();
        _;
    }

    constructor(address roles_, uint256 initialMaxTotalAssets) {
        roles = roles_;
        maxTotalAssetsValue = initialMaxTotalAssets;
        emit MaxTotalAssetsSet(initialMaxTotalAssets);
    }

    /// @dev The vault parameter is intentionally unused for now, see
    /// ICapitalLimitRegistry.sol, every vault gets the same value until
    /// Phase 4.
    function maxTotalAssets(address) external view returns (uint256) {
        return maxTotalAssetsValue;
    }

    /// @notice Step 1 of 2. Applies to both increases and decreases, same
    /// symmetric treatment already chosen for the router allowlist (adding
    /// and removing a router both go through the full delay, since removal
    /// wasn't judged urgent enough to skip it either).
    function proposeMaxTotalAssets(uint256 value) external onlyAdmin {
        uint256 executableAt = block.timestamp + MAX_TOTAL_ASSETS_TIMELOCK;
        pendingMaxTotalAssets = value;
        maxTotalAssetsExecutableAt = executableAt;
        emit MaxTotalAssetsProposed(value, executableAt);
    }

    /// @notice Step 2 of 2. Permissionless once the timelock has elapsed,
    /// same "anyone can finalize, the contract enforces the real condition"
    /// pattern used throughout MandateVault.sol.
    function executeMaxTotalAssets() external {
        uint256 executableAt = maxTotalAssetsExecutableAt;
        if (executableAt == 0 || block.timestamp < executableAt) revert MaxTotalAssetsNotReady(executableAt);

        uint256 value = pendingMaxTotalAssets;
        maxTotalAssetsExecutableAt = 0;
        pendingMaxTotalAssets = 0;
        maxTotalAssetsValue = value;
        emit MaxTotalAssetsSet(value);
    }

    /// @notice A different role than ADMIN, which proposes, so a pending
    /// change (a compromised ADMIN key raising the cap, or simply a mistake)
    /// can actually be stopped during the delay, not just watched.
    function cancelMaxTotalAssets() external onlyPauser {
        if (maxTotalAssetsExecutableAt == 0) revert NoPendingMaxTotalAssets();
        maxTotalAssetsExecutableAt = 0;
        pendingMaxTotalAssets = 0;
        emit MaxTotalAssetsCancelled(msg.sender);
    }
}
