import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function HowItWorksPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="How it Works" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '34px' }}>
      <section style={{ width: '100%', maxWidth: '1120px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            HOW A DECISION WORKS
          </span>
          <span style={{ flex: '1', height: '1px', background: 'linear-gradient(90deg, #242936, rgba(36,41,54,0))' }}></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gridAutoRows: '1fr', gap: '18px', alignItems: 'stretch' }}>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                01
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <rect x="3" y="6" width="12" height="9" rx="2.5"></rect>
                  <path d="M9 3.5v2.5"></path>
                  <circle cx="9" cy="2.6" r="1"></circle>
                  <path d="M6.6 9.6v1.6M11.4 9.6v1.6"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              AI Agent Proposes
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              The AI agent proposes. It reads the vault's real state (assets, open positions, current drawdown) and real market data, then proposes a decision (hold, enter, exit, rebalance, etc.) with its full reasoning visible.
            </p>
          </Hoverable>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                02
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <path d="M9 2l5.5 2.2v4.3c0 3.4-2.3 5.7-5.5 6.5-3.2-.8-5.5-3.1-5.5-6.5V4.2z"></path>
                  <path d="M6.4 8.7l1.9 1.9 3.3-3.6"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              Automatic Check (Advisory)
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              Automatic check (advisory). An offchain check reviews the proposal before it's shown, to catch obvious problems early. This check is never the final authority, only an early warning.
            </p>
          </Hoverable>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                03
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <circle cx="7.4" cy="6" r="2.6"></circle>
                  <path d="M2.8 14.4c0-2.5 2-4.1 4.6-4.1 1 0 1.9.2 2.6.7"></path>
                  <path d="M10.9 12.5l1.5 1.5 3.1-3.2"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              Human Confirmation
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              Human confirmation. Every decision that moves real funds (enter, exit, rebalance) waits for a person to confirm it before it executes. If nobody confirms in time, it expires automatically and never executes. Hold decisions don't move funds, so they auto confirm.
            </p>
          </Hoverable>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                04
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <path d="M9 2l5.5 2.2v4.3c0 3.4-2.3 5.7-5.5 6.5-3.2-.8-5.5-3.1-5.5-6.5V4.2z"></path>
                  <rect x="6.7" y="7.9" width="4.6" height="3.7" rx="1"></rect>
                  <path d="M7.8 7.9V7a1.2 1.2 0 0 1 2.4 0v.9"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              The Policy Contract Decides, Not the AI
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              The policy contract decides, not the AI. Once confirmed, the decision passes through the onchain policy contract: fixed, deterministic rules (drawdown limits, how much of a single asset it can hold, whether the price is trustworthy, etc.) that don't depend on any AI reasoning. If the decision violates any rule, the entire transaction reverts, nothing executes, not even partially.
            </p>
          </Hoverable>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                05
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <rect x="2.4" y="2.4" width="5" height="5" rx="1.2"></rect>
                  <rect x="10.6" y="2.4" width="5" height="5" rx="1.2"></rect>
                  <rect x="6.5" y="10.6" width="5" height="5" rx="1.2"></rect>
                  <path d="M7.4 4.9h3.2M5.4 7.4l2 3.2M12.6 7.4l-2 3.2"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              Real Onchain Execution
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              Real onchain execution. If it passes the policy, it actually executes on the blockchain (Arc Network).
            </p>
          </Hoverable>
          <Hoverable as="div" style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }} hover={{ borderColor: '#3A4152', boxShadow: '0 0 30px rgba(51,133,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11.5px', color: '#3385FF', background: 'rgba(0,102,255,0.08)', border: '1px solid rgba(0,102,255,0.32)' }}>
                06
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', flexShrink: '0', background: '#12141B', border: '1px solid #1D212B', color: '#64748B' }}>
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                  <path d="M4 2.6h6l3 3v2.6"></path>
                  <path d="M10 2.6v3h3"></path>
                  <path d="M4 2.6v11h4"></path>
                  <circle cx="12" cy="11.9" r="3.3"></circle>
                  <path d="M12 10.3v1.7l1.1.8"></path>
                </svg>
              </span>
            </div>
            <h3 style={{ margin: '0', fontSize: '14.5px', fontWeight: '600', letterSpacing: '-0.01em', lineHeight: '1.35', color: '#F1F5F9' }}>
              Full Transparency
            </h3>
            <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', textWrap: 'pretty' }}>
              Full transparency. Every decision is recorded with its full reasoning, its result (executed, rejected, expired), and a link to the real transaction on the block explorer. Nothing is hidden.
            </p>
          </Hoverable>
        </div>
      </section>
      <section style={{ width: '100%', maxWidth: '1120px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            VAULT MODEL
          </span>
          <span style={{ flex: '1', height: '1px', background: 'linear-gradient(90deg, #242936, rgba(36,41,54,0))' }}></span>
        </div>
        <div style={{ background: 'linear-gradient(160deg, rgba(51,133,255,0.05), rgba(0,229,163,0.03))', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '12px', padding: '30px 32px', display: 'flex', gap: '26px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '60px', height: '60px', flexShrink: '0', borderRadius: '14px', background: 'rgba(0,229,163,0.07)', border: '1px solid rgba(0,229,163,0.24)', color: '#00E5A3' }}>
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
              <rect x="1.8" y="3" width="14.4" height="12" rx="2.2"></rect>
              <circle cx="9" cy="9" r="3.4"></circle>
              <circle cx="9" cy="9" r="1"></circle>
              <path d="M9 4.2v1.4M9 12.4v1.4M4.6 9h1.4M12 9h1.4"></path>
            </svg>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '280px', flex: '1' }}>
            <h3 style={{ margin: '0', fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em', color: '#F1F5F9' }}>
              Vault Model
            </h3>
            <p style={{ margin: '0', fontSize: '13.5px', lineHeight: '1.75', color: '#94A3B8', maxWidth: '820px', textWrap: 'pretty' }}>
              Vaults are created and configured by the team only (a curator model, same as established DeFi platforms). There is no public feature to create your own AI agent, this was deliberately decided against building, given the risk of letting anyone create AI managed vaults without oversight.
            </p>
          </div>
        </div>
      </section>
    </main>
    </>
  );
}
