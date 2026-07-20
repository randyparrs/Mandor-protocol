// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stores arbitrary bytes as its own deployed runtime bytecode,
/// readable back via EXTCODECOPY/EXTCODESIZE, never executed as logic (the
/// standard "SSTORE2-for-bytecode" pattern). Used by MandateVaultDeployer to
/// hold MandateVault's full creation bytecode as inert data, so it can be
/// read back and CREATE2'd into a real, independent MandateVault instance
/// WITHOUT Solidity's `new MandateVault(...)` embedding that creation code
/// directly into MandateVaultDeployer's own compiled bytecode -- the real,
/// measured EIP-170 problem this exists to solve (see
/// MandateVaultDeployer.sol's own top-of-file comment for the numbers that
/// made this necessary).
///
/// @dev Deliberately tiny and single-purpose: this contract's OWN creation
/// code is what actually gets embedded via `new BytecodePointer(...)`, and
/// it costs a fixed, negligible amount regardless of how much data it is
/// given to store, since that data arrives as a runtime constructor
/// argument (calldata), never as compiled-in Solidity source. Inert by
/// design: nobody ever calls into a deployed instance expecting logic to
/// execute, its only purpose is to exist as a byte string readable via
/// EXTCODECOPY.
contract BytecodePointer {
    constructor(bytes memory data) {
        assembly {
            return(add(data, 0x20), mload(data))
        }
    }
}
