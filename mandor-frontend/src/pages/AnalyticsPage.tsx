import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function AnalyticsPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="Analytics" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '22px 28px 56px', display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '1500px', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
            Protocol TVL
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
            {v.tvlDisplay}
          </span>
        </div>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
            Total Fees Collected
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
            150.29 USDC
          </span>
        </div>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
            Decisions Logged
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
            45
          </span>
        </div>
        <div style={{ border: '1px solid #242936', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
            Active Strategies
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
            {v.strategiesDisplay}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px', flex: '2', minWidth: '340px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
              TVL OVER TIME
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
              LAST 30 DAYS
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '17px', fontWeight: '500', lineHeight: '1.25', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
              {v.tvlDisplay}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: '500', color: '#00E5A3' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#00E5A3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                <path d="M3 10l3.5-4L9 8.5 13 3"></path>
                <path d="M9.5 3H13v3.5"></path>
              </svg>
              +296% · 30d
            </span>
          </div>
          <svg viewBox="0 0 560 160" preserveAspectRatio="none" style={{ width: '100%', height: '248px', overflow: 'visible', flex: '1' }}>
            <defs>
              <linearGradient id="tvlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#00E5A3" stopOpacity="0.22"></stop>
                <stop offset="1" stopColor="#00E5A3" stopOpacity="0"></stop>
              </linearGradient>
            </defs>
            <line x1="8" y1="44" x2="552" y2="44" stroke="#1D212B" strokeWidth="1"></line>
            <line x1="8" y1="80" x2="552" y2="80" stroke="#1D212B" strokeWidth="1"></line>
            <line x1="8" y1="116" x2="552" y2="116" stroke="#1D212B" strokeWidth="1"></line>
            <path d="M8.0,147.3 L26.8,143.4 L45.5,145.3 L64.3,139.4 L83.0,133.5 L101.8,135.5 L120.6,127.6 L139.3,129.6 L158.1,121.7 L176.8,115.9 L195.6,117.8 L214.3,108.0 L233.1,100.1 L251.9,104.1 L270.6,94.2 L289.4,86.4 L308.1,90.3 L326.9,80.5 L345.7,72.6 L364.4,76.6 L383.2,66.7 L401.9,58.9 L420.7,62.8 L439.4,53.0 L458.2,45.1 L477.0,49.1 L495.7,39.2 L514.5,31.4 L533.2,21.6 L552.0,8.0 L552.0,152 L8.0,152 Z" fill="url(#tvlFill)"></path>
            <path d="M8.0,147.3 L26.8,143.4 L45.5,145.3 L64.3,139.4 L83.0,133.5 L101.8,135.5 L120.6,127.6 L139.3,129.6 L158.1,121.7 L176.8,115.9 L195.6,117.8 L214.3,108.0 L233.1,100.1 L251.9,104.1 L270.6,94.2 L289.4,86.4 L308.1,90.3 L326.9,80.5 L345.7,72.6 L364.4,76.6 L383.2,66.7 L401.9,58.9 L420.7,62.8 L439.4,53.0 L458.2,45.1 L477.0,49.1 L495.7,39.2 L514.5,31.4 L533.2,21.6 L552.0,8.0" fill="none" stroke="#00E5A3" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"></path>
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
            <span>
              27 Jun
            </span>
            <span>
              12 Jul
            </span>
            <span>
              26 Jul
            </span>
          </div>
        </div>
        <div style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '18px', flex: '1', minWidth: '280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
              ALLOCATION BY VAULT
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
              SHARE OF TVL
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: '1' }}>
            <div style={{ position: 'relative', width: '150px', height: '150px', flexShrink: '0', borderRadius: '50%', background: 'conic-gradient(#3385FF 0.0% 61.7%, #00E5A3 61.7% 86.5%, #E0B23C 86.5% 89.8%, #94A3B8 89.8% 100.0%)' }}>
              <div style={{ position: 'absolute', inset: '23px', borderRadius: '50%', background: '#161920', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                  4
                </span>
                <span style={{ fontSize: '9.5px', letterSpacing: '0.09em', color: '#6B7280' }}>
                  VAULTS
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: '1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#3385FF', flexShrink: '0' }}></span>
                <span style={{ fontSize: '12px', color: '#94A3B8', flex: '1' }}>
                  V6
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#E2E8F0' }}>
                  61.7%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#00E5A3', flexShrink: '0' }}></span>
                <span style={{ fontSize: '12px', color: '#94A3B8', flex: '1' }}>
                  V3
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#E2E8F0' }}>
                  24.8%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#E0B23C', flexShrink: '0' }}></span>
                <span style={{ fontSize: '12px', color: '#94A3B8', flex: '1' }}>
                  V7
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#E2E8F0' }}>
                  3.3%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#94A3B8', flexShrink: '0' }}></span>
                <span style={{ fontSize: '12px', color: '#94A3B8', flex: '1' }}>
                  V5
                </span>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#E2E8F0' }}>
                  10.2%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            DECISION HISTORY AGGREGATES
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
            ACROSS ALL VAULTS
          </span>
        </div>
        <div style={{ display: 'flex', gap: '36px', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: '1.2', minWidth: '280px', paddingRight: '36px', borderRight: '1px solid #1D212B', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '40px', height: '148px', padding: '0 8px', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: '1' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                  14
                </span>
                <div style={{ width: '100%', maxWidth: '56px', height: '64px', background: '#00E5A3', borderRadius: '5px 5px 0 0', opacity: '0.9' }}></div>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.09em', color: '#64748B' }}>
                  EXECUTE
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: '1' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                  22
                </span>
                <div style={{ width: '100%', maxWidth: '56px', height: '100px', background: '#94A3B8', borderRadius: '5px 5px 0 0', opacity: '0.9' }}></div>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.09em', color: '#64748B' }}>
                  CHECK
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: '1' }}>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                  9
                </span>
                <div style={{ width: '100%', maxWidth: '56px', height: '41px', background: '#F59E0B', borderRadius: '5px 5px 0 0', opacity: '0.9' }}></div>
                <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.09em', color: '#64748B' }}>
                  HOLD
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px 32px', flex: '1', minWidth: '280px', alignContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                Total decisions logged
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                45
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                Average confidence
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                95.1%
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                Most active vault
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                V3
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '10px', fontWeight: '500', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#64748B' }}>
                Blocked / HOLD decisions
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14.5px', fontWeight: '500', lineHeight: '1.3', letterSpacing: '-0.01em', color: '#FFFFFF' }}>
                9
              </span>
            </div>
          </div>
        </div>
      </div>
      {' '}
      <div style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            PERFORMANCE FEE HISTORY
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
            10% ON REALIZED YIELD
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ position: 'absolute', left: '-4px', top: '50%', marginTop: '-3.5px', width: '7px', height: '7px', borderRadius: '50%', background: '#3385FF', boxShadow: '0 0 0 3px #161920' }}></span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.4)', borderRadius: '4px', padding: '3px 8px', flexShrink: '0', marginLeft: '18px' }}>
              V6
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Performance fee settled
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 25 · 14:02 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280', flexShrink: '0' }}>
              +412.77 USDC gross
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3', flexShrink: '0', width: '96px', textAlign: 'right' }}>
              41.28 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0' }}>
              0x7b21…4fd9
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ position: 'absolute', left: '-4px', top: '50%', marginTop: '-3.5px', width: '7px', height: '7px', borderRadius: '50%', background: '#3385FF', boxShadow: '0 0 0 3px #161920' }}></span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.4)', borderRadius: '4px', padding: '3px 8px', flexShrink: '0', marginLeft: '18px' }}>
              V6
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Performance fee settled
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 18 · 14:02 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280', flexShrink: '0' }}>
              +388.05 USDC gross
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3', flexShrink: '0', width: '96px', textAlign: 'right' }}>
              38.81 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0' }}>
              0x2ad4…91c7
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ position: 'absolute', left: '-4px', top: '50%', marginTop: '-3.5px', width: '7px', height: '7px', borderRadius: '50%', background: '#3385FF', boxShadow: '0 0 0 3px #161920' }}></span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.4)', borderRadius: '4px', padding: '3px 8px', flexShrink: '0', marginLeft: '18px' }}>
              V6
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Performance fee settled
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 11 · 14:02 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280', flexShrink: '0' }}>
              +361.90 USDC gross
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3', flexShrink: '0', width: '96px', textAlign: 'right' }}>
              36.19 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0' }}>
              0x9e0f…3b2a
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ position: 'absolute', left: '-4px', top: '50%', marginTop: '-3.5px', width: '7px', height: '7px', borderRadius: '50%', background: '#3385FF', boxShadow: '0 0 0 3px #161920' }}></span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.4)', borderRadius: '4px', padding: '3px 8px', flexShrink: '0', marginLeft: '18px' }}>
              V6
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Performance fee settled
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 04 · 14:02 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280', flexShrink: '0' }}>
              +340.12 USDC gross
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3', flexShrink: '0', width: '96px', textAlign: 'right' }}>
              34.01 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0' }}>
              0x1c88…7de1
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ position: 'absolute', left: '-4px', top: '50%', marginTop: '-3.5px', width: '7px', height: '7px', borderRadius: '50%', background: '#3385FF', boxShadow: '0 0 0 3px #161920' }}></span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#3385FF', border: '1px solid rgba(0,102,255,0.4)', borderRadius: '4px', padding: '3px 8px', flexShrink: '0', marginLeft: '18px' }}>
              V6
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Performance fee settled
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 06 27 · 14:02 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#6B7280', flexShrink: '0' }}>
              +318.44 USDC gross
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12.5px', color: '#00E5A3', flexShrink: '0', width: '96px', textAlign: 'right' }}>
              31.84 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0' }}>
              0x5a67…c0f3
            </span>
          </Hoverable>
        </div>
      </div>
      <div style={{ background: '#161920', border: '1px solid #242936', borderRadius: '12px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            REAL ONCHAIN ACTIVITY
          </span>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.08em', color: '#4B5563' }}>
            ARC TESTNET · ARBITRUM SEPOLIA
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: '0', borderRadius: '8px', background: 'rgba(0,229,163,0.1)', border: '1px solid rgba(0,229,163,0.3)', color: '#00E5A3', marginLeft: '-14px', boxShadow: '0 0 0 4px #161920' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(90deg)' }}>
                <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Deposit · V6
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 22 · 16:40 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3', flexShrink: '0' }}>
              +4,000.00 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0', width: '88px', textAlign: 'right' }}>
              0x4c7d…9a11f4
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: '0', borderRadius: '8px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#F87171', marginLeft: '-14px', boxShadow: '0 0 0 4px #161920' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(270deg)' }}>
                <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Withdrawal · V3
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 21 · 09:12 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#F87171', flexShrink: '0' }}>
              -1,200.00 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0', width: '88px', textAlign: 'right' }}>
              0x88af…2e70c1
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: '0', borderRadius: '8px', background: 'rgba(0,102,255,0.1)', border: '1px solid rgba(0,102,255,0.3)', color: '#3385FF', marginLeft: '-14px', boxShadow: '0 0 0 4px #161920' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(0deg)' }}>
                <path d="M2.5 6.5h9M8 3.5l3 3-3 3"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Bridge · Arc → Arbitrum Sepolia
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 23 · 13:47 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#3385FF', flexShrink: '0' }}>
              38,000.00 USDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0', width: '88px', textAlign: 'right' }}>
              0x4c7d…9a11f4
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: '0', borderRadius: '8px', background: 'rgba(0,229,163,0.1)', border: '1px solid rgba(0,229,163,0.3)', color: '#00E5A3', marginLeft: '-14px', boxShadow: '0 0 0 4px #161920' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(90deg)' }}>
                <path d="M3.5 10.5L10.5 3.5M10.5 3.5H5M10.5 3.5V9"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Deposit · V7
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 25 · 10:40 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#00E5A3', flexShrink: '0' }}>
              +3,260.00 WUSDC
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0', width: '88px', textAlign: 'right' }}>
              0x8f3a…b2c21b
            </span>
          </Hoverable>
          <Hoverable as="div" style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 6px 12px 0', position: 'relative', marginLeft: '15px', borderLeft: '1px solid #1D212B' }} hover={{ background: 'rgba(148,163,184,0.04)', borderRadius: '0 8px 8px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: '0', borderRadius: '8px', background: 'rgba(148,163,184,0.08)', border: '1px solid #3A4152', color: '#94A3B8', marginLeft: '-14px', boxShadow: '0 0 0 4px #161920' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ transform: 'rotate(0deg)' }}>
                <circle cx="7" cy="7" r="5"></circle>
                <path d="M7 4v3l2 1.2"></path>
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' }}>
              <span style={{ fontSize: '12.5px', color: '#DCE3EE' }}>
                Contract deploy · V7 position manager
              </span>
              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', color: '#4B5563' }}>
                2026 07 25 · 10:12 UTC
              </span>
            </div>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#94A3B8', flexShrink: '0' }}>
              —
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#4B5563', flexShrink: '0', width: '88px', textAlign: 'right' }}>
              0x8f3a…b2c21b
            </span>
          </Hoverable>
        </div>
      </div>
      <div style={{ background: 'linear-gradient(160deg, rgba(51,133,255,0.05), rgba(0,229,163,0.03))', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '12px', padding: '24px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#94A3B8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
            <path d="M8 2l5 2v4c0 3.2-2.2 5.3-5 6-2.8-.7-5-2.8-5-6V4z"></path>
            <path d="M5.8 8l1.6 1.6 2.8-3.2"></path>
          </svg>
          <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
            STRATEGY VALIDATION RESEARCH
          </span>
        </div>
        <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#94A3B8', maxWidth: '760px' }}>
          Independent backtests validate each strategy's mechanic before it is deployed to testnet. Findings inform risk limits (max drawdown, out-of-range time, allocation caps) rather than live performance figures above, which come only from onchain state.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#6B7280' }}>
              Backtest window
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#E2E8F0' }}>
              2019 — 2025 daily data
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', color: '#6B7280' }}>
              Strategies covered
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#E2E8F0' }}>
              LP Yield, Cross-Chain Lending, Ergodic Rebalancing
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', color: '#6B7280' }}>
              Methodology
            </span>
            <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#E2E8F0' }}>
              Historical simulation, no live capital
            </span>
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
