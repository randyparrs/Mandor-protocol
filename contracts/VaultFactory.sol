// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MandateVault} from "./MandateVault.sol";
import {MandateVaultDeployer} from "./MandateVaultDeployer.sol";
import {VaultPolicy} from "./VaultPolicy.sol";

/// @notice Deploys Vault+Policy pairs. Every vault created this way gets the
/// protocol-owned seed deposit atomically, in the same transaction that
/// creates it, so there is never a near-zero-shares window to attack.
/// Curator-only per the launch strategy: only ADMIN_ROLE can create a vault,
/// there is no public vault creation path (Agent Studio was cut from the
/// roadmap entirely, see docs/architecture.md).
contract VaultFactory {
    using SafeERC20 for IERC20;

    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public immutable roles;
    /// @dev Split out purely for contract size, see MandateVaultDeployer.sol.
    MandateVaultDeployer public immutable vaultDeployer;
    address public protocolTreasury;

    address[] public allVaults;
    mapping(address vault => bool exists) public isMandateVault;

    event VaultCreated(address indexed vault, address indexed policy, address indexed creator, uint256 seedAmount);
    event ProtocolTreasurySet(address indexed treasury);

    error NotAdmin();
    error ZeroSeedAmount();
    error ZeroTreasury();

    modifier onlyAdmin() {
        if (!IAccessControl(roles).hasRole(ADMIN_ROLE, msg.sender)) revert NotAdmin();
        _;
    }

    constructor(address roles_, address protocolTreasury_, MandateVaultDeployer vaultDeployer_) {
        roles = roles_;
        protocolTreasury = protocolTreasury_;
        vaultDeployer = vaultDeployer_;
    }

    struct CreateVaultParams {
        IERC20 usdc;
        address initialSwapRouter;
        string name;
        string symbol;
        address[] otherAssets;
        VaultPolicy.ConstructorLimits limits; // vault/roles fields are overwritten by this function
        uint256 seedAmount;
    }

    /// @notice Deploys MandateVault, then its paired VaultPolicy (which
    /// needs the real vault address in its constructor), wires them
    /// together with one-shot setPolicy, and seeds the vault atomically.
    /// Nothing can happen to the vault before this whole sequence
    /// completes, since maxDeposit/maxMint return 0 while policy is unset.
    function createVault(CreateVaultParams memory params) external onlyAdmin returns (address vault, address policy) {
        if (params.seedAmount == 0) revert ZeroSeedAmount();
        if (protocolTreasury == address(0)) revert ZeroTreasury();

        MandateVault v = MandateVault(
            vaultDeployer.deploy(
                params.usdc, roles, params.initialSwapRouter, params.name, params.symbol, params.otherAssets, address(this)
            )
        );

        params.limits.vault = address(v);
        params.limits.roles = roles;
        VaultPolicy p = new VaultPolicy(params.limits);

        v.setPolicy(address(p));

        params.usdc.safeTransferFrom(msg.sender, address(this), params.seedAmount);
        params.usdc.forceApprove(address(v), params.seedAmount);
        v.deposit(params.seedAmount, protocolTreasury);

        allVaults.push(address(v));
        isMandateVault[address(v)] = true;

        emit VaultCreated(address(v), address(p), msg.sender, params.seedAmount);
        return (address(v), address(p));
    }

    function setProtocolTreasury(address treasury) external onlyAdmin {
        protocolTreasury = treasury;
        emit ProtocolTreasurySet(treasury);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
