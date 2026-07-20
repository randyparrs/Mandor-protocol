// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICCTPTokenMessenger} from "../interfaces/ICCTPTokenMessenger.sol";

/// @notice Test-only stand-in implementing the exact same real interface as
/// the verified CCTP V2 TokenMessengerV2 on Arc Testnet (see
/// ICCTPTokenMessenger.sol), so unit/fork tests exercise the exact call
/// shape MandateVault._bridgeDeposit uses, only the messenger address
/// differs between mock and real.
///
/// Deliberately does NOT move any real tokens (no transferFrom on
/// burnToken): the real depositForBurn call, real parameter construction,
/// and real on-chain effect were already independently verified against the
/// real TokenMessengerV2 (scripts/verifyCctpBridgeDepositOnArcTestnet.ts and
/// test/MandateVaultArcFork.t.sol's own real-call trace, see
/// docs/deployments.md's v4 CCTP section). This mock exists only to let a
/// fork test exercise MandateVault.executeDecision(BRIDGE_DEPOSIT)'s own
/// atomicity (role check, ledger debit, LendingPositionRegistry position
/// creation, all in one transaction) against real native USDC and a real
/// vault, without a second real transferFrom on Arc's native-USDC proxy --
/// which depends on Arc-specific precompiles Foundry's fork EVM cannot
/// execute, confirmed during this test's own development (see
/// test/MandateVaultArcFork.t.sol's own doc comments on this exact point).
/// Not part of the real protocol.
contract MockCCTPTokenMessenger is ICCTPTokenMessenger {
    struct RecordedCall {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
        address caller;
    }

    RecordedCall public lastCall;
    uint256 public callCount;

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external override {
        lastCall = RecordedCall({
            amount: amount,
            destinationDomain: destinationDomain,
            mintRecipient: mintRecipient,
            burnToken: burnToken,
            destinationCaller: destinationCaller,
            maxFee: maxFee,
            minFinalityThreshold: minFinalityThreshold,
            caller: msg.sender
        });
        callCount++;
    }
}
