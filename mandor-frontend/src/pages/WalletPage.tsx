import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function WalletPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="Wallet" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1500px', width: '100%' }}>
      {v.wlLocked && (
        <>
        <div style={{ flex: '1', display: 'grid', placeItems: 'center', padding: '24px 0' }}>
          <div style={{ width: 'min(400px, 100%)', background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '46px', height: '46px', borderRadius: '12px', background: '#12141B', border: '1px solid #242936' }}>
              <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <path d="M2.5 5.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"></path>
                <path d="M2.5 5.5V4a1 1 0 0 1 1-1H13"></path>
                <circle cx="12.2" cy="10.5" r="0.8" fill="#94A3B8" stroke="none"></circle>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '17px', fontWeight: '600', letterSpacing: '-0.01em' }}>
                Sign in to Mandor
              </span>
              <span style={{ fontSize: '13px', color: '#94A3B8', lineHeight: '1.6' }}>
                Create or access your embedded wallet with your Google account. No seed phrase required.
              </span>
            </div>
            <Hoverable as="button" onClick={v.connect} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: '#1F2937', background: '#FFFFFF', border: 'none', borderRadius: '8px', padding: '11px 18px', cursor: 'pointer' }} hover={{ background: '#E8ECF3' }}>
              <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden={'true'}>
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"></path>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"></path>
                <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"></path>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"></path>
              </svg>
              {' '}Continue with Google{' '}
            </Hoverable>
            <Hoverable as="button" onClick={v.connect} style={{ width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '10px 18px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
              Connect external wallet
            </Hoverable>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#4B5563' }}>
              POWERED BY PRIVY · EMBEDDED WALLET
            </span>
          </div>
        </div>
        </>
      )}
      {v.wlLoading && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ height: '150px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite' }}></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px' }}>
            <div style={{ height: '380px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.15s' }}></div>
            <div style={{ height: '380px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', animation: 'skeletonPulse 1.4s ease-in-out infinite', animationDelay: '0.3s' }}></div>
          </div>
        </div>
        </>
      )}
      {v.wlReady && (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Identity + balance banner */}
          <div data-screen-label="Wallet Identity" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', flexShrink: '0', borderRadius: '10px', background: '#12141B', border: '1px solid #242936' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden={'true'}>
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"></path>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"></path>
                  <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"></path>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"></path>
                </svg>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0', flex: '1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: '600' }}>
                    Signed in with Google
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.08em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.35)', borderRadius: '4px', padding: '2px 7px' }}>
                    EMBEDDED WALLET · PRIVY
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8', wordBreak: 'break-all' }}>
                    {v.wlAddress}
                  </span>
                  <Hoverable as="button" onClick={v.wlCopy} style={{ flexShrink: '0', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11px', fontWeight: '600', color: '#3385FF', background: 'rgba(0,102,255,0.12)', border: 'none', borderRadius: '5px', padding: '4px 10px', cursor: 'pointer' }} hover={{ background: 'rgba(0,102,255,0.22)' }}>
                    {v.wlCopyLabel}
                  </Hoverable>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: '0' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.08em', color: '#94A3B8', border: '1px solid #3A4152', borderRadius: '4px', padding: '2px 7px' }}>
                  ARC TESTNET
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#00E5A3' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00E5A3', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                  LIVE
                </span>
              </div>
            </div>
          </div>
          {/* Two column dashboard */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '14px', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '0' }}>
              {/* Total balance hero */}
              <div data-screen-label="Total Balance" style={{ background: 'linear-gradient(135deg, rgba(0,102,255,0.08) 0%, rgba(22,25,32,0) 58%), #161920', border: '1px solid #242936', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                    Total balance
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#4B5563' }}>
                    USD VALUE
                  </span>
                </div>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                  {v.wlTotal}
                </span>
                <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: '1.6' }}>
                  Combined USD value of every asset in this wallet. Capital deposited in vaults is not included here.
                </span>
              </div>
              {/* Primary actions */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(156px, 1fr))', gap: '12px' }}>
                <Hoverable as="button" onClick={v.wlOpenRcv} style={{ display: 'flex', alignItems: 'center', gap: '11px', textAlign: 'left', fontFamily: '\'Inter\', system-ui, sans-serif', background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '14px 15px', cursor: 'pointer', transition: 'border-color 0.16s ease, background 0.16s ease' }} hover={{ borderColor: 'rgba(0,229,163,0.45)', background: 'rgba(0,229,163,0.05)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', flexShrink: '0', borderRadius: '9px', background: 'rgba(0,229,163,0.08)', border: '1px solid rgba(0,229,163,0.25)', color: '#00E5A3' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(180deg)' }}>
                      <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
                    </svg>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: '600', color: '#F1F5F9' }}>
                      Receive
                    </span>
                    <span style={{ fontSize: '11.5px', color: '#6B7280' }}>
                      Show address and QR
                    </span>
                  </span>
                </Hoverable>
                <Hoverable as="button" onClick={v.wlToggleSend} style={{ display: 'flex', alignItems: 'center', gap: '11px', textAlign: 'left', fontFamily: '\'Inter\', system-ui, sans-serif', background: v.wlSendCardBg, border: `1px solid ${v.wlSendCardBorder}`, borderRadius: '12px', padding: '14px 15px', cursor: 'pointer', transition: 'border-color 0.16s ease, background 0.16s ease' }} hover={{ borderColor: 'rgba(0,102,255,0.45)', background: 'rgba(0,102,255,0.06)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', flexShrink: '0', borderRadius: '9px', background: 'rgba(0,102,255,0.1)', border: '1px solid rgba(0,102,255,0.3)', color: '#3385FF' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                      <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
                    </svg>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: '600', color: '#F1F5F9' }}>
                      Send
                    </span>
                    <span style={{ fontSize: '11.5px', color: '#6B7280' }}>
                      Transfer to any address
                    </span>
                  </span>
                </Hoverable>
              </div>
              {v.wlSendOpen && (
                <>
                <div data-screen-label="Wallet Send" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                      Send {v.wlToken}
                    </span>
                    <Hoverable as="button" onClick={v.wlToggleSend} aria-label="Close send panel" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', flexShrink: '0', borderRadius: '6px', background: 'transparent', border: 'none', color: '#4B5563', cursor: 'pointer' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden={'true'}>
                        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7"></path>
                      </svg>
                    </Hoverable>
                  </div>
                  {v.wlStepForm && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#6B7280' }}>
                          Destination address
                        </span>
                        <div style={{ background: '#0D0E12', border: `1px solid ${v.wlToBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.wlTo} onChange={v.wlOnTo} placeholder="0x recipient address" spellCheck={false} style={{ width: '100%', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none' }} />
                        </div>
                        {v.wlHasToErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171' }}>
                            {v.wlToErr}
                          </span>
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#6B7280' }}>
                          Asset
                        </span>
                        <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <Hoverable as="select" value={v.wlToken} onChange={v.wlOnToken} style={{ appearance: 'none', WebkitAppearance: 'none', width: '100%', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '500', color: '#E2E8F0', background: '#12141B', border: '1px solid #242936', borderRadius: '8px', height: '40px', padding: '0 32px 0 13px', cursor: 'pointer', transition: 'border-color 0.18s ease' }} hover={{ borderColor: '#3A4152' }}>
                            <option value="USDC">
                              USDC · USD Coin
                            </option>
                            <option value="EURC">
                              EURC · Euro Coin
                            </option>
                            <option value="wUSDC">
                              wUSDC · Wrapped USDC
                            </option>
                            <option value="cirBTC">
                              cirBTC · Circle BTC
                            </option>
                          </Hoverable>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ position: 'absolute', right: '12px', pointerEvents: 'none' }}>
                            <path d="M4 6.5l4 4 4-4"></path>
                          </svg>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#6B7280' }}>
                          Amount
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#0D0E12', border: `1px solid ${v.wlAmtBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                          <input value={v.wlAmount} onChange={v.wlOnAmount} placeholder="0.00" inputMode="decimal" style={{ flex: '1', minWidth: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '16px', color: '#FFFFFF', background: 'transparent', border: 'none', outline: 'none' }} />
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280' }}>
                            {v.wlToken}
                          </span>
                          <Hoverable as="button" onClick={v.wlMax} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '11.5px', fontWeight: '600', color: '#3385FF', background: 'rgba(0,102,255,0.12)', border: 'none', borderRadius: '5px', padding: '5px 11px', cursor: 'pointer' }} hover={{ background: 'rgba(0,102,255,0.22)' }}>
                            Max
                          </Hoverable>
                        </div>
                        {v.wlHasAmtErr && (
                          <>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#F87171' }}>
                            {v.wlAmtErr}
                          </span>
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                        <span style={{ fontSize: '12px', color: '#6B7280' }}>
                          Available balance
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                          {v.wlBalance}
                        </span>
                      </div>
                      <Hoverable as="button" onClick={v.wlReview} disabled={v.wlReviewDisabled} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: v.wlRevCtaColor, background: v.wlRevCtaBg, border: 'none', borderRadius: '8px', padding: '12px 18px', cursor: v.wlRevCtaCursor }} hover={{ background: v.wlRevCtaHoverBg }}>
                        Review Send
                      </Hoverable>
                    </div>
                    </>
                  )}
                  {v.wlStepReview && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                        REVIEW TRANSFER
                      </span>
                      <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Recipient
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#FFFFFF', wordBreak: 'break-all', lineHeight: '1.6' }}>
                            {v.wlRevTo}
                          </span>
                        </div>
                        <div style={{ height: '1px', background: '#1D212B' }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Amount
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                            {v.wlRevAmt}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                          <span style={{ fontSize: '12px', color: '#6B7280' }}>
                            Estimated gas fee
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#94A3B8' }}>
                            0.0100 USDC
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid #1D212B', paddingTop: '10px' }}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#94A3B8' }}>
                            Total debit
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#FFFFFF' }}>
                            {v.wlRevTotal}
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: '1.6' }}>
                        Double check the recipient address. Transfers on Arc Testnet cannot be reversed.
                      </span>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <Hoverable as="button" onClick={v.wlBack} style={{ flex: '1', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '11px 16px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
                          Back
                        </Hoverable>
                        <Hoverable as="button" onClick={v.wlConfirm} style={{ flex: '2', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13.5px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '8px', padding: '11px 16px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                          Confirm &amp; Send
                        </Hoverable>
                      </div>
                    </div>
                    </>
                  )}
                  {v.wlStepPending && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '48px 16px' }}>
                      <span style={{ width: '26px', height: '26px', borderRadius: '50%', border: '2.5px solid #242936', borderTopColor: '#3385FF', animation: 'spin 0.8s linear infinite' }}></span>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: '#94A3B8' }}>
                        Broadcasting transaction to Arc Testnet…
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563' }}>
                        {v.wlRevAmt} → {v.wlRevToShort}
                      </span>
                    </div>
                    </>
                  )}
                  {v.wlStepSuccess && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', background: 'rgba(0,229,163,0.06)', border: '1px solid rgba(0,229,163,0.3)', borderRadius: '10px', padding: '28px 16px' }}>
                        <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                          <circle cx="8" cy="8" r="6.5"></circle>
                          <path d="M5.5 8l1.8 1.8L10.8 6"></path>
                        </svg>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#00E5A3' }}>
                          Transfer sent
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8' }}>
                          {v.wlSentAmt} → {v.wlSentTo}
                        </span>
                        <Hoverable as="a" href={v.wlTxUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', fontWeight: '500', color: '#94A3B8', textDecoration: 'underline' }} hover={{ color: '#FFFFFF' }}>
                          View on explorer
                        </Hoverable>
                      </div>
                      <Hoverable as="button" onClick={v.wlReset} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '11px 16px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
                        Send another
                      </Hoverable>
                    </div>
                    </>
                  )}
                  {v.wlStepFailed && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '14px' }}>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0', marginTop: '1px' }}>
                          <path d="M8 2L15 14H1L8 2z"></path>
                          <line x1="8" y1="7" x2="8" y2="10"></line>
                          <circle cx="8" cy="12" r="0.5" fill="#F59E0B" stroke="none"></circle>
                        </svg>
                        <span style={{ fontSize: '12.5px', lineHeight: '1.6', color: '#A5ACB8' }}>
                          <strong style={{ color: '#F59E0B', fontWeight: '600' }}>
                            Transaction failed.
                          </strong>
                          {' '}No funds moved. The network rejected the transfer; you can retry safely.
                        </span>
                      </div>
                      <Hoverable as="button" onClick={v.wlBack} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '11px 16px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
                        Back to review
                      </Hoverable>
                    </div>
                    </>
                  )}
                  {v.wlStepCancelled && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '14px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#94A3B8' }}>
                          Transaction cancelled by user. No funds moved.
                        </span>
                      </div>
                      <Hoverable as="button" onClick={v.wlBack} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13.5px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '11px 16px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
                        Back to review
                      </Hoverable>
                    </div>
                    </>
                  )}
                </div>
                </>
              )}
              {/* Your assets */}
              <div data-screen-label="Your Assets" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                    Your assets
                  </span>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#4B5563' }}>
                    {v.wlAssetCount}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {(v.wlAssets || []).map((a: any, $index: number) => (
                    <React.Fragment key={$index}>
                      <Hoverable as="div" style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr) auto 84px', alignItems: 'center', gap: '12px', padding: '11px 6px', borderTop: '1px solid #1D212B', borderRadius: '8px' }} hover={{ background: 'rgba(148,163,184,0.05)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', fontWeight: '500', background: a.bg, border: `1px solid ${a.border}`, color: a.color }}>
                          {a.mark}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#DCE3EE', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {a.name}
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.04em', color: '#6B7280' }}>
                            {a.sym}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                            {a.bal}
                          </span>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                            {a.usd}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#94A3B8' }}>
                            {a.pct}
                          </span>
                          <span style={{ width: '100%', height: '3px', borderRadius: '2px', background: '#1D212B', overflow: 'hidden' }}>
                            <span style={{ display: 'block', height: '100%', width: a.barW, borderRadius: '2px', background: a.color, opacity: '0.85' }}></span>
                          </span>
                        </div>
                      </Hoverable>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            {/* Activity */}
            <div data-screen-label="Wallet Activity" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6B7280' }}>
                  Recent activity
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#4B5563' }}>
                  ONCHAIN TRANSFERS
                </span>
              </div>
              <div data-wl-scroll="true" style={{ flex: '1', minHeight: '0', overflowY: 'auto', display: 'flex', flexDirection: 'column', margin: '0 -6px', padding: '0 6px' }}>
                {(v.wlFeed || []).map((it: any, $index: number) => (
                  <React.Fragment key={$index}>
                    <Hoverable as="div" style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto auto', alignItems: 'center', gap: '12px', padding: '12px 6px', borderTop: '1px solid #1D212B', borderRadius: '8px' }} hover={{ background: 'rgba(148,163,184,0.05)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', flexShrink: '0', borderRadius: '8px', background: it.iconBg, border: `1px solid ${it.iconBorder}`, color: it.color }}>
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: `rotate(${it.rot})` }}>
                          <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
                        </svg>
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '0' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: '500', color: '#DCE3EE', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.type}
                          {it.hasDetail && (
                            <>
                            <span style={{ color: '#6B7280', fontWeight: '400' }}>
                              {' '}· {it.detail}
                            </span>
                            </>
                          )}
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                          {it.time}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: it.color, whiteSpace: 'nowrap' }}>
                          {it.amt}
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.04em', color: '#6B7280' }}>
                          {it.token}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.06em', whiteSpace: 'nowrap', color: it.stColor, border: `1px solid ${it.stBorder}`, borderRadius: '4px', padding: '2px 7px' }}>
                          {it.status}
                        </span>
                        <Hoverable as="a" href={it.url} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', flexShrink: '0', borderRadius: '6px', color: '#4B5563' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                            <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v6A1.5 1.5 0 0 0 3.5 12h6A1.5 1.5 0 0 0 11 10.5V8"></path>
                            <path d="M8.5 2H12v3.5"></path>
                            <path d="M12 2L6.5 7.5"></path>
                          </svg>
                        </Hoverable>
                      </div>
                    </Hoverable>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          {/* Receive modal */}
          {v.wlRcvOpen && (
            <>
            <div onClick={v.wlCloseRcv} style={{ position: 'fixed', inset: '0', zIndex: '240', background: 'rgba(9,10,13,0.76)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', animation: 'wlFadeIn 0.16s ease-out' }}>
              <div role="dialog" aria-modal="true" aria-label="Receive USDC" onClick={v.wlStop} style={{ width: '100%', maxWidth: '372px', background: '#161920', border: '1px solid #242936', borderRadius: '14px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxShadow: '0 24px 60px rgba(0,0,0,0.55)', animation: 'wlModalIn 0.18s ease-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', width: '100%' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', letterSpacing: '-0.01em', color: '#F1F5F9' }}>
                    Receive
                  </span>
                  <Hoverable as="button" onClick={v.wlCloseRcv} aria-label="Close" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', flexShrink: '0', borderRadius: '7px', background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.1)' }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden={'true'}>
                      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7"></path>
                    </svg>
                  </Hoverable>
                </div>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '9.5px', letterSpacing: '0.08em', color: '#94A3B8', border: '1px solid #3A4152', borderRadius: '4px', padding: '3px 8px' }}>
                  ARC TESTNET
                </span>
                <div style={{ background: '#12141B', border: '1px solid #1D212B', borderRadius: '12px', padding: '16px', display: 'inline-flex' }}>
                  <span dangerouslySetInnerHTML={v.wlQrHtml} style={{ display: 'inline-flex' }}></span>
                </div>
                <div style={{ width: '100%', background: '#0D0E12', border: '1px solid #242936', borderRadius: '8px', padding: '11px 13px' }}>
                  <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#DCE3EE', wordBreak: 'break-all', lineHeight: '1.6' }}>
                    {v.wlAddress}
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: '1.6', textAlign: 'center' }}>
                  Scan the code or share this address to receive assets on Arc Testnet.
                </span>
                <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                  <Hoverable as="button" onClick={v.wlCopy} style={{ flex: '1', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '8px', padding: '10px 16px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
                    {v.wlCopyLabel} Address
                  </Hoverable>
                  <Hoverable as="button" onClick={v.wlShare} style={{ flex: '1', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', padding: '10px 16px', cursor: 'pointer' }} hover={{ color: '#FFFFFF', borderColor: '#3A4152' }}>
                    Share
                  </Hoverable>
                </div>
              </div>
            </div>
            </>
          )}
        </div>
        </>
      )}
    </main>
    </>
  );
}
