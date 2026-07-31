import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function SettingsPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="Settings" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      <section style={{ width: '100%', maxWidth: '880px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', color: '#F1F5F9' }}>
            Account and Wallet
          </h2>
          <span style={{ fontSize: '12.5px', color: '#6B7280' }}>
            Your sign in method, embedded wallet and session controls.
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Login method
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#94A3B8', border: '1px solid #242936', borderRadius: '999px', padding: '5px 12px' }}>
              <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"></path>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"></path>
                <path fill="#FBBC05" d="M3.964 10.708A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.708V4.96H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.04l3.007-2.332z"></path>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"></path>
              </svg>
              {' '}GOOGLE{' '}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', borderTop: '1px solid #1D212B', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Connected wallet
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#E2E8F0', flexShrink: '0' }}>
              {v.walletDisplay}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', borderTop: '1px solid #1D212B', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Export wallet
            </span>
            <Hoverable as="button" style={{ flexShrink: '0', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#94A3B8', background: 'transparent', border: '1px solid #242936', borderRadius: '8px', height: '36px', padding: '0 18px', cursor: 'pointer', transition: 'border-color 0.18s ease, color 0.18s ease' }} hover={{ borderColor: '#3A4152', color: '#DCE3EE' }}>
              Export wallet
            </Hoverable>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', borderTop: '1px solid #1D212B', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Disconnect
            </span>
            <Hoverable as="button" onClick={v.disconnect} style={{ flexShrink: '0', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '600', color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.32)', borderRadius: '8px', height: '36px', padding: '0 18px', cursor: 'pointer', transition: 'background 0.18s ease, border-color 0.18s ease' }} hover={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.5)' }}>
              Disconnect
            </Hoverable>
          </div>
        </div>
      </section>
      <section style={{ width: '100%', maxWidth: '880px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', color: '#F1F5F9' }}>
            Reference currency
          </h2>
          <span style={{ fontSize: '12.5px', color: '#6B7280' }}>
            Currency used to display balances and vault values.
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Reference currency
            </span>
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: '0' }}>
              <Hoverable as="select" value={v.setCurrency} onChange={v.onCurrency} style={{ appearance: 'none', WebkitAppearance: 'none', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '500', color: '#E2E8F0', background: '#12141B', border: '1px solid #242936', borderRadius: '8px', height: '36px', width: '200px', padding: '0 32px 0 12px', cursor: 'pointer', transition: 'border-color 0.18s ease' }} hover={{ borderColor: '#3A4152' }}>
                <option value="USD">
                  USD
                </option>
                <option value="EUR">
                  EUR
                </option>
                <option value="GBP">
                  GBP
                </option>
              </Hoverable>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ position: 'absolute', right: '11px', pointerEvents: 'none' }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </span>
          </div>
        </div>
      </section>
      <section style={{ width: '100%', maxWidth: '880px', background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', color: '#F1F5F9' }}>
            App preferences
          </h2>
          <span style={{ fontSize: '12.5px', color: '#6B7280' }}>
            How Mandor refreshes data and which network this session runs on.
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Auto refresh interval
            </span>
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: '0' }}>
              <Hoverable as="select" value={v.setRefresh} onChange={v.onRefresh} style={{ appearance: 'none', WebkitAppearance: 'none', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '500', color: '#E2E8F0', background: '#12141B', border: '1px solid #242936', borderRadius: '8px', height: '36px', width: '200px', padding: '0 32px 0 12px', cursor: 'pointer', transition: 'border-color 0.18s ease' }} hover={{ borderColor: '#3A4152' }}>
                <option value="15 seconds">
                  15 seconds
                </option>
                <option value="30 seconds">
                  30 seconds
                </option>
                <option value="60 seconds">
                  60 seconds
                </option>
              </Hoverable>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ position: 'absolute', right: '11px', pointerEvents: 'none' }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', borderTop: '1px solid #1D212B', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Default vault view
            </span>
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: '0' }}>
              <Hoverable as="select" value={v.setVaultView} onChange={v.onVaultView} style={{ appearance: 'none', WebkitAppearance: 'none', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '500', color: '#E2E8F0', background: '#12141B', border: '1px solid #242936', borderRadius: '8px', height: '36px', width: '200px', padding: '0 32px 0 12px', cursor: 'pointer', transition: 'border-color 0.18s ease' }} hover={{ borderColor: '#3A4152' }}>
                <option value="All vaults">
                  All vaults
                </option>
                <option value="My positions">
                  My positions
                </option>
              </Hoverable>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ position: 'absolute', right: '11px', pointerEvents: 'none' }}>
                <path d="M4 6.5l4 4 4-4"></path>
              </svg>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '56px', borderTop: '1px solid #1D212B', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Connected network
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: '0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', fontWeight: '500', color: '#94A3B8', border: '1px solid #242936', borderRadius: '999px', padding: '5px 12px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00E5A3', display: 'inline-block', flexShrink: '0', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
                {' '}Arc Testnet{' '}
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563' }}>
                Chain ID 5042002
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
    </>
  );
}
