// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateVault} from "./MandateVault.sol";

/// @notice A single-purpose deployer for MandateVault, split out of
/// VaultFactory purely for contract size: Solidity embeds a contract's full
/// creation bytecode into any other contract that instantiates it via `new`,
/// and VaultFactory deploying both MandateVault and VaultPolicy directly
/// pushed its own runtime bytecode past the 24576-byte EIP-170 limit
/// (25,334 bytes measured). Isolating MandateVault's creation code here
/// keeps VaultFactory itself well within the limit.
///
/// Restricted to the real, known VaultFactory only. An earlier version of
/// this contract had no restriction, reasoning that a directly-deployed
/// rogue vault would just be unregistered in VaultFactory's own
/// isMandateVault mapping. That reasoning missed a real risk: `deploy`
/// takes `factory` as a plain parameter that becomes MandateVault's
/// immutable `factory` field, so anyone could call this directly and pass
/// in the REAL VaultFactory's address, producing a vault that reports
/// `factory() == <the real, known VaultFactory>` despite never having gone
/// through it. Any future code that trusts that field directly, instead of
/// checking VaultFactory's own registry, would be fooled. Fixed at the
/// source instead of depending on nothing downstream ever checking it the
/// wrong way.
///
/// Circular-dependency note, same pattern already used for
/// MandateVault/VaultPolicy: this contract must exist before VaultFactory
/// (which takes this contract's address in its own constructor), so this
/// contract cannot take VaultFactory's address as a constructor argument
/// either. Resolved the same way: deploy this contract, deploy VaultFactory,
/// then call `setFactory` here exactly once. Nothing security-sensitive is
/// reachable in between, since `deploy` reverts for every caller until
/// `setFactory` has run.
contract MandateVaultDeployer {
    address public immutable deployer;
    address public factory;

    error NotDeployer();
    error FactoryAlreadySet();
    error NotFactory();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice Called exactly once, by whoever deployed this contract,
    /// right after VaultFactory itself is deployed.
    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert FactoryAlreadySet();
        factory = factory_;
    }

    function deploy(
        IERC20 usdc,
        address roles,
        address initialSwapRouter,
        string memory name,
        string memory symbol,
        address[] memory otherAssets
    ) external returns (address) {
        if (msg.sender != factory) revert NotFactory();
        // msg.sender is guaranteed to be the real VaultFactory by the check
        // above, so it is passed through directly as MandateVault's
        // immutable factory field, no separate parameter needed.
        return address(new MandateVault(usdc, roles, initialSwapRouter, name, symbol, otherAssets, msg.sender));
    }
}
