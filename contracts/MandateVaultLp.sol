// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IVaultPolicy, IAutoPausePayer} from "./interfaces/IVaultPolicy.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {ICapitalLimitRegistry} from "./interfaces/ICapitalLimitRegistry.sol";
import {ILendingPositionRegistry, IStaleWithdrawalBountyPayer} from "./interfaces/ILendingPositionRegistry.sol";
import {ILpPositionRegistry} from "./interfaces/ILpPositionRegistry.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/INonfungiblePositionManager.sol";
import {ICCTPTokenMessenger} from "./interfaces/ICCTPTokenMessenger.sol";
import {IVaultFactory} from "./interfaces/IVaultFactory.sol";

/// @notice v7 (LP yield vault, WUSDC/EURC) only. Built from
/// contracts/MandateVaultLending.sol as its base (same ERC-4626 custody
/// model, same performance-fee mechanism), not from contracts/MandateVault.sol:
/// re-adding v3's LP mechanism inline on top of MandateVault.sol would hit
/// the exact same EIP-170 problem that already forced v6's own pivot (a
/// measured 482 bytes over the 24,576-byte limit, see
/// MandateVaultLending.sol's own top-of-file comment), and dropping LP
/// entirely (v6's fix) is not an option here -- v7's whole purpose is a
/// real LP position. The fix instead is the full LpPositionRegistry
/// extraction already flagged as deliberately deferred "v7+" work during
/// the v6 session: this contract keeps only a THIN dispatcher (asset
/// validation, token custody hand-off, ledger debit/credit), and
/// contracts/LpPositionRegistry.sol owns the actual mint/increase/decrease/
/// collect/close mechanics, TWAP-guarded valuation, NFT custody, and the
/// positionManager 48h timelock -- the same "separate deployed contract,
/// vault only holds custody and dispatches" shape ILendingPositionRegistry
/// already proves for v4's cross-chain lending. See
/// contracts/LpPositionRegistry.sol's own top-of-file comment for the one
/// deliberate difference from that precedent (this satellite does
/// transiently hold funds, LendingPositionRegistry never does).
///
/// @notice Used starting with v7. v1-v6 are unaffected: v1-v5 keep
/// deploying from contracts/MandateVault.sol, v6 from
/// contracts/MandateVaultLending.sol, neither changed by this file at all.
///
/// @notice The ERC-4626 vault that actually custodies funds. Deposits/mints
/// are gated by VaultPolicy's pause state; withdrawals/redeems never are,
/// same discipline P2PMarket.sol already proved (pause blocks new exposure
/// only, never exits). The AI agent never touches this contract directly: the
/// keeper calls executeDecision with a Decision that must already have
/// passed VaultPolicy's deterministic gate, checked twice (before and after
/// the actual swap), never once.
contract MandateVaultLp is ERC4626, IAutoPausePayer, IStaleWithdrawalBountyPayer, ReentrancyGuard {
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

    /// @dev v6 only, stays 0 forever for a vault with performanceFeeBps ==
    /// 0 (_accrueFee's own early return never mints or moves this).
    /// Deliberately separate from highWaterMarkUSDC above: that one tracks
    /// raw NAV for drawdown purposes, and a plain deposit already raises
    /// raw NAV without any real yield, which would incorrectly charge a fee
    /// on a depositor's own newly-arrived principal. Tracking price PER
    /// SHARE instead is immune to that: an ordinary deposit/withdrawal
    /// moves totalAssets() and totalSupply() together, leaving price per
    /// share unchanged, so only genuine yield (totalAssets() growing with
    /// no matching share issuance) ever moves this value. Only ever
    /// ratchets up in _accrueFee, matching highWaterMarkUSDC's own
    /// never-decreases convention; recovering back up to a prior peak,
    /// without exceeding it, charges no fee.
    uint256 public feeHighWaterMarkPricePerShare;

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
    // v4 (cross-chain lending vault) state. Always unset/unused for
    // v1/v2/v3: lendingRegistry stays address(0) unless GOVERNANCE
    // explicitly wires one post-creation, and no real BRIDGE_* decision
    // can ever be proposed without it. All real position lifecycle STATE
    // lives on LendingPositionRegistry, a separate deployed contract, not
    // here -- see that contract's own top-of-file doc comment for why
    // (real, measured EIP-170 pressure, not a stylistic split).
    // ---------------------------------------------------------------------

    /// @dev One-shot, GOVERNANCE-gated, deliberately NO timelock/rotation
    /// path, unlike allowedRouters: a vault's
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

    // ---------------------------------------------------------------------
    // v3/v7 (LP yield vault) state. All real LP position lifecycle STATE
    // (NFT custody, mint/increase/decrease/collect/close mechanics,
    // TWAP-guarded valuation, the positionManager 48h timelock) lives on
    // LpPositionRegistry, a separate deployed contract, not here -- see
    // that contract's own top-of-file doc comment for why (real, measured
    // EIP-170 pressure, not a stylistic split). ILpPositionRegistry.LpLeg
    // is used directly as this contract's own LpLeg type (declared once,
    // on the interface, rather than duplicated here): ABI-wise this
    // changes nothing for executor/keeperServiceV4.ts, Solidity's ABI
    // encoding is structural (tuple shape), not tied to which file
    // declares the struct.
    // ---------------------------------------------------------------------

    /// @dev One-shot, GOVERNANCE-gated, deliberately NO timelock/rotation
    /// path, same reasoning as lendingRegistry below: this vault's
    /// LpPositionRegistry is deployed specifically for THIS vault and
    /// tracks THIS vault's own live LP position state, rotating it mid-life
    /// would orphan that state, not just be unnecessary.
    address public lpRegistry;

    /// @dev v4 only. Mirrors this project's own "keeper supplies real, current
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
    event LendingRegistrySet(address indexed lendingRegistry);
    event LpRegistrySet(address indexed lpRegistry);
    event BridgeDepositExecuted(uint256 indexed positionId, uint256 indexed chainId, uint256 amount);
    event CrossChainWithdrawalCompleted(uint256 indexed positionId, uint256 amountReceived);
    event StaleWithdrawalBountyAmountSet(uint256 amount);
    event StaleWithdrawalBountyPaid(address indexed to, uint256 amount);
    event PerformanceFeeAccrued(address indexed recipient, uint256 feeUSDC, uint256 feeShares, uint256 newHighWaterMarkPricePerShare);

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
    error LendingRegistryAlreadySet();
    error LendingRegistryNotSet();
    error CctpTokenMessengerNotSet();
    error ChainKeeperNotSet(uint256 chainId);
    error NotLendingRegistry();
    error LpRegistryAlreadySet();
    error LpRegistryNotSet();

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

    /// @dev Accrues before, not after: a deposit/mint changes totalSupply(),
    /// which would shift price-per-share out from under _accrueFee()'s own
    /// pre/post comparison if it ran afterward. Running it first means the
    /// fee is always assessed against the state immediately before this
    /// specific deposit changes anything, never mixed in with it.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        _accrueFee();
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Same ordering reasoning as _deposit above, mirrored for
    /// withdraw/redeem.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        _accrueFee();
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return DECIMALS_OFFSET;
    }

    /// @dev Never a live balanceOf read, see _ledger's doc comment above.
    /// Both LP positions and cross-chain lending positions are the real
    /// external valuations this contract performs, each delegated entirely
    /// to its own satellite registry contract.
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

    /// @dev Always 0 until GOVERNANCE wires a real lpRegistry post-creation.
    /// Delegates entirely to LpPositionRegistry's own totalValueUSDC, see
    /// that contract's own doc comments for the TWAP-guarded valuation
    /// rules -- this vault holds no LP position state of its own to sum.
    function _valueLpPositions() internal view returns (uint256) {
        if (lpRegistry == address(0)) return 0;
        return ILpPositionRegistry(lpRegistry).totalValueUSDC();
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
        ILpPositionRegistry.LpLeg calldata lpLeg,
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
        // close of an open position, see _executeLpLeg below), same gate
        // contracts/MandateVault.sol's own executeDecision already uses.
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

    // ---------------------------------------------------------------------
    // v3/v7 (LP yield vault) execution. Deliberately thin: all real position
    // mechanics/state live on LpPositionRegistry (a separate deployed
    // contract, see its own top-of-file comment), this vault only ever
    // validates registered assets, hands off exactly the tokens a leg
    // needs, and debits/credits its own ledger by the REAL amounts the
    // registry reports back -- never the keeper-supplied Desired amounts,
    // same "trust the real external call's return value, not the request"
    // discipline _executeSwapLeg's amountOut already uses.
    // ---------------------------------------------------------------------

    /// @notice Dispatches one LP operation to LpPositionRegistry. Only ever
    /// reaches real position mechanics once lpRegistry is wired (post-
    /// creation, by GOVERNANCE); never populated for any vault version that
    /// doesn't use LP.
    function _executeLpLeg(IVaultPolicy.DecisionAction action, ILpPositionRegistry.LpLeg calldata leg) internal {
        if (lpRegistry == address(0)) revert LpRegistryNotSet();

        if (action == IVaultPolicy.DecisionAction.LP_OPEN) {
            address token0 = IUniswapV3PoolMinimal(leg.pool).token0();
            address token1 = IUniswapV3PoolMinimal(leg.pool).token1();
            if (!isRegisteredAsset[token0]) revert UnregisteredAsset(token0);
            if (!isRegisteredAsset[token1]) revert UnregisteredAsset(token1);
            // Push exactly what the leg asks for; LpPositionRegistry
            // refunds any unused leftover back to this vault before
            // returning, and reports the REAL amounts consumed, see that
            // contract's own top-of-file comment for the full atomicity
            // reasoning.
            IERC20(token0).safeTransfer(lpRegistry, leg.amount0Desired);
            IERC20(token1).safeTransfer(lpRegistry, leg.amount1Desired);
            (, uint256 amount0Used, uint256 amount1Used) = ILpPositionRegistry(lpRegistry).openPosition(leg, token0, token1);
            _ledger[token0] -= amount0Used;
            _ledger[token1] -= amount1Used;
        } else if (action == IVaultPolicy.DecisionAction.LP_INCREASE) {
            (address token0, address token1) = ILpPositionRegistry(lpRegistry).tokensOf(leg.tokenId);
            IERC20(token0).safeTransfer(lpRegistry, leg.amount0Desired);
            IERC20(token1).safeTransfer(lpRegistry, leg.amount1Desired);
            (uint256 amount0Used, uint256 amount1Used) = ILpPositionRegistry(lpRegistry).increasePosition(leg, token0, token1);
            _ledger[token0] -= amount0Used;
            _ledger[token1] -= amount1Used;
        } else if (action == IVaultPolicy.DecisionAction.LP_DECREASE) {
            (uint256 amount0, uint256 amount1, address token0, address token1) = ILpPositionRegistry(lpRegistry).decreasePosition(leg);
            _ledger[token0] += amount0;
            _ledger[token1] += amount1;
        } else if (action == IVaultPolicy.DecisionAction.LP_COLLECT) {
            (uint256 amount0, uint256 amount1, address token0, address token1) = ILpPositionRegistry(lpRegistry).collectFees(leg);
            _ledger[token0] += amount0;
            _ledger[token1] += amount1;
        } else if (action == IVaultPolicy.DecisionAction.LP_CLOSE || action == IVaultPolicy.DecisionAction.EMERGENCY_EXIT_TO_STABLE) {
            // EMERGENCY_EXIT_TO_STABLE reaching here means the keeper
            // supplied a populated leg identifying an open position to
            // unwind, same unconditional safety-valve action as
            // contracts/MandateVault.sol's own executeDecision. Closing is
            // always the correct, safe interpretation regardless of which
            // action label carries it here.
            (uint256 amount0, uint256 amount1, address token0, address token1) = ILpPositionRegistry(lpRegistry).closePosition(leg);
            _ledger[token0] += amount0;
            _ledger[token1] += amount1;
        }
    }

    /// @dev One-line delegate to LpPositionRegistry's own tracking, a
    /// no-op until lpRegistry is wired.
    function _syncLpOutOfRangeTracking() internal {
        if (lpRegistry != address(0)) ILpPositionRegistry(lpRegistry).syncOutOfRangeTracking();
    }

    function setLpRegistry(address registry) external onlyGovernance {
        if (lpRegistry != address(0)) revert LpRegistryAlreadySet();
        lpRegistry = registry;
        emit LpRegistrySet(registry);
    }

    // ---------------------------------------------------------------------
    // v4 (cross-chain lending vault) execution. Deliberately thin: all real
    // position lifecycle state/rules live on LendingPositionRegistry (a
    // separate deployed contract, see its own top-of-file comment), this
    // vault only ever holds custody (the ledger, the real depositForBurn
    // call) and dispatches, same "unconditionally execute whatever the
    // keeper supplied, protected only by pre/post policy validation" shape
    // _executeSwapLeg already uses.
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
            // position to unwind: closing is always the correct, safe
            // interpretation regardless of which action label carries it
            // here. One executeDecision call per open position (see
            // executor/keeperService.ts's closeAllOpenCrossChainPositions),
            // never an onchain loop here, keeping this dispatcher thin.
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
            // Always empty until GOVERNANCE wires a real lpRegistry.
            // Delegates to LpPositionRegistry's own currentPositions, same
            // reasoning as _valueLendingPositions/currentLendingPositions
            // below.
            currentLpPositions: lpRegistry == address(0)
                ? new IVaultPolicy.LpPositionHolding[](0)
                : ILpPositionRegistry(lpRegistry).currentPositions(nav),
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

    function _accrueFee() internal {
        uint256 feeBps = IVaultPolicy(policy).performanceFeeBps();
        if (feeBps == 0) return;
        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 unit = 10 ** decimals();
        uint256 currentPricePerShare = convertToAssets(unit);
        uint256 previousHighWaterMark = feeHighWaterMarkPricePerShare;

        // At or below the existing high-water-mark: do nothing at all,
        // the high-water-mark itself must never move down. Only exits
        // this function without reaching either of the two spots below
        // that write feeHighWaterMarkPricePerShare.
        if (previousHighWaterMark != 0 && currentPricePerShare <= previousHighWaterMark) return;

        if (previousHighWaterMark != 0) {
            // unchecked is safe throughout: the subtraction cannot
            // underflow (guarded by the comparison just above), feeBps is
            // bounded to 10_000 by convention (never attacker-controlled,
            // only ever set once at this vault's own deployment), and a
            // USDC-denominated amount overflowing uint256 would require
            // values many orders of magnitude beyond any real NAV this
            // project could ever hold.
            unchecked {
                uint256 profitUSDC = ((currentPricePerShare - previousHighWaterMark) * supply) / unit;
                uint256 feeUSDC = (profitUSDC * feeBps) / 10_000;
                if (feeUSDC != 0) {
                    // Standard closed-form share-minting formula (Yearn
                    // V3/Morpho Vaults V2): mints exactly enough shares
                    // that their value, at the POST-mint price per share,
                    // equals feeUSDC -- existing holders' total assets are
                    // untouched, only diluted by the new shares.
                    uint256 feeShares = (feeUSDC * supply) / (totalAssets() - feeUSDC);
                    address recipient = IVaultFactory(factory).protocolTreasury();
                    _mint(recipient, feeShares);
                    // Recomputed from live state after minting, not
                    // derived from the math above: guarantees the stored
                    // high-water-mark matches exactly what the next
                    // _accrueFee() call will itself read back via
                    // convertToAssets.
                    uint256 newHighWaterMark = convertToAssets(unit);
                    feeHighWaterMarkPricePerShare = newHighWaterMark;
                    emit PerformanceFeeAccrued(recipient, feeUSDC, feeShares, newHighWaterMark);
                    return;
                }
            }
        }

        // Reached only for lazy baseline initialization (previousHighWaterMark
        // was 0) or a dust-level gain too small to charge a fee on -- both
        // simply adopt the current price per share as the new
        // high-water-mark, never itself taxed.
        feeHighWaterMarkPricePerShare = currentPricePerShare;
    }

    /// @notice Permissionless: lets the fee accrue (or the high-water-mark
    /// ratchet up on dust-level gains) even during a stretch with no real
    /// deposit/withdraw to piggyback on, same "anyone can escalate, the
    /// contract enforces the real condition" pattern as checkAndAutoPause.
    /// A no-op if performanceFeeBps is 0.
    function accrueFee() external {
        _accrueFee();
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
