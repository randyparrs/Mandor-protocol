// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";

/// @notice Test-only stand-in implementing the same real interface as the
/// verified UnitFlowV3Router on Arc Testnet (see ISwapRouter.sol), so unit
/// tests exercise the exact call shape MandateVault uses against the real
/// router, only the router address differs between mock and real. Not part
/// of the real protocol.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    /// @dev rateBps: how many units of tokenOut per unit of tokenIn,
    /// expressed in basis points of a 1:1 rate (10_000 = 1:1).
    uint256 public rateBps = 10_000;
    bool public shouldRevert;
    bool public shouldShortOutput;
    address public immutable mockFactory;

    constructor() {
        mockFactory = address(this);
    }

    function setRateBps(uint256 value) external {
        rateBps = value;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setShouldShortOutput(bool value) external {
        shouldShortOutput = value;
    }

    function factory() external view override returns (address) {
        return mockFactory;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable override returns (uint256 amountOut) {
        if (shouldRevert) revert("mock router: swap failed");

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // rateBps is a VALUE ratio (10_000 = 1:1 by value), not a raw unit
        // ratio, so this adjusts for tokenIn/tokenOut having different
        // decimals (e.g. 18-decimal USDC swapped for 6-decimal EURC).
        uint8 decimalsIn = IERC20Metadata(params.tokenIn).decimals();
        uint8 decimalsOut = IERC20Metadata(params.tokenOut).decimals();
        amountOut = (params.amountIn * rateBps) / 10_000;
        if (decimalsOut > decimalsIn) {
            amountOut = amountOut * (10 ** (decimalsOut - decimalsIn));
        } else if (decimalsIn > decimalsOut) {
            amountOut = amountOut / (10 ** (decimalsIn - decimalsOut));
        }
        if (shouldShortOutput) {
            amountOut = params.amountOutMinimum > 0 ? params.amountOutMinimum - 1 : 0;
        }

        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        return amountOut;
    }

    /// @dev Test helper: the mock needs to already hold tokenOut liquidity
    /// to pay out swaps, unlike a real pool that sources it from reserves.
    function seedLiquidity(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
