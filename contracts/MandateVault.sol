// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IVaultPolicy, IAutoPausePayer} from "./interfaces/IVaultPolicy.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {ICapitalLimitRegistry} from "./interfaces/ICapitalLimitRegistry.sol";
import {INonfungiblePositionManager, IUniswapV3PoolMinimal} from "./interfaces/INonfungiblePositionManager.sol";
import {ILendingPositionRegistry, IStaleWithdrawalBountyPayer} from "./interfaces/ILendingPositionRegistry.sol";
import {ICCTPTokenMessenger} from "./interfaces/ICCTPTokenMessenger.sol";
import {TickMath} from "./lib/TickMath.sol";
import {LiquidityAmounts} from "./lib/LiquidityAmounts.sol";

/// @notice SHARED ACROSS EVERY DEPLOYED VERSION (v1 through v5): this is a
/// single source file, not one file per version. Each version (v1
/// USDC-only, v2 USDC+cirBTC, v3 LP yield, v4 cross-chain lending, v5
/// ergodic rebalancing) is a separate DEPLOYED INSTANCE of this exact same
/// contract, distinguished by its own constructor parameters (risk limits:
/// maxDrawdownBps, maxAllocationBpsPerAsset, etc.) and which VaultFactory
/// generation created it (Gen1 for v1/v2, Gen2 for v3, Gen3 for v4, Gen4
/// for v5, see contracts/VaultFactory.sol and VaultPolicy.sol's own
/// matching note), never a separate contract per version. Newer versions'
/// fields (LP position tracking for v3, cross-chain lending for v4) are
/// simply unused/zeroed for older versions' real deployed instances, not a
/// sign anything is missing. See docs/deployments.md for the full, real
/// address/transaction history of every version, and legacy/README.md for
/// why v1/v2 specifically are discontinued.
///
/// @notice The ERC-4626 vault that actually custodies funds. Deposits/mints
/// are gated by VaultPolicy's pause state; withdrawals/redeems never are,
/// same discipline P2PMarket.sol already proved (pause blocks new exposure
/// only, never exits). The AI agent never touches this contract directly: the
/// keeper calls executeDecision with a Decision that must already have
/// passed VaultPolicy's deterministic gate, checked twice (before and after
/// the actual swap), never once.
contract MandateVault is ERC4626, IAutoPausePayer, IStaleWithdrawalBountyPayer, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

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
    /// @dev Consulted by maxDeposit via _capByRegistry, see
    /// contracts/CapitalLimitRegistry.sol. Left at address(0) means
    /// uncapped, but VaultFactory.createVault always wires this at creation
    /// time, so an uncapped vault should never occur in practice.
    address public capitalLimitRegistry;

    /// @dev Self-contained timelock for router allowlist changes only, see
    /// proposeRouterAllowed/executeRouterAllowed. A malicious router could
    /// redirect swap proceeds to an attacker, so this one governance action
    /// is code-enforced rather than left to the "GOVERNANCE_ROLE is held by
    /// a real TimelockController" convention documented in
    /// docs/architecture.md for everything else.
    uint256 internal constant ROUTER_CHANGE_TIMELOCK = 48 hours;
    mapping(address router => uint256 executableAt) public routerChangeExecutableAt;
    mapping(address router => bool pendingAllowed) public pendingRouterChange;

    /// @dev sweepDust moves real, unaccounted-excess funds (not just a
    /// config flag like the router allowlist), so unlike a bare instant
    /// sweep, it goes through the same propose/execute/cancel shape as
    /// router allowlist changes: someone who accidentally sends a large
    /// transfer directly to the vault (bypassing deposit()) still counts as
    /// "dust" under this definition, and deserves a real window to notice
    /// and ask for it back before GOVERNANCE can move it, not an instant,
    /// no-recourse sweep. See proposeSweepDust/executeSweepDust below.
    uint256 internal constant SWEEP_DUST_TIMELOCK = 48 hours;
    struct PendingSweep {
        address to;
        uint256 amount;
        uint256 executableAt;
    }
    mapping(address asset => PendingSweep) public pendingSweep;

    /// @dev Deliberately mutable, unlike everything in VaultPolicy: this is
    /// an economic incentive to keep checkAndAutoPause's permissionless
    /// path real, not a risk limit, so it needs to track gas costs and
    /// USDC value context over time. GOVERNANCE-adjustable (in practice,
    /// behind the same 48h timelock convention documented in
    /// docs/architecture.md for anything fund-safety-relevant), never
    /// touched by VaultPolicy, which only ever triggers the callback.
    /// Hard-capped by MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE/BPS below regardless of
    /// what GOVERNANCE sets here, see payAutoPauseBounty.
    uint256 public autoPauseBountyAmount;

    /// @dev Hard, non-governance-adjustable ceilings on a single bounty
    /// payout, so even a compromised or mistaken GOVERNANCE setting
    /// `autoPauseBountyAmount` too high can never drain a meaningful
    /// portion of the vault through one legitimate pause trigger. The
    /// smaller of the two always applies, see payAutoPauseBounty.
    uint256 internal constant MAX_AUTO_PAUSE_BOUNTY_BPS = 100; // 1% of current totalAssets()
    uint256 internal constant MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE = 1000e18; // 1000 USDC, 18-decimal native

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

    // ---------------------------------------------------------------------
    // v3 (yield-seeking LP vault) state. Always empty/unused for v1/v2:
    // nothing here is ever populated unless a real LP_* decision executes,
    // which v1/v2's own agent strategy text and VaultPolicy limits never
    // propose/allow. See docs/v3 design doc for the full reasoning.
    // ---------------------------------------------------------------------

    /// @dev The UnitFlowV3PositionManager-equivalent this vault mints/
    /// manages LP positions through. address(0) (the default for v1/v2)
    /// means "no LP capability wired," same "zero means opted out" pattern
    /// as capitalLimitRegistry. Changed only through the same propose/
    /// execute/cancel 48h timelock as allowedRouters, same reasoning: a
    /// malicious position manager could redirect NFT custody or misreport
    /// position state, a fund-safety-relevant address change.
    address public positionManager;
    uint256 internal constant POSITION_MANAGER_CHANGE_TIMELOCK = 48 hours;
    uint256 public pendingPositionManagerExecutableAt;
    address public pendingPositionManager;

    /// @dev TWAP window for LP position valuation, see _twapSqrtPriceX96.
    /// 30 minutes: long enough that sustaining a manipulated price across
    /// the whole window costs meaningfully more than a single-block flash
    /// swap, short enough to still reflect real, current market
    /// conditions for an out-of-range/value-loss determination.
    uint32 internal constant LP_VALUATION_TWAP_SECONDS = 1800;

    /// @dev Every LP position tokenId this vault currently holds. Removed
    /// from this array (swap-and-pop) on LP_CLOSE. Small, unbounded-in-
    /// theory but bounded in practice by VaultPolicy's maxLpAllocationBps
    /// (a vault that keeps opening tiny positions still can't exceed its
    /// own total LP allocation cap).
    uint256[] public lpPositionIds;
    mapping(uint256 tokenId => bool) internal _isHeldLpPosition;
    /// @dev Set once at LP_OPEN from the keeper-supplied LpLeg.pool (the
    /// same trust model as SwapLeg.router: a keeper-supplied address,
    /// never independently re-derived from the Factory on every read).
    mapping(uint256 tokenId => address) public lpPositionPool;
    /// @dev USD value of a position's principal at the moment it was
    /// opened (LP_OPEN), never updated afterward. The base VaultPolicy
    /// compares live currentValueUSDC against, see LpPositionHolding's own
    /// doc comment in IVaultPolicy.sol for why this is a value-drawdown
    /// proxy, not textbook IL-vs-HODL.
    mapping(uint256 tokenId => uint256) public lpPositionOpenValueUSDC;
    /// @dev 0 while the position is in range (or was never observed out of
    /// range); set to the timestamp of the first observation of it being
    /// out of range, cleared the moment it's back in range. VaultPolicy
    /// compares block.timestamp - this against maxLpOutOfRangeSeconds.
    mapping(uint256 tokenId => uint256) public lpOutOfRangeSince;
    /// @dev Snapshot of the pool's own liquidity() at the moment this
    /// position was opened, compared against the pool's current liquidity
    /// by VaultPolicy's pool-liquidity-drop check.
    mapping(uint256 tokenId => uint128) public lpPoolLiquidityAtOpen;

    // ---------------------------------------------------------------------
    // v4 (cross-chain lending vault) state. Always unset/unused for
    // v1/v2/v3: lendingRegistry stays address(0) unless GOVERNANCE
    // explicitly wires one post-creation, and no real BRIDGE_* decision
    // can ever be proposed without it. All real position lifecycle STATE
    // lives on LendingPositionRegistry, a separate deployed contract, not
    // here -- see that contract's own top-of-file doc comment for why
    // (real, measured EIP-170 pressure, not a stylistic split).
    // ---------------------------------------------------------------------

    /// @dev One-shot, GOVERNANCE-gated, deliberately NO timelock/rotation
    /// path, unlike positionManager/allowedRouters: a vault's
    /// LendingPositionRegistry is deployed specifically for THIS vault and
    /// tracks THIS vault's own live cross-chain position state. Rotating
    /// it mid-life would orphan that state, not just be unnecessary --
    /// a one-shot lock is the correct safety property here, not merely a
    /// bytecode saving (though it is also that, see
    /// LendingPositionRegistry.sol's own top-of-file comment).
    address public lendingRegistry;

    /// @dev Immutable, set once at construction, not a governance setter:
    /// this points at Circle's own canonical CCTP TokenMessenger for this
    /// chain, essentially permanent infrastructure this project does not
    /// choose or compete between (there is only ever one real
    /// TokenMessenger per chain), unlike a project-chosen DEX router or
    /// position manager, both of which legitimately could need rotation
    /// among real alternatives (see v3's own design doc weighing 3 real
    /// candidate position managers). If this address is ever genuinely
    /// wrong, the fix is a new vault deployment (this project's own
    /// "materially different setup, new version" rule), not a live
    /// parameter change -- so, unlike lendingRegistry (which genuinely
    /// cannot be a constructor argument, see that field's own doc comment
    /// on the circular-dependency reasoning), there is no reason to pay
    /// for a setter/event/error a real deployment would never actually
    /// use, real EIP-170 margin (see MandateVaultDeployer.sol's own
    /// top-of-file comment).
    address public immutable cctpTokenMessenger;

    /// @dev Passed as-is to LendingPositionRegistry.initiateWithdrawal for
    /// both the agent-proposed BRIDGE_WITHDRAW path and
    /// EMERGENCY_EXIT_TO_STABLE's own cross-chain unwind (the same single
    /// retrieval path either way, distinguished only for observability).
    /// Matches LendingPositionRegistry.REASON_MANUAL_OR_EMERGENCY by
    /// value, not by reference (two separately deployed contracts, no
    /// shared constant to import cheaply).
    bytes32 internal constant REASON_MANUAL_OR_EMERGENCY = "MANUAL_OR_EMERGENCY";

    /// @dev CCTP V2's real, published finality thresholds
    /// (`circlefin/evm-cctp-contracts/blob/master/src/v2/FinalityThresholds.sol`,
    /// verified live, not guessed): 1000 = FINALITY_THRESHOLD_CONFIRMED,
    /// the threshold CCTP's own "Fast Transfer" mode uses (~8-20 seconds);
    /// 2000 = FINALITY_THRESHOLD_FINALIZED (standard/full finality,
    /// ~15-19 minutes). This project defaults to Fast Transfer: the
    /// keeper's own downstream action (supplying to Aave on the
    /// destination chain) already depends on real-time execution, and the
    /// v4 design's own staleness/deviation checks on
    /// LendingPositionRegistry already bound the risk of acting on a
    /// same-day, not-yet-fully-finalized transfer -- waiting ~15-19
    /// minutes for full finality on every single deposit would cost real
    /// yield-capture time for a marginal safety gain this project's other
    /// checks already cover.
    uint32 internal constant CCTP_MIN_FINALITY_THRESHOLD = 1000;

    /// @dev Mirrors autoPauseBountyAmount, deliberately duplicated rather
    /// than shared, see IStaleWithdrawalBountyPayer's doc comment in
    /// ILendingPositionRegistry.sol for the design reasoning.
    uint256 public staleWithdrawalBountyAmount;
    uint256 internal constant MAX_STALE_WITHDRAWAL_BOUNTY_BPS = 100; // 1% of current totalAssets(), mirrors MAX_AUTO_PAUSE_BOUNTY_BPS
    uint256 internal constant MAX_STALE_WITHDRAWAL_BOUNTY_ABSOLUTE = 1000e18; // mirrors MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE

    /// @dev Mirrors INonfungiblePositionManager's own params directly, same
    /// "known real ABI, not an invented one" reasoning as SwapLeg. Built
    /// fresh by the keeper at execution time (real, current amount0Min/
    /// amount1Min/deadline), never trusted from the agent's own proposed
    /// Decision fields the same way SwapLeg's minAmountOut is never the
    /// agent's own number, see executor/keeperService.ts's buildLpLeg.
    /// Only one leg per decision (never an array): a single LP_* decision
    /// always acts on at most one position, unlike REBALANCE, which can
    /// need several simultaneous swap legs. pool.token0()/token1() decide
    /// which of amount0/amount1 apply; empty (pool == address(0)) means
    /// "no LP action this call," matching an empty swaps[] for HOLD.
    struct LpLeg {
        address pool;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 tokenId; // for INCREASE/DECREASE/COLLECT/CLOSE, ignored for OPEN
        uint128 liquidity; // for DECREASE, ignored otherwise
        uint256 deadline;
    }

    /// @dev v4 only. Mirrors LpLeg's own "keeper supplies real, current
    /// values, contract trusts within already-validated boundaries"
    /// convention, with one deliberate exception: the CCTP mintRecipient
    /// AND destinationCaller are NEVER taken from the keeper's supplied
    /// leg, both are always derived fresh from
    /// lendingRegistry.chainKeeper(chainId) inside _bridgeDeposit, same
    /// "never trust a caller-supplied destination for where funds go"
    /// discipline as every other real transfer in this contract -- a
    /// compromised keeper populating this leg cannot redirect bridged
    /// funds anywhere but the real, governance-set destination-chain
    /// keeper, NOR let any other address complete the mint on the
    /// destination chain (destinationCaller restricts
    /// MessageTransmitterV2.receiveMessage to that same chainKeeper only,
    /// not left open to any relayer). chainId/amount/maxFee are for
    /// BRIDGE_DEPOSIT (new position) -- maxFee is a real, keeper-computed
    /// value (the maximum CCTP Fast Transfer fee the keeper is willing to
    /// pay at execution time, same "current market conditions, not a
    /// hardcoded contract constant" reasoning as SwapLeg.minAmountOut);
    /// positionId is for BRIDGE_WITHDRAW and EMERGENCY_EXIT_TO_STABLE's
    /// own unwind (existing position, ignored for BRIDGE_DEPOSIT, same
    /// reasoning LP_OPEN never takes a caller-supplied tokenId).
    struct BridgeLeg {
        uint256 chainId;
        uint256 amount;
        uint256 positionId;
        uint32 cctpDestinationDomain;
        uint256 maxFee;
    }

    event PolicySet(address indexed policy);
    event DecisionExecuted(IVaultPolicy.DecisionAction indexed action, address indexed asset, uint256 amount);
    event SwapExecuted(address indexed router, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event RouterAllowedSet(address indexed router, bool allowed);
    event RouterChangeProposed(address indexed router, bool allowed, uint256 executableAt);
    event RouterChangeCancelled(address indexed router, address indexed cancelledBy);
    event CapitalLimitRegistrySet(address indexed registry);
    event SweepDustProposed(address indexed asset, address indexed to, uint256 amount, uint256 executableAt);
    event SweepDustCancelled(address indexed asset, address indexed cancelledBy);
    event DustSwept(address indexed asset, address indexed to, uint256 amount);
    event AutoPauseBountyAmountSet(uint256 amount);
    event AutoPauseBountyPaid(address indexed to, uint256 amount);
    event PositionManagerSet(address indexed positionManager);
    event PositionManagerChangeProposed(address indexed positionManager, uint256 executableAt);
    event PositionManagerChangeCancelled(address indexed cancelledBy);
    event LpPositionOpened(uint256 indexed tokenId, address indexed pool, uint256 openValueUSDC);
    event LpPositionIncreased(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpPositionDecreased(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpFeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LpPositionClosed(uint256 indexed tokenId);
    event LendingRegistrySet(address indexed lendingRegistry);
    event BridgeDepositExecuted(uint256 indexed positionId, uint256 indexed chainId, uint256 amount);
    event CrossChainWithdrawalCompleted(uint256 indexed positionId, uint256 amountReceived);
    event StaleWithdrawalBountyAmountSet(uint256 amount);
    event StaleWithdrawalBountyPaid(address indexed to, uint256 amount);

    error PolicyAlreadySet();
    error NotFactory();
    error NotKeeper();
    error NotGovernance();
    error NotPauser();
    error NotPolicy();
    error PolicyNotSet();
    error DecisionRejected(bytes32[] codes);
    error RouterNotAllowed(address router);
    error InsufficientSwapOutput(uint256 amountOut, uint256 minAmountOut);
    error UnregisteredAsset(address asset);
    error NoDust();
    error BountyAmountExceedsCap(uint256 amount, uint256 cap);
    error RouterChangeNotReady(uint256 executableAt);
    error NoPendingRouterChange(address router);
    error SweepNotReady(uint256 executableAt);
    error NoPendingSweep(address asset);
    error PositionManagerNotSet();
    error PositionManagerChangeNotReady(uint256 executableAt);
    error NoPendingPositionManagerChange();
    error MintPriceOutOfRange(int24 currentTick, int24 tickLower, int24 tickUpper);
    error LpPositionNotHeld(uint256 tokenId);
    error UnsupportedLpToken(address token);
    error LendingRegistryAlreadySet();
    error LendingRegistryNotSet();
    error CctpTokenMessengerNotSet();
    error ChainKeeperNotSet(uint256 chainId);
    error NotLendingRegistry();

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

    modifier onlyPauser() {
        if (!IAccessControl(roles).hasRole(PAUSER_ROLE, msg.sender)) revert NotPauser();
        _;
    }

    constructor(
        IERC20 usdc_,
        address roles_,
        address initialSwapRouter_,
        string memory name_,
        string memory symbol_,
        address[] memory otherAssets_,
        address factory_,
        address cctpTokenMessenger_
    ) ERC4626(usdc_) ERC20(name_, symbol_) {
        cctpTokenMessenger = cctpTokenMessenger_;
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
    /// The one deliberate exception is _valueLpPositions(): an LP position
    /// is an NFT whose composition depends on the current pool price, not
    /// a fungible ledger entry, so valuing it genuinely requires reading
    /// live pool state (positions()/slot0()), same as every real Uniswap
    /// V3 integrator does. See LpPositionHolding's doc comment in
    /// IVaultPolicy.sol for the manipulation-surface consequence of this,
    /// named explicitly rather than hidden.
    function totalAssets() public view override returns (uint256) {
        uint256 total = _ledger[asset()];
        for (uint256 i = 0; i < registeredAssets.length; i++) {
            address a = registeredAssets[i];
            if (a == asset()) continue;
            total += _valueInUSDC(a, _ledger[a]);
        }
        total += _valueLpPositions();
        total += _valueLendingPositions();
        return total;
    }

    /// @dev Always 0 for v1/v2/v3 (lendingRegistry unset). Delegates
    /// entirely to LendingPositionRegistry's own totalValueUSDC, see that
    /// contract's own doc comments for the per-status valuation rules --
    /// this vault holds no cross-chain lending state of its own to sum.
    function _valueLendingPositions() internal view returns (uint256) {
        if (lendingRegistry == address(0)) return 0;
        return ILendingPositionRegistry(lendingRegistry).totalValueUSDC();
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
        uint256 registryMax = ICapitalLimitRegistry(capitalLimitRegistry).maxTotalAssets(address(this));
        uint256 currentAssets = totalAssets();
        uint256 room = registryMax > currentAssets ? registryMax - currentAssets : 0;
        return room < max ? room : max;
    }

    // ---------------------------------------------------------------------
    // Decision execution
    // ---------------------------------------------------------------------

    /// @notice The only way the AI agent's proposals ever touch this vault. The
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
        SwapLeg[] calldata swaps,
        LpLeg calldata lpLeg,
        BridgeLeg calldata bridgeLeg
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

        // A populated LP leg is either a brand-new position (pool !=
        // address(0), LP_OPEN only) or an operation on an existing
        // position identified by tokenId (LP_INCREASE/LP_DECREASE/
        // LP_COLLECT/LP_CLOSE, and EMERGENCY_EXIT_TO_STABLE's own implicit
        // close of an open position, see _executeLpLeg below). Checking
        // only lpLeg.pool was a real, previously-shipped bug: every
        // non-LP_OPEN leg always sets pool == address(0) (see
        // executor/keeperService.ts's buildLpLeg), so LP_INCREASE/
        // LP_DECREASE/LP_COLLECT/LP_CLOSE were silently unreachable no-ops.
        // Found and fixed 2026-07-14, before any real capital could reach
        // this path (LP_OPEN itself is still hard-blocked pending an
        // independent cirBTC reference price, see requireIndependentReferencePriceForLp).
        if (lpLeg.pool != address(0) || lpLeg.tokenId != 0) {
            _executeLpLeg(decision.action, lpLeg);
        }
        // Same "pool != 0 for the identifying case, tokenId != 0 for
        // every other case" shape as the LP gate above, applied to
        // BridgeLeg's own two identifying fields: BRIDGE_DEPOSIT always
        // sets chainId (a new position), BRIDGE_WITHDRAW and
        // EMERGENCY_EXIT_TO_STABLE's own cross-chain unwind always set
        // positionId (an existing one).
        if (bridgeLeg.chainId != 0 || bridgeLeg.positionId != 0) {
            _executeBridgeLeg(decision.action, bridgeLeg);
        }
        // Persists real out-of-range durations for every held position,
        // regardless of whether this specific call touched one, so
        // VaultPolicy's check reads an accurate, previously-stored
        // duration rather than one that silently resets every call.
        _syncLpOutOfRangeTracking();

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

    /// @notice Dispatches one LP operation, unconditionally executing
    /// whatever the keeper supplied, same "protected only by pre/post
    /// policy validation" shape _executeSwapLeg already uses. Only ever
    /// called for v3-style vaults (positionManager != address(0)); v1/v2
    /// never populate a non-empty LpLeg, so this never runs for them.
    function _executeLpLeg(IVaultPolicy.DecisionAction action, LpLeg calldata leg) internal {
        if (positionManager == address(0)) revert PositionManagerNotSet();

        if (action == IVaultPolicy.DecisionAction.LP_OPEN) {
            _lpOpen(leg);
        } else if (action == IVaultPolicy.DecisionAction.LP_INCREASE) {
            _lpIncrease(leg);
        } else if (action == IVaultPolicy.DecisionAction.LP_DECREASE) {
            _lpDecrease(leg);
        } else if (action == IVaultPolicy.DecisionAction.LP_COLLECT) {
            _lpCollect(leg);
        } else if (action == IVaultPolicy.DecisionAction.LP_CLOSE || action == IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE) {
            // EMERGENCY_EXIT_TO_STABLE reaching here means the keeper
            // supplied a populated leg identifying an open position to
            // unwind, as part of the vault's own unconditional safety-
            // valve action (see executor/keeperService.ts's
            // closeAllOpenLpPositions). Closing is always the correct,
            // safe interpretation regardless of which action label carries
            // it here, same "reducing exposure is always fine" rule this
            // contract already applies everywhere else. This is what makes
            // EMERGENCY_EXIT_TO_STABLE's VaultPolicy bypass (validateDecision's
            // unconditional early return for this action) actually cover
            // LP positions too, not just simple ledger holdings.
            _lpClose(leg);
        }
    }

    /// @dev Shared by _lpOpen/_lpIncrease, the exact same approve-both/
    /// clear-both pattern both need around their real positionManager call,
    /// factored out purely for contract size (real EIP-170 pressure, see
    /// foundry.toml's own comment), not a new behavior.
    function _approveBoth(address token0, address token1, uint256 amount0, uint256 amount1) internal {
        IERC20(token0).forceApprove(positionManager, amount0);
        IERC20(token1).forceApprove(positionManager, amount1);
    }

    /// @dev Shared by _lpIncrease/_lpDecrease/_lpCollect/_lpClose, the
    /// exact same held-position guard all four need, factored out purely
    /// for contract size, not a new behavior.
    function _requireHeldPosition(uint256 tokenId) internal view {
        if (!_isHeldLpPosition[tokenId]) revert LpPositionNotHeld(tokenId);
    }

    /// @dev Shared by _lpOpen/_lpIncrease: real capital consumed by a real
    /// mint/increaseLiquidity call leaves this vault's own ledger, factored
    /// out purely for contract size, not a new behavior.
    function _debitLedgerBoth(address token0, address token1, uint256 amount0, uint256 amount1) internal {
        _ledger[token0] -= amount0;
        _ledger[token1] -= amount1;
    }

    function _lpOpen(LpLeg calldata leg) internal {
        address token0 = IUniswapV3PoolMinimal(leg.pool).token0();
        address token1 = IUniswapV3PoolMinimal(leg.pool).token1();
        if (!isRegisteredAsset[token0]) revert UnregisteredAsset(token0);
        if (!isRegisteredAsset[token1]) revert UnregisteredAsset(token1);

        _approveBoth(token0, token1, leg.amount0Desired, leg.amount1Desired);

        (uint256 tokenId,, uint256 amount0, uint256 amount1) = INonfungiblePositionManager(positionManager).mint(
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

        _approveBoth(token0, token1, 0, 0);

        // The real, immediate "is this actually earning fees right now"
        // check, mirroring _executeSwapLeg's own immediate
        // InsufficientSwapOutput check rather than routing a mechanical,
        // in-the-moment correctness check through VaultPolicy. The
        // range-WIDTH check (minLpTickRangeWidth) lives in VaultPolicy
        // instead, since it only needs decision.tickLower/tickUpper, no
        // live pool read.
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(leg.pool).slot0();
        if (currentTick < leg.tickLower || currentTick >= leg.tickUpper) {
            revert MintPriceOutOfRange(currentTick, leg.tickLower, leg.tickUpper);
        }

        _debitLedgerBoth(token0, token1, amount0, amount1);

        lpPositionIds.push(tokenId);
        _isHeldLpPosition[tokenId] = true;
        lpPositionPool[tokenId] = leg.pool;
        uint256 openValueUSDC = _valueInUSDC(token0, amount0) + _valueInUSDC(token1, amount1);
        lpPositionOpenValueUSDC[tokenId] = openValueUSDC;
        lpPoolLiquidityAtOpen[tokenId] = IUniswapV3PoolMinimal(leg.pool).liquidity();

        emit LpPositionOpened(tokenId, leg.pool, openValueUSDC);
    }

    function _lpIncrease(LpLeg calldata leg) internal {
        _requireHeldPosition(leg.tokenId);
        (,, address token0, address token1,,,,,,,,) = INonfungiblePositionManager(positionManager).positions(leg.tokenId);

        _approveBoth(token0, token1, leg.amount0Desired, leg.amount1Desired);

        (, uint256 amount0, uint256 amount1) = INonfungiblePositionManager(positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: leg.tokenId,
                amount0Desired: leg.amount0Desired,
                amount1Desired: leg.amount1Desired,
                amount0Min: leg.amount0Min,
                amount1Min: leg.amount1Min,
                deadline: leg.deadline
            })
        );

        _approveBoth(token0, token1, 0, 0);

        _debitLedgerBoth(token0, token1, amount0, amount1);
        // New capital added to an existing position grows its own basis,
        // same "value-drawdown-since-basis" reasoning as LP_OPEN.
        lpPositionOpenValueUSDC[leg.tokenId] += _valueInUSDC(token0, amount0) + _valueInUSDC(token1, amount1);

        emit LpPositionIncreased(leg.tokenId, amount0, amount1);
    }

    /// @dev Shared by _lpDecrease/_lpClose: decreaseLiquidity only credits
    /// tokensOwed, it never itself moves tokens, same real Uniswap V3
    /// two-step mechanic every integrator follows, see _collectAll below.
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

    /// @dev Shared by _lpDecrease/_lpCollect/_lpClose: always sweeps
    /// everything currently owed on the position (principal just
    /// decreased, plus any accrued fees) back into this vault's own
    /// ledger, factored out purely to cut duplicated bytecode across the
    /// three call sites (this project's MandateVault.sol was pushed over
    /// the EIP-170 24576-byte deployable-contract limit by v3's LP logic,
    /// see foundry.toml's own doc comment on the optimizer settings this
    /// also required).
    function _collectAll(uint256 tokenId, address token0, address token1) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        _ledger[token0] += amount0;
        _ledger[token1] += amount1;
    }

    function _lpDecrease(LpLeg calldata leg) internal {
        _requireHeldPosition(leg.tokenId);
        (,, address token0, address token1,,,, uint128 liquidityBefore,,,,) =
            INonfungiblePositionManager(positionManager).positions(leg.tokenId);

        _decreaseLiquidity(leg.tokenId, leg.liquidity, leg.amount0Min, leg.amount1Min, leg.deadline);
        (uint256 amount0, uint256 amount1) = _collectAll(leg.tokenId, token0, token1);

        if (liquidityBefore > 0) {
            lpPositionOpenValueUSDC[leg.tokenId] =
                (lpPositionOpenValueUSDC[leg.tokenId] * (liquidityBefore - leg.liquidity)) / liquidityBefore;
        }

        emit LpPositionDecreased(leg.tokenId, amount0, amount1);
    }

    function _lpCollect(LpLeg calldata leg) internal {
        _requireHeldPosition(leg.tokenId);
        (,, address token0, address token1,,,,,,,,) = INonfungiblePositionManager(positionManager).positions(leg.tokenId);
        // Pure fee income, principal/basis unchanged.
        (uint256 amount0, uint256 amount1) = _collectAll(leg.tokenId, token0, token1);
        emit LpFeesCollected(leg.tokenId, amount0, amount1);
    }

    function _lpClose(LpLeg calldata leg) internal {
        _requireHeldPosition(leg.tokenId);
        (,, address token0, address token1,,,, uint128 liquidity,,,,) =
            INonfungiblePositionManager(positionManager).positions(leg.tokenId);

        if (liquidity > 0) {
            _decreaseLiquidity(leg.tokenId, liquidity, leg.amount0Min, leg.amount1Min, leg.deadline);
        }
        _collectAll(leg.tokenId, token0, token1);
        INonfungiblePositionManager(positionManager).burn(leg.tokenId);

        _removeLpPosition(leg.tokenId);

        emit LpPositionClosed(leg.tokenId);
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

    /// @notice Required so this vault can receive an LP position NFT from
    /// positionManager.mint's recipient callback. Accepts unconditionally
    /// from the configured positionManager only, matching how every other
    /// external call in this contract trusts only its own governance-
    /// configured, allowlisted counterparties.
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (msg.sender != positionManager) revert UnsupportedLpToken(msg.sender);
        return IERC721Receiver.onERC721Received.selector;
    }

    // ---------------------------------------------------------------------
    // v4 (cross-chain lending vault) execution. Deliberately thin: all real
    // position lifecycle state/rules live on LendingPositionRegistry (a
    // separate deployed contract, see its own top-of-file comment), this
    // vault only ever holds custody (the ledger, the real depositForBurn
    // call) and dispatches, same "unconditionally execute whatever the
    // keeper supplied, protected only by pre/post policy validation" shape
    // _executeSwapLeg/_executeLpLeg already use.
    // ---------------------------------------------------------------------

    function _executeBridgeLeg(IVaultPolicy.DecisionAction action, BridgeLeg calldata leg) internal {
        if (lendingRegistry == address(0)) revert LendingRegistryNotSet();

        if (action == IVaultPolicy.DecisionAction.BRIDGE_DEPOSIT) {
            _bridgeDeposit(leg);
        } else if (
            action == IVaultPolicy.DecisionAction.BRIDGE_WITHDRAW
                || action == IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE
        ) {
            // EMERGENCY_EXIT_TO_STABLE reaching here means the keeper
            // supplied a populated leg identifying an open cross-chain
            // position to unwind, same "closing is always the correct,
            // safe interpretation regardless of which action label
            // carries it here" reasoning _executeLpLeg already applies to
            // LP_CLOSE. One executeDecision call per open position (see
            // executor/keeperService.ts's closeAllOpenCrossChainPositions,
            // mirroring closeAllOpenLpPositions), never an onchain loop
            // here, keeping this dispatcher as thin as the LP one.
            ILendingPositionRegistry(lendingRegistry).initiateWithdrawal(leg.positionId, REASON_MANUAL_OR_EMERGENCY);
        }
    }

    function _bridgeDeposit(BridgeLeg calldata leg) internal {
        if (cctpTokenMessenger == address(0)) revert CctpTokenMessengerNotSet();
        address keeperAddr = ILendingPositionRegistry(lendingRegistry).chainKeeper(leg.chainId);
        if (keeperAddr == address(0)) revert ChainKeeperNotSet(leg.chainId);

        _ledger[asset()] -= leg.amount;
        IERC20(asset()).forceApprove(cctpTokenMessenger, leg.amount);
        // mintRecipient AND destinationCaller are BOTH ALWAYS derived from
        // the registry's own governance-set chainKeeper, never leg.* --
        // see BridgeLeg's own doc comment for why this is not merely a
        // convenience choice. Restricting destinationCaller to the same
        // address means only that dedicated chain keeper can ever
        // complete the mint on the destination chain, not an open
        // completion any relayer could trigger. minFinalityThreshold is a
        // fixed policy constant (CCTP Fast Transfer, see
        // CCTP_MIN_FINALITY_THRESHOLD's own doc comment); maxFee is the
        // one real-time, market-dependent value the keeper supplies via
        // the leg itself.
        bytes32 keeperBytes32 = bytes32(uint256(uint160(keeperAddr)));
        ICCTPTokenMessenger(cctpTokenMessenger).depositForBurn(
            leg.amount, leg.cctpDestinationDomain, keeperBytes32, asset(), keeperBytes32, leg.maxFee, CCTP_MIN_FINALITY_THRESHOLD
        );
        IERC20(asset()).forceApprove(cctpTokenMessenger, 0);

        uint256 positionId = ILendingPositionRegistry(lendingRegistry).recordNewPosition(leg.chainId, leg.amount);
        emit BridgeDepositExecuted(positionId, leg.chainId, leg.amount);
    }

    /// @notice Called by the keeper once real CCTP funds have landed back
    /// on this chain. Trusts the keeper-supplied amountReceived directly,
    /// the same "trusted boundary" already established for
    /// _executeSwapLeg's amountOut and every LP amount this contract
    /// credits from a real external call's return value -- deliberately
    /// NOT a live balanceOf read: _ledger's own top-of-file comment names
    /// exactly one deliberate exception to "never read a live balance"
    /// (sweepDust), and diluting that for marginal benefit here would
    /// also reintroduce the shared native/ERC-20-balance donation-risk
    /// surface that invariant exists to close, for a real EIP-170 cost.
    function confirmCrossChainWithdrawalComplete(uint256 positionId, uint256 amountReceived) external onlyKeeper nonReentrant {
        if (lendingRegistry == address(0)) revert LendingRegistryNotSet();
        _ledger[asset()] += amountReceived;
        ILendingPositionRegistry(lendingRegistry).markClosed(positionId);
        emit CrossChainWithdrawalCompleted(positionId, amountReceived);
    }

    /// @notice The only function LendingPositionRegistry's
    /// checkAndInitiateStaleWithdrawal calls back into. Deliberately
    /// duplicated from payAutoPauseBounty, not shared -- see
    /// ILendingPositionRegistry.sol's IStaleWithdrawalBountyPayer doc
    /// comment for the design reasoning (different trigger, likely
    /// different economics over time).
    function payStaleWithdrawalBounty(address to) external nonReentrant {
        if (msg.sender != lendingRegistry) revert NotLendingRegistry();
        uint256 amount = _capBounty(staleWithdrawalBountyAmount, MAX_STALE_WITHDRAWAL_BOUNTY_BPS, MAX_STALE_WITHDRAWAL_BOUNTY_ABSOLUTE);
        if (amount == 0) return;

        _ledger[asset()] -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit StaleWithdrawalBountyPaid(to, amount);
    }

    function setLendingRegistry(address registry) external onlyGovernance {
        if (lendingRegistry != address(0)) revert LendingRegistryAlreadySet();
        lendingRegistry = registry;
        emit LendingRegistrySet(registry);
    }

    function setStaleWithdrawalBountyAmount(uint256 amount) external onlyGovernance {
        if (amount > MAX_STALE_WITHDRAWAL_BOUNTY_ABSOLUTE) {
            revert BountyAmountExceedsCap(amount, MAX_STALE_WITHDRAWAL_BOUNTY_ABSOLUTE);
        }
        staleWithdrawalBountyAmount = amount;
        emit StaleWithdrawalBountyAmountSet(amount);
    }

    /// @dev Real, current value of every held LP position, summed. See
    /// totalAssets()'s own doc comment for why this is the one deliberate
    /// exception to "never trust live external state."
    function _valueLpPositions() internal view returns (uint256 total) {
        uint256 len = lpPositionIds.length;
        for (uint256 i = 0; i < len; i++) {
            (uint256 valueUSDC,,,) = _valuePosition(lpPositionIds[i]);
            total += valueUSDC;
        }
    }

    /// @dev Shared per-position valuation, used by both _valueLpPositions
    /// (totalAssets) and _buildLpPositionHoldings (_buildState, the full
    /// VaultPolicy-facing array). Reads the position's real, current
    /// liquidity/range from positionManager.positions(), computes real
    /// token0/token1 amounts via LiquidityAmounts.getAmountsForLiquidity
    /// (the same math every real Uniswap V3 integrator uses, not
    /// reinvented) against a TWAP price (see _twapSqrtPriceX96, NOT the
    /// live slot0() spot price used to matter here before 2026-07-15), adds
    /// already-accrued uncollected fees (tokensOwed0/1), then prices both
    /// sides via the vault's existing _valueInUSDC.
    ///
    /// @dev SECURITY: totalAssets() (which calls this) is read live and
    /// permissionlessly by every deposit()/withdraw()/mint()/redeem() call
    /// (standard, un-overridden ERC-4626), in the SAME transaction as the
    /// caller's own call. A live slot0() spot price is flash-manipulable
    /// within that single transaction (move the pool's price with a large
    /// swap, deposit/withdraw at the manipulated NAV, reverse the swap),
    /// and unlike a simple ERC-20 holding (valued from lastKnownPriceUSDC,
    /// a price CACHED from the last time the keeper executed a decision,
    /// not read live), an LP position's actual token0/token1 SPLIT is not
    /// something that can be cached the same way, it structurally depends
    /// on price at read time. Found and fixed 2026-07-15, before any real
    /// deposit could ever reach a vault holding an open position (real
    /// LP_OPEN execution was, and remains, hard-blocked pending an
    /// independent cirBTC reference price, see
    /// requireIndependentReferencePriceForLp in executor/keeperService.ts,
    /// but this contract is immutable per instance, so this needed fixing
    /// before deployment, not after). See docs/deployments.md's v3 section.
    function _valuePosition(uint256 tokenId)
        internal
        view
        returns (uint256 valueUSDC, address pool, bool inRange, uint128 currentPoolLiquidity)
    {
        pool = lpPositionPool[tokenId];
        (,, address token0, address token1,, int24 tickLower, int24 tickUpper, uint128 liquidity,,, uint128 tokensOwed0, uint128 tokensOwed1) =
            INonfungiblePositionManager(positionManager).positions(tokenId);

        // Live tick, deliberately still used here (NOT the TWAP): inRange
        // and currentPoolLiquidity are real-time risk-monitoring signals
        // (VaultPolicy's out-of-range/pool-liquidity-drop checks), a lagged
        // average would make them economically confusing, not safer. Only
        // the dollar VALUATION below uses the TWAP.
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        currentPoolLiquidity = IUniswapV3PoolMinimal(pool).liquidity();
        inRange = currentTick >= tickLower && currentTick < tickUpper;

        (uint256 amount0, uint256 amount1) =
            LiquidityAmounts.getAmountsForLiquidityFromTwap(_tickCumulativeDelta(pool), LP_VALUATION_TWAP_SECONDS, tickLower, tickUpper, liquidity);

        valueUSDC = _valueInUSDC(token0, amount0 + tokensOwed0) + _valueInUSDC(token1, amount1 + tokensOwed1);
    }

    /// @dev Manipulation-resistant time-weighted average price over
    /// LP_VALUATION_TWAP_SECONDS, the standard Uniswap V3 oracle read
    /// (observe()), not the live spot price. Deliberately reverts (does
    /// not silently fall back to spot) if the pool lacks enough historical
    /// observations for the requested window: a default-initialized pool
    /// only stores 1 observation (increaseObservationCardinalityNext, a
    /// real, permissionless, standard Uniswap V3 call, must be made on the
    /// real pool well before the first LP_OPEN on it, a documented
    /// operational prerequisite, see docs/deployments.md's v3 section).
    ///
    /// No separate explicit check is needed in _lpOpen itself: this
    /// function is already reached, for the position just minted, by
    /// executeDecision's own POST-state _buildState/_buildLpPositionHoldings
    /// pass, which runs unconditionally right after any leg executes and
    /// reverts the entire transaction (undoing the real mint too, standard
    /// EVM atomicity) if validateDecision's post-check fails for any
    /// reason, this one included. So a pool without a usable TWAP already
    /// can never successfully open a position on it, for free, from
    /// existing control flow, no separate gate call needed, real EIP-170
    /// contract-size pressure made this worth stating explicitly rather
    /// than adding a redundant call (see foundry.toml's own comment on how
    /// tight this whole LP mechanism already is).
    /// The actual TWAP-to-amounts math (rounding included) lives in
    /// LiquidityAmounts.getAmountsForLiquidityFromTwap instead of here,
    /// purely for contract size: bundling it into that one already-linked
    /// external library call saves more bytecode than computing it inline
    /// (measured; the earlier attempt at factoring only the tiny avg-tick
    /// arithmetic alone into its own external call cost more than it
    /// saved, real EIP-170 pressure either way, not a stylistic choice).
    function _tickCumulativeDelta(address pool) internal view returns (int56) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = LP_VALUATION_TWAP_SECONDS;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IUniswapV3PoolMinimal(pool).observe(secondsAgos);
        return tickCumulatives[1] - tickCumulatives[0];
    }

    function _buildLpPositionHoldings(uint256 nav) internal view returns (IVaultPolicy.LpPositionHolding[] memory) {
        uint256 len = lpPositionIds.length;
        IVaultPolicy.LpPositionHolding[] memory result = new IVaultPolicy.LpPositionHolding[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = lpPositionIds[i];
            (uint256 valueUSDC, address pool, bool inRange, uint128 currentPoolLiquidity) = _valuePosition(tokenId);

            uint256 outOfRangeSince = lpOutOfRangeSince[tokenId];
            if (!inRange && outOfRangeSince == 0) {
                // Not persisted here (this is a view function): the real
                // persistence happens in _syncLpOutOfRangeTracking, called
                // from executeDecision before _buildState runs. This
                // local value is only used to compute VaultPolicy's
                // out-of-range-duration figure for THIS call consistently
                // with what was just persisted.
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
        return result;
    }

    /// @dev Persists the real out-of-range-since timestamp for every held
    /// position, called once per executeDecision (before building either
    /// state) so the value _buildLpPositionHoldings computes for
    /// VaultPolicy matches what is actually stored, and so the very next
    /// call (even one with no LP action at all) observes an already-
    /// updated, real duration, not one that resets every time.
    function _syncLpOutOfRangeTracking() internal {
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
            prices: prices,
            // Always empty for v1/v2 (lpPositionIds never populated).
            // Deliberately excluded from the stable-bps sum above (that
            // loop only ever reads currentHoldings): an LP position's
            // value is never counted as a liquid stable reserve, same
            // non-instant-liquidity treatment cirBTC already gets, this
            // is what actually guarantees a minStableAllocationBps floor
            // of real, liquid stable holdings always stays outside any
            // LP position.
            currentLpPositions: _buildLpPositionHoldings(nav),
            // Always empty for v1/v2/v3 (lendingRegistry unset). Delegates
            // to LendingPositionRegistry's own currentPositions, same
            // reasoning as _valueLendingPositions above.
            currentLendingPositions: lendingRegistry == address(0)
                ? new IVaultPolicy.LendingPositionHolding[](0)
                : ILendingPositionRegistry(lendingRegistry).currentPositions(nav)
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
    ///
    /// @dev The actual amount paid is capped here, at payout time, to the
    /// SMALLER of MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE and
    /// MAX_AUTO_PAUSE_BOUNTY_BPS of the vault's CURRENT totalAssets(), not
    /// just validated once when GOVERNANCE sets the value. This is
    /// deliberate: totalAssets() can move a lot between when a bounty is
    /// configured and when it is actually paid out (deposits, withdrawals,
    /// losses), so capping only at set-time would not guarantee the payout
    /// stays small relative to the vault at the moment it actually happens.
    /// Even a compromised or mistaken GOVERNANCE setting an absurd
    /// `autoPauseBountyAmount` can never drain more than this hard,
    /// non-governance-adjustable ceiling in a single payout.
    function payAutoPauseBounty(address to) external nonReentrant {
        if (msg.sender != policy) revert NotPolicy();
        uint256 amount = _capBounty(autoPauseBountyAmount, MAX_AUTO_PAUSE_BOUNTY_BPS, MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE);
        if (amount == 0) return;

        _ledger[asset()] -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit AutoPauseBountyPaid(to, amount);
    }

    /// @dev Shared by payAutoPauseBounty/payStaleWithdrawalBounty: the
    /// exact same "smaller of a BPS-of-current-TVL cap and a hard
    /// absolute cap" math, factored out purely for contract size (real
    /// EIP-170 pressure, see foundry.toml's own comment), not a new
    /// behavior. The two bounty POOLS themselves stay fully separate
    /// (separate amounts, separate governance setters, separate events),
    /// A deliberate decision not to couple their economics -- only
    /// the arithmetic is shared.
    function _capBounty(uint256 amount, uint256 bpsCap, uint256 absoluteCap) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 percentCap = (totalAssets() * bpsCap) / 10_000;
        uint256 cap = percentCap < absoluteCap ? percentCap : absoluteCap;
        return amount > cap ? cap : amount;
    }

    // ---------------------------------------------------------------------
    // Governance
    // ---------------------------------------------------------------------

    /// @notice Step 1 of 2 for changing the router allowlist. Never
    /// instantaneous, code-enforced, not just left to the convention that
    /// GOVERNANCE_ROLE happens to be held by an external TimelockController.
    /// A malicious router added to the allowlist could redirect swap
    /// proceeds to an attacker-controlled contract, this is one of the few
    /// governance actions severe enough to warrant its own self-contained
    /// timelock in this contract, independent of deployment configuration.
    function proposeRouterAllowed(address router, bool allowed) external onlyGovernance {
        uint256 executableAt = block.timestamp + ROUTER_CHANGE_TIMELOCK;
        pendingRouterChange[router] = allowed;
        routerChangeExecutableAt[router] = executableAt;
        emit RouterChangeProposed(router, allowed, executableAt);
    }

    /// @notice Step 2 of 2. Permissionless once the timelock has elapsed,
    /// same "anyone can escalate, the contract enforces the real condition"
    /// pattern already used for checkAndAutoPause and P2PMarket.sol's
    /// expire(), so a change can never get stuck waiting on GOVERNANCE to
    /// remember to come back and finalize it.
    function executeRouterAllowed(address router) external {
        uint256 executableAt = routerChangeExecutableAt[router];
        if (executableAt == 0 || block.timestamp < executableAt) revert RouterChangeNotReady(executableAt);

        bool allowed = pendingRouterChange[router];
        allowedRouters[router] = allowed;
        delete routerChangeExecutableAt[router];
        delete pendingRouterChange[router];
        emit RouterAllowedSet(router, allowed);
    }

    /// @notice A 48h delay only protects against a compromised GOVERNANCE
    /// key if someone can actually act during that window, not just watch
    /// the attack land on a timer. Gated to PAUSER_ROLE, deliberately a
    /// different role than the GOVERNANCE_ROLE that proposes, so a proposal
    /// pushed through with a briefly compromised GOVERNANCE key can still be
    /// stopped by the team/monitoring during the delay. Reverts if there is
    /// no pending change for this router, rather than silently no-op-ing.
    function cancelRouterAllowedChange(address router) external onlyPauser {
        if (routerChangeExecutableAt[router] == 0) revert NoPendingRouterChange(router);
        delete routerChangeExecutableAt[router];
        delete pendingRouterChange[router];
        emit RouterChangeCancelled(router, msg.sender);
    }

    /// @notice Step 1 of 2 for changing the LP position manager. Same
    /// self-contained 48h timelock as the router allowlist, same reasoning:
    /// a malicious position manager could redirect NFT custody or misreport
    /// a position's real state, this is a fund-safety-relevant address
    /// change. Only one pending change at a time (unlike the router
    /// allowlist, which tracks pending state per-router, since this is a
    /// single address, not a mapping).
    function proposePositionManager(address newPositionManager) external onlyGovernance {
        uint256 executableAt = block.timestamp + POSITION_MANAGER_CHANGE_TIMELOCK;
        pendingPositionManager = newPositionManager;
        pendingPositionManagerExecutableAt = executableAt;
        emit PositionManagerChangeProposed(newPositionManager, executableAt);
    }

    /// @notice Step 2 of 2. Permissionless once the timelock has elapsed,
    /// same "anyone can finalize, the contract enforces the real condition"
    /// pattern as executeRouterAllowed.
    function executePositionManager() external {
        uint256 executableAt = pendingPositionManagerExecutableAt;
        if (executableAt == 0 || block.timestamp < executableAt) revert PositionManagerChangeNotReady(executableAt);

        positionManager = pendingPositionManager;
        delete pendingPositionManagerExecutableAt;
        delete pendingPositionManager;
        emit PositionManagerSet(positionManager);
    }

    /// @notice Gated to PAUSER_ROLE, same reasoning as
    /// cancelRouterAllowedChange: a different role than the GOVERNANCE_ROLE
    /// that proposes, so the team can actually stop a pending change during
    /// the delay.
    function cancelPositionManagerChange() external onlyPauser {
        if (pendingPositionManagerExecutableAt == 0) revert NoPendingPositionManagerChange();
        delete pendingPositionManagerExecutableAt;
        delete pendingPositionManager;
        emit PositionManagerChangeCancelled(msg.sender);
    }

    /// @notice Callable by the factory (once, at vault creation, so the cap
    /// is enforced from the very first block a vault could be deposited
    /// into, no separate manual step to forget) or by GOVERNANCE afterwards
    /// (so a future, smarter registry, e.g. Phase 4's reputation-based
    /// scoring, can be swapped in without redeploying the vault).
    function setCapitalLimitRegistry(address registry) external {
        if (msg.sender != factory && !IAccessControl(roles).hasRole(GOVERNANCE_ROLE, msg.sender)) {
            revert NotGovernance();
        }
        capitalLimitRegistry = registry;
        emit CapitalLimitRegistrySet(registry);
    }

    /// @notice The bounty is an economic incentive, not a risk limit, so
    /// unlike everything in VaultPolicy it is deliberately adjustable, to
    /// track gas costs and USDC value context over time. Rejected outright
    /// if it exceeds MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE, an early, cheap check;
    /// the real, always-enforced ceiling (which also accounts for
    /// MAX_AUTO_PAUSE_BOUNTY_BPS of current TVL) is applied fresh at
    /// payout time in payAutoPauseBounty, since TVL can move a lot between
    /// this call and an actual payout. In practice this action should go
    /// through the same 48h-timelock convention documented in
    /// docs/architecture.md for fund-safety-relevant parameters.
    function setAutoPauseBountyAmount(uint256 amount) external onlyGovernance {
        if (amount > MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE) {
            revert BountyAmountExceedsCap(amount, MAX_AUTO_PAUSE_BOUNTY_ABSOLUTE);
        }
        autoPauseBountyAmount = amount;
        emit AutoPauseBountyAmountSet(amount);
    }

    /// @notice Step 1 of 2. The one place this contract ever reads a live
    /// balanceOf. The swept amount can only ever be the unaccounted excess
    /// above the ledger, never ledgered depositor funds, that bound is what
    /// makes reading a live balance here safe at all. It is frozen at the
    /// amount observed now; a later executeSweepDust call transfers exactly
    /// this amount, never a value recomputed at execution time, matching how
    /// proposeRouterAllowed/executeRouterAllowed freezes its proposal.
    function proposeSweepDust(address asset_, address to) external onlyGovernance {
        uint256 live = IERC20(asset_).balanceOf(address(this));
        uint256 accounted = _ledger[asset_];
        if (live <= accounted) revert NoDust();
        uint256 dust = live - accounted;
        uint256 executableAt = block.timestamp + SWEEP_DUST_TIMELOCK;
        pendingSweep[asset_] = PendingSweep({to: to, amount: dust, executableAt: executableAt});
        emit SweepDustProposed(asset_, to, dust, executableAt);
    }

    /// @notice Step 2 of 2. Permissionless once the timelock has elapsed,
    /// same "anyone can finalize, the contract enforces the real condition"
    /// pattern as executeRouterAllowed and checkAndAutoPause.
    function executeSweepDust(address asset_) external nonReentrant {
        PendingSweep memory pending = pendingSweep[asset_];
        if (pending.executableAt == 0 || block.timestamp < pending.executableAt) {
            revert SweepNotReady(pending.executableAt);
        }
        delete pendingSweep[asset_];
        IERC20(asset_).safeTransfer(pending.to, pending.amount);
        emit DustSwept(asset_, pending.to, pending.amount);
    }

    /// @notice A large accidental direct transfer to the vault (bypassing
    /// deposit()) also counts as dust under this definition, and its sender
    /// deserves a real window to notice and ask for it back before it moves
    /// anywhere, not an instant, no-recourse sweep. Gated to PAUSER_ROLE,
    /// same reasoning and same role as cancelRouterAllowedChange: a
    /// different role than the GOVERNANCE_ROLE that proposes, so the team
    /// can actually stop a pending sweep during the delay, not just watch it
    /// count down.
    function cancelSweepDust(address asset_) external onlyPauser {
        if (pendingSweep[asset_].executableAt == 0) revert NoPendingSweep(asset_);
        delete pendingSweep[asset_];
        emit SweepDustCancelled(asset_, msg.sender);
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

    /// @notice v3 only: every held LP position's real, current state in one
    /// call, reusing the exact same computation _buildState feeds
    /// VaultPolicy, so the offchain agent/keeper layer (getVaultState.ts)
    /// never has to independently re-derive it. Always an empty array for
    /// v1/v2 (lpPositionIds is never populated).
    function currentLpPositions() external view returns (IVaultPolicy.LpPositionHolding[] memory) {
        return _buildLpPositionHoldings(totalAssets());
    }

    function lpPositionCount() external view returns (uint256) {
        return lpPositionIds.length;
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
