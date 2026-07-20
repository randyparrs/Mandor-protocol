// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice A real, deployed (not a Hardhat/Foundry-only mock) ERC-20,
/// created purely as team-owned test infrastructure for v3's Paper Vault
/// and test environment, so it has real, varied liquidity to reason about
/// beyond the two thin real pools currently on Arc Testnet (WUSDC/cirBTC,
/// EURC/cirBTC). Never presented as a real market opportunity, see the
/// deploy script's own doc comment and the deployment log this project
/// keeps in docs/deployments.md.
///
/// Mint is gated to a single admin address (OpenZeppelin's Ownable, an
/// audited primitive, not reinvented), never open to anyone, matching
/// Randy's explicit ask, unlike the fully-open-mint MockERC20.sol this
/// repo already has for local Hardhat/Foundry tests only (never deployed
/// for real). Deliberately NOT gated through the project's real,
/// production MandateRoles registry: that would require the deploying
/// address to already hold ADMIN_ROLE there, which only the real project
/// admin key holds (behind Hardhat's encrypted keystore), reintroducing
/// exactly the manual-signing dependency this test-infrastructure
/// deployment is meant to avoid. The dedicated deployer address (its own
/// fresh key, see scripts/deployTestTokens.ts) is the owner/admin of
/// these tokens only, with zero role or authority anywhere else in this
/// project (no vault role, no governance role, nothing).
contract TestToken is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address admin_) ERC20(name_, symbol_) Ownable(admin_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
