// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy} from "./interfaces/IVaultPolicy.sol";
import {ILendingPositionRegistry, IStaleWithdrawalBountyPayer} from "./interfaces/ILendingPositionRegistry.sol";

/// @notice v4 (cross-chain lending vault) only. Tracks every cross-chain
/// lending position's lifecycle state and enforces the reporting/staleness
/// rules VaultPolicy's immutable limits define. Holds NO funds of its own,
/// same "separate deployed contract, vault retains all custody" shape as
/// VaultPolicy -- deployed specifically to relieve real, measured EIP-170
/// pressure on MandateVaultDeployer (see docs/deployments.md's v4 section),
/// not a stylistic split.
///
/// Deliberately NOT wired into VaultFactory.createVault's atomic sequence,
/// same reasoning as v3's positionManager: deployed and wired AFTER the
/// vault+policy pair already exists, via MandateVault.setLendingRegistry
/// (one-shot, see that function's own doc comment for why this is a
/// one-shot lock rather than a rotatable timelock field like
/// positionManager).
///
/// @dev Known, disclosed limitation of this whole mechanism, not an
/// oversight: this contract only ever knows what its own chainKeeper for a
/// given chain last reported. Arc has no trustless way to read a
/// destination chain's real state, so currentValueUSDC below is always
/// exactly the keeper's own claim, bounded only by the deviation-per-report
/// cap and the staleness/force-unwind timers. See
/// IVaultPolicy.LendingPositionHolding's own doc comment and
/// docs/deployments.md's v4 section for the full writeup of this trust
/// boundary.
contract LendingPositionRegistry is ILendingPositionRegistry {
    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev Real "anyone can escalate" reasons, distinguished purely for
    /// event/observability clarity, mirrors AutoPaused(address,bytes32
    /// code)'s own convention. Never affects control flow: both feed the
    /// exact same single _initiateWithdrawal path (a deliberate
    /// requirement, see docs/deployments.md's v4 section: one retrieval
    /// path, two triggers).
    bytes32 public constant REASON_MANUAL_OR_EMERGENCY = "MANUAL_OR_EMERGENCY";
    bytes32 public constant REASON_STALE_TIMEOUT = "STALE_TIMEOUT";

    uint256 internal constant CHAIN_KEEPER_CHANGE_TIMELOCK = 48 hours;

    address public immutable vault;
    address public immutable policy;
    address public immutable roles;

    enum LendingPositionStatus {
        IN_TRANSIT_OUT,
        OPEN,
        WITHDRAWAL_PENDING,
        IN_TRANSIT_BACK
        // No CLOSED value tracked in storage: a closed position is
        // removed from positionIds/positions entirely (markClosed), same
        // "gone from the array, not lingering at zero" convention
        // MandateVault._removeLpPosition already uses for LP_CLOSE.
    }

    struct CrossChainPosition {
        uint256 chainId;
        LendingPositionStatus status;
        uint256 principalUSDC;
        uint256 currentValueUSDC;
        uint256 lastReportedAt;
    }

    uint256 internal nextPositionId = 1;
    uint256[] public positionIds;
    mapping(uint256 positionId => CrossChainPosition) public positions;

    /// @dev Rotatable, unlike the registry's own address on MandateVault:
    /// a compromised per-chain keeper wallet (the real Radiant-informed
    /// concern this project weighed for v4) must be replaceable without
    /// redeploying anything, same full propose/execute/cancel 48h timelock
    /// as MandateVault's positionManager, gated by GOVERNANCE_ROLE (in
    /// practice, the 2-of-3 Safe multisig confirmed for new v4 human
    /// roles -- this contract only ever checks the role, never how many
    /// signers back it, same convention as every other GOVERNANCE_ROLE
    /// check in this project).
    mapping(uint256 chainId => address) public chainKeeper;
    mapping(uint256 chainId => address) public pendingChainKeeper;
    mapping(uint256 chainId => uint256) public chainKeeperExecutableAt;

    event LendingPositionOpened(uint256 indexed positionId, uint256 indexed chainId, uint256 principalUSDC);
    event LendingPositionReported(uint256 indexed positionId, uint256 valueUSDC);
    event CrossChainWithdrawalInitiated(uint256 indexed positionId, uint256 indexed chainId, bytes32 reason);
    event LendingPositionClosed(uint256 indexed positionId);
    event StaleWithdrawalBountyCallFailed(address indexed to);
    event ChainKeeperSet(uint256 indexed chainId, address indexed keeper);
    event ChainKeeperChangeProposed(uint256 indexed chainId, address indexed keeper, uint256 executableAt);
    event ChainKeeperChangeCancelled(uint256 indexed chainId, address indexed cancelledBy);

    error NotVault(address caller);
    error NotGovernance();
    error NotPauser();
    error NotChainKeeper(address caller, uint256 chainId);
    error PositionNotFound(uint256 positionId);
    error PositionAlreadyUnwinding(uint256 positionId);
    error ReportDeviationExceeded(uint256 positionId, uint256 baseline, uint256 reported);
    error NotYetStale(uint256 positionId, uint256 lastReportedAt, uint256 threshold);
    error ChainKeeperChangeNotReady(uint256 executableAt);
    error NoPendingChainKeeperChange(uint256 chainId);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        if (!IAccessControl(roles).hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotGovernance();
        _;
    }

    modifier onlyPauser() {
        if (!IAccessControl(roles).hasRole(PAUSER_ROLE, msg.sender)) revert NotPauser();
        _;
    }

    constructor(address vault_, address policy_, address roles_) {
        vault = vault_;
        policy = policy_;
        roles = roles_;
    }

    // ---------------------------------------------------------------------
    // Vault-only: position lifecycle
    // ---------------------------------------------------------------------

    function recordNewPosition(uint256 chainId, uint256 principalUSDC) external onlyVault returns (uint256 positionId) {
        positionId = nextPositionId++;
        positions[positionId] = CrossChainPosition({
            chainId: chainId,
            status: LendingPositionStatus.IN_TRANSIT_OUT,
            principalUSDC: principalUSDC,
            // Conservative initial value: the bridge itself does not
            // create or destroy value, and no yield has accrued yet to
            // claim, see docs/deployments.md's v4 section point 2.
            currentValueUSDC: principalUSDC,
            // The clock anchor before any real report exists, see
            // IVaultPolicy.sol's lendingPositionForceUnwindSeconds doc
            // comment: a position whose first report never arrives is
            // caught by the same staleness mechanism as one that stopped
            // reporting after being confirmed open, not a gap.
            lastReportedAt: block.timestamp
        });
        positionIds.push(positionId);
        emit LendingPositionOpened(positionId, chainId, principalUSDC);
    }

    function initiateWithdrawal(uint256 positionId, bytes32 reason) external onlyVault {
        _initiateWithdrawal(positionId, reason);
    }

    function markClosed(uint256 positionId) external onlyVault {
        _requirePosition(positionId);
        uint256 len = positionIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (positionIds[i] == positionId) {
                positionIds[i] = positionIds[len - 1];
                positionIds.pop();
                break;
            }
        }
        delete positions[positionId];
        emit LendingPositionClosed(positionId);
    }

    function _initiateWithdrawal(uint256 positionId, bytes32 reason) internal {
        CrossChainPosition storage p = positions[positionId];
        _requirePosition(positionId);
        // Idempotent, not reverted: the emergency-unwind path and the
        // permissionless staleness trigger can both reach the same
        // position, and racing between them is harmless, see the
        // "one single retrieval path" requirement above.
        if (p.status == LendingPositionStatus.WITHDRAWAL_PENDING || p.status == LendingPositionStatus.IN_TRANSIT_BACK) {
            return;
        }
        p.status = LendingPositionStatus.WITHDRAWAL_PENDING;
        emit CrossChainWithdrawalInitiated(positionId, p.chainId, reason);
    }

    function _requirePosition(uint256 positionId) internal view {
        if (positions[positionId].chainId == 0) revert PositionNotFound(positionId);
    }

    // ---------------------------------------------------------------------
    // ChainKeeper-only: reporting
    // ---------------------------------------------------------------------

    /// @notice First report for a position is compared against its
    /// principalUSDC; every later report against the PREVIOUS report's
    /// value, not the original principal -- avoids needing to model an
    /// expected accrual rate onchain, same "start simple, revisit with
    /// real data" treatment as every other v3/v4 placeholder limit. See
    /// docs/deployments.md's v4 section point 4.
    function reportLendingPosition(uint256 positionId, uint256 valueUSDC) external {
        CrossChainPosition storage p = positions[positionId];
        _requirePosition(positionId);
        if (msg.sender != chainKeeper[p.chainId]) revert NotChainKeeper(msg.sender, p.chainId);
        if (p.status == LendingPositionStatus.WITHDRAWAL_PENDING || p.status == LendingPositionStatus.IN_TRANSIT_BACK) {
            revert PositionAlreadyUnwinding(positionId);
        }

        uint256 baseline = p.status == LendingPositionStatus.IN_TRANSIT_OUT ? p.principalUSDC : p.currentValueUSDC;
        if (baseline > 0) {
            uint256 diff = valueUSDC > baseline ? valueUSDC - baseline : baseline - valueUSDC;
            uint256 deviationBps = (diff * 10_000) / baseline;
            if (deviationBps > IVaultPolicy(policy).lendingReportMaxDeviationBps()) {
                revert ReportDeviationExceeded(positionId, baseline, valueUSDC);
            }
        }

        p.currentValueUSDC = valueUSDC;
        p.lastReportedAt = block.timestamp;
        if (p.status == LendingPositionStatus.IN_TRANSIT_OUT) {
            p.status = LendingPositionStatus.OPEN;
        }
        emit LendingPositionReported(positionId, valueUSDC);
    }

    // ---------------------------------------------------------------------
    // Permissionless staleness backstop
    // ---------------------------------------------------------------------

    /// @notice Mirrors VaultPolicy.checkAndAutoPause's "anyone can
    /// escalate, the contract enforces the real condition" pattern,
    /// deliberately scoped to ONE position rather than a vault-wide pause:
    /// a stale lending report corrupts that position's own valuation, not
    /// the whole vault's, so pausing everything would be disproportionate,
    /// same reasoning documented in docs/deployments.md's v4 section for
    /// why this is not simply a copy of checkAndAutoPause.
    function checkAndInitiateStaleWithdrawal(uint256 positionId) external {
        CrossChainPosition storage p = positions[positionId];
        _requirePosition(positionId);
        uint256 threshold = IVaultPolicy(policy).lendingPositionForceUnwindSeconds();
        if (block.timestamp <= p.lastReportedAt || block.timestamp - p.lastReportedAt <= threshold) {
            revert NotYetStale(positionId, p.lastReportedAt, threshold);
        }

        _initiateWithdrawal(positionId, REASON_STALE_TIMEOUT);

        // Effects (the withdrawal-initiation above) happen before this
        // interaction, same checks-effects-interactions discipline as
        // checkAndAutoPause: a failed payout must never undo the
        // withdrawal it is meant to reward.
        try IStaleWithdrawalBountyPayer(vault).payStaleWithdrawalBounty(msg.sender) {}
        catch Error(string memory) {
            emit StaleWithdrawalBountyCallFailed(msg.sender);
        } catch (bytes memory) {
            emit StaleWithdrawalBountyCallFailed(msg.sender);
        }
    }

    // ---------------------------------------------------------------------
    // Views for MandateVault
    // ---------------------------------------------------------------------

    function totalValueUSDC() external view returns (uint256 total) {
        uint256 staleAfter = IVaultPolicy(policy).lendingReportStaleAfterSeconds();
        uint256 len = positionIds.length;
        for (uint256 i = 0; i < len; i++) {
            total += _accountingValue(positions[positionIds[i]], staleAfter);
        }
    }

    function currentPositions(uint256 nav) external view returns (IVaultPolicy.LendingPositionHolding[] memory result) {
        uint256 staleAfter = IVaultPolicy(policy).lendingReportStaleAfterSeconds();
        uint256 len = positionIds.length;
        result = new IVaultPolicy.LendingPositionHolding[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 positionId = positionIds[i];
            CrossChainPosition storage p = positions[positionId];
            uint256 valueUSDC = _accountingValue(p, staleAfter);
            uint16 bps = nav == 0 ? 0 : uint16((valueUSDC * 10_000) / nav);
            result[i] = IVaultPolicy.LendingPositionHolding({
                positionId: positionId,
                chainId: p.chainId,
                status: IVaultPolicy.LendingPositionStatus(uint8(p.status)),
                currentAllocationBps: bps,
                principalUSDC: p.principalUSDC,
                currentValueUSDC: valueUSDC,
                lastReportedAt: p.lastReportedAt
            });
        }
    }

    /// @dev Shared by totalValueUSDC/currentPositions, same "one valuation
    /// function, used everywhere it's needed" convention as MandateVault's
    /// own _valuePosition. IN_TRANSIT_OUT and OPEN-but-fresh trust the
    /// stored value directly; OPEN-but-stale, WITHDRAWAL_PENDING, and
    /// IN_TRANSIT_BACK all fall back to the conservative floor
    /// (min(currentValueUSDC, principalUSDC)), see
    /// docs/deployments.md's v4 section points 2-3 for the full reasoning.
    function _accountingValue(CrossChainPosition storage p, uint256 staleAfter) internal view returns (uint256) {
        if (p.status == LendingPositionStatus.IN_TRANSIT_OUT) {
            return p.principalUSDC;
        }
        if (p.status == LendingPositionStatus.OPEN) {
            bool stale = block.timestamp > p.lastReportedAt && block.timestamp - p.lastReportedAt > staleAfter;
            if (!stale) return p.currentValueUSDC;
        }
        return p.currentValueUSDC < p.principalUSDC ? p.currentValueUSDC : p.principalUSDC;
    }

    // ---------------------------------------------------------------------
    // Governance: chainKeeper timelock
    // ---------------------------------------------------------------------

    function proposeChainKeeper(uint256 chainId, address keeper) external onlyGovernance {
        uint256 executableAt = block.timestamp + CHAIN_KEEPER_CHANGE_TIMELOCK;
        pendingChainKeeper[chainId] = keeper;
        chainKeeperExecutableAt[chainId] = executableAt;
        emit ChainKeeperChangeProposed(chainId, keeper, executableAt);
    }

    /// @notice Permissionless once the timelock elapses, same "anyone can
    /// finalize, the contract enforces the real condition" pattern as
    /// MandateVault.executeRouterAllowed/executePositionManager.
    function executeChainKeeper(uint256 chainId) external {
        uint256 executableAt = chainKeeperExecutableAt[chainId];
        if (executableAt == 0 || block.timestamp < executableAt) revert ChainKeeperChangeNotReady(executableAt);

        address keeper = pendingChainKeeper[chainId];
        chainKeeper[chainId] = keeper;
        delete chainKeeperExecutableAt[chainId];
        delete pendingChainKeeper[chainId];
        emit ChainKeeperSet(chainId, keeper);
    }

    /// @notice Gated to PAUSER_ROLE, same reasoning as MandateVault's
    /// cancelRouterAllowedChange: a different role than the GOVERNANCE_ROLE
    /// that proposes, so a briefly compromised GOVERNANCE key (or
    /// multisig) cannot push a malicious chainKeeper rotation through
    /// unopposed during the 48h window.
    function cancelChainKeeperChange(uint256 chainId) external onlyPauser {
        if (chainKeeperExecutableAt[chainId] == 0) revert NoPendingChainKeeperChange(chainId);
        delete chainKeeperExecutableAt[chainId];
        delete pendingChainKeeper[chainId];
        emit ChainKeeperChangeCancelled(chainId, msg.sender);
    }

    function positionCount() external view returns (uint256) {
        return positionIds.length;
    }
}
