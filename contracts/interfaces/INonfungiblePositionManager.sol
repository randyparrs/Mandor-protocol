// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice The real, verified interface of UnitFlowV3PositionManager
/// (`0x0553682bc188b850acd31CBd3500Dcd0aa35372B` on Arc Testnet, see
/// docs/arc-facts-to-verify.md for the live verification: real ERC-721
/// position custody, standard mint/increaseLiquidity/decreaseLiquidity/
/// collect/burn/positions, confirmed against Arcscan's verified source,
/// exact standard Uniswap V3 periphery shape). This project's v3 vault
/// custodies an LP position by holding this NFT directly (implements
/// `onERC721Received`), the same way a real Uniswap V3 LP wallet does.
interface INonfungiblePositionManager is IERC721 {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);

    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function burn(uint256 tokenId) external payable;

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function factory() external view returns (address);
}

/// @notice Minimal read-only interface for a UnitFlowV3 pool: current
/// price/tick and total pool liquidity (for the pool-liquidity-drop
/// check, `MandateVault._valueLpPositions()`'s `inRange`/`currentPoolLiquidity`
/// reads), plus `observe()` (the standard Uniswap V3 TWAP oracle read,
/// used by `MandateVault._twapSqrtPriceX96` for manipulation-resistant LP
/// position valuation, see that function's own doc comment). Never used
/// for anything beyond reading, same as `IQuoter.sol`'s own scope.
interface IUniswapV3PoolMinimal {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function liquidity() external view returns (uint128);

    function token0() external view returns (address);

    function token1() external view returns (address);

    /// @notice Standard Uniswap V3 TWAP read: cumulative tick values at
    /// each requested `secondsAgo` offset, from which the average tick
    /// over any window between two offsets can be derived. Reverts if the
    /// pool lacks enough historical observations for the requested window
    /// (default-initialized pools only store 1, see
    /// `increaseObservationCardinalityNext`), by design, see
    /// `MandateVault._twapSqrtPriceX96`.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}
