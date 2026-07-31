// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy} from "./interfaces/IVaultPolicy.sol";
import {ILpPositionRegistry, IMandateVaultLpPricing} from "./interfaces/ILpPositionRegistry.sol";
import {INonfungiblePositionManager, IUniswapV3PoolMinimal} from "./interfaces/INonfungiblePositionManager.sol";
import {LiquidityAmounts} from "./lib/LiquidityAmounts.sol";

/// @notice v7 (LP yield vault, WUSDC/EURC) only. Owns the entire
/// Uniswap-V3-style LP mechanism -- position NFT custody, mint/increase/
/// decrease/collect/close, TWAP-guarded valuation, the positionManager 48h
/// timelock -- previously all inline on contracts/MandateVault.sol (v3).
/// Split out into its own deployed contract for the exact same reason
/// LendingPositionRegistry was split out of the shared vault for v4: real,
/// measured EIP-170 pressure. Unlike v6 (which simply has no LP mechanism
/// at all, see contracts/MandateVaultLending.sol), v7 genuinely needs LP --
/// dropping it was never an option -- so the fix here is extraction, the
/// exact "full LpPositionRegistry extraction, deliberately deferred to a
/// dedicated future session (v7+)" work flagged during the v6 session, not
/// a smaller variant.
///
/// @dev Real, disclosed difference from LendingPositionRegistry: that
/// contract never touches funds, only bookkeeping (the real value transfer
/// happens on the vault itself, via CCTP). This one genuinely must hold
/// funds, if only transiently within a single transaction: Uniswap's own
/// positionManager.mint()/increaseLiquidity() require a real recipient to
/// receive the resulting NFT/leftover tokens, and this registry is that
/// recipient (implements IERC721Receiver, holds every position it manages).
/// The custody sequence for LP_OPEN/LP_INCREASE is: (1) the vault transfers
/// exactly leg.amount0Desired/amount1Desired of the pool's real tokens to
/// this registry via a plain ERC-20 transfer, (2) this registry approves
/// positionManager and calls mint/increaseLiquidity, (3) this registry
/// refunds any unused leftover back to the vault, (4) this registry returns
/// the REAL amounts consumed so the vault can debit its own ledger by
/// exactly that, never the Desired amount. All of this happens inside ONE
/// external call from the vault (MandateVaultLp._lpOpen/_lpIncrease), so
/// standard EVM atomicity applies throughout: if positionManager.mint()
/// reverts for any reason, every state change already made in this same
/// transaction -- including the vault's initial token transfer into this
/// registry -- is rolled back automatically, with nothing partially
/// applied and nothing left stranded here without a backing NFT position,
/// not even for one block. See test/LpPositionRegistry.t.sol's dedicated
/// revert-safety test for a concrete proof of this, not just the
/// theoretical EVM guarantee.
contract LpPositionRegistry is ILpPositionRegistry, IERC721Receiver {
    using SafeERC20 for IERC20;

    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address public immutable vault;
    address public immutable policy;
    address public immutable roles;

    /// @dev The UnitFlowV3PositionManager-equivalent this registry mints/
    /// manages LP positions through. address(0) until GOVERNANCE proposes
    /// and executes a real one (same propose/execute/cancel 48h timelock
    /// contracts/MandateVault.sol's own positionManager already used,
    /// moved here unchanged).
    address public positionManager;
    uint256 internal constant POSITION_MANAGER_CHANGE_TIMELOCK = 48 hours;
    uint256 public pendingPositionManagerExecutableAt;
    address public pendingPositionManager;

    /// @dev Same reasoning as contracts/MandateVault.sol's own
    /// LP_VALUATION_TWAP_SECONDS: long enough that sustaining a manipulated
    /// price across the whole window costs meaningfully more than a
    /// single-block flash swap, short enough to still reflect real, current
    /// market conditions.
    uint32 internal constant LP_VALUATION_TWAP_SECONDS = 1800;

    uint256[] public lpPositionIds;
    mapping(uint256 tokenId => bool) internal _isHeldLpPosition;
    mapping(uint256 tokenId => address) public lpPositionPool;
    mapping(uint256 tokenId => uint256) public lpPositionOpenValueUSDC;
    mapping(uint256 tokenId => uint256) public lpOutOfRangeSince;
    mapping(uint256 tokenId => uint128) public lpPoolLiquidityAtOpen;

    event PositionManagerSet(address indexed positionManager);
    event PositionManagerChangeProposed(address indexed positionManager, uint256 executableAt);
    event PositionManagerChangeCancelled(address indexed cancelledBy);
    event LpPositionOpened(uint256 indexed tokenId, address indexed pool, uint256 openValueUSDC);
    event LpPositionIncreased(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpPositionDecreased(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpFeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpPositionClosed(uint256 indexed tokenId);

    error NotVault(address caller);
    error NotGovernance();
    error NotPauser();
    error PositionManagerNotSet();
    error PositionManagerChangeNotReady(uint256 executableAt);
    error NoPendingPositionManagerChange();
    error MintPriceOutOfRange(int24 currentTick, int24 tickLower, int24 tickUpper);
    error LpPositionNotHeld(uint256 tokenId);
    error UnsupportedLpToken(address token);
    error UnregisteredAsset(address asset);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        if (!IAccessControl(roles).hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotGovernance();
        _;
    }

    modifier onlyPauser() {
        if (!IAccessControl(roles).hasRole(PAUSER_ROLE, msg.sender)) revert NotPauser();
        _;
    }

    constructor(address vault_, address policy_, address roles_) {
        vault = vault_;
        policy = policy_;
        roles = roles_;
    }

    // ---------------------------------------------------------------------
    // Vault-only: position lifecycle
    // ---------------------------------------------------------------------

    function openPosition(LpLeg calldata leg, address token0, address token1)
        external
        onlyVault
        returns (uint256 tokenId, uint256 amount0Used, uint256 amount1Used)
    {
        if (positionManager == address(0)) revert PositionManagerNotSet();
        if (!IMandateVaultLpPricing(vault).isRegisteredAsset(token0)) revert UnregisteredAsset(token0);
        if (!IMandateVaultLpPricing(vault).isRegisteredAsset(token1)) revert UnregisteredAsset(token1);

        IERC20(token0).forceApprove(positionManager, leg.amount0Desired);
        IERC20(token1).forceApprove(positionManager, leg.amount1Desired);

        (tokenId,, amount0Used, amount1Used) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: leg.fee,
                tickLower: leg.tickLower,
                tickUpper: leg.tickUpper,
                amount0Desired: leg.amount0Desired,
                amount1Desired: leg.amount1Desired,
                amount0Min: leg.amount0Min,
                amount1Min: leg.amount1Min,
                recipient: address(this),
                deadline: leg.deadline
            })
        );

        IERC20(token0).forceApprove(positionManager, 0);
        IERC20(token1).forceApprove(positionManager, 0);
        _refundLeftover(token0, token1, leg.amount0Desired - amount0Used, leg.amount1Desired - amount1Used);

        // The real, immediate "is this actually earning fees right now"
        // check, mirroring the original inline version exactly. The
        // range-WIDTH check (minLpTickRangeWidth) stays in VaultPolicy,
        // since it only needs decision.tickLower/tickUpper, no live pool
        // read.
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(leg.pool).slot0();
        if (currentTick < leg.tickLower || currentTick >= leg.tickUpper) {
            revert MintPriceOutOfRange(currentTick, leg.tickLower, leg.tickUpper);
        }

        uint256 openValueUSDC = _valueInUSDC(token0, amount0Used) + _valueInUSDC(token1, amount1Used);

        lpPositionIds.push(tokenId);
        _isHeldLpPosition[tokenId] = true;
        lpPositionPool[tokenId] = leg.pool;
        lpPositionOpenValueUSDC[tokenId] = openValueUSDC;
        lpPoolLiquidityAtOpen[tokenId] = IUniswapV3PoolMinimal(leg.pool).liquidity();

        emit LpPositionOpened(tokenId, leg.pool, openValueUSDC);
    }

    function increasePosition(LpLeg calldata leg, address token0, address token1)
        external
        onlyVault
        returns (uint256 amount0Used, uint256 amount1Used)
    {
        _requireHeldPosition(leg.tokenId);

        IERC20(token0).forceApprove(positionManager, leg.amount0Desired);
        IERC20(token1).forceApprove(positionManager, leg.amount1Desired);

        (, amount0Used, amount1Used) = INonfungiblePositionManager(positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: leg.tokenId,
                amount0Desired: leg.amount0Desired,
                amount1Desired: leg.amount1Desired,
                amount0Min: leg.amount0Min,
                amount1Min: leg.amount1Min,
                deadline: leg.deadline
            })
        );

        IERC20(token0).forceApprove(positionManager, 0);
        IERC20(token1).forceApprove(positionManager, 0);
        _refundLeftover(token0, token1, leg.amount0Desired - amount0Used, leg.amount1Desired - amount1Used);

        // New capital added to an existing position grows its own basis,
        // same "value-drawdown-since-basis" reasoning as LP_OPEN.
        lpPositionOpenValueUSDC[leg.tokenId] += _valueInUSDC(token0, amount0Used) + _valueInUSDC(token1, amount1Used);

        emit LpPositionIncreased(leg.tokenId, amount0Used, amount1Used);
    }

    function decreasePosition(LpLeg calldata leg) external onlyVault returns (uint256 amount0, uint256 amount1, address token0, address token1) {
        _requireHeldPosition(leg.tokenId);
        uint128 liquidityBefore;
        (,, token0, token1,,,, liquidityBefore,,,,) = INonfungiblePositionManager(positionManager).positions(leg.tokenId);

        _decreaseLiquidity(leg.tokenId, leg.liquidity, leg.amount0Min, leg.amount1Min, leg.deadline);
        (amount0, amount1) = _collectAllToVault(leg.tokenId, token0, token1);

        if (liquidityBefore > 0) {
            lpPositionOpenValueUSDC[leg.tokenId] =
                (lpPositionOpenValueUSDC[leg.tokenId] * (liquidityBefore - leg.liquidity)) / liquidityBefore;
        }

        emit LpPositionDecreased(leg.tokenId, amount0, amount1);
    }

    function collectFees(LpLeg calldata leg) external onlyVault returns (uint256 amount0, uint256 amount1, address token0, address token1) {
        _requireHeldPosition(leg.tokenId);
        (,, token0, token1,,,,,,,,) = INonfungiblePositionManager(positionManager).positions(leg.tokenId);
        // Pure fee income, principal/basis unchanged.
        (amount0, amount1) = _collectAllToVault(leg.tokenId, token0, token1);
        emit LpFeesCollected(leg.tokenId, amount0, amount1);
    }

    function closePosition(LpLeg calldata leg) external onlyVault returns (uint256 amount0, uint256 amount1, address token0, address token1) {
        _requireHeldPosition(leg.tokenId);
        uint128 liquidity;
        (,, token0, token1,,,, liquidity,,,,) = INonfungiblePositionManager(positionManager).positions(leg.tokenId);

        if (liquidity > 0) {
            _decreaseLiquidity(leg.tokenId, liquidity, leg.amount0Min, leg.amount1Min, leg.deadline);
        }
        (amount0, amount1) = _collectAllToVault(leg.tokenId, token0, token1);
        INonfungiblePositionManager(positionManager).burn(leg.tokenId);

        _removeLpPosition(leg.tokenId);

        emit LpPositionClosed(leg.tokenId);
    }

    function tokensOf(uint256 tokenId) external view returns (address token0, address token1) {
        _requireHeldPosition(tokenId);
        (,, token0, token1,,,,,,,,) = INonfungiblePositionManager(positionManager).positions(tokenId);
    }

    /// @dev Refunds whatever the vault pushed but positionManager didn't
    /// actually consume, back to the vault, in the same call -- so the
    /// vault's own ledger debit (by the real amountUsed this function's
    /// caller returns) always matches its net token balance change
    /// exactly. A no-op transfer of 0 is deliberately skipped (cheaper, and
    /// SafeERC20 already tolerates 0-value transfers regardless).
    function _refundLeftover(address token0, address token1, uint256 leftover0, uint256 leftover1) internal {
        if (leftover0 > 0) IERC20(token0).safeTransfer(vault, leftover0);
        if (leftover1 > 0) IERC20(token1).safeTransfer(vault, leftover1);
    }

    function _requireHeldPosition(uint256 tokenId) internal view {
        if (!_isHeldLpPosition[tokenId]) revert LpPositionNotHeld(tokenId);
    }

    /// @dev Shared by decreasePosition/closePosition: decreaseLiquidity
    /// only credits tokensOwed, it never itself moves tokens, same real
    /// Uniswap V3 two-step mechanic every integrator follows, see
    /// _collectAllToVault below.
    function _decreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) internal {
        INonfungiblePositionManager(positionManager).decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            })
        );
    }

    /// @dev Shared by decreasePosition/collectFees/closePosition: always
    /// sweeps everything currently owed on the position (principal just
    /// decreased, if any, plus any accrued fees), and unlike the original
    /// inline version (which credited the vault's own _ledger directly),
    /// this one physically transfers the collected tokens back to the
    /// vault -- this registry, not the vault, is positionManager.collect's
    /// real recipient, so the tokens land here first and must be forwarded.
    function _collectAllToVault(uint256 tokenId, address token0, address token1) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        if (amount0 > 0) IERC20(token0).safeTransfer(vault, amount0);
        if (amount1 > 0) IERC20(token1).safeTransfer(vault, amount1);
    }

    function _removeLpPosition(uint256 tokenId) internal {
        uint256 len = lpPositionIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (lpPositionIds[i] == tokenId) {
                lpPositionIds[i] = lpPositionIds[len - 1];
                lpPositionIds.pop();
                break;
            }
        }
        _isHeldLpPosition[tokenId] = false;
        delete lpPositionPool[tokenId];
        delete lpPositionOpenValueUSDC[tokenId];
        delete lpOutOfRangeSince[tokenId];
        delete lpPoolLiquidityAtOpen[tokenId];
    }

    /// @notice Required so this registry can receive an LP position NFT
    /// from positionManager.mint's recipient callback. Accepts
    /// unconditionally from the configured positionManager only, matching
    /// how every other external call in this contract trusts only its own
    /// governance-configured, allowlisted counterparty.
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (msg.sender != positionManager) revert UnsupportedLpToken(msg.sender);
        return IERC721Receiver.onERC721Received.selector;
    }

    // ---------------------------------------------------------------------
    // Views for MandateVaultLp
    // ---------------------------------------------------------------------

    function totalValueUSDC() external view returns (uint256 total) {
        uint256 len = lpPositionIds.length;
        for (uint256 i = 0; i < len; i++) {
            (uint256 valueUSDC,,,) = _valuePosition(lpPositionIds[i]);
            total += valueUSDC;
        }
    }

    function currentPositions(uint256 nav) external view returns (IVaultPolicy.LpPositionHolding[] memory result) {
        uint256 len = lpPositionIds.length;
        result = new IVaultPolicy.LpPositionHolding[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = lpPositionIds[i];
            (uint256 valueUSDC, address pool, bool inRange, uint128 currentPoolLiquidity) = _valuePosition(tokenId);

            uint256 outOfRangeSince = lpOutOfRangeSince[tokenId];
            if (!inRange && outOfRangeSince == 0) {
                // Not persisted here (this is a view function): the real
                // persistence happens in syncOutOfRangeTracking, called
                // from the vault's executeDecision before _buildState runs.
                outOfRangeSince = block.timestamp;
            } else if (inRange) {
                outOfRangeSince = 0;
            }

            uint16 bps = nav == 0 ? 0 : uint16((valueUSDC * 10_000) / nav);
            result[i] = IVaultPolicy.LpPositionHolding({
                tokenId: tokenId,
                pool: pool,
                currentAllocationBps: bps,
                openValueUSDC: lpPositionOpenValueUSDC[tokenId],
                currentValueUSDC: valueUSDC,
                inRange: inRange,
                outOfRangeSince: outOfRangeSince,
                poolLiquidityAtOpen: lpPoolLiquidityAtOpen[tokenId],
                currentPoolLiquidity: currentPoolLiquidity
            });
        }
    }

    /// @dev Shared per-position valuation, same math as
    /// contracts/MandateVault.sol's own _valuePosition, moved here
    /// unchanged: reads the position's real, current liquidity/range from
    /// positionManager.positions(), computes real token0/token1 amounts via
    /// LiquidityAmounts.getAmountsForLiquidityFromTwap against a TWAP price
    /// (not the live slot0() spot price, see _tickCumulativeDelta below),
    /// adds already-accrued uncollected fees, then prices both sides via
    /// _valueInUSDC (this registry's own copy of the vault's pricing
    /// formula, reading the vault's public price cache, see
    /// IMandateVaultLpPricing).
    function _valuePosition(uint256 tokenId)
        internal
        view
        returns (uint256 valueUSDC, address pool, bool inRange, uint128 currentPoolLiquidity)
    {
        pool = lpPositionPool[tokenId];
        (,, address token0, address token1,, int24 tickLower, int24 tickUpper, uint128 liquidity,,, uint128 tokensOwed0, uint128 tokensOwed1) =
            INonfungiblePositionManager(positionManager).positions(tokenId);

        // Live tick, deliberately still used here (NOT the TWAP): inRange
        // and currentPoolLiquidity are real-time risk-monitoring signals,
        // a lagged average would make them economically confusing, not
        // safer. Only the dollar VALUATION below uses the TWAP.
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        currentPoolLiquidity = IUniswapV3PoolMinimal(pool).liquidity();
        inRange = currentTick >= tickLower && currentTick < tickUpper;

        (uint256 amount0, uint256 amount1) =
            LiquidityAmounts.getAmountsForLiquidityFromTwap(_tickCumulativeDelta(pool), LP_VALUATION_TWAP_SECONDS, tickLower, tickUpper, liquidity);

        valueUSDC = _valueInUSDC(token0, amount0 + tokensOwed0) + _valueInUSDC(token1, amount1 + tokensOwed1);
    }

    /// @dev Manipulation-resistant time-weighted average price over
    /// LP_VALUATION_TWAP_SECONDS, moved here unchanged from
    /// contracts/MandateVault.sol's own _tickCumulativeDelta. Deliberately
    /// reverts (does not silently fall back to spot) if the pool lacks
    /// enough historical observations for the requested window.
    function _tickCumulativeDelta(address pool) internal view returns (int56) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = LP_VALUATION_TWAP_SECONDS;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IUniswapV3PoolMinimal(pool).observe(secondsAgos);
        return tickCumulatives[1] - tickCumulatives[0];
    }

    /// @dev This registry's own copy of the vault's exact _valueInUSDC
    /// formula, reading the vault's public price cache rather than
    /// maintaining a second, separately-updated one -- the vault remains
    /// the single source of truth for lastKnownPriceUSDC/assetDecimals,
    /// this registry only ever reads it.
    function _valueInUSDC(address a, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 price = IMandateVaultLpPricing(vault).lastKnownPriceUSDC(a);
        if (price == 0) return 0;
        return (amount * price) / (10 ** IMandateVaultLpPricing(vault).assetDecimals(a));
    }

    function syncOutOfRangeTracking() external onlyVault {
        uint256 len = lpPositionIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = lpPositionIds[i];
            (,, bool inRange,) = _valuePosition(tokenId);
            if (!inRange && lpOutOfRangeSince[tokenId] == 0) {
                lpOutOfRangeSince[tokenId] = block.timestamp;
            } else if (inRange && lpOutOfRangeSince[tokenId] != 0) {
                lpOutOfRangeSince[tokenId] = 0;
            }
        }
    }

    function positionCount() external view returns (uint256) {
        return lpPositionIds.length;
    }

    // ---------------------------------------------------------------------
    // Governance: positionManager timelock
    // ---------------------------------------------------------------------

    /// @notice Step 1 of 2 for changing the LP position manager. Same
    /// self-contained 48h timelock as contracts/MandateVault.sol's own
    /// version, moved here unchanged: a malicious position manager could
    /// redirect NFT custody or misreport position state, a fund-safety-
    /// relevant address change.
    function proposePositionManager(address newPositionManager) external onlyGovernance {
        uint256 executableAt = block.timestamp + POSITION_MANAGER_CHANGE_TIMELOCK;
        pendingPositionManager = newPositionManager;
        pendingPositionManagerExecutableAt = executableAt;
        emit PositionManagerChangeProposed(newPositionManager, executableAt);
    }

    /// @notice Step 2 of 2. Permissionless once the timelock has elapsed,
    /// same "anyone can finalize, the contract enforces the real condition"
    /// pattern as LendingPositionRegistry.executeChainKeeper.
    function executePositionManager() external {
        uint256 executableAt = pendingPositionManagerExecutableAt;
        if (executableAt == 0 || block.timestamp < executableAt) revert PositionManagerChangeNotReady(executableAt);

        positionManager = pendingPositionManager;
        delete pendingPositionManagerExecutableAt;
        delete pendingPositionManager;
        emit PositionManagerSet(positionManager);
    }

    /// @notice Gated to PAUSER_ROLE, a different role than the
    /// GOVERNANCE_ROLE that proposes, so a briefly compromised GOVERNANCE
    /// key (or multisig) cannot push a malicious positionManager rotation
    /// through unopposed during the 48h window.
    function cancelPositionManagerChange() external onlyPauser {
        if (pendingPositionManagerExecutableAt == 0) revert NoPendingPositionManagerChange();
        delete pendingPositionManagerExecutableAt;
        delete pendingPositionManager;
        emit PositionManagerChangeCancelled(msg.sender);
    }
}
