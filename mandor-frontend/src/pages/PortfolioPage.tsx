import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function PortfolioPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="My Portfolio" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1500px', width: '100%' }}>
      {v.pfLocked && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '72px 24px', border: '1px dashed #242936', borderRadius: '12px', background: '#161920' }}>
          <svg width="26" height="26" viewBox="0 0 18 18" fill="none" stroke="#4B5563" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
            <path d="M2.5 5.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"></path>
            <path d="M2.5 5.5V4a1 1 0 0 1 1-1H13"></path>
            <circle cx="12.2" cy="10.5" r="0.8" fill="#4B5563" stroke="none"></circle>
          </svg>
          <span style={{ fontSize: '14px', color: '#94A3B8' }}>
            Connect your wallet to view your aggregated portfolio
          </span>
          <Hoverable as="button" onClick={v.connect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 22px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
            Connect
          </Hoverable>
        </div>
        </>
      )}
      {v.pfLoading && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px' }}>
            <div style={{ height: '156px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
            <div style={{ height: '156px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
          </div>
          <div style={{ height: '240px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.3s' }}></div>
        </div>
        </>
      )}
      {v.pfReady && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* KPI row: hero + allocation */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px', alignItems: 'stretch' }}>
            <div data-screen-label="Portfolio Hero" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                  TOTAL PORTFOLIO VALUE
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#00E5A3' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  LIVE
                </span>
              </div>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                {v.pfTotal}
              </span>
              <div style={{ display: 'flex', gap: '34px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#6B7280' }}>
                    Vaults with balance
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#94A3B8' }}>
                    3 of 3
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#6B7280' }}>
                    Wallet USDC
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#94A3B8' }}>
                    {v.pfWallet}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#6B7280' }}>
                    Network
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#94A3B8' }}>
                    Arc Testnet
                  </span>
                </div>
              </div>
            </div>
            <div data-screen-label="Allocation" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                ALLOCATION BY VAULT
              </span>
              <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#242936' }}>
                {(v.pfSegments || []).map((sg: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <div style={{ width: sg.width, background: sg.bg, height: '100%' }}></div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(v.pfAlloc || []).map((al: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: al.bg, flexShrink: '0' }}></span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280', width: '22px', flexShrink: '0' }}>
                        {al.ver}
                      </span>
                      <span style={{ fontSize: '12.5px', color: '#94A3B8', flex: '1', minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {al.name}
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.04em', color: al.pctColor, border: `1px solid ${al.pctBorder}`, borderRadius: '4px', padding: '2px 7px', minWidth: '54px', textAlign: 'center', flexShrink: '0' }}>
                        {al.pct}
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF', minWidth: '108px', textAlign: 'right', flexShrink: '0' }}>
                        {al.usd}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          {/* Historical performance placeholder */}
          <div data-screen-label="Historical Placeholder" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                PORTFOLIO VALUE OVER TIME
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '999px', padding: '4px 11px' }}>
                TO BE BUILT · COMING SOON
              </span>
            </div>
            <div style={{ position: 'relative', height: '100px', border: '1px solid #1D212B', borderRadius: '8px', background: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.03) 0 8px, transparent 8px 16px)', overflow: 'hidden' }}>
              <svg viewBox="0 0 800 100" preserveAspectRatio="none" aria-hidden={'true'} style={{ position: 'absolute', inset: '0', width: '100%', height: '100%' }}>
                <line x1="0" y1="25" x2="800" y2="25" stroke="#1D212B" strokeWidth="1"></line>
                <line x1="0" y1="50" x2="800" y2="50" stroke="#1D212B" strokeWidth="1"></line>
                <line x1="0" y1="75" x2="800" y2="75" stroke="#1D212B" strokeWidth="1"></line>
                <path d="M0 79 C 90 78, 160 74, 250 75 S 420 71, 530 72 S 710 67, 800 68" fill="none" stroke="#3A4152" strokeWidth="1.5" strokeDasharray="5 5"></path>
              </svg>
              <div style={{ position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.1em', color: '#6B7280', background: '#161920', border: '1px solid #242936', borderRadius: '6px', padding: '8px 14px' }}>
                  HISTORICAL SERIES NOT YET INDEXED
                </span>
              </div>
            </div>
            <p style={{ margin: '0', fontSize: '12.5px', lineHeight: '1.6', color: '#6B7280' }}>
              Only current onchain state exists today. Historical performance and PnL series will appear here once decision snapshots are indexed over time.
            </p>
          </div>
          {/* Per vault breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', alignItems: 'stretch' }}>
            {/* v3 breakdown */}
            <div data-screen-label="Portfolio v3" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: '0' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#00E5A3', flexShrink: '0' }}></span>
                  <span style={{ fontSize: '13.5px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    LP Yield
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280', flexShrink: '0' }}>
                    v3
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', flexShrink: '0' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                    {v.p3Pos}
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                    {v.p3Share}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '112px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                  ASSET COMPOSITION
                </span>
                {(v.p3Assets || []).map((a: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.sym}
                        </span>
                        {a.testnet && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.06em', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '4px', padding: '2px 6px' }}>
                            TESTNET VALUE, NOT REAL
                          </span>
                          </>
                        )}
                        <span style={{ marginLeft: 'auto', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.usd}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                          {a.bal}
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563' }}>
                          {a.px}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '118px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                    LP POSITION
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: v.p3PosStatusColor }}>
                    {v.p3PosStatus}
                  </span>
                </div>
                {v.p3PosNone && (
                  <>
                  <p style={{ margin: '0', fontSize: '12.5px', lineHeight: '1.6', color: '#6B7280' }}>
                    None open. The agent has not deployed liquidity yet because cirBTC carries a price restriction on the DEX.
                  </p>
                  </>
                )}
                {v.p3PosActive && (
                  <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Active range
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                        58,400 to 71,200
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Current price
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                        64,890 USDC/cirBTC
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Range health
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3' }}>
                        IN RANGE
                      </span>
                    </div>
                  </div>
                  </>
                )}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '1px', background: '#1D212B', marginBottom: '14px' }}></div>
                <Hoverable as="button" onClick={v.p3AccToggle} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                  {' '}Risk and Operations{' '}
                  <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                    {v.p3AccChevron}
                  </span>
                </Hoverable>
                {v.p3AccOpen && (
                  <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginTop: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Drawdown status
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p3Dd}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Operational status
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.06em', color: '#00E5A3' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3' }}></span>
                        ACTIVE · NOT PAUSED
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Trades today
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p3Trades}
                      </span>
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
            {/* v4 breakdown */}
            <div data-screen-label="Portfolio v4" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: '0' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#0066FF', flexShrink: '0' }}></span>
                  <span style={{ fontSize: '13.5px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Cross Chain Lending
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280', flexShrink: '0' }}>
                    v6
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', flexShrink: '0' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                    {v.p4Pos}
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                    {v.p4Share}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '112px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                  ASSET COMPOSITION
                </span>
                {(v.p4Assets || []).map((a: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.sym}
                        </span>
                        {a.testnet && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.06em', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '4px', padding: '2px 6px' }}>
                            TESTNET VALUE, NOT REAL
                          </span>
                          </>
                        )}
                        <span style={{ marginLeft: 'auto', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.usd}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                          {a.bal}
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563' }}>
                          {a.px}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '118px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                    CROSS CHAIN LENDING
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: v.p4PosStatusColor }}>
                    {v.p4PosStatus}
                  </span>
                </div>
                {v.p4PosNone && (
                  <>
                  <p style={{ margin: '0', fontSize: '12.5px', lineHeight: '1.6', color: '#6B7280' }}>
                    None open. All capital remains on Arc Testnet while ChainKeeper activation on Arbitrum Sepolia is pending.
                  </p>
                  </>
                )}
                {v.p4PosActive && (
                  <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Destination chain
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                        Arbitrum Sepolia
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Transit status
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#3385FF' }}>
                        {v.v4StageLabel}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Vault value on Aave
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                        38,412.77 USDC
                      </span>
                    </div>
                  </div>
                  </>
                )}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '1px', background: '#1D212B', marginBottom: '14px' }}></div>
                <Hoverable as="button" onClick={v.p4AccToggle} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                  {' '}Risk and Operations{' '}
                  <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                    {v.p4AccChevron}
                  </span>
                </Hoverable>
                {v.p4AccOpen && (
                  <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginTop: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Drawdown status
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p4Dd}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Operational status
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.06em', color: '#00E5A3' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3' }}></span>
                        ACTIVE · NOT PAUSED
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Trades today
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p4Trades}
                      </span>
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
            {/* v5 breakdown */}
            <div data-screen-label="Portfolio v5" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: '0' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'linear-gradient(90deg, #0066FF, #00A87A)', flexShrink: '0' }}></span>
                  <span style={{ fontSize: '13.5px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Ergodic Rebalancing
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280', flexShrink: '0' }}>
                    v5
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', flexShrink: '0' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                    {v.p5Pos}
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                    {v.p5Share}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '112px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                  ASSET COMPOSITION
                </span>
                {(v.p5Assets || []).map((a: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.sym}
                        </span>
                        {a.testnet && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.06em', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '4px', padding: '2px 6px' }}>
                            TESTNET VALUE, NOT REAL
                          </span>
                          </>
                        )}
                        <span style={{ marginLeft: 'auto', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                          {a.usd}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                          {a.bal}
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563' }}>
                          {a.px}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '118px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                    TARGET VS REAL RATIO
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: v.p5PosStatusColor }}>
                    {v.p5PosStatus}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.06em', color: '#4B5563', width: '44px', flexShrink: '0' }}>
                    TARGET
                  </span>
                  <div style={{ display: 'flex', flex: '1', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#242936' }}>
                    <div style={{ width: '50%', background: '#0066FF', height: '100%' }}></div>
                    <div style={{ width: '50%', background: '#00E5A3', height: '100%' }}></div>
                  </div>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#94A3B8', width: '84px', textAlign: 'right', flexShrink: '0' }}>
                    50.0 / 50.0
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.06em', color: '#4B5563', width: '44px', flexShrink: '0' }}>
                    REAL
                  </span>
                  <div style={{ display: 'flex', flex: '1', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#242936' }}>
                    <div style={{ width: v.p5RealUsdcW, background: '#0066FF', height: '100%' }}></div>
                    <div style={{ width: v.p5RealBtcW, background: '#00E5A3', height: '100%' }}></div>
                  </div>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#94A3B8', width: '84px', textAlign: 'right', flexShrink: '0' }}>
                    {v.p5RealSplit}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#6B7280' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '2px', background: '#0066FF' }}></span>
                    USDC
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#6B7280' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '2px', background: '#00E5A3' }}></span>
                    cirBTC
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '1px', background: '#1D212B', marginBottom: '14px' }}></div>
                <Hoverable as="button" onClick={v.p5AccToggle} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                  {' '}Risk and Operations{' '}
                  <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                    {v.p5AccChevron}
                  </span>
                </Hoverable>
                {v.p5AccOpen && (
                  <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginTop: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Drawdown status
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p5Dd}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Operational status
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.06em', color: '#00E5A3' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3' }}></span>
                        ACTIVE · NOT PAUSED
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#6B7280' }}>
                        Trades today
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                        {v.p5Trades}
                      </span>
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Consolidated decision history */}
          <div data-screen-label="Consolidated History" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', color: '#6B7280' }}>
                CONSOLIDATED DECISION HISTORY
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#4B5563' }}>
                ALL VAULTS · LAST 24H
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {(v.pfFeed || []).map((t: any, $index: number) => (
                <React.Fragment key={$index}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', lineHeight: '1.5', letterSpacing: '0.06em', color: t.vColor, border: `1px solid ${t.vBorder}`, borderRadius: '4px', padding: '2px 8px', minWidth: '34px', textAlign: 'center', flexShrink: '0' }}>
                      {t.vault}
                    </span>
                    <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', lineHeight: '1.5', letterSpacing: '0.06em', color: t.color, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '2px 8px', minWidth: '76px', textAlign: 'center', flexShrink: '0' }}>
                      {t.action}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '0' }}>
                      <span style={{ fontSize: '12px', lineHeight: '1.6', color: '#94A3B8' }}>
                        {t.text}
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                        {t.time}
                      </span>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        </>
      )}
    </main>
    </>
  );
}
