// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "./TickMath.sol";

/// @title Liquidity amount functions
/// @notice Provides functions for computing liquidity amounts from token amounts and prices
/// @dev Ported from Uniswap V3 periphery (GPL-2.0-or-later). The original relies on a vendored
/// `FullMath.mulDiv` (512-bit-precision full multiply-then-divide); here it's replaced with
/// OpenZeppelin's `Math.mulDiv` (from `contracts/utils/math/Math.sol`, already a real dependency
/// of this project, audited), doing the exact same 512-bit-intermediate computation, rather than
/// vendoring a second, redundant copy of the same primitive.
library LiquidityAmounts {
    uint8 internal constant RESOLUTION = 96;
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    function toUint128(uint256 x) private pure returns (uint128 y) {
        require((y = uint128(x)) == x, "LiquidityAmounts: overflow");
    }

    /// @notice Computes the amount of liquidity received for a given amount of token0 and price range
    function getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount0) public pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        uint256 intermediate = Math.mulDiv(sqrtRatioAX96, sqrtRatioBX96, Q96);
        return toUint128(Math.mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96));
    }

    /// @notice Computes the amount of liquidity received for a given amount of token1 and price range
    function getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount1) public pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        return toUint128(Math.mulDiv(amount1, Q96, sqrtRatioBX96 - sqrtRatioAX96));
    }

    /// @notice Computes the maximum amount of liquidity received for given amounts of token0 and token1, the
    /// current pool price, and the prices at the tick boundaries
    function getLiquidityForAmounts(uint160 sqrtRatioX96, uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount0, uint256 amount1)
        public
        pure
        returns (uint128 liquidity)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            uint128 liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
            uint128 liquidity1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
        }
    }

    /// @notice Computes the amount of token0 for a given amount of liquidity and a price range
    function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) public pure returns (uint256 amount0) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        return Math.mulDiv(uint256(liquidity) << RESOLUTION, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96) / sqrtRatioAX96;
    }

    /// @notice Computes the amount of token1 for a given amount of liquidity and a price range
    function getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) public pure returns (uint256 amount1) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        return Math.mulDiv(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96);
    }

    /// @notice Computes the token0 and token1 value for a given amount of liquidity, the current
    /// pool price, and the prices at the tick boundaries. This is the function this project's
    /// `MandateVault._valueLpPositions()` calls to derive a held position's real, current
    /// underlying composition (never a cached or agent-reported figure), same math every real
    /// Uniswap V3 integrator uses.
    function getAmountsForLiquidity(uint160 sqrtRatioX96, uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        public
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
        } else {
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        }
    }

    /// @notice Combines a Uniswap V3 pool's raw observe() output (a real
    /// TWAP read, not the live spot price) with getAmountsForLiquidity in
    /// one external call, purely to cut MandateVault.sol's own inlined
    /// bytecode (real EIP-170 contract-size pressure this whole LP
    /// mechanism already needed via_ir + externalized libraries for, see
    /// foundry.toml's own comment): bundling the avg-tick arithmetic AND
    /// both TickMath.getSqrtRatioAtTick calls AND getAmountsForLiquidity
    /// into a single already-linked external library call saves more than
    /// the avg-tick arithmetic alone would (measured: extracting only the
    /// tiny arithmetic actually cost more bytecode than it saved, this
    /// bundles enough real work per call to net-save instead). Rounding
    /// mirrors Uniswap's own reference OracleLibrary.consult exactly
    /// (round toward negative infinity, not toward zero), not a novel
    /// approximation. See MandateVault._valuePosition's own doc comment
    /// for why the TWAP (not the live tick) is used here specifically.
    function getAmountsForLiquidityFromTwap(
        int56 tickCumulativeDelta,
        uint32 windowSeconds,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) public pure returns (uint256 amount0, uint256 amount1) {
        int24 avgTick = int24(tickCumulativeDelta / int56(uint56(windowSeconds)));
        if (tickCumulativeDelta < 0 && tickCumulativeDelta % int56(uint56(windowSeconds)) != 0) {
            avgTick--;
        }
        return getAmountsForLiquidity(
            TickMath.getSqrtRatioAtTick(avgTick), TickMath.getSqrtRatioAtTick(tickLower), TickMath.getSqrtRatioAtTick(tickUpper), liquidity
        );
    }
}
