// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generic swap interface any allowlisted router must implement.
/// MandateVault never interprets `routerData`; it is opaque, router-specific
/// calldata (a Uniswap-V3-style path, a Curve pool index pair, etc). The real
/// router address/ABI on Arc Testnet is not verified yet, see
/// docs/arc-facts-to-verify.md. This interface exists so the swap mechanism
/// can be built and tested now against a mock, and wired to a real router
/// later without touching MandateVault's own code.
interface ISwapRouter {
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes calldata routerData
    ) external returns (uint256 amountOut);
}
