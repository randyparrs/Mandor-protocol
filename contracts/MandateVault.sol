// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy, IAutoPausePayer} from "./interfaces/IVaultPolicy.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @notice The ERC-4626 vault that actually custodies funds. Deposits/mints
/// are gated by VaultPolicy's pause state; withdrawals/redeems never are,
/// same discipline P2PMarket.sol already proved (pause blocks new exposure
/// only, never exits). Claude never touches this contract directly: the
/// keeper calls executeDecision with a Decision that must already have
/// passed VaultPolicy's deterministic gate, checked twice (before and after
/// the actual swap), never once.
contract MandateVault is ERC4626, IAutoPausePayer, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    address public immutable factory;
    address public immutable roles;
    /// @dev One-shot, set by the factory right after construction, see
    /// docs/architecture.md "circular dependency, resolved with a sequenced
    /// deploy": VaultPolicy's constructor needs this vault's address, so
    /// this vault must exist first, and cannot take policy as a constructor
    /// argument.
    address public policy;

    /// @dev Every registered asset's accounted balance. This is the single
    /// source of truth for totalAssets(), never a live balanceOf read,
    /// because Arc's native USDC and its ERC-20 interface share one balance
    /// (verified live, see docs/architecture.md "USDC donation attack"),
    /// and the same donation risk applies to any ERC-20 the vault holds,
    /// not just USDC. The one deliberate exception is sweepDust below.
    mapping(address asset => uint256 accounted) internal _ledger;
    mapping(address asset => uint8) public assetDecimals;
    mapping(address asset => bool) public isRegisteredAsset;
    address[] public registeredAssets;
    /// @dev USDC value (18-decimal) of one whole unit of the asset, cached
    /// only from prices that already passed VaultPolicy's own staleness and
    /// deviation checks inside executeDecision. A stale or deviated price
    /// can never enter this cache since the whole transaction reverts
    /// before the cache is updated.
    mapping(address asset => uint256 priceUSDC) public lastKnownPriceUSDC;

    mapping(address router => bool allowed) public allowedRouters;
    /// @dev Reserved hook only, unused until a future CapitalLimitRegistry
    /// exists. Left at address(0) means uncapped.
    address public capitalLimitRegistry;

    /// @dev Deliberately mutable, unlike everything in VaultPolicy: this is
    /// an economic incentive to keep checkAndAutoPause's permissionless
    /// path real, not a risk limit, so it needs to track gas costs and
    /// USDC value context over time. GOVERNANCE-adjustable (in practice,
    /// behind the same 48h timelock convention documented in
    /// docs/architecture.md for anything fund-safety-relevant), never
    /// touched by VaultPolicy, which only ever triggers the callback.
    uint256 public autoPauseBountyAmount;

    uint256 public tradesToday;
    uint256 public tradeDayStart;
    uint256 public highWaterMarkUSDC;

    uint8 private constant DECIMALS_OFFSET = 3;

    /// @dev Mirrors ISwapRouter.ExactInputSingleParams directly (fee,
    /// sqrtPriceLimitX96 included) rather than an opaque bytes blob, since
    /// the real router this targets (UnitFlowV3Router on Arc Testnet, see
    /// ISwapRouter.sol) is a verified, standard Uniswap V3 fork with a known
    /// ABI, not a hypothetical one anymore.
    struct SwapLeg {
        address router;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        uint160 sqrtPriceLimitX96;
    }

    event PolicySet(address indexed policy);
    event DecisionExecuted(IVaultPolicy.DecisionAction indexed action, address indexed asset, uint256 amount);
    event SwapExecuted(address indexed router, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event RouterAllowedSet(address indexed router, bool allowed);
    event CapitalLimitRegistrySet(address indexed registry);
    event DustSwept(address indexed asset, address indexed to, uint256 amount);
    event AutoPauseBountyAmountSet(uint256 amount);
    event AutoPauseBountyPaid(address indexed to, uint256 amount);

    error PolicyAlreadySet();
    error NotFactory();
    error NotKeeper();
    error NotGovernance();
    error NotPolicy();
    error PolicyNotSet();
    error DecisionRejected(bytes32[] codes);
    error RouterNotAllowed(address router);
    error InsufficientSwapOutput(uint256 amountOut, uint256 minAmountOut);
    error UnregisteredAsset(address asset);
    error NoDust();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyKeeper() {
        if (!IAccessControl(roles).hasRole(KEEPER_ROLE, msg.sender)) revert NotKeeper();
        _;
    }

    modifier onlyGovernance() {
        if (!IAccessControl(roles).hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotGovernance();
        _;
    }

    constructor(
        IERC20 usdc_,
        address roles_,
        address initialSwapRouter_,
        string memory name_,
        string memory symbol_,
        address[] memory otherAssets_,
        address factory_
    ) ERC4626(usdc_) ERC20(name_, symbol_) {
        // Deliberately an explicit argument, not msg.sender: this contract
        // is deployed via MandateVaultDeployer (split out purely for
        // contract size, see MandateVaultDeployer.sol), so msg.sender here
        // would be the deployer helper, not the real VaultFactory that must
        // be authorized to call setPolicy below.
        factory = factory_;
        roles = roles_;
        // Defaults to 0 (no bounty, checkAndAutoPause callers get paid
        // nothing) until GOVERNANCE explicitly sets a real value via
        // setAutoPauseBountyAmount, same pattern as capitalLimitRegistry
        // defaulting to address(0) until governance opts in.

        _registerAsset(address(usdc_));
        for (uint256 i = 0; i < otherAssets_.length; i++) {
            _registerAsset(otherAssets_[i]);
        }
        if (initialSwapRouter_ != address(0)) {
            allowedRouters[initialSwapRouter_] = true;
            emit RouterAllowedSet(initialSwapRouter_, true);
        }
        tradeDayStart = block.timestamp;
    }

    /// @dev Called exactly once by the factory, right after this vault and
    /// its policy are both deployed. maxDeposit/maxMint return 0 while this
    /// is unset, so nothing (not even the seed deposit) can happen before
    /// wiring is complete.
    function setPolicy(address policy_) external onlyFactory {
        if (policy != address(0)) revert PolicyAlreadySet();
        policy = policy_;
        emit PolicySet(policy_);
    }

    // ---------------------------------------------------------------------
    // ERC-4626 overrides
    // ---------------------------------------------------------------------

    function _decimalsOffset() internal pure override returns (uint8) {
        return DECIMALS_OFFSET;
    }

    /// @dev Never a live balanceOf read, see _ledger's doc comment above.
    function totalAssets() public view override returns (uint256) {
        uint256 total = _ledger[asset()];
        for (uint256 i = 0; i < registeredAssets.length; i++) {
            address a = registeredAssets[i];
            if (a == asset()) continue;
            total += _valueInUSDC(a, _ledger[a]);
        }
        return total;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (policy == address(0) || IVaultPolicy(policy).paused()) return 0;
        return _capByRegistry(super.maxDeposit(address(0)));
    }

    function maxMint(address) public view override returns (uint256) {
        if (policy == address(0) || IVaultPolicy(policy).paused()) return 0;
        return super.maxMint(address(0));
    }

    /// @dev Withdrawals are never gated by pause, same rule VaultPolicy
    /// itself follows. Capped by the vault's actual liquid USDC ledger, not
    /// just the owner's shares, so an over-redemption (e.g. most of NAV is
    /// deployed into EURC/cirBTC) reverts cleanly via OZ's own error instead
    /// of an ugly low-level transfer failure. This is the bank-run liquidity
    /// cap noted as an open item in docs/threat-model.md.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 ownerMax = super.maxWithdraw(owner);
        uint256 liquid = _ledger[asset()];
        return ownerMax < liquid ? ownerMax : liquid;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 ownerMax = super.maxRedeem(owner);
        uint256 liquidShares = previewWithdraw(_ledger[asset()]);
        return ownerMax < liquidShares ? ownerMax : liquidShares;
    }

    function _transferIn(address from, uint256 assets) internal override {
        super._transferIn(from, assets);
        _ledger[asset()] += assets;
        _updateHighWaterMark();
    }

    function _transferOut(address to, uint256 assets) internal override {
        _ledger[asset()] -= assets;
        super._transferOut(to, assets);
    }

    function _capByRegistry(uint256 max) internal view returns (uint256) {
        if (capitalLimitRegistry == address(0)) return max;
        // Reserved hook: a future CapitalLimitRegistry would be consulted
        // here. Left as a pass-through until that contract exists.
        return max;
    }

    // ---------------------------------------------------------------------
    // Decision execution
    // ---------------------------------------------------------------------

    /// @notice The only way Claude's proposals ever touch this vault. The
    /// keeper supplies the Decision itself and fresh prices; this contract
    /// builds VaultState from its own ledger, it is never handed one, so a
    /// buggy or compromised keeper cannot fabricate a compliant-looking
    /// state for a non-compliant real trade. Validated once before the
    /// swap (cheap early gate) and once after (the real gate, since a
    /// real router's output cannot be perfectly predicted) - if the actual
    /// resulting state violates policy, the whole transaction, swaps
    /// included, reverts.
    function executeDecision(
        IVaultPolicy.Decision calldata decision,
        IVaultPolicy.AssetPrice[] calldata prices,
        SwapLeg[] calldata swaps
    ) external onlyKeeper nonReentrant returns (bool) {
        if (policy == address(0)) revert PolicyNotSet();

        IVaultPolicy.VaultState memory preState = _buildState(prices);
        (bool prePassed, bytes32[] memory preCodes) = IVaultPolicy(policy).validateDecision(decision, preState);
        if (!prePassed) revert DecisionRejected(preCodes);

        // Prices just passed staleness/deviation checks, safe to cache now.
        for (uint256 i = 0; i < prices.length; i++) {
            lastKnownPriceUSDC[prices[i].asset] = prices[i].price;
        }

        for (uint256 i = 0; i < swaps.length; i++) {
            _executeSwapLeg(swaps[i]);
        }

        if (decision.action != IVaultPolicy.DecisionAction.HOLD) {
            _incrementTradesToday();
        }
        _updateHighWaterMark();

        IVaultPolicy.VaultState memory postState = _buildState(prices);
        (bool postPassed, bytes32[] memory postCodes) = IVaultPolicy(policy).validateDecision(decision, postState);
        if (!postPassed) revert DecisionRejected(postCodes);

        emit DecisionExecuted(decision.action, decision.asset, decision.amount);
        return true;
    }

    function _executeSwapLeg(SwapLeg calldata leg) internal {
        if (!allowedRouters[leg.router]) revert RouterNotAllowed(leg.router);
        if (!isRegisteredAsset[leg.tokenIn] || !isRegisteredAsset[leg.tokenOut]) revert UnregisteredAsset(leg.tokenIn);

        IERC20(leg.tokenIn).forceApprove(leg.router, leg.amountIn);
        uint256 amountOut = ISwapRouter(leg.router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: leg.tokenIn,
                tokenOut: leg.tokenOut,
                fee: leg.fee,
                recipient: address(this),
                deadline: leg.deadline,
                amountIn: leg.amountIn,
                amountOutMinimum: leg.minAmountOut,
                sqrtPriceLimitX96: leg.sqrtPriceLimitX96
            })
        );
        IERC20(leg.tokenIn).forceApprove(leg.router, 0);

        if (amountOut < leg.minAmountOut) revert InsufficientSwapOutput(amountOut, leg.minAmountOut);

        // Trusted boundary: the router is allowlisted by GOVERNANCE, so its
        // returned amountOut is trusted directly, never re-derived from a
        // live balanceOf read (that would reintroduce the same donation
        // risk the ledger exists to close).
        _ledger[leg.tokenIn] -= leg.amountIn;
        _ledger[leg.tokenOut] += amountOut;

        emit SwapExecuted(leg.router, leg.tokenIn, leg.tokenOut, leg.amountIn, amountOut);
    }

    function _buildState(IVaultPolicy.AssetPrice[] calldata prices)
        internal
        view
        returns (IVaultPolicy.VaultState memory)
    {
        uint256 nav = totalAssets();
        IVaultPolicy.AssetHolding[] memory holdings = new IVaultPolicy.AssetHolding[](registeredAssets.length);
        for (uint256 i = 0; i < registeredAssets.length; i++) {
            address a = registeredAssets[i];
            uint256 valueUSDC = a == asset() ? _ledger[a] : _valueInUSDC(a, _ledger[a]);
            uint16 bps = nav == 0 ? 0 : uint16((valueUSDC * 10_000) / nav);
            holdings[i] = IVaultPolicy.AssetHolding({asset: a, currentAllocationBps: bps});
        }

        uint16 drawdownBps = _currentDrawdownBps();
        return IVaultPolicy.VaultState({
            currentDrawdownBps: drawdownBps,
            // Not used by validateDecision's own checks (only by
            // checkAndAutoPause's speed check, called directly on
            // VaultPolicy by an off-chain watcher, not through this
            // contract), left equal to the current value as a harmless
            // placeholder rather than a fabricated number.
            drawdownBpsAtWindowStart: drawdownBps,
            tradesToday: tradesToday,
            currentHoldings: holdings,
            prices: prices
        });
    }

    function _valueInUSDC(address a, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 price = lastKnownPriceUSDC[a];
        if (price == 0) return 0;
        return (amount * price) / (10 ** assetDecimals[a]);
    }

    function _currentDrawdownBps() internal view returns (uint16) {
        uint256 nav = totalAssets();
        if (highWaterMarkUSDC == 0 || nav >= highWaterMarkUSDC) return 0;
        return uint16(((highWaterMarkUSDC - nav) * 10_000) / highWaterMarkUSDC);
    }

    function _updateHighWaterMark() internal {
        uint256 nav = totalAssets();
        if (nav > highWaterMarkUSDC) {
            highWaterMarkUSDC = nav;
        }
    }

    function _incrementTradesToday() internal {
        if (block.timestamp >= tradeDayStart + 1 days) {
            tradeDayStart = block.timestamp;
            tradesToday = 0;
        }
        tradesToday += 1;
    }

    // ---------------------------------------------------------------------
    // Auto-pause bounty payout
    // ---------------------------------------------------------------------

    /// @notice The only function VaultPolicy's checkAndAutoPause calls back
    /// into. Restricted to the configured policy address. This contract
    /// decides the amount itself (autoPauseBountyAmount, mutable, see its
    /// declaration above) rather than trusting a caller-supplied figure,
    /// so it can never be tricked into paying more than its own current
    /// configured amount even in principle. Pays nothing (a silent no-op,
    /// not a revert) if the current amount is 0, so an operator who hasn't
    /// opted into a bounty yet doesn't turn every auto-pause into a failed
    /// call. Guarded by nonReentrant since, unlike VaultPolicy (which holds
    /// no funds), this function actually moves them.
    function payAutoPauseBounty(address to) external nonReentrant {
        if (msg.sender != policy) revert NotPolicy();
        uint256 amount = autoPauseBountyAmount;
        if (amount == 0) return;

        _ledger[asset()] -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit AutoPauseBountyPaid(to, amount);
    }

    // ---------------------------------------------------------------------
    // Governance
    // ---------------------------------------------------------------------

    function setRouterAllowed(address router, bool allowed) external onlyGovernance {
        allowedRouters[router] = allowed;
        emit RouterAllowedSet(router, allowed);
    }

    function setCapitalLimitRegistry(address registry) external onlyGovernance {
        capitalLimitRegistry = registry;
        emit CapitalLimitRegistrySet(registry);
    }

    /// @notice The bounty is an economic incentive, not a risk limit, so
    /// unlike everything in VaultPolicy it is deliberately adjustable, to
    /// track gas costs and USDC value context over time. No hard cap
    /// enforced in code; GOVERNANCE is expected to keep it small relative
    /// to the loss a timely pause prevents, and in practice this action
    /// should go through the same 48h-timelock convention documented in
    /// docs/architecture.md for fund-safety-relevant parameters.
    function setAutoPauseBountyAmount(uint256 amount) external onlyGovernance {
        autoPauseBountyAmount = amount;
        emit AutoPauseBountyAmountSet(amount);
    }

    /// @notice The one place this contract ever reads a live balanceOf. Can
    /// only ever move the unaccounted excess above the ledger, never
    /// ledgered funds, so it is safe despite reading a live balance.
    function sweepDust(address asset_, address to) external onlyGovernance nonReentrant {
        uint256 live = IERC20(asset_).balanceOf(address(this));
        uint256 accounted = _ledger[asset_];
        if (live <= accounted) revert NoDust();
        uint256 dust = live - accounted;
        IERC20(asset_).safeTransfer(to, dust);
        emit DustSwept(asset_, to, dust);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function ledgerOf(address asset_) external view returns (uint256) {
        return _ledger[asset_];
    }

    function currentDrawdownBps() external view returns (uint16) {
        return _currentDrawdownBps();
    }

    function _registerAsset(address a) internal {
        isRegisteredAsset[a] = true;
        registeredAssets.push(a);
        assetDecimals[a] = _tryReadDecimals(a);
    }

    function _tryReadDecimals(address a) internal view returns (uint8) {
        (bool ok, bytes memory data) = a.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (ok && data.length >= 32) {
            return abi.decode(data, (uint8));
        }
        return 18;
    }
}
