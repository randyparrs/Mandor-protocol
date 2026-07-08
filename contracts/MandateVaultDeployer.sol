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
/// keeps VaultFactory itself well within the limit. No access control here
/// on purpose: VaultFactory is the only intended caller, and this contract
/// holds no funds and no state between calls, so an arbitrary caller
/// deploying a MandateVault directly (bypassing VaultFactory) would just
/// get an unregistered, unseeded, policy-less vault that VaultFactory's own
/// isMandateVault registry would never recognize.
contract MandateVaultDeployer {
    function deploy(
        IERC20 usdc,
        address roles,
        address initialSwapRouter,
        string memory name,
        string memory symbol,
        address[] memory otherAssets,
        address factory
    ) external returns (address) {
        return address(new MandateVault(usdc, roles, initialSwapRouter, name, symbol, otherAssets, factory));
    }
}
