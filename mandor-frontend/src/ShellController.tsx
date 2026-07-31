import React from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import AppShell from './AppShell';
import { defaultShellProps } from './types';
import type { ShellProps, ShellVals } from './types';
import { VAULT_CONFIGS } from './lib/vaults';
import { readVaultTotals, readUserPosition } from './lib/vaultReads';

/**
 * All state and derived display values for the app shell.
 * Ported 1:1 from the design source: state shape, handlers and renderVals()
 * are unchanged, so the rendered output matches the original pixel for pixel.
 *
 * Phase 1 wiring (real wallet connection): this class no longer owns its
 * own fake `connected` boolean -- connection state is now driven entirely
 * by the real Privy auth props passed in from ShellControllerWithAuth
 * below (the same usePrivy/useWallets/useCreateWallet pattern already
 * proven in src/App.tsx). Every other phase (vault balances, deposits,
 * decision timeline, wallet feed, analytics) is still simulated, unchanged
 * from the original design, wired in later phases.
 */
class ShellControllerInner extends React.Component<ShellProps, any> {
  static defaultProps: ShellProps = defaultShellProps;

  state = {
    limitPop: null,
    settings: { currency: 'USD', refresh: '30 seconds', vaultView: 'All vaults' },
    connected: false,
    active: 'Vaults',
    tlOpen: {},
    vOpen: {},
    tlFilter: 'all',
    tlTrace: {},
    pvFilter: 'all',
    pvTrace: {},
    pfAcc: {},
    // connected: no longer local state, see isConnected() -- derived from
    // this.props.authenticated/userAddress (real Privy auth), Phase 1.
    wallet: { tab: 'none', rcvOpen: false, token: 'USDC', to: '', amount: '', step: 'form', txHash: null, copied: false, sent: [], sentAmt: '', sentTo: '' },
    rpc: {
      v3: { status: 'loading', totalAssets: null, maxDeposit: null },
      v4: { status: 'loading', totalAssets: null, maxDeposit: null },
      v5: { status: 'loading', totalAssets: null, maxDeposit: null },
      v7: { status: 'loading', totalAssets: null, maxDeposit: null }
    },
    user: {
      v3: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null },
      v4: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null },
      v5: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null },
      v7: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null }
    },
    forms: {
      v3: { tab: 'deposit', amount: '' },
      v4: { tab: 'deposit', amount: '' },
      v5: { tab: 'deposit', amount: '' },
      v7: { tab: 'deposit', amount: '' }
    },
    tx: {
      v3: { phase: 'idle', txHash: null },
      v4: { phase: 'idle', txHash: null },
      v5: { phase: 'idle', txHash: null },
      v7: { phase: 'idle', txHash: null }
    }
  };

  money = null;
  // Guards fetchAllVaultsSequentially/fetchAllUsersSequentially against a
  // real, confirmed-live failure mode: React.StrictMode (see main.tsx)
  // mounts, unmounts and remounts this component once in dev, and without
  // this guard the first (discarded) instance's in-flight sequential fetch
  // loop keeps running in the background after unmount, doubling
  // concurrent load against the real Arc Testnet RPC and tripping its rate
  // limit -- confirmed by RPC errors going away once this guard was added.
  // Never fires in production (no StrictMode there, single mount only).
  _destroyed = false;

  // Internal contract names ("Mandate") must never surface in the UI.
  vaultMeta = {
    v3: {
      limited: true, ver: 'v3',
      rpcData: { totalAssets: 24618.40, maxDeposit: 25381.60 },
      userData: { shares: 1500.00, position: 1512.30, maxWithdraw: 1512.30, walletBalance: 12500.00, allowance: 0 },
      ctaBg: '#00E5A3', ctaHover: '#33EAB5', ctaText: '#0D0E12', tabBg: 'rgba(0,229,163,0.16)',
      timeline: [
        { action: 'HOLD', text: 'LP deployment skipped. cirBTC price restriction still active on the DEX.', time: '2026 07 23 · 14:02 UTC' },
        { action: 'CHECK', text: 'Pool state read. Fee tier 0.30%, no position open.', time: '2026 07 23 · 08:02 UTC' }
      ]
    },
    v4: {
      limited: false, ver: 'v6', apy: 3.12,
      rpcData: { totalAssets: 61205.88, maxDeposit: 38794.12 },
      userData: { shares: 4000.00, position: 4038.20, maxWithdraw: 4038.20, walletBalance: 12500.00, allowance: 0 },
      ctaBg: '#0066FF', ctaHover: '#1A75FF', ctaText: '#FFFFFF', tabBg: 'rgba(0,102,255,0.18)',
      timeline: [
        { action: 'EXECUTE', text: 'Bridged USDC via CCTP and supplied to Aave v3 on Arbitrum Sepolia.', time: '2026 07 23 · 13:47 UTC' },
        { action: 'CHECK', text: 'Aave USDC supply rate read on Arbitrum Sepolia: 3.12%.', time: '2026 07 23 · 07:47 UTC' }
      ]
    },
    v5: {
      limited: true, ver: 'v5',
      rpcData: { totalAssets: 9842.16, maxDeposit: 40157.84 },
      userData: { shares: 750.00, position: 750.00, maxWithdraw: 750.00, walletBalance: 12500.00, allowance: 0 },
      ctaBg: '#0066FF', ctaHover: '#1A75FF', ctaText: '#FFFFFF', tabBg: 'rgba(0,102,255,0.18)',
      timeline: [
        { action: 'HOLD', text: 'Rebalance blocked in both directions. No USDC/cirBTC pool exists on the DEX.', time: '2026 07 23 · 12:30 UTC' },
        { action: 'CHECK', text: 'Target weights unchanged at 50 / 50. Vault remains 100% USDC.', time: '2026 07 23 · 06:30 UTC' }
      ]
    },
    v7: {
      limited: false, ver: 'v7', asset: 'WUSDC',
      rpcData: { totalAssets: 3260.00, maxDeposit: 46740.00 },
      userData: { shares: 0, position: 0, maxWithdraw: 0, walletBalance: 2500.00, allowance: 0 },
      ctaBg: '#00E5A3', ctaHover: '#33EAB5', ctaText: '#0D0E12', tabBg: 'rgba(0,229,163,0.16)',
      timeline: [
        { action: 'EXECUTE', text: 'Vault and LP position contracts deployed on Arc Testnet.', time: '2026 07 25 · 10:12 UTC' },
        { action: 'CHECK', text: 'Pool state read: 184,000 WUSDC / 147,000 EURC, fee tier 0.30%. Volume too low for an APY estimate.', time: '2026 07 26 · 08:00 UTC' }
      ]
    }
  };

  limitCopy = {
    v3: 'LP execution is currently blocked. cirBTC carries an independent price restriction on the DEX, so the agent cannot open a real liquidity position yet. Deposits and withdrawals still settle normally.',
    v5: 'Rebalancing is fully blocked in both directions. No USDC/cirBTC pool exists on the DEX and no independent reference price is available. The vault holds 100% USDC and cannot move. A functional demo runs in the Paper Vault.'
  };

  // Phase 1: real connection state, derived from Privy auth props (see
  // ShellControllerWithAuth below), never from local state -- there is no
  // fake "connected" flag to get out of sync with the real wallet.
  isConnected() {
    return !!(this.props.authenticated && this.props.userAddress);
  }

  componentWillUnmount() {
    this._destroyed = true;
    document.removeEventListener('mousedown', this.onDocDown, true);
    document.removeEventListener('keydown', this.onDocKey, true);
    window.removeEventListener('scroll', this.onDocScroll, true);
  }

  componentDidUpdate(prevProps: ShellProps) {
    // Mirrors the old fake connect()'s side effect: the moment a real
    // wallet becomes connected, kick off the (still-simulated, Phase 2)
    // per-vault user data fetch, same as clicking "Connect" used to do.
    const wasConnected = !!(prevProps.authenticated && prevProps.userAddress);
    if (!wasConnected && this.isConnected()) {
      this.fetchAllUsersSequentially();
    }
  }

  // Sequential, never Promise.all/forEach-in-parallel: this public RPC
  // (rpc.testnet.arc.network) rate-limits concurrent requests, confirmed
  // live, see lib/vaultReads.ts's own RPC_PACING_MS note. Each vault is
  // wrapped in its own try/catch so one failed read (e.g. a rate limit
  // despite the pacing) can't silently stop every vault after it in the
  // sequence -- confirmed live this was a real failure mode, not
  // hypothetical, before this wrapping was added.
  async fetchAllVaultsSequentially() {
    for (const id of ['v3', 'v4', 'v5', 'v7']) {
      if (this._destroyed) return;
      try {
        await this.fetchVault(id);
      } catch (e) {
        console.warn(`fetchVault(${id}) failed`, e);
      }
    }
  }

  async fetchAllUsersSequentially() {
    for (const id of ['v3', 'v4', 'v5', 'v7']) {
      if (this._destroyed) return;
      if (this.state.user[id].status !== 'idle') continue;
      try {
        await this.fetchUser(id);
      } catch (e) {
        console.warn(`fetchUser(${id}) failed`, e);
      }
    }
  }

  componentDidMount() {
    this.onDocDown = (e) => {
      if (!this.state.limitPop) return;
      const t = e.target;
      if (t && t.closest && t.closest('[data-limit-pop], [data-limit-anchor]')) return;
      this.setState({ limitPop: null });
    };
    this.onDocKey = (e) => {
      if (e.key !== 'Escape') return;
      if (this.state.limitPop) this.setState({ limitPop: null });
      if (this.state.wallet.rcvOpen) this.setWl({ rcvOpen: false });
    };
    this.onDocScroll = () => { if (this.state.limitPop) this.setState({ limitPop: null }); };
    document.addEventListener('mousedown', this.onDocDown, true);
    document.addEventListener('keydown', this.onDocKey, true);
    window.addEventListener('scroll', this.onDocScroll, true);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll('main').forEach((m) => { m.scrollTop = 0; });
    });
    this.walletFeedBase = this.walletFeedBase.map((e) => ({ ...e, hash: this.randHash() }));
    import('./shared/money.js').then((m) => {
      this.money = m;
      this.fetchAllVaultsSequentially();
    });
  }

  async fetchVault(id) {
    if (this._destroyed) return;
    this.setState((s) => ({ rpc: { ...s.rpc, [id]: { ...s.rpc[id], status: 'loading' } } }));
    const totals = await readVaultTotals(VAULT_CONFIGS[id]);
    if (this._destroyed) return;
    this.setState((s) => ({ rpc: { ...s.rpc, [id]: { status: 'loaded', ...totals } } }));
  }

  async fetchUser(id) {
    const userAddress = this.props.userAddress;
    if (!userAddress || this._destroyed) return;
    this.setState((s) => ({ user: { ...s.user, [id]: { ...s.user[id], status: 'loading' } } }));
    const position = await readUserPosition(VAULT_CONFIGS[id], userAddress);
    if (this._destroyed) return;
    this.setState((s) => ({ user: { ...s.user, [id]: { status: 'loaded', ...position } } }));
  }

  randHash() {
    let h = '0x';
    for (let i = 0; i < 64; i++) h += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return h;
  }

  icons = {
    'Vaults': '<path d="M3 6h12v10H3z"/><path d="M9 9v4"/><circle cx="9" cy="11" r="3.2"/>',
    'My Portfolio': '<circle cx="9" cy="9" r="7"/><path d="M9 2v7l5 4.5"/>',
    'Wallet': '<path d="M2.5 5.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"/><path d="M2.5 5.5V4a1 1 0 0 1 1-1H13"/><circle cx="12.2" cy="10.5" r="0.8" fill="currentColor" stroke="none"/>',
    'Decision Timeline': '<path d="M4 3v12"/><circle cx="4" cy="5" r="1.6"/><circle cx="4" cy="13" r="1.6"/><path d="M7.5 5h7M7.5 13h7"/>',
    'Paper Vault': '<path d="M5 2.5h6l3 3v9.5H5z"/><path d="M11 2.5v3h3"/>',
    'Analytics': '<path d="M3 15V9M9 15V4M15 15v-7"/>',
    'How it Works': '<circle cx="9" cy="9" r="7"/><path d="M7 7a2 2 0 1 1 2.7 1.9c-.6.2-.7.7-.7 1.3"/><circle cx="9" cy="12.6" r="0.7" fill="currentColor" stroke="none"/>',
    'Settings': '<circle cx="9" cy="9" r="2.5"/><path d="M9 2v2.2M9 13.8V16M2 9h2.2M13.8 9H16M4.2 4.2l1.5 1.5M12.3 12.3l1.5 1.5M13.8 4.2l-1.5 1.5M5.7 12.3l-1.5 1.5"/>'
  };

  fmt(v) {
    if (this.money === null || v === null || v === undefined) return '…';
    return this.money.formatUSDC(v);
  }

  clearOutcome(id) {
    const p = this.state.tx[id].phase;
    if (p === 'success' || p === 'failed' || p === 'cancelled') {
      this.setState((s) => ({ tx: { ...s.tx, [id]: { phase: 'idle', txHash: null } } }));
    }
  }

  setTx(id, phase, txHash) {
    this.setState((s) => ({ tx: { ...s.tx, [id]: { phase: phase, txHash: txHash || null } } }));
  }

  submitTx(id) {
    const u = this.state.user[id];
    const tab = this.state.forms[id].tab;
    const amt = parseFloat(this.state.forms[id].amount) || 0;
    if (amt <= 0) return;
    const outcome = this.props.txOutcome ?? 'success';

    if (tab === 'deposit' && amt > u.allowance) {
      this.setTx(id, 'approving');
      setTimeout(() => {
        if (outcome === 'cancelled') { this.setTx(id, 'cancelled'); return; }
        this.setState((s) => ({
          user: { ...s.user, [id]: { ...s.user[id], allowance: amt } },
          tx: { ...s.tx, [id]: { phase: 'idle', txHash: null } }
        }));
      }, 1500);
      return;
    }

    this.setTx(id, tab === 'deposit' ? 'depositing' : 'withdrawing');
    setTimeout(() => {
      if (outcome === 'cancelled') { this.setTx(id, 'cancelled'); return; }
      const hash = this.randHash();
      if (outcome === 'failed') { this.setTx(id, 'failed', hash); return; }
      this.setState((s) => {
        const su = s.user[id];
        const sr = s.rpc[id];
        const nu = tab === 'deposit'
          ? { ...su, walletBalance: su.walletBalance - amt, position: su.position + amt, shares: su.shares + amt, maxWithdraw: su.maxWithdraw + amt, allowance: Math.max(0, su.allowance - amt) }
          : { ...su, walletBalance: su.walletBalance + amt, position: su.position - amt, shares: su.shares - amt, maxWithdraw: su.maxWithdraw - amt };
        const nr = tab === 'deposit'
          ? { ...sr, totalAssets: sr.totalAssets + amt, maxDeposit: Math.max(0, sr.maxDeposit - amt) }
          : { ...sr, totalAssets: sr.totalAssets - amt, maxDeposit: sr.maxDeposit + amt };
        const fe = { dir: tab === 'deposit' ? 'out' : 'in', type: (tab === 'deposit' ? 'Vault deposit · ' : 'Vault withdrawal · ') + this.vaultMeta[id].ver, amount: amt, time: 'Just now', hash: hash };
        return {
          user: { ...s.user, [id]: nu },
          rpc: { ...s.rpc, [id]: nr },
          forms: { ...s.forms, [id]: { ...s.forms[id], amount: '' } },
          tx: { ...s.tx, [id]: { phase: 'success', txHash: hash } },
          wallet: { ...s.wallet, sent: [fe, ...s.wallet.sent] }
        };
      });
    }, 1800);
  }

  cardVals(id) {
    const demo = (this.props.scenario ?? 'today') === 'live demo';
    const meta = this.vaultMeta[id];
    const asset = meta.asset || 'USDC';
    const fm = (v) => (this.money === null || v === null || v === undefined) ? '…' : this.money.formatMoney(v, { symbol: '', decimals: 2 }) + ' ' + asset;
    const connected = this.isConnected();
    const r = this.state.rpc[id];
    const u = this.state.user[id];
    const f = this.state.forms[id];
    const tx = this.state.tx[id];
    const vLoaded = r.status === 'loaded';
    const uLoaded = connected && u.status === 'loaded';
    const uLoading = connected && u.status !== 'loaded';
    const tab = f.tab;
    const amt = parseFloat(f.amount) || 0;
    const busy = tx.phase === 'approving' || tx.phase === 'depositing' || tx.phase === 'withdrawing';

    let err = '';
    if (uLoaded && vLoaded && amt > 0) {
      if (tab === 'deposit') {
        if (amt > r.maxDeposit) err = 'Amount exceeds vault deposit capacity';
        else if (amt > u.walletBalance) err = 'Insufficient ' + asset + ' balance in wallet';
      } else if (amt > u.maxWithdraw) err = 'Amount exceeds withdrawable limit';
    }

    const needsApproval = tab === 'deposit' && uLoaded && amt > 0 && amt > u.allowance;
    let ctaLabel = (tab === 'deposit' ? 'Deposit ' : 'Withdraw ') + asset;
    if (needsApproval) ctaLabel = 'Approve ' + asset;
    if (tx.phase === 'approving') ctaLabel = 'Approving...';
    if (tx.phase === 'depositing') ctaLabel = 'Depositing...';
    if (tx.phase === 'withdrawing') ctaLabel = 'Withdrawing...';
    const ctaDisabled = busy || !uLoaded || !vLoaded || amt <= 0 || err !== '';
    const tlOpen = !!this.state.tlOpen[id];
    const open = !!this.state.vOpen[id];

    return {
      ActivePill: vLoaded && (demo || !meta.limited),
      Limited: vLoaded && !demo && meta.limited,
      ShowLimit: !demo && meta.limited,
      LimitClick: (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const left = Math.max(12, Math.min(r.left, window.innerWidth - 352));
        this.setState((s) => ({ limitPop: s.limitPop && s.limitPop.id === id ? null : { id, top: Math.round(r.bottom + 8), left: Math.round(left) } }));
      },
      Open: open,
      Toggle: () => this.setState((s) => ({ vOpen: { ...s.vOpen, [id]: !s.vOpen[id] } })),
      Rows: open ? '1fr' : '0fr',
      ChevRot: open ? 'rotate(180deg)' : 'rotate(0deg)',
      MyPos: uLoaded ? fm(u.position) : '—',
      PosVal: uLoaded ? fm(u.position) : '…',
      YieldVal: uLoaded ? '+' + fm(Math.max(0, u.position - u.shares)) : '…',
      Loading: !vLoaded,
      Loaded: vLoaded,
      Tvl: fm(r.totalAssets),
      Capacity: fm(r.maxDeposit),
      Apy: vLoaded && meta.apy != null ? meta.apy.toFixed(2) + '%' : '…',
      Locked: !connected,
      UserLoading: uLoading,
      FormReady: uLoaded,
      IsDep: tab === 'deposit',
      SelDep: () => this.setState((s) => ({ forms: { ...s.forms, [id]: { tab: 'deposit', amount: '' } }, tx: { ...s.tx, [id]: { phase: 'idle', txHash: null } } })),
      SelWd: () => this.setState((s) => ({ forms: { ...s.forms, [id]: { tab: 'withdraw', amount: '' } }, tx: { ...s.tx, [id]: { phase: 'idle', txHash: null } } })),
      DepColor: tab === 'deposit' ? '#FFFFFF' : '#6B7280',
      DepBg: tab === 'deposit' ? meta.tabBg : 'transparent',
      WdColor: tab === 'withdraw' ? '#FFFFFF' : '#6B7280',
      WdBg: tab === 'withdraw' ? meta.tabBg : 'transparent',
      Amount: f.amount,
      OnAmount: (e) => {
        const val = e.target.value.replace(/[^0-9.]/g, '');
        this.clearOutcome(id);
        this.setState((s) => ({ forms: { ...s.forms, [id]: { ...s.forms[id], amount: val } } }));
      },
      SetMax: () => {
        if (!uLoaded || !vLoaded) return;
        this.clearOutcome(id);
        const max = tab === 'deposit' ? Math.min(r.maxDeposit, u.walletBalance) : u.maxWithdraw;
        this.setState((s) => ({ forms: { ...s.forms, [id]: { ...s.forms[id], amount: max.toFixed(2) } } }));
      },
      InDisabled: busy,
      InOpacity: busy ? 0.45 : 1,
      InBorder: err !== '' ? 'rgba(248,113,113,0.5)' : '#242936',
      HasErr: err !== '',
      Err: err,
      MetaLabel: tab === 'deposit' ? 'Wallet balance' : 'Available to withdraw',
      MetaValue: uLoaded ? fm(tab === 'deposit' ? u.walletBalance : u.maxWithdraw) : '…',
      Allowance: uLoaded ? fm(u.allowance) : '…',
      Submit: () => this.submitTx(id),
      CtaLabel: ctaLabel,
      CtaDisabled: ctaDisabled,
      CtaBg: ctaDisabled ? '#1D2635' : meta.ctaBg,
      CtaHoverBg: ctaDisabled ? '#1D2635' : meta.ctaHover,
      CtaColor: ctaDisabled ? '#6B7280' : meta.ctaText,
      CtaOpacity: ctaDisabled ? 0.7 : 1,
      CtaCursor: ctaDisabled ? 'not-allowed' : 'pointer',
      TxOk: tx.phase === 'success',
      TxFail: tx.phase === 'failed',
      TxCancel: tx.phase === 'cancelled',
      TxUrl: tx.txHash ? 'https://testnet.arcscan.app/tx/' + tx.txHash : '#',
      TlToggle: () => this.setState((s) => ({ tlOpen: { ...s.tlOpen, [id]: !s.tlOpen[id] } })),
      TlOpen: tlOpen,
      TlChevron: tlOpen ? '▴' : '▾',
      Timeline: meta.timeline.map((t) => ({
        ...t,
        color: t.action === 'HOLD' ? '#F59E0B' : t.action === 'EXECUTE' ? '#00E5A3' : '#94A3B8',
        border: t.action === 'HOLD' ? 'rgba(245,158,11,0.3)' : t.action === 'EXECUTE' ? 'rgba(0,229,163,0.3)' : '#3A4152'
      }))
    };
  }

  wlAddressFull = '0x7f3A2b8C4d5E6f708192A3b4C5d6E7f8A9B09c4E';

  walletFeedBase = [
    { dir: 'out', type: 'Sent', detail: '0x3cA1…88F2', token: 'USDC', amount: 120.00, time: '2026 07 23 · 09:14 UTC', status: 'Confirmed' },
    { dir: 'out', type: 'Vault deposit', detail: 'v3 · LP Yield', token: 'USDC', amount: 1500.00, time: '2026 07 22 · 18:03 UTC', status: 'Confirmed' },
    { dir: 'out', type: 'Vault deposit', detail: 'v6 · Paper Vault', token: 'USDC', amount: 4000.00, time: '2026 07 22 · 16:40 UTC', status: 'Confirmed' },
    { dir: 'out', type: 'Vault deposit', detail: 'v5 · Ergodic', token: 'USDC', amount: 750.00, time: '2026 07 22 · 16:12 UTC', status: 'Confirmed' },
    { dir: 'in', type: 'Received', detail: '0x91b4…C77e', token: 'USDC', amount: 300.00, time: '2026 07 21 · 11:26 UTC', status: 'Confirmed' },
    { dir: 'in', type: 'Received', detail: 'Arc faucet', token: 'USDC', amount: 18570.00, time: '2026 07 21 · 10:05 UTC', status: 'Confirmed' }
  ];

  wlTokenMeta = [
    { sym: 'USDC', name: 'USD Coin', dec: 2, color: '#3385FF', bg: 'rgba(0,102,255,0.1)', border: 'rgba(0,102,255,0.3)' },
    { sym: 'EURC', name: 'Euro Coin', dec: 2, color: '#9184D9', bg: 'rgba(145,132,217,0.1)', border: 'rgba(145,132,217,0.3)' },
    { sym: 'wUSDC', name: 'Wrapped USDC', dec: 2, color: '#00E5A3', bg: 'rgba(0,229,163,0.08)', border: 'rgba(0,229,163,0.25)' },
    { sym: 'cirBTC', name: 'Circle BTC', dec: 4, color: '#E0B23C', bg: 'rgba(224,178,60,0.1)', border: 'rgba(224,178,60,0.3)' }
  ];

  fmtNum(v, dec) {
    if (this.money === null || v === null || v === undefined) return '…';
    return this.money.formatMoney(v, { symbol: '', decimals: dec === undefined ? 2 : dec });
  }

  fmtUsd(v) {
    if (this.money === null || v === null || v === undefined) return '…';
    return this.money.formatMoney(v);
  }

  wlHoldings() {
    const u = this.state.user;
    const qty = {
      USDC: u.v3.walletBalance || 0,
      EURC: 1650.00,
      wUSDC: u.v7.walletBalance == null ? this.vaultMeta.v7.userData.walletBalance : u.v7.walletBalance,
      cirBTC: 0.05
    };
    const px = { USDC: 1, EURC: 1.08, wUSDC: 1, cirBTC: 64890 };
    const rows = this.wlTokenMeta.map((m) => ({ ...m, qty: qty[m.sym], usd: qty[m.sym] * px[m.sym] }));
    const total = rows.reduce((s, r) => s + r.usd, 0);
    return {
      total,
      rows: rows.map((r) => {
        const p = total > 0 ? (r.usd / total) * 100 : 0;
        return {
          sym: r.sym, name: r.name, color: r.color, bg: r.bg, border: r.border, qty: r.qty, dec: r.dec,
          mark: r.sym.slice(0, 1).toUpperCase(),
          bal: this.fmtNum(r.qty, r.dec),
          usd: this.fmtUsd(r.usd),
          pct: p.toFixed(1) + '%',
          barW: p.toFixed(1) + '%'
        };
      })
    };
  }

  setWl(patch) {
    this.setState((s) => ({ wallet: { ...s.wallet, ...patch } }));
  }

  shortAddr(a) {
    return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
  }

  wlQr() {
    if (this._wlQrCache) return this._wlQrCache;
    let seed = 0;
    for (const c of this.wlAddressFull) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const finder = (x, y) => (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    let cells = '';
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
      if (finder(x, y)) continue;
      if (rand() > 0.52) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    const f = (x, y) => '<rect x="' + x + '" y="' + y + '" width="7" height="7"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#12141B"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3"/>';
    this._wlQrCache = { __html: '<svg viewBox="0 0 21 21" width="212" height="212" fill="#FFFFFF" shape-rendering="crispEdges" aria-hidden="true">' + f(0, 0) + f(14, 0) + f(0, 14) + cells + '</svg>' };
    return this._wlQrCache;
  }

  wlConfirm() {
    const amt = parseFloat(this.state.wallet.amount) || 0;
    const tok = this.state.wallet.token || 'USDC';
    const dec = tok === 'cirBTC' ? 4 : 2;
    this.setWl({ step: 'pending' });
    setTimeout(() => {
      const outcome = this.props.txOutcome ?? 'success';
      if (outcome === 'cancelled') { this.setWl({ step: 'cancelled' }); return; }
      if (outcome === 'failed') { this.setWl({ step: 'failed', txHash: this.randHash() }); return; }
      const hash = this.randHash();
      this.setState((s) => {
        const nu = {};
        const debit = tok === 'USDC' ? amt + 0.01 : 0.01;
        ['v3', 'v4', 'v5'].forEach((id) => { nu[id] = { ...s.user[id], walletBalance: (s.user[id].walletBalance || 0) - debit }; });
        const to = this.shortAddr(s.wallet.to.trim());
        const entry = { dir: 'out', type: 'Sent', detail: to, token: tok, amount: amt, time: 'Just now', hash: hash, status: 'Confirmed' };
        return { user: nu, wallet: { ...s.wallet, step: 'success', txHash: hash, to: '', amount: '', sent: [entry, ...s.wallet.sent], sentAmt: this.fmtNum(amt, dec) + ' ' + tok, sentTo: to } };
      });
    }, 1800);
  }

  wlVals() {
    const w = this.state.wallet;
    const connected = this.isConnected();
    const ready = connected && ['v3', 'v4', 'v5'].every((id) => this.state.user[id].status === 'loaded');
    const hold = this.wlHoldings();
    const tok = w.token || 'USDC';
    const sel = hold.rows.find((r) => r.sym === tok) || hold.rows[0];
    const dec = sel.dec;
    const gas = tok === 'USDC' ? 0.01 : 0;
    const bal = sel.qty || 0;
    const amt = parseFloat(w.amount) || 0;
    const to = w.to.trim();
    const addrOk = /^0x[a-fA-F0-9]{40}$/.test(to);
    let toErr = '';
    if (to !== '' && !addrOk) toErr = 'Enter a valid 0x address (42 characters)';
    else if (addrOk && to.toLowerCase() === this.wlAddressFull.toLowerCase()) toErr = 'Recipient is your own address';
    let amtErr = '';
    if (amt > 0 && amt + gas > bal) amtErr = 'Insufficient ' + tok + ' balance' + (gas > 0 ? ' including gas fee' : '');
    const canReview = addrOk && toErr === '' && amt > 0 && amtErr === '';
    const mapItem = (e) => ({
      type: e.type, time: e.time,
      detail: e.detail || '',
      hasDetail: !!e.detail,
      token: e.token || 'USDC',
      amt: (e.dir === 'in' ? '+' : '−') + this.fmtNum(e.amount, 2),
      color: e.dir === 'in' ? '#00E5A3' : '#F87171',
      iconBg: e.dir === 'in' ? 'rgba(0,229,163,0.08)' : 'rgba(248,113,113,0.08)',
      iconBorder: e.dir === 'in' ? 'rgba(0,229,163,0.25)' : 'rgba(248,113,113,0.28)',
      rot: e.dir === 'in' ? '180deg' : '0deg',
      status: e.status || 'Confirmed',
      stColor: (e.status || 'Confirmed') === 'Confirmed' ? '#00E5A3' : '#E0B23C',
      stBorder: (e.status || 'Confirmed') === 'Confirmed' ? 'rgba(0,229,163,0.3)' : 'rgba(224,178,60,0.35)',
      url: e.hash ? 'https://testnet.arcscan.app/tx/' + e.hash : '#'
    });
    return {
      wlLocked: !connected,
      wlLoading: connected && !ready,
      wlReady: ready,
      wlAddress: this.wlAddressFull,
      wlBalance: this.fmtNum(bal, dec) + ' ' + tok,
      wlToken: tok,
      wlOnToken: (e) => this.setWl({ token: e.target.value, amount: '' }),
      wlQrHtml: this.wlQr(),
      wlCopy: () => {
        try { navigator.clipboard.writeText(this.wlAddressFull); } catch (e) {}
        this.setWl({ copied: true });
        clearTimeout(this._wlCopyT);
        this._wlCopyT = setTimeout(() => this.setWl({ copied: false }), 1600);
      },
      wlCopyLabel: w.copied ? 'Copied' : 'Copy',
      wlShare: () => {
        if (navigator.share) navigator.share({ text: this.wlAddressFull }).catch(() => {});
        else try { navigator.clipboard.writeText(this.wlAddressFull); } catch (e) {}
      },
      wlTotal: this.fmtUsd(hold.total),
      wlAssets: hold.rows,
      wlAssetCount: hold.rows.length + ' TOKENS',
      wlRcvOpen: w.rcvOpen,
      wlOpenRcv: () => this.setWl({ rcvOpen: true }),
      wlStop: (e) => e.stopPropagation(),
      wlCloseRcv: () => this.setWl({ rcvOpen: false }),
      wlSendOpen: w.tab === 'send',
      wlToggleSend: () => this.setWl({ tab: w.tab === 'send' ? 'none' : 'send', step: 'form' }),
      wlSendCardBg: w.tab === 'send' ? 'rgba(0,102,255,0.06)' : '#161920',
      wlSendCardBorder: w.tab === 'send' ? 'rgba(0,102,255,0.4)' : '#242936',
      wlTo: w.to,
      wlOnTo: (e) => this.setWl({ to: e.target.value }),
      wlToBorder: toErr !== '' ? 'rgba(248,113,113,0.5)' : '#242936',
      wlHasToErr: toErr !== '',
      wlToErr: toErr,
      wlAmount: w.amount,
      wlOnAmount: (e) => this.setWl({ amount: e.target.value.replace(/[^0-9.]/g, '') }),
      wlAmtBorder: amtErr !== '' ? 'rgba(248,113,113,0.5)' : '#242936',
      wlHasAmtErr: amtErr !== '',
      wlAmtErr: amtErr,
      wlMax: () => this.setWl({ amount: Math.max(0, bal - gas).toFixed(dec) }),
      wlReview: () => { if (canReview) this.setWl({ step: 'review' }); },
      wlReviewDisabled: !canReview,
      wlRevCtaBg: canReview ? '#0066FF' : '#1D2635',
      wlRevCtaHoverBg: canReview ? '#1A75FF' : '#1D2635',
      wlRevCtaColor: canReview ? '#FFFFFF' : '#6B7280',
      wlRevCtaCursor: canReview ? 'pointer' : 'not-allowed',
      wlStepForm: w.step === 'form',
      wlStepReview: w.step === 'review',
      wlStepPending: w.step === 'pending',
      wlStepSuccess: w.step === 'success',
      wlStepFailed: w.step === 'failed',
      wlStepCancelled: w.step === 'cancelled',
      wlRevTo: to,
      wlRevToShort: this.shortAddr(to),
      wlRevAmt: this.fmtNum(amt, dec) + ' ' + tok,
      wlRevTotal: this.fmtNum(amt + gas, dec) + ' ' + tok,
      wlBack: () => this.setWl({ step: w.step === 'form' ? 'form' : (w.step === 'failed' || w.step === 'cancelled' ? 'review' : 'form') }),
      wlConfirm: () => this.wlConfirm(),
      wlSentAmt: w.sentAmt,
      wlSentTo: w.sentTo,
      wlTxUrl: w.txHash ? 'https://testnet.arcscan.app/tx/' + w.txHash : '#',
      wlReset: () => this.setWl({ step: 'form', to: '', amount: '', txHash: null }),
      wlFeed: [...w.sent, ...this.walletFeedBase].map(mapItem)
    };
  }

  pfMeta = {
    v3: { name: 'LP Yield', swatch: '#00E5A3', pctColor: '#00E5A3', pctBorder: 'rgba(0,229,163,0.3)' },
    v4: { name: 'Cross Chain Lending', swatch: '#0066FF', pctColor: '#3385FF', pctBorder: 'rgba(0,102,255,0.4)' },
    v5: { name: 'Ergodic Rebalancing', swatch: 'linear-gradient(90deg, #0066FF, #00A87A)', pctColor: '#94A3B8', pctBorder: '#3A4152' }
  };

  pfAssets(id) {
    const demo = (this.props.scenario ?? 'today') === 'live demo';
    const pos = this.state.user[id].position || 0;
    const hasBtc = id !== 'v4';
    if (!demo || !hasBtc) {
      const rows = [{ sym: 'USDC', bal: pos.toFixed(2), px: 'last price 1.00 USD', usd: this.fmt(pos), testnet: false }];
      if (hasBtc) rows.push({ sym: 'cirBTC', bal: '0.0000', px: 'last price 64,890.00 USD', usd: this.fmt(0), testnet: true });
      return rows;
    }
    const btcUsd = pos * 0.48;
    const usdcUsd = pos - btcUsd;
    return [
      { sym: 'USDC', bal: usdcUsd.toFixed(2), px: 'last price 1.00 USD', usd: this.fmt(usdcUsd), testnet: false },
      { sym: 'cirBTC', bal: (btcUsd / 64890).toFixed(4), px: 'last price 64,890.00 USD', usd: this.fmt(btcUsd), testnet: true }
    ];
  }

  pfVals(id) {
    const demo = (this.props.scenario ?? 'today') === 'live demo';
    const u = this.state.user[id];
    const open = !!this.state.pfAcc[id];
    const dd = demo ? { v3: '0.8%', v4: '0.3%', v5: '1.6%' }[id] : '0.0%';
    const trades = demo ? { v3: '2', v4: '1', v5: '3' }[id] : '0';
    let status, statusColor;
    if (id === 'v5') {
      status = demo ? 'NEAR TARGET' : 'BLOCKED';
      statusColor = demo ? '#00E5A3' : '#F59E0B';
    } else {
      status = demo ? (id === 'v3' ? 'IN RANGE' : 'OPEN') : 'NONE OPEN';
      statusColor = demo ? (id === 'v3' ? '#00E5A3' : '#3385FF') : '#4B5563';
    }
    const usdcPct = demo ? 52.6 : 100;
    return {
      Pos: this.fmt(u.position),
      Assets: this.pfAssets(id),
      PosActive: demo,
      PosNone: !demo,
      PosStatus: status,
      PosStatusColor: statusColor,
      RealUsdcW: usdcPct + '%',
      RealBtcW: (100 - usdcPct) + '%',
      RealSplit: usdcPct.toFixed(1) + ' / ' + (100 - usdcPct).toFixed(1),
      AccToggle: () => this.setState((s) => ({ pfAcc: { ...s.pfAcc, [id]: !s.pfAcc[id] } })),
      AccOpen: open,
      AccChevron: open ? '▴' : '▾',
      Dd: dd + ' from peak · failsafe at 15%',
      Trades: trades
    };
  }

  pref(p, o) {
    const out = {};
    for (const k in o) out[p + k] = o[k];
    return out;
  }

  decisionLog = [
    { id: 'd1', key: 'v7', action: 'CHECK', status: 'NO ACTION', time: '2026 07 26 · 08:00 UTC', confidence: '92%', model: 'agent-core 1.4',
      op: [{ k: 'Pool', v: 'WUSDC/EURC · 0.30%' }, { k: 'Venue', v: 'UnitFlowV3 · Arc Testnet' }, { k: '24h volume', v: '1,204 WUSDC' }],
      reasoning: 'Pool state read successfully. Trading volume over the last 24 hours is far below the minimum threshold required to compute a reliable APY estimate or justify opening a position. The agent keeps monitoring and will re-evaluate on the next cycle.',
      trace: '[08:00:12] pool.read WUSDC/EURC fee=3000 ok\n[08:00:13] liquidity=184,012 WUSDC / 147,338 EURC\n[08:00:13] volume_24h=1,204 < min_volume=25,000\n[08:00:14] apy_estimate=null (insufficient data)\n[08:00:14] decision=CHECK next_review=+6h',
      offchain: 'Pool reserves cross-checked against indexer (2/2 sources agree).', anomaly: null, ops: 'Nominal · executor healthy · 0 retries', onchain: null },
    { id: 'd2', key: 'v7', action: 'EXECUTE', status: 'CONFIRMED', time: '2026 07 25 · 10:12 UTC', confidence: '99%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'Contract deployment' }, { k: 'Contracts', v: 'Vault + LP position manager' }, { k: 'Network', v: 'Arc Testnet' }],
      reasoning: 'Vault and LP position contracts for the WUSDC/EURC strategy were deployed and verified on Arc Testnet. Ownership and risk parameters were set according to the v7 specification.',
      trace: '[10:12:01] deploy mLPv7 vault ok\n[10:12:04] deploy position_manager ok\n[10:12:06] set risk_limits dd=10% lp_loss=3% oor=48h alloc=50%\n[10:12:08] verify sources ok\n[10:12:09] decision=EXECUTE',
      offchain: 'Bytecode verified against audited build (hash match).', anomaly: null, ops: 'Nominal · deployment pipeline · 0 retries',
      onchain: { hash: '0x8f3a91c4…b2c21b', block: '1,284,092', url: 'https://testnet.arcscan.io/tx/0x8f3a91c4b2c21b' } },
    { id: 'd3', key: 'v4', action: 'EXECUTE', status: 'CONFIRMED', time: '2026 07 23 · 13:47 UTC', confidence: '97%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'Bridge + supply' }, { k: 'Route', v: 'Arc → Arbitrum Sepolia (CCTP)' }, { k: 'Destination', v: 'Aave v3 USDC pool' }],
      reasoning: 'USDC was bridged via CCTP to Arbitrum Sepolia and supplied to Aave v3. The full cycle (deposit, lend cross-chain, accrue yield) is operating within all risk limits.',
      trace: '[13:47:02] cctp.burn 38,000 USDC ok\n[13:47:41] attestation received (39s)\n[13:48:03] cctp.mint arbitrum-sepolia ok\n[13:48:10] aave.supply 38,000 USDC ok\n[13:48:11] decision=EXECUTE health=1.00',
      offchain: 'Aave supply rate cross-checked against RPC read (3/3 sources agree).', anomaly: null, ops: 'Nominal · bridge latency 39s · 0 retries',
      onchain: { hash: '0x4c7de208…9a11f4', block: '1,271,556', url: 'https://testnet.arcscan.io/tx/0x4c7de2089a11f4' } },
    { id: 'd4', key: 'v5', action: 'HOLD', status: 'BLOCKED', time: '2026 07 23 · 12:30 UTC', confidence: '95%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'Rebalance check' }, { k: 'Target', v: '50% USDC / 50% cirBTC' }, { k: 'Actual', v: '100% USDC' }],
      reasoning: 'Rebalancing is blocked in both directions. No USDC/cirBTC pool exists on the DEX and no independent reference price is available, so any trade would execute against an unverifiable price. The vault stays fully in USDC.',
      trace: '[12:30:05] price.reference cirBTC=null\n[12:30:05] pool.lookup USDC/cirBTC not_found\n[12:30:06] rebalance_direction=both blocked\n[12:30:06] decision=HOLD',
      offchain: 'Reference price feeds queried: 0/3 returned a valid cirBTC quote.', anomaly: 'cirBTC price source unavailable for 4 consecutive cycles.', ops: 'Degraded · waiting on price feed · 0 retries', onchain: null },
    { id: 'd5', key: 'v3', action: 'HOLD', status: 'BLOCKED', time: '2026 07 23 · 11:15 UTC', confidence: '94%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'LP deployment check' }, { k: 'Pair', v: 'USDC/cirBTC' }, { k: 'Blocker', v: 'Independent price restriction' }],
      reasoning: 'LP execution remains blocked on the testnet. cirBTC carries an independent price restriction on the DEX, so the agent cannot verify a fair entry range and will not open a real liquidity position. Deposits and withdrawals continue to settle normally.',
      trace: '[11:15:02] dex.price cirBTC restricted\n[11:15:03] range_calc aborted (no reference)\n[11:15:03] decision=HOLD next_review=+12h',
      offchain: 'DEX oracle flag confirmed via indexer snapshot.', anomaly: null, ops: 'Nominal · executor healthy · 0 retries', onchain: null },
    { id: 'd6', key: 'v5', action: 'CHECK', status: 'PASSED', time: '2026 07 23 · 06:30 UTC', confidence: '96%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'Weight audit' }, { k: 'Target', v: '50% USDC / 50% cirBTC' }, { k: 'Drift', v: '0.0%' }],
      reasoning: 'Scheduled audit of target weights. Targets are unchanged at 50/50 and the vault remains 100% USDC while rebalancing stays blocked. No action required.',
      trace: '[06:30:01] weights.read target=50/50 actual=100/0\n[06:30:01] drift=0.0% within tolerance\n[06:30:02] decision=CHECK',
      offchain: 'Vault accounting matches indexer balances.', anomaly: null, ops: 'Nominal · scheduled audit · 0 retries', onchain: null },
    { id: 'd7', key: 'v3', action: 'CHECK', status: 'PASSED', time: '2026 07 22 · 22:00 UTC', confidence: '93%', model: 'agent-core 1.4',
      op: [{ k: 'Operation', v: 'Vault accounting audit' }, { k: 'Total assets', v: '24,618.40 USDC' }, { k: 'Share price', v: '1.0000' }],
      reasoning: 'Nightly accounting audit. Total assets and share price reconcile with onchain state; no fee accrual events since the last audit.',
      trace: '[22:00:03] vault.totalAssets=24,618.40 ok\n[22:00:03] share_price=1.0000 ok\n[22:00:04] decision=CHECK',
      offchain: 'Balances reconciled against indexer (2/2 sources agree).', anomaly: null, ops: 'Nominal · scheduled audit · 0 retries', onchain: null }
  ];

  tlVals() {
    const vt = { v3: ['#00E5A3', 'rgba(0,229,163,0.3)'], v4: ['#3385FF', 'rgba(0,102,255,0.4)'], v5: ['#94A3B8', '#3A4152'], v7: ['#00E5A3', 'rgba(0,229,163,0.3)'] };
    const ac = { EXECUTE: ['#00E5A3', 'rgba(0,229,163,0.3)'], HOLD: ['#F59E0B', 'rgba(245,158,11,0.35)'], CHECK: ['#94A3B8', '#3A4152'] };
    const filt = this.state.tlFilter;
    const list = this.decisionLog.filter((d) => filt === 'all' || d.key === filt).map((d) => {
      const open = !!this.state.tlTrace[d.id];
      return {
        ...d,
        ver: this.vaultMeta[d.key].ver.toUpperCase(), vColor: vt[d.key][0], vBorder: vt[d.key][1],
        aColor: ac[d.action][0], aBorder: ac[d.action][1],
        hasAnomaly: !!d.anomaly, noAnomaly: !d.anomaly,
        hasOnchain: !!d.onchain,
        hash: d.onchain ? d.onchain.hash : '', block: d.onchain ? d.onchain.block : '', url: d.onchain ? d.onchain.url : '',
        traceToggle: () => this.setState((s) => ({ tlTrace: { ...s.tlTrace, [d.id]: !s.tlTrace[d.id] } })),
        traceRows: open ? '1fr' : '0fr',
        traceChevron: open ? '▴' : '▾'
      };
    });
    const filters = [{ label: 'ALL', val: 'all' }, { label: 'V3', val: 'v3' }, { label: 'V5', val: 'v5' }, { label: 'V6', val: 'v4' }, { label: 'V7', val: 'v7' }].map((f) => ({
      label: f.label,
      select: () => this.setState({ tlFilter: f.val }),
      color: filt === f.val ? '#FFFFFF' : '#94A3B8',
      bg: filt === f.val ? 'rgba(0,102,255,0.16)' : 'transparent',
      border: filt === f.val ? 'rgba(0,102,255,0.5)' : '#242936'
    }));
    return { tlFilters: filters, tlDecisions: list, tlEmpty: list.length === 0 };
  }

  paperLog = [
    { id: 'p1', action: 'REBALANCE', time: '2026 07 26 · 09:00 UTC', confidence: '91%', model: 'agent-core 1.4 · sim', tokens: '1,842',
      op: [{ k: 'From', v: '58.0% USDC / 42.0% cirBTC' }, { k: 'To', v: '50.0% USDC / 50.0% cirBTC' }, { k: 'Simulated price', v: '1 cirBTC = 64,210 USDC' }],
      reasoning: 'Paper weights drifted 8 points from target after the simulated price move. The agent trims paper USDC and buys paper cirBTC to return to the ergodic 50/50 target, exactly as it would on the live pool once a real price feed exists.',
      trace: '[09:00:01] paper.weights read 58.0/42.0\n[09:00:01] target=50.0/50.0 drift=8.0pp\n[09:00:02] sim_price cirBTC=64,210\n[09:00:03] paper.trade sell 4,120 USDC buy 0.0642 cirBTC\n[09:00:03] decision=REBALANCE (simulated)',
      offchain: 'Simulated price checked against 3 mock feeds for internal consistency.' },
    { id: 'p2', action: 'CHECK', time: '2026 07 25 · 21:00 UTC', confidence: '95%', model: 'agent-core 1.4 · sim', tokens: '960',
      op: [{ k: 'Weights', v: '50.0% / 50.0%' }, { k: 'Drift', v: '0.4pp' }, { k: 'Paper NAV', v: '18,240.00 USDC' }],
      reasoning: 'Scheduled audit of paper weights. Drift is within tolerance, no rebalance needed this cycle.',
      trace: '[21:00:01] paper.weights read 50.4/49.6\n[21:00:01] drift=0.4pp within tolerance\n[21:00:02] decision=CHECK (simulated)',
      offchain: 'Paper ledger reconciles with simulation state store.' },
    { id: 'p3', action: 'REBALANCE', time: '2026 07 25 · 06:00 UTC', confidence: '89%', model: 'agent-core 1.4 · sim', tokens: '2,105',
      op: [{ k: 'From', v: '50.0% USDC / 50.0% cirBTC' }, { k: 'To', v: '50.0% USDC / 50.0% cirBTC' }, { k: 'Simulated price', v: '1 cirBTC = 63,480 USDC' }],
      reasoning: 'A larger simulated price swing pushed weights to 61/39. The agent rebalanced back to target in two smaller paper trades to limit simulated slippage, the same execution discipline planned for the live strategy.',
      trace: '[06:00:01] paper.weights read 61.0/39.0\n[06:00:02] split_trade legs=2\n[06:00:03] paper.trade leg1 sell 2,900 USDC\n[06:00:04] paper.trade leg2 sell 2,850 USDC\n[06:00:04] decision=REBALANCE (simulated)',
      offchain: 'Slippage model checked against historical simulated volatility.' }
  ];

  pvVals() {
    const ac = { REBALANCE: ['#3385FF', 'rgba(0,102,255,0.4)'], CHECK: ['#94A3B8', '#3A4152'] };
    const filt = this.state.pvFilter;
    const list = this.paperLog.filter((d) => filt === 'all' || d.action === filt).map((d) => {
      const open = !!this.state.pvTrace[d.id];
      return {
        ...d,
        aColor: ac[d.action][0],
        traceToggle: () => this.setState((s) => ({ pvTrace: { ...s.pvTrace, [d.id]: !s.pvTrace[d.id] } })),
        traceRows: open ? '1fr' : '0fr',
        traceChevron: open ? '▴' : '▾'
      };
    });
    const filters = [{ label: 'ALL', val: 'all' }, { label: 'REBALANCE', val: 'REBALANCE' }, { label: 'CHECK', val: 'CHECK' }].map((f) => ({
      label: f.label,
      select: () => this.setState({ pvFilter: f.val }),
      color: filt === f.val ? '#FFFFFF' : '#94A3B8',
      bg: filt === f.val ? 'rgba(224,178,60,0.14)' : 'transparent',
      border: filt === f.val ? 'rgba(224,178,60,0.5)' : '#242936'
    }));
    return { pvFilters: filters, pvDecisions: list };
  }

  renderVals() {
    const labels = ['Vaults', 'My Portfolio', 'Wallet', 'Decision Timeline', 'Paper Vault', 'Analytics', 'How it Works', 'Settings'];
    const { active } = this.state;
    const { rpc } = this.state;
    const connected = this.isConnected();
    const demo = (this.props.scenario ?? 'today') === 'live demo';

    const v7Lp = this.state.rpc.v7.lpPosition || null; // set by fetchVault when the agent opens a real LP position onchain
    const loaded = ['v3', 'v4', 'v5', 'v7'].map((id) => rpc[id]).filter((r) => r.status === 'loaded');
    const allLoaded = loaded.length === 4;
    const tvl = loaded.reduce((sum, r) => sum + r.totalAssets, 0);

    const stages = ['IN TRANSIT', 'OPEN', 'WITHDRAWAL PENDING', 'RETURNING'];
    const curStage = stages.indexOf((this.props.v4Stage ?? 'open').toUpperCase());
    const usdcPct = demo ? 52.6 : 100;

    return {
      navItems: labels.map((label) => ({
        label: label,
        color: label === active ? '#FFFFFF' : '#94A3B8',
        bg: label === active ? 'rgba(0,102,255,0.12)' : 'transparent',
        iconHtml: { __html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + this.icons[label] + '</svg>' },
        select: () => this.setState({ active: label })
      })),
      activeLabel: active.toUpperCase(),
      limitOpen: !!this.state.limitPop,
      limitTop: this.state.limitPop ? this.state.limitPop.top + 'px' : '0px',
      limitLeft: this.state.limitPop ? this.state.limitPop.left + 'px' : '0px',
      limitBody: this.state.limitPop ? this.limitCopy[this.state.limitPop.id] : '',
      limitClose: () => this.setState({ limitPop: null }),
      pageTitle: active,
      pageDesc: ({
        'Vaults': 'Four autonomous strategies. Select a vault to expand it in place.',
        'My Portfolio': 'Aggregated view of your positions across all Mandor vaults, read from current onchain state.',
        'Wallet': 'Your embedded Mandor wallet. Send and receive USDC on Arc Testnet without a seed phrase.',
        'Decision Timeline': 'Full audit log of every decision the AI agent has taken across vaults.',
        'Paper Vault': 'Simulated v5 rebalancing demo running on paper positions.',
        'Analytics': 'Protocol level metrics and vault performance over time.',
        'How it Works': 'Architecture, agent mechanics and safeguards behind Mandor Protocol.',
        'Settings': 'Manage your account information and application preferences.'
      })[active] || '',
      showVaults: active === 'Vaults',
      showPortfolio: active === 'My Portfolio',
      showWallet: active === 'Wallet',
      showTimeline: active === 'Decision Timeline',
      showPaper: active === 'Paper Vault',
      showAnalytics: active === 'Analytics',
      showHow: active === 'How it Works',
      showSettings: active === 'Settings',
      setCurrency: this.state.settings.currency,
      setRefresh: this.state.settings.refresh,
      setVaultView: this.state.settings.vaultView,
      onCurrency: (e) => { const v = e.target.value; this.setState((s) => ({ settings: { ...s.settings, currency: v } })); },
      onRefresh: (e) => { const v = e.target.value; this.setState((s) => ({ settings: { ...s.settings, refresh: v } })); },
      onVaultView: (e) => { const v = e.target.value; this.setState((s) => ({ settings: { ...s.settings, vaultView: v } })); },
      showPlaceholder: active !== 'Vaults' && active !== 'My Portfolio' && active !== 'Wallet' && active !== 'Decision Timeline' && active !== 'Paper Vault' && active !== 'Analytics' && active !== 'How it Works' && active !== 'Settings',

      ...this.wlVals(),
      ...this.tlVals(),
      ...this.pvVals(),

      tvlDisplay: allLoaded ? this.fmt(tvl) : '…',
      strategiesDisplay: allLoaded ? '4' : '…',

      ...(() => {
        const users = this.state.user;
        const pfReady = connected && ['v3', 'v4', 'v5'].every((id) => users[id].status === 'loaded');
        const pfPos = { v3: users.v3.position || 0, v4: users.v4.position || 0, v5: users.v5.position || 0 };
        const pfTotal = pfPos.v3 + pfPos.v4 + pfPos.v5;
        const pfP = (id) => pfTotal > 0 ? (pfPos[id] / pfTotal * 100) : 0;
        const vt = { v3: ['#00E5A3', 'rgba(0,229,163,0.3)'], v4: ['#3385FF', 'rgba(0,102,255,0.4)'], v5: ['#94A3B8', '#3A4152'] };
        const feed = [];
        ['v3', 'v4', 'v5'].forEach((id) => this.vaultMeta[id].timeline.forEach((t) => feed.push({
          vault: this.vaultMeta[id].ver.toUpperCase(), vColor: vt[id][0], vBorder: vt[id][1],
          action: t.action, text: t.text, time: t.time,
          color: t.action === 'HOLD' ? '#F59E0B' : t.action === 'EXECUTE' ? '#00E5A3' : '#94A3B8',
          border: t.action === 'HOLD' ? 'rgba(245,158,11,0.3)' : t.action === 'EXECUTE' ? 'rgba(0,229,163,0.3)' : '#3A4152'
        })));
        feed.sort((a, b) => a.time < b.time ? 1 : -1);
        return {
          pfLocked: !connected,
          pfLoading: connected && !pfReady,
          pfReady: pfReady,
          pfTotal: this.fmt(pfTotal),
          pfWallet: this.fmt(users.v3.walletBalance),
          pfSegments: ['v3', 'v4', 'v5'].map((id) => ({ width: pfP(id).toFixed(1) + '%', bg: this.pfMeta[id].swatch })),
          pfAlloc: ['v3', 'v4', 'v5'].map((id) => ({
            ver: this.vaultMeta[id].ver, name: this.pfMeta[id].name, bg: this.pfMeta[id].swatch,
            pct: pfP(id).toFixed(1) + '%', pctColor: this.pfMeta[id].pctColor, pctBorder: this.pfMeta[id].pctBorder,
            usd: this.fmt(pfPos[id])
          })),
          pfFeed: feed,
          p3Share: pfP('v3').toFixed(1) + '% of portfolio',
          p4Share: pfP('v4').toFixed(1) + '% of portfolio',
          p5Share: pfP('v5').toFixed(1) + '% of portfolio',
          ...this.pref('p3', this.pfVals('v3')),
          ...this.pref('p4', this.pfVals('v4')),
          ...this.pref('p5', this.pfVals('v5'))
        };
      })(),

      ...this.pref('v3', this.cardVals('v3')),
      ...this.pref('v4', this.cardVals('v4')),
      ...this.pref('v5', this.cardVals('v5')),
      ...this.pref('v7', this.cardVals('v7')),

      v3LpActive: demo,
      v3LpNone: !demo,

      v7LpActive: !!v7Lp,
      v7LpNone: !v7Lp,
      v7LpLower: v7Lp ? v7Lp.lower : '',
      v7LpUpper: v7Lp ? v7Lp.upper : '',
      v7LpPrice: v7Lp ? v7Lp.price : '',
      v7LpValue: v7Lp ? v7Lp.value : '',
      v7LpRangeLeft: v7Lp ? v7Lp.rangeLeft : '0%',
      v7LpRangeWidth: v7Lp ? v7Lp.rangeWidth : '0%',
      v7LpPriceLeft: v7Lp ? v7Lp.priceLeft : '0%',

      v4HasPos: rpc.v4.status === 'loaded',
      v4NoPos: rpc.v4.status !== 'loaded',
      v4StageLabel: curStage >= 0 ? stages[curStage] : 'OPEN',
      v4Steps: stages.map((label, i) => ({
        label: label,
        color: i === curStage ? '#FFFFFF' : '#4B5563',
        bg: i === curStage ? 'rgba(0,102,255,0.25)' : 'transparent',
        border: i === curStage ? 'rgba(0,102,255,0.5)' : '#242936'
      })),

      v5UsdcPct: usdcPct + '%',
      v5BtcPct: (100 - usdcPct) + '%',
      v5UsdcLabel: usdcPct.toFixed(1) + '%',
      v5BtcLabel: (100 - usdcPct).toFixed(1) + '%',
      v5GoPaper: () => this.setState({ active: 'Paper Vault' }),

      isConnected: connected,
      isDisconnected: !connected,
      // Real short address once connected (same 0x1234…abcd formatting the
      // old shortAddr() already uses elsewhere in this file), falls back
      // to the design-time placeholder prop only while disconnected.
      walletDisplay: connected && this.props.userAddress ? this.shortAddr(this.props.userAddress) : (this.props.walletDisplay ?? '0x7f3A…9c4E'),
      // Real Privy auth, same sequencing as src/App.tsx's own handleConnect:
      // not authenticated -> login(); authenticated but no wallet yet ->
      // createWallet(). The actual "connected" transition (and its
      // fetchUser side effect) is driven by componentDidUpdate once Privy's
      // own state reflects a real connected wallet, not by this click
      // handler directly -- there is nothing fake left to flip here.
      connect: () => {
        if (!this.props.authenticated) {
          this.props.onLogin?.();
          return;
        }
        if (!this.props.userAddress) {
          this.props.onCreateWallet?.();
        }
      },
      disconnect: () => {
        this.props.onLogout?.();
        this.setState({
          wallet: { tab: 'none', rcvOpen: false, token: 'USDC', to: '', amount: '', step: 'form', txHash: null, copied: false, sent: [], sentAmt: '', sentTo: '' },
          user: {
            v3: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null },
            v4: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null },
            v5: { status: 'idle', shares: null, position: null, maxWithdraw: null, walletBalance: null, allowance: null }
          },
          forms: {
            v3: { tab: 'deposit', amount: '' },
            v4: { tab: 'deposit', amount: '' },
            v5: { tab: 'deposit', amount: '' }
          },
          tx: {
            v3: { phase: 'idle', txHash: null },
            v4: { phase: 'idle', txHash: null },
            v5: { phase: 'idle', txHash: null }
          }
        });
      }
    };
  }

  render() {
    const v = this.renderVals() as ShellVals;
    return <AppShell v={v} />;
  }
}

/**
 * Real Privy wiring (Phase 1). Same usePrivy/useWallets/useCreateWallet
 * pattern already proven in src/App.tsx, including the embedded-wallet
 * preference (prefer the Privy embedded wallet if present, otherwise fall
 * back to whatever wallet is connected, e.g. an external one the user
 * linked) -- ported, not reinvented. This is the actual default export:
 * ShellControllerInner (the class above) never talks to Privy directly,
 * it only ever receives the results as plain props.
 */
export default function ShellController(props: ShellProps) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;

  return (
    <ShellControllerInner
      {...props}
      privyReady={ready}
      authenticated={authenticated}
      userAddress={userAddress}
      onLogin={login}
      onLogout={logout}
      onCreateWallet={async () => { await createWallet(); }}
    />
  );
}
