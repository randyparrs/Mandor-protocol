// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAutoPausePayer} from "../interfaces/IVaultPolicy.sol";

/// @notice Test-only stand-in for MandateVault, used to verify VaultPolicy's
/// checkAndAutoPause behaves correctly whether the bounty payout succeeds or
/// reverts. Not part of the real protocol.
contract MockVault is IAutoPausePayer {
    bool public shouldRevertPayout;
    address public lastPaidTo;
    uint256 public payoutCallCount;

    function setShouldRevertPayout(bool value) external {
        shouldRevertPayout = value;
    }

    function payAutoPauseBounty(address to) external {
        payoutCallCount++;
        if (shouldRevertPayout) {
            revert("payout intentionally failed");
        }
        lastPaidTo = to;
    }
}
