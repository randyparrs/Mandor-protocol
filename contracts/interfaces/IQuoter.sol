// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The real UnitFlowV3 Quoter's interface, at
/// 0x121aeB6DEf00F6F67665008CaC1C19805886ed1a, verified directly against
/// its own verified source on Arcscan, not assumed from a generic Uniswap
/// V3 template. Classic Uniswap V3 Quoter V1 shape:
/// quoteExactInputSingle takes flat parameters (not a params struct, unlike
/// ISwapRouter.sol's V2-style ExactInputSingleParams), and is declared
/// non-view (no `view` modifier) because it internally calls the real
/// pool's swap() inside a try/catch and decodes the resulting amount out of
/// the revert reason (the standard Uniswap V3 Quoter gas-optimization
/// trick), never actually committing a state change. Still callable via a
/// plain eth_call (viem's readContract, never writeContract/
/// simulateContract) to get a real, current quote at zero cost, confirmed
/// live: quoting 1 WUSDC into cirBTC on the real deployed Quoter returned a
/// real, non-reverting amountOut.
interface IQuoter {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);
}
