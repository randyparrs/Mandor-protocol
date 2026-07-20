// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {BytecodePointer} from "./BytecodePointer.sol";

/// @notice A single-purpose deployer for MandateVault, split out of
/// VaultFactory purely for contract size (see that reasoning preserved
/// below), and REWRITTEN 2026-07-16 to stop embedding MandateVault's
/// creation bytecode in Solidity source at all.
///
/// Why the rewrite was necessary, not optional: v4's cross-chain lending
/// additions to MandateVault.sol grew IVaultPolicy's shared Decision/
/// VaultState structs and MandateVault's own dispatch logic enough that
/// `new MandateVault(...)` here pushed this contract's own runtime to
/// 27,905 bytes measured, 3,329 bytes over the EIP-170 24,576-byte limit
/// -- not a few bytes over, a gap no amount of the same trimming
/// techniques that kept v3 under budget could close without cutting
/// already-agreed v4 functionality (the reportLendingPosition deviation
/// check, the intentionally-separate stale-withdrawal bounty). See
/// docs/deployments.md's v4 section for the full numbers and reasoning.
///
/// The fix: this contract no longer imports MandateVault.sol or
/// references its type anywhere. Its full creation bytecode (already
/// linked against the real, deployed TickMath/LiquidityAmounts libraries,
/// see scripts/deployVaultFactoryForV4.ts) is supplied as a CONSTRUCTOR
/// ARGUMENT (bytes memory, runtime calldata) and stored via
/// BytecodePointer as inert, EXTCODECOPY-readable data -- since EIP-170
/// only limits DEPLOYED runtime code size, never constructor-argument
/// calldata size, moving the bytecode from "compiled into this contract's
/// source" to "supplied at construction time" sidesteps the limit
/// entirely rather than working around it. deploy() reads it back and
/// CREATE2s a real, fully independent MandateVault instance -- NOT a
/// delegatecall proxy (deliberately ruled out: this project wants every
/// vault to be a genuinely separate, immutable contract, matching
/// "materially different setup means a new deployment, never mutate a
/// live one", not a shared implementation with proxy/storage-collision
/// risk). See test/MandateVaultDeployerBytecode.t.sol for the dedicated
/// proof that this produces byte-identical, correctly-functioning
/// MandateVault instances, not just "it compiles."
///
/// FRAGMENTED across multiple BytecodePointer instances, discovered live
/// as necessary, not a stylistic choice: BytecodePointer's own deployed
/// size equals exactly the data it is given to store, so a single
/// instance is bound by the SAME EIP-170 24,576-byte limit this whole
/// mechanism exists to route around for MandateVault -- and MandateVault's
/// real creation code (26,576 bytes) is itself over that limit. Confirmed
/// live via `cast run` on a real reverted Arc Testnet transaction
/// (`[CreateContractSizeLimit]`, not a gas problem, see
/// docs/deployments.md's v4 section for the full diagnostic trail this
/// project verified before accepting fragmentation as the only real path
/// forward). This is also a well-documented, known constraint of the
/// SSTORE2 pattern in general (confirmed against 0xsequence/sstore2's own
/// reference implementation), not an Arc-specific or novel limitation.
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

    /// @dev A safe, round margin under EIP-170's hard 24,576-byte limit,
    /// not the exact boundary -- BytecodePointer's own deployed size
    /// equals its data length exactly, so each fragment must individually
    /// respect the same limit MandateVault itself is bound by. Chosen
    /// once, here; the off-chain deploy script's chunking is agnostic to
    /// this exact value beyond respecting it (see chunkBytecode() in
    /// scripts/deployVaultFactoryForV4.ts).
    uint256 internal constant MAX_FRAGMENT_SIZE = 24_000;

    /// @dev Holds MandateVault's full, already-linked creation bytecode,
    /// split across as many fragments as needed (never hardcoded to a
    /// fixed count: MandateVault's real size today needs exactly 2, but
    /// this array grows or shrinks with whatever the real compiled size
    /// requires in any future version, same "don't hardcode an assumption
    /// that today's size happens to satisfy" discipline already applied to
    /// v4's Decision/VaultState struct growth, see docs/deployments.md).
    /// Fragment i lives at index i; concatenation order is array order,
    /// guaranteed at every layer: the off-chain script slices sequentially,
    /// the constructor array argument cannot be reordered by the ABI, and
    /// the constructor loop below pushes in the same order it iterates.
    /// Set once at construction from constructor arguments the real deploy
    /// script supplies -- read directly from
    /// forge-out/MandateVault.sol/MandateVault.json, linked against the
    /// real, already-deployed TickMath/LiquidityAmounts addresses, then
    /// chunked -- NEVER via Solidity's own type(MandateVault).creationCode,
    /// which would just reintroduce the exact embedding problem this whole
    /// mechanism exists to avoid, one level removed. This contract does
    /// not import MandateVault.sol at all, by construction, so there is no
    /// alternate source for this value to silently fall back to -- see
    /// test/MandateVaultDeployerBytecode.t.sol's marker-substitution test,
    /// which proves this is a standing guarantee, not just a comment.
    address[] public mandateVaultCodePointers;

    /// @dev CREATE2 salt source. An incrementing counter rather than a
    /// fixed value or a hash of constructor args: guarantees a distinct
    /// deployment address every call regardless of whether two vaults
    /// ever end up with byte-identical constructor arguments (unlikely in
    /// practice, but this removes the possibility of a collision revert
    /// entirely rather than relying on argument diversity).
    uint256 public deployCount;

    error NotDeployer();
    error FactoryAlreadySet();
    error NotFactory();
    error FragmentTooLarge(uint256 index, uint256 size);

    constructor(bytes[] memory mandateVaultCreationCodeFragments) {
        deployer = msg.sender;
        for (uint256 i = 0; i < mandateVaultCreationCodeFragments.length; i++) {
            bytes memory fragment = mandateVaultCreationCodeFragments[i];
            if (fragment.length > MAX_FRAGMENT_SIZE) revert FragmentTooLarge(i, fragment.length);
            mandateVaultCodePointers.push(address(new BytecodePointer(fragment)));
        }
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
        address[] memory otherAssets,
        address cctpTokenMessenger
    ) external returns (address) {
        if (msg.sender != factory) revert NotFactory();

        bytes memory creationCode = _readAllFragments();
        // msg.sender is guaranteed to be the real VaultFactory by the check
        // above, so it is passed through directly as MandateVault's
        // immutable factory field, no separate parameter needed -- same
        // reasoning as the original `new MandateVault(...)` call this
        // replaces. abi.encodePacked(creationCode, abi.encode(args)) is
        // exactly what Solidity's own `new X(args)` produces under the
        // hood (creation code followed by ABI-encoded constructor
        // arguments, no selector), reproduced manually here so the
        // resulting deployment is byte-for-byte what the old direct `new`
        // call would have produced, see the dedicated test proving this.
        bytes memory payload = abi.encodePacked(
            creationCode,
            abi.encode(usdc, roles, initialSwapRouter, name, symbol, otherAssets, msg.sender, cctpTokenMessenger)
        );
        return Create2.deploy(0, bytes32(deployCount++), payload);
    }

    /// @dev Standard EXTCODECOPY read-back, mirrors BytecodePointer's own
    /// write side exactly.
    function _readPointerCode(address pointer) internal view returns (bytes memory code) {
        uint256 size;
        assembly {
            size := extcodesize(pointer)
        }
        code = new bytes(size);
        assembly {
            extcodecopy(pointer, add(code, 0x20), 0, size)
        }
    }

    /// @dev Reconstructs the full MandateVault creation code by reading
    /// every fragment back, in array order, and concatenating -- order is
    /// never re-derived or assumed here, it is simply array iteration
    /// order, already guaranteed correct by construction (see
    /// mandateVaultCodePointers' own doc comment for the full chain of
    /// guarantees).
    function _readAllFragments() internal view returns (bytes memory code) {
        uint256 len = mandateVaultCodePointers.length;
        for (uint256 i = 0; i < len; i++) {
            code = bytes.concat(code, _readPointerCode(mandateVaultCodePointers[i]));
        }
    }

    /// @notice Convenience view: the full, reconstructed MandateVault
    /// creation code, for off-chain scripts/tests to independently verify
    /// against vm.getCode(...) or the compiled artifact directly, without
    /// needing to loop over mandateVaultCodePointers themselves.
    function mandateVaultCreationCode() external view returns (bytes memory) {
        return _readAllFragments();
    }

    function fragmentCount() external view returns (uint256) {
        return mandateVaultCodePointers.length;
    }
}
