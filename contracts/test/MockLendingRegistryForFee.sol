// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only stand-in for LendingPositionRegistry, used to isolate
/// MandateVault's performance-fee accrual logic (test/MandateVault.t.sol)
/// from real cross-chain lending/CCTP mechanics: freely sets the reported
/// value MandateVault._valueLendingPositions() reads, simulating yield (an
/// increase) or a loss (a decrease) with a single call, no real position
/// lifecycle needed. Not part of the real protocol.
contract MockLendingRegistryForFee {
    uint256 public totalValueUSDC;

    function setTotalValueUSDC(uint256 value) external {
        totalValueUSDC = value;
    }
}
