// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The one function MandateVault's fee-accrual logic needs from its
/// own factory: the shared, governance-settable protocolTreasury address
/// (mutable on VaultFactory itself, see its own setTreasury), read live at
/// accrual time rather than cached as a separate MandateVault immutable, so
/// a future treasury rotation (VaultFactory.setProtocolTreasury) is picked
/// up automatically, not frozen at this vault's own deploy time.
interface IVaultFactory {
    function protocolTreasury() external view returns (address);
}
