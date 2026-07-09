// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Phase 2 stub: a single ADMIN-settable maximum totalAssets
/// value applied uniformly to every vault, so "new vaults start with low
/// capital limits" (docs/threat-model.md, "Capital limits and progressive
/// trust") is a real, enforced property from day one, not just a documented
/// plan waiting on Phase 4's reputation-based progressive scoring. The vault
/// parameter is kept in the interface now so Phase 4 can move to a genuinely
/// per-vault value later without changing MandateVault.sol's call site.
interface ICapitalLimitRegistry {
    function maxTotalAssets(address vault) external view returns (uint256);
}
