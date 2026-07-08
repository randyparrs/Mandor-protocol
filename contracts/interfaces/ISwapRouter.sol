// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The standard Uniswap V3 SwapRouter interface, adopted directly
/// rather than a generic invented one, because a real, verified,
/// standard-Uniswap-V3-compatible router genuinely exists on Arc Testnet:
/// "UnitFlowV3Router" by ACTFUN (a token launchpad), at
/// 0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01. This is third-party
/// infrastructure, NOT the official Uniswap Labs deployment announced as an
/// Arc ecosystem partner, that one still has no publicly documented
/// address. Verified independently against Arcscan's own API: the source
/// compiles under solc 0.7.6, the file paths and imports
/// (contracts/periphery/UnitFlowV3Router.sol, ISwapRouter,
/// PeripheryImmutableState, PeripheryValidation) match the standard
/// Uniswap V3 periphery structure, and the exactInputSingle function's ABI
/// matches ISwapRouter.ExactInputSingleParams exactly. Only WETH9() being
/// renamed WUSDC() differs from the canonical interface (Arc's native gas
/// token is USDC, not ETH). See docs/arc-facts-to-verify.md.
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    function factory() external view returns (address);
}
