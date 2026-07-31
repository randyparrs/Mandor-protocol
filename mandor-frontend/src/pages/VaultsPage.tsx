import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function VaultsPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="Vaults" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1500px', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
            Total Value Locked (TVL)
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
            {v.tvlDisplay}
          </span>
        </div>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
            Protocol Safeguard
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', letterSpacing: '0.06em', color: '#00E5A3', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '999px', padding: '5px 12px', marginTop: '3px' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
              <path d="M8 1.5l5.5 2v4c0 3.2-2.2 5.5-5.5 6.5-3.3-1-5.5-3.3-5.5-6.5v-4l5.5-2z"></path>
            </svg>
            {' '}FAILSAFE MONITORED{' '}
          </span>
        </div>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
            Strategies Deployed
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
            {v.strategiesDisplay}
          </span>
        </div>
      </div>
      {/* Vault card grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* ======== v3 LP YIELD (mint) ======== */}
        <Hoverable as="div" data-screen-label="v3 LP Yield" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', overflow: 'hidden' }} hover={{ borderColor: 'rgba(0,229,163,0.4)', boxShadow: '0 0 32px rgba(0,229,163,0.07)' }}>
          <Hoverable as="div" onClick={v.v3Toggle} role="button" tabIndex="0" aria-expanded={v.v3Open} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '16px 24px 16px 14px', cursor: 'pointer', flexWrap: 'wrap', minHeight: '74px' }} hover={{ background: 'rgba(148,163,184,0.03)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', flexShrink: '0', borderRadius: '9px', background: 'rgba(0,229,163,0.1)', border: '1px solid rgba(0,229,163,0.25)' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#00E5A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <path d="M9 2c2.8 3.2 4.5 5.6 4.5 8a4.5 4.5 0 0 1-9 0c0-2.4 1.7-4.8 4.5-8z"></path>
                <path d="M6.8 10.2a2.2 2.2 0 0 0 2 2.2"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '230px', flex: '1' }}>
              <h3 style={{ margin: '0', fontSize: '15.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Mandor USDC+cirBTC Yield Vault
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '20px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                  v3 · USDC + cirBTC
                </span>
                {v.v3ShowLimit && (
                  <>
                  <Hoverable as="button" type="button" data-limit-anchor="true" onClick={v.v3LimitClick} aria-label="Show known limitation" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11px', fontWeight: '500', color: '#F59E0B', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: '999px', padding: '2px 9px 2px 7px', cursor: 'pointer', transition: 'background 0.18s ease, border-color 0.18s ease' }} hover={{ background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.5)' }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                      <path d="M8 2L15 14H1L8 2z"></path>
                      <line x1="8" y1="7" x2="8" y2="10"></line>
                      <circle cx="8" cy="12" r="0.5" fill="#F59E0B" stroke="none"></circle>
                    </svg>
                    Known limitation
                  </Hoverable>
                  </>
                )}
              </div>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.1em', color: '#0D0E12', background: '#00E5A3', borderRadius: '5px', padding: '3px 4px', fontWeight: '500', flexShrink: '0', width: '132px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              LP YIELD
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginLeft: 'auto', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  TVL
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                  {v.v3Tvl}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '128px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  APY
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#4B5563', whiteSpace: 'nowrap', paddingTop: '2px' }}>
                  Insufficient data
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  My Position
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                  {v.v3MyPos}
                </span>
              </div>
              {v.v3ActivePill && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#00E5A3', background: 'rgba(0,229,163,0.07)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  ACTIVE
                </span>
                </>
              )}
              {v.v3Limited && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#F59E0B', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#F59E0B' }}></span>
                  LIMITED
                </span>
                </>
              )}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', transition: 'transform 0.3s ease', transform: v.v3ChevRot }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </div>
          </Hoverable>
          <div style={{ display: 'grid', gridTemplateRows: v.v3Rows, transition: 'grid-template-rows 0.3s ease-in-out' }}>
            <div style={{ overflow: 'hidden', minHeight: '0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 18px 18px' }}>
                <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#94A3B8', maxWidth: '900px', minHeight: '42px' }}>
                  The agent opens and manages concentrated liquidity positions on the DEX, earning trading fee income from the USDC/cirBTC pair.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', alignItems: 'stretch' }}>
                  <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '5px', background: '#0D0E12', border: '1px solid #242936', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
                      <button onClick={v.v3SelDep} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v3DepColor, background: v.v3DepBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Deposit
                      </button>
                      <button onClick={v.v3SelWd} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v3WdColor, background: v.v3WdBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Withdraw
                      </button>
                    </div>
                    {v.v3Locked && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '16px', border: '1px dashed #242936', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                          Connect wallet to continue
                        </span>
                        <Hoverable as="button" onClick={v.connect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 26px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                          Connect
                        </Hoverable>
                      </div>
                      </>
                    )}
                    {v.v3UserLoading && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ height: '48px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                        <div style={{ height: '40px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                      </div>
                      </>
                    )}
                    {v.v3FormReady && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#0D0E12', border: `1px solid ${v.v3InBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.v3Amount} onChange={v.v3OnAmount} disabled={v.v3InDisabled} placeholder="0.00" inputMode="decimal" style={{ flex: '1', minWidth: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '16px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none', opacity: v.v3InOpacity }} />
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280' }}>
                            USDC
                          </span>
                          <Hoverable as="button" onClick={v.v3SetMax} disabled={v.v3InDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11.5px', fontWeight: '600', color: '#00E5A3', background: 'rgba(0,229,163,0.1)', border: 'none', borderRadius: '5px', padding: '5px 11px', cursor: 'pointer' }} hover={{ background: 'rgba(0,229,163,0.2)' }}>
                            Max
                          </Hoverable>
                        </div>
                        {v.v3HasErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171', marginTop: '-4px' }}>
                            {v.v3Err}
                          </span>
                          </>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              {v.v3MetaLabel}
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                              {v.v3MetaValue}
                            </span>
                          </div>
                          {v.v3IsDep && (
                            <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                Current allowance
                              </span>
                              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                                {v.v3Allowance}
                              </span>
                            </div>
                            </>
                          )}
                        </div>
                        <Hoverable as="button" onClick={v.v3Submit} disabled={v.v3CtaDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: v.v3CtaColor, background: v.v3CtaBg, border: 'none', borderRadius: '8px', padding: '12px 18px', cursor: v.v3CtaCursor, opacity: v.v3CtaOpacity }} hover={{ background: v.v3CtaHoverBg }}>
                          {v.v3CtaLabel}
                        </Hoverable>
                        {v.v3TxOk && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,229,163,0.06)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.5 8l1.8 1.8L10.8 6"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#00E5A3' }}>
                              Transaction successful
                            </span>
                            <Hoverable as="a" href={v.v3TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v3TxFail && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#F87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#F87171' }}>
                              Transaction failed
                            </span>
                            <Hoverable as="a" href={v.v3TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v3TxCancel && (
                          <>
                          <div style={{ border: '1px solid #242936', borderRadius: '8px', padding: '10px 14px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#94A3B8' }}>
                              Transaction cancelled by user
                            </span>
                          </div>
                          </>
                        )}
                        <div style={{ borderTop: '1px solid #1D212B', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Vault balance
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              {v.v3PosVal}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Accrued yield
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3' }}>
                              {v.v3YieldVal}
                            </span>
                          </div>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px' }}>
                      {v.v3Loading && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                        </div>
                        </>
                      )}
                      {v.v3Loaded && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Total Deposited
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v3Tvl}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Available Capacity
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v3Capacity}
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: '1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          LP POSITION
                        </span>
                        {v.v3LpActive && (
                          <>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#00E5A3' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3' }}></span>
                            IN RANGE
                          </span>
                          </>
                        )}
                        {v.v3LpNone && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
                            NONE OPEN
                          </span>
                          </>
                        )}
                      </div>
                      {v.v3LpActive && (
                        <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: '#242936' }}>
                            <div style={{ position: 'absolute', left: '28%', width: '46%', top: '0', bottom: '0', background: 'rgba(0,229,163,0.45)', borderRadius: '3px' }}></div>
                            <div style={{ position: 'absolute', left: '51%', top: '-3px', width: '2px', height: '12px', background: '#FFFFFF', borderRadius: '1px' }}></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                              58,400
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#FFFFFF' }}>
                              64,890 USDC/cirBTC
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                              71,200
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Position value
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                              12,300.55 USDC
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                      {v.v3LpNone && (
                        <>
                        <p style={{ margin: '0', fontSize: '12.5px', lineHeight: '1.6', color: '#6B7280' }}>
                          No active LP position. The agent has not deployed liquidity yet.
                        </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '6px', borderTop: '1px solid #1D212B', paddingTop: '14px' }}>
                  <Hoverable as="button" onClick={v.v3TlToggle} style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                      <path d="M4 3v12"></path>
                      <circle cx="4" cy="5" r="1.6"></circle>
                      <circle cx="4" cy="13" r="1.6"></circle>
                      <path d="M7.5 5h7M7.5 13h7"></path>
                    </svg>
                    {' '}View Vault Decision Timeline{' '}
                    <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                      {v.v3TlChevron}
                    </span>
                  </Hoverable>
                  {v.v3TlOpen && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                      {(v.v3Timeline || []).map((t: any, $index: number) => (
                        <React.Fragment key={$index}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: t.color, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '3px 8px', flexShrink: '0' }}>
                              {t.action}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                              <span style={{ fontSize: '12px', lineHeight: '1.55', color: '#94A3B8' }}>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Hoverable>
        {/* ======== v5 ERGODIC REBALANCING (dual tone) ======== */}
        <Hoverable as="div" data-screen-label="v5 Ergodic Rebalancing" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', overflow: 'hidden' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 32px rgba(0,102,255,0.05), 0 0 32px rgba(0,229,163,0.04)' }}>
          <Hoverable as="div" onClick={v.v5Toggle} role="button" tabIndex="0" aria-expanded={v.v5Open} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '16px 24px 16px 14px', cursor: 'pointer', flexWrap: 'wrap', minHeight: '74px' }} hover={{ background: 'rgba(148,163,184,0.03)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', flexShrink: '0', borderRadius: '9px', background: 'linear-gradient(135deg, rgba(0,102,255,0.12), rgba(0,229,163,0.12))', border: '1px solid #3A4152' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <path d="M3 6.5h9M9.5 3.5L12.5 6.5 9.5 9.5" stroke="#3385FF"></path>
                <path d="M15 11.5H6M8.5 14.5L5.5 11.5 8.5 8.5" stroke="#00E5A3"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '230px', flex: '1' }}>
              <h3 style={{ margin: '0', fontSize: '15.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Mandor USDC/cirBTC Ergodic Rebalancing Vault
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '20px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                  v5 · USDC + cirBTC
                </span>
                {v.v5ShowLimit && (
                  <>
                  <Hoverable as="button" type="button" data-limit-anchor="true" onClick={v.v5LimitClick} aria-label="Show known limitation" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11px', fontWeight: '500', color: '#F59E0B', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: '999px', padding: '2px 9px 2px 7px', cursor: 'pointer', transition: 'background 0.18s ease, border-color 0.18s ease' }} hover={{ background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.5)' }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                      <path d="M8 2L15 14H1L8 2z"></path>
                      <line x1="8" y1="7" x2="8" y2="10"></line>
                      <circle cx="8" cy="12" r="0.5" fill="#F59E0B" stroke="none"></circle>
                    </svg>
                    Known limitation
                  </Hoverable>
                  </>
                )}
              </div>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.1em', color: '#FFFFFF', background: 'linear-gradient(90deg, #0066FF, #00A87A)', borderRadius: '5px', padding: '3px 4px', fontWeight: '500', flexShrink: '0', width: '132px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              ERGODIC REBALANCING
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginLeft: 'auto', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  TVL
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                  {v.v5Tvl}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '128px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  APY
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#4B5563', whiteSpace: 'nowrap', paddingTop: '2px' }}>
                  Insufficient data
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  My Position
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                  {v.v5MyPos}
                </span>
              </div>
              {v.v5ActivePill && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#00E5A3', background: 'rgba(0,229,163,0.07)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  ACTIVE
                </span>
                </>
              )}
              {v.v5Limited && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#F59E0B', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#F59E0B' }}></span>
                  LIMITED
                </span>
                </>
              )}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', transition: 'transform 0.3s ease', transform: v.v5ChevRot }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </div>
          </Hoverable>
          <div style={{ display: 'grid', gridTemplateRows: v.v5Rows, transition: 'grid-template-rows 0.3s ease-in-out' }}>
            <div style={{ overflow: 'hidden', minHeight: '0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 18px 18px' }}>
                <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#94A3B8', maxWidth: '900px', minHeight: '42px' }}>
                  Periodic rebalancing toward a fixed 50 / 50 USDC and cirBTC target weight, harvesting volatility rather than avoiding it.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', alignItems: 'stretch' }}>
                  <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '5px', background: '#0D0E12', border: '1px solid #242936', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
                      <button onClick={v.v5SelDep} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v5DepColor, background: v.v5DepBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Deposit
                      </button>
                      <button onClick={v.v5SelWd} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v5WdColor, background: v.v5WdBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Withdraw
                      </button>
                    </div>
                    {v.v5Locked && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '16px', border: '1px dashed #242936', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                          Connect wallet to continue
                        </span>
                        <Hoverable as="button" onClick={v.connect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 26px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                          Connect
                        </Hoverable>
                      </div>
                      </>
                    )}
                    {v.v5UserLoading && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ height: '48px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                        <div style={{ height: '40px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                      </div>
                      </>
                    )}
                    {v.v5FormReady && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#0D0E12', border: `1px solid ${v.v5InBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.v5Amount} onChange={v.v5OnAmount} disabled={v.v5InDisabled} placeholder="0.00" inputMode="decimal" style={{ flex: '1', minWidth: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '16px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none', opacity: v.v5InOpacity }} />
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280' }}>
                            USDC
                          </span>
                          <Hoverable as="button" onClick={v.v5SetMax} disabled={v.v5InDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11.5px', fontWeight: '600', color: '#3385FF', background: 'rgba(0,102,255,0.12)', border: 'none', borderRadius: '5px', padding: '5px 11px', cursor: 'pointer' }} hover={{ background: 'rgba(0,102,255,0.22)' }}>
                            Max
                          </Hoverable>
                        </div>
                        {v.v5HasErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171', marginTop: '-4px' }}>
                            {v.v5Err}
                          </span>
                          </>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              {v.v5MetaLabel}
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                              {v.v5MetaValue}
                            </span>
                          </div>
                          {v.v5IsDep && (
                            <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                Current allowance
                              </span>
                              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                                {v.v5Allowance}
                              </span>
                            </div>
                            </>
                          )}
                        </div>
                        <Hoverable as="button" onClick={v.v5Submit} disabled={v.v5CtaDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: v.v5CtaColor, background: v.v5CtaBg, border: 'none', borderRadius: '8px', padding: '12px 18px', cursor: v.v5CtaCursor, opacity: v.v5CtaOpacity }} hover={{ background: v.v5CtaHoverBg }}>
                          {v.v5CtaLabel}
                        </Hoverable>
                        {v.v5TxOk && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,229,163,0.06)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.5 8l1.8 1.8L10.8 6"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#00E5A3' }}>
                              Transaction successful
                            </span>
                            <Hoverable as="a" href={v.v5TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v5TxFail && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#F87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#F87171' }}>
                              Transaction failed
                            </span>
                            <Hoverable as="a" href={v.v5TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v5TxCancel && (
                          <>
                          <div style={{ border: '1px solid #242936', borderRadius: '8px', padding: '10px 14px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#94A3B8' }}>
                              Transaction cancelled by user
                            </span>
                          </div>
                          </>
                        )}
                        <div style={{ borderTop: '1px solid #1D212B', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Vault balance
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              {v.v5PosVal}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Accrued yield
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3' }}>
                              {v.v5YieldVal}
                            </span>
                          </div>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px' }}>
                      {v.v5Loading && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                        </div>
                        </>
                      )}
                      {v.v5Loaded && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Total Deposited
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v5Tvl}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Available Capacity
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v5Capacity}
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: '1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          ALLOCATION · TARGET VS ACTUAL
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.06em', color: '#94A3B8', width: '48px', flexShrink: '0' }}>
                          TARGET
                        </span>
                        <div style={{ flex: '1', display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#242936' }}>
                          <div style={{ width: '50%', background: 'rgba(0,102,255,0.45)', height: '100%' }}></div>
                          <div style={{ width: '50%', background: 'rgba(0,229,163,0.45)', height: '100%' }}></div>
                        </div>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#6B7280', width: '84px', flexShrink: '0', textAlign: 'right' }}>
                          50.0 / 50.0
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.06em', color: '#94A3B8', width: '48px', flexShrink: '0' }}>
                          ACTUAL
                        </span>
                        <div style={{ flex: '1', display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#242936' }}>
                          <div style={{ width: v.v5UsdcPct, background: '#0066FF', height: '100%' }}></div>
                          <div style={{ width: v.v5BtcPct, background: '#00E5A3', height: '100%' }}></div>
                        </div>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#FFFFFF', width: '84px', flexShrink: '0', textAlign: 'right' }}>
                          {v.v5UsdcLabel} / {v.v5BtcLabel}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '16px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '2px', background: '#0066FF' }}></span>
                          USDC
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '2px', background: '#00E5A3' }}></span>
                          cirBTC
                        </span>
                      </div>
                      <p style={{ margin: '0', fontSize: '12px', lineHeight: '1.6', color: '#6B7280' }}>
                        The AI agent rebalances automatically toward the ergodic 50 / 50 target whenever an independent price source is available.
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: '1px solid #242936', borderRadius: '8px', padding: '7px 12px', background: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.03) 0 6px, transparent 6px 12px)' }}>
                        <span style={{ fontSize: '12px', lineHeight: '1.55', color: '#94A3B8' }}>
                          See it live in the Paper Vault.
                        </span>
                        <Hoverable as="button" onClick={v.v5GoPaper} style={{ flexShrink: '0', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12px', fontWeight: '600', color: '#FFFFFF', background: 'transparent', border: '1px solid #3A4152', borderRadius: '6px', padding: '7px 12px', cursor: 'pointer' }} hover={{ borderColor: '#00E5A3', color: '#00E5A3' }}>
                          Open Paper Vault →
                        </Hoverable>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '6px', borderTop: '1px solid #1D212B', paddingTop: '14px' }}>
                  <Hoverable as="button" onClick={v.v5TlToggle} style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                      <path d="M4 3v12"></path>
                      <circle cx="4" cy="5" r="1.6"></circle>
                      <circle cx="4" cy="13" r="1.6"></circle>
                      <path d="M7.5 5h7M7.5 13h7"></path>
                    </svg>
                    {' '}View Vault Decision Timeline{' '}
                    <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                      {v.v5TlChevron}
                    </span>
                  </Hoverable>
                  {v.v5TlOpen && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                      {(v.v5Timeline || []).map((t: any, $index: number) => (
                        <React.Fragment key={$index}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: t.color, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '3px 8px', flexShrink: '0' }}>
                              {t.action}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                              <span style={{ fontSize: '12px', lineHeight: '1.55', color: '#94A3B8' }}>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Hoverable>
        {/* ======== v4 CROSS CHAIN LENDING (blue) ======== */}
        <Hoverable as="div" data-screen-label="v6 Cross Chain Lending" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', overflow: 'hidden' }} hover={{ borderColor: 'rgba(0,102,255,0.45)', boxShadow: '0 0 32px rgba(0,102,255,0.08)' }}>
          <Hoverable as="div" onClick={v.v4Toggle} role="button" tabIndex="0" aria-expanded={v.v4Open} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '16px 24px 16px 14px', cursor: 'pointer', flexWrap: 'wrap', minHeight: '74px' }} hover={{ background: 'rgba(148,163,184,0.03)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', flexShrink: '0', borderRadius: '9px', background: 'rgba(0,102,255,0.1)', border: '1px solid rgba(0,102,255,0.3)' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#3385FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <path d="M2.5 6.5h10.5M10.5 4l2.5 2.5L10.5 9"></path>
                <path d="M15.5 11.5H5M7.5 14L5 11.5 7.5 9"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '230px', flex: '1' }}>
              <h3 style={{ margin: '0', fontSize: '15.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Mandor USDC Cross&#8288;Chain Lending Vault
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '20px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                  v6 · USDC only
                </span>
              </div>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.1em', color: '#FFFFFF', background: '#0066FF', borderRadius: '5px', padding: '3px 4px', fontWeight: '500', flexShrink: '0', width: '132px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              CROSS CHAIN LENDING
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginLeft: 'auto', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  TVL
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                  {v.v4Tvl}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '128px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  APY
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', letterSpacing: '-0.01em', color: '#00E5A3', whiteSpace: 'nowrap' }}>
                  {v.v4Apy}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  My Position
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                  {v.v4MyPos}
                </span>
              </div>
              {v.v4ActivePill && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#00E5A3', background: 'rgba(0,229,163,0.07)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  ACTIVE
                </span>
                </>
              )}
              {v.v4Limited && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#F59E0B', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#F59E0B' }}></span>
                  LIMITED
                </span>
                </>
              )}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', transition: 'transform 0.3s ease', transform: v.v4ChevRot }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </div>
          </Hoverable>
          <div style={{ display: 'grid', gridTemplateRows: v.v4Rows, transition: 'grid-template-rows 0.3s ease-in-out' }}>
            <div style={{ overflow: 'hidden', minHeight: '0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 18px 18px' }}>
                <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#94A3B8', maxWidth: '900px', minHeight: '42px' }}>
                  The agent bridges USDC via CCTP to Arbitrum Sepolia and supplies it to Aave v3, running the full cycle: deposit, lend cross chain, earn yield. The current scope is the Arbitrum Sepolia + Aave v3 route, a fully functional feature.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', alignItems: 'stretch' }}>
                  <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '5px', background: '#0D0E12', border: '1px solid #242936', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
                      <button onClick={v.v4SelDep} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v4DepColor, background: v.v4DepBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Deposit
                      </button>
                      <button onClick={v.v4SelWd} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v4WdColor, background: v.v4WdBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Withdraw
                      </button>
                    </div>
                    {v.v4Locked && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '16px', border: '1px dashed #242936', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                          Connect wallet to continue
                        </span>
                        <Hoverable as="button" onClick={v.connect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 26px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                          Connect
                        </Hoverable>
                      </div>
                      </>
                    )}
                    {v.v4UserLoading && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ height: '48px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                        <div style={{ height: '40px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                      </div>
                      </>
                    )}
                    {v.v4FormReady && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#0D0E12', border: `1px solid ${v.v4InBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.v4Amount} onChange={v.v4OnAmount} disabled={v.v4InDisabled} placeholder="0.00" inputMode="decimal" style={{ flex: '1', minWidth: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '16px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none', opacity: v.v4InOpacity }} />
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280' }}>
                            USDC
                          </span>
                          <Hoverable as="button" onClick={v.v4SetMax} disabled={v.v4InDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11.5px', fontWeight: '600', color: '#3385FF', background: 'rgba(0,102,255,0.12)', border: 'none', borderRadius: '5px', padding: '5px 11px', cursor: 'pointer' }} hover={{ background: 'rgba(0,102,255,0.22)' }}>
                            Max
                          </Hoverable>
                        </div>
                        {v.v4HasErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171', marginTop: '-4px' }}>
                            {v.v4Err}
                          </span>
                          </>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              {v.v4MetaLabel}
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                              {v.v4MetaValue}
                            </span>
                          </div>
                          {v.v4IsDep && (
                            <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                Current allowance
                              </span>
                              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                                {v.v4Allowance}
                              </span>
                            </div>
                            </>
                          )}
                        </div>
                        <Hoverable as="button" onClick={v.v4Submit} disabled={v.v4CtaDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: v.v4CtaColor, background: v.v4CtaBg, border: 'none', borderRadius: '8px', padding: '12px 18px', cursor: v.v4CtaCursor, opacity: v.v4CtaOpacity }} hover={{ background: v.v4CtaHoverBg }}>
                          {v.v4CtaLabel}
                        </Hoverable>
                        {v.v4TxOk && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,229,163,0.06)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.5 8l1.8 1.8L10.8 6"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#00E5A3' }}>
                              Transaction successful
                            </span>
                            <Hoverable as="a" href={v.v4TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v4TxFail && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#F87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#F87171' }}>
                              Transaction failed
                            </span>
                            <Hoverable as="a" href={v.v4TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v4TxCancel && (
                          <>
                          <div style={{ border: '1px solid #242936', borderRadius: '8px', padding: '10px 14px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#94A3B8' }}>
                              Transaction cancelled by user
                            </span>
                          </div>
                          </>
                        )}
                        <div style={{ borderTop: '1px solid #1D212B', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Vault balance
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              {v.v4PosVal}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Accrued yield
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3' }}>
                              {v.v4YieldVal}
                            </span>
                          </div>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px' }}>
                      {v.v4Loading && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                        </div>
                        </>
                      )}
                      {v.v4Loaded && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Total Deposited
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v4Tvl}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Available Capacity
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v4Capacity}
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: '1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          CROSS CHAIN POSITION
                        </span>
                        {v.v4HasPos && (
                          <>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#3385FF' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#3385FF', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                            {v.v4StageLabel}
                          </span>
                          </>
                        )}
                        {v.v4NoPos && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
                            READING…
                          </span>
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#94A3B8', border: '1px solid #242936', borderRadius: '999px', padding: '5px 12px', flexShrink: '0' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00E5A3' }}></span>
                          Arc Testnet
                        </span>
                        <span style={{ flex: '1', height: '1px', background: 'repeating-linear-gradient(90deg, #3A4152 0 5px, transparent 5px 10px)', position: 'relative', minWidth: '64px' }}></span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', marginLeft: '-8px' }}>
                          <path d="M2 6h8M7 3l3 3-3 3"></path>
                        </svg>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#94A3B8', border: '1px solid rgba(0,102,255,0.35)', borderRadius: '999px', padding: '5px 12px', flexShrink: '0' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3385FF' }}></span>
                          Arbitrum Sepolia · Aave v3
                        </span>
                      </div>
                      {v.v4HasPos && (
                        <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {(v.v4Steps || []).map((st: any, $index: number) => (
                              <React.Fragment key={$index}>
                                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.06em', color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '4px', padding: '3px 8px' }}>
                                  {st.label}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Principal bridged
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                              38,000.00 USDC
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Current value on Aave
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3' }}>
                              38,412.77 USDC
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                      {v.v4NoPos && (
                        <>
                        <p style={{ margin: '0', fontSize: '12.5px', lineHeight: '1.6', color: '#6B7280' }}>
                          Reading cross chain position state from Arbitrum Sepolia.
                        </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '6px', borderTop: '1px solid #1D212B', paddingTop: '14px' }}>
                  <Hoverable as="button" onClick={v.v4TlToggle} style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                      <path d="M4 3v12"></path>
                      <circle cx="4" cy="5" r="1.6"></circle>
                      <circle cx="4" cy="13" r="1.6"></circle>
                      <path d="M7.5 5h7M7.5 13h7"></path>
                    </svg>
                    {' '}View Vault Decision Timeline{' '}
                    <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                      {v.v4TlChevron}
                    </span>
                  </Hoverable>
                  {v.v4TlOpen && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                      {(v.v4Timeline || []).map((t: any, $index: number) => (
                        <React.Fragment key={$index}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: t.color, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '3px 8px', flexShrink: '0' }}>
                              {t.action}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                              <span style={{ fontSize: '12px', lineHeight: '1.55', color: '#94A3B8' }}>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Hoverable>
        {/* ======== v7 WUSDC/EURC LP (mint, real pool) ======== */}
        <Hoverable as="div" data-screen-label="v7 WUSDC EURC LP" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', overflow: 'hidden' }} hover={{ borderColor: 'rgba(0,229,163,0.4)', boxShadow: '0 0 32px rgba(0,229,163,0.07)' }}>
          <Hoverable as="div" onClick={v.v7Toggle} role="button" tabIndex="0" aria-expanded={v.v7Open} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '16px 24px 16px 14px', cursor: 'pointer', flexWrap: 'wrap', minHeight: '74px' }} hover={{ background: 'rgba(148,163,184,0.03)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', flexShrink: '0', borderRadius: '9px', background: 'linear-gradient(135deg, rgba(0,102,255,0.1), rgba(0,229,163,0.12))', border: '1px solid rgba(0,229,163,0.25)' }}>
              <svg width="19" height="19" viewBox="0 0 18 18" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <circle cx="6.8" cy="9" r="4.6" stroke="#3385FF"></circle>
                <circle cx="11.2" cy="9" r="4.6" stroke="#00E5A3"></circle>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '230px', flex: '1' }}>
              <h3 style={{ margin: '0', fontSize: '15.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Mandor WUSDC/EURC LP Vault
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '20px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                  v7 · mLPv7 · WUSDC + EURC
                </span>
              </div>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.1em', color: '#0D0E12', background: '#00E5A3', borderRadius: '5px', padding: '3px 4px', fontWeight: '500', flexShrink: '0', width: '132px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              LP YIELD
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginLeft: 'auto', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  TVL
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                  {v.v7Tvl}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '128px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  APY
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#4B5563', whiteSpace: 'nowrap', paddingTop: '2px' }}>
                  Insufficient data
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '148px' }}>
                <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                  My Position
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                  {v.v7MyPos}
                </span>
              </div>
              {v.v7ActivePill && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#00E5A3', background: 'rgba(0,229,163,0.07)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  ACTIVE
                </span>
                </>
              )}
              {v.v7Limited && (
                <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#F59E0B', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '999px', padding: '5px 12px', minWidth: '92px', justifyContent: 'center' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#F59E0B' }}></span>
                  LIMITED
                </span>
                </>
              )}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', transition: 'transform 0.3s ease', transform: v.v7ChevRot }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </div>
          </Hoverable>
          <div style={{ display: 'grid', gridTemplateRows: v.v7Rows, transition: 'grid-template-rows 0.3s ease-in-out' }}>
            <div style={{ overflow: 'hidden', minHeight: '0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 18px 18px' }}>
                <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#94A3B8', maxWidth: '900px', minHeight: '42px' }}>
                  The first Mandor vault able to execute a real LP position. The agent provides liquidity to the live WUSDC/EURC pool on UnitFlowV3 (0.3% fee tier), earning trading fees on real volume. Deposits are made in WUSDC.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', alignItems: 'stretch' }}>
                  <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '5px', background: '#0D0E12', border: '1px solid #242936', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
                      <button onClick={v.v7SelDep} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v7DepColor, background: v.v7DepBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Deposit
                      </button>
                      <button onClick={v.v7SelWd} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: v.v7WdColor, background: v.v7WdBg, border: 'none', borderRadius: '6px', padding: '7px 18px', cursor: 'pointer' }}>
                        Withdraw
                      </button>
                    </div>
                    {v.v7Locked && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '16px', border: '1px dashed #242936', borderRadius: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                          Connect wallet to continue
                        </span>
                        <Hoverable as="button" onClick={v.connect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 26px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                          Connect
                        </Hoverable>
                      </div>
                      </>
                    )}
                    {v.v7UserLoading && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ height: '48px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                        <div style={{ height: '40px', background: '#242936', borderRadius: '8px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                      </div>
                      </>
                    )}
                    {v.v7FormReady && (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#0D0E12', border: `1px solid ${v.v7InBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.v7Amount} onChange={v.v7OnAmount} disabled={v.v7InDisabled} placeholder="0.00" inputMode="decimal" style={{ flex: '1', minWidth: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '16px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none', opacity: v.v7InOpacity }} />
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280' }}>
                            WUSDC
                          </span>
                          <Hoverable as="button" onClick={v.v7SetMax} disabled={v.v7InDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11.5px', fontWeight: '600', color: '#00E5A3', background: 'rgba(0,229,163,0.1)', border: 'none', borderRadius: '5px', padding: '5px 11px', cursor: 'pointer' }} hover={{ background: 'rgba(0,229,163,0.2)' }}>
                            Max
                          </Hoverable>
                        </div>
                        {v.v7HasErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171', marginTop: '-4px' }}>
                            {v.v7Err}
                          </span>
                          </>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              {v.v7MetaLabel}
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                              {v.v7MetaValue}
                            </span>
                          </div>
                          {v.v7IsDep && (
                            <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                Current allowance
                              </span>
                              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                                {v.v7Allowance}
                              </span>
                            </div>
                            </>
                          )}
                        </div>
                        <Hoverable as="button" onClick={v.v7Submit} disabled={v.v7CtaDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: v.v7CtaColor, background: v.v7CtaBg, border: 'none', borderRadius: '8px', padding: '12px 18px', cursor: v.v7CtaCursor, opacity: v.v7CtaOpacity }} hover={{ background: v.v7CtaHoverBg }}>
                          {v.v7CtaLabel}
                        </Hoverable>
                        {v.v7TxOk && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,229,163,0.06)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.5 8l1.8 1.8L10.8 6"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#00E5A3' }}>
                              Transaction successful
                            </span>
                            <Hoverable as="a" href={v.v7TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v7TxFail && (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '10px 14px' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#F87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                              <circle cx="8" cy="8" r="6.5"></circle>
                              <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path>
                            </svg>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#F87171' }}>
                              Transaction failed
                            </span>
                            <Hoverable as="a" href={v.v7TxUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                              Explorer
                            </Hoverable>
                          </div>
                          </>
                        )}
                        {v.v7TxCancel && (
                          <>
                          <div style={{ border: '1px solid #242936', borderRadius: '8px', padding: '10px 14px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#94A3B8' }}>
                              Transaction cancelled by user
                            </span>
                          </div>
                          </>
                        )}
                        <div style={{ borderTop: '1px solid #1D212B', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Vault balance
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              {v.v7PosVal}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Accrued yield
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3' }}>
                              {v.v7YieldVal}
                            </span>
                          </div>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px' }}>
                      {v.v7Loading && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
                          <div style={{ height: '40px', background: '#242936', borderRadius: '6px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
                        </div>
                        </>
                      )}
                      {v.v7Loaded && (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Total Deposited
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v7Tvl}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                              Available Capacity
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                              {v.v7Capacity}
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                    <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: '1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          LP POSITION · WUSDC/EURC
                        </span>
                        {v.v7LpActive && (
                          <>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#00E5A3' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3' }}></span>
                            IN RANGE
                          </span>
                          </>
                        )}
                        {v.v7LpNone && (
                          <>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
                            NONE OPEN
                          </span>
                          </>
                        )}
                      </div>
                      {v.v7LpActive && (
                        <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: '#242936' }}>
                            <div style={{ position: 'absolute', left: v.v7LpRangeLeft, width: v.v7LpRangeWidth, top: '0', bottom: '0', background: 'rgba(0,229,163,0.45)', borderRadius: '3px' }}></div>
                            <div style={{ position: 'absolute', left: v.v7LpPriceLeft, top: '-3px', width: '2px', height: '12px', background: '#FFFFFF', borderRadius: '1px' }}></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                              {v.v7LpLower}
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#FFFFFF' }}>
                              {v.v7LpPrice} WUSDC/EURC
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                              {v.v7LpUpper}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Position value
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                              {v.v7LpValue}
                            </span>
                          </div>
                        </div>
                        </>
                      )}
                      {v.v7LpNone && (
                        <>
                        <p style={{ margin: '0', fontSize: '12px', lineHeight: '1.6', color: '#6B7280' }}>
                          No position open yet. The agent is monitoring this pool for a qualifying opportunity.
                        </p>
                        </>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Pool
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                            WUSDC/EURC · 0.30% · UnitFlowV3
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Pool liquidity
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                            ≈184,000 WUSDC / ≈147,000 EURC
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Performance fee
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                            10% on realized yield
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          RISK LIMITS
                        </span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 18px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Max drawdown
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              10%
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Max LP loss
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              3%
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Max out of range
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              48h
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              Max LP allocation
                            </span>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF' }}>
                              50% of NAV
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '6px', borderTop: '1px solid #1D212B', paddingTop: '14px' }}>
                  <Hoverable as="button" onClick={v.v7TlToggle} style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '12.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }} hover={{ color: '#FFFFFF' }}>
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                      <path d="M4 3v12"></path>
                      <circle cx="4" cy="5" r="1.6"></circle>
                      <circle cx="4" cy="13" r="1.6"></circle>
                      <path d="M7.5 5h7M7.5 13h7"></path>
                    </svg>
                    {' '}View Vault Decision Timeline{' '}
                    <span style={{ marginLeft: 'auto', color: '#6B7280' }}>
                      {v.v7TlChevron}
                    </span>
                  </Hoverable>
                  {v.v7TlOpen && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                      {(v.v7Timeline || []).map((t: any, $index: number) => (
                        <React.Fragment key={$index}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: t.color, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '3px 8px', flexShrink: '0' }}>
                              {t.action}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                              <span style={{ fontSize: '12px', lineHeight: '1.55', color: '#94A3B8' }}>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Hoverable>
      </div>
    </main>
    </>
  );
}
