// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";

/// @notice Test-only stand-in for a real on-chain DEX router (Uniswap-V3 or
/// Curve style, address/ABI not yet verified on Arc Testnet, see
/// docs/arc-facts-to-verify.md). Configurable exchange rate and failure
/// modes, mirroring MockVault.sol's existing pattern. Not part of the real
/// protocol.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    /// @dev rateBps: how many units of tokenOut per unit of tokenIn,
    /// expressed in basis points of a 1:1 rate (10_000 = 1:1).
    uint256 public rateBps = 10_000;
    bool public shouldRevert;
    bool public shouldShortOutput;

    function setRateBps(uint256 value) external {
        rateBps = value;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setShouldShortOutput(bool value) external {
        shouldShortOutput = value;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256, bytes calldata)
        external
        override
        returns (uint256 amountOut)
    {
        if (shouldRevert) revert("mock router: swap failed");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // rateBps is a VALUE ratio (10_000 = 1:1 by value), not a raw unit
        // ratio, so this adjusts for tokenIn/tokenOut having different
        // decimals (e.g. 18-decimal USDC swapped for 6-decimal EURC).
        uint8 decimalsIn = IERC20Metadata(tokenIn).decimals();
        uint8 decimalsOut = IERC20Metadata(tokenOut).decimals();
        amountOut = (amountIn * rateBps) / 10_000;
        if (decimalsOut > decimalsIn) {
            amountOut = amountOut * (10 ** (decimalsOut - decimalsIn));
        } else if (decimalsIn > decimalsOut) {
            amountOut = amountOut / (10 ** (decimalsIn - decimalsOut));
        }
        if (shouldShortOutput) {
            amountOut = minAmountOut > 0 ? minAmountOut - 1 : 0;
        }

        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        return amountOut;
    }

    /// @dev Test helper: the mock needs to already hold tokenOut liquidity
    /// to pay out swaps, unlike a real pool that sources it from reserves.
    function seedLiquidity(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
