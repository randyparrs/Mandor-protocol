import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function PaperVaultPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main data-screen-label="Paper Vault" style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '20px 28px 48px', position: 'relative' }}>
      <div style={{ position: 'relative', maxWidth: '880px', border: '1px dashed rgba(224,178,60,0.45)', borderRadius: '14px', padding: '22px 22px 26px', overflow: 'hidden' }}>
        <div aria-hidden={'true'} style={{ position: 'absolute', inset: '0', background: 'repeating-linear-gradient(135deg, rgba(224,178,60,0.05) 0 10px, transparent 10px 20px)', pointerEvents: 'none' }}></div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.1em', color: '#E0B23C', background: 'rgba(224,178,60,0.1)', border: '1px solid rgba(224,178,60,0.4)', borderRadius: '999px', padding: '6px 14px' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#E0B23C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                <path d="M8 2.5l5.5 3v5l-5.5 3-5.5-3v-5z"></path>
                <path d="M8 8v5.5M8 8L2.5 5M8 8l5.5-3"></path>
              </svg>
              SIMULATED ENVIRONMENT
            </span>
            <span style={{ fontSize: '12.5px', color: '#94A3B8' }}>
              No real funds, contracts or transactions are involved.
            </span>
          </div>
          <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#94A3B8', maxWidth: '700px' }}>
            A running demo of the v5 Ergodic Rebalancing strategy against paper positions and a simulated price feed, so the mechanic can be seen working end to end while the real pool is unavailable.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(v.pvFilters || []).map((f: any, $index: number) => (
              <React.Fragment key={$index}>
                <Hoverable as="button" onClick={f.select} style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', letterSpacing: '0.06em', color: f.color, background: f.bg, border: `1px solid ${f.border}`, borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', transition: 'border-color 0.15s ease, color 0.15s ease' }} hover={{ borderColor: '#E0B23C', color: '#FFFFFF' }}>
                  {f.label}
                </Hoverable>
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(v.pvDecisions || []).map((d: any, $index: number) => (
              <React.Fragment key={$index}>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '14px', flexShrink: '0' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: d.aColor, boxShadow: '0 0 0 3px rgba(224,178,60,0.1)', marginTop: '24px', flexShrink: '0' }}></span>
                    <span style={{ flex: '1', width: '1px', background: 'linear-gradient(180deg, rgba(224,178,60,0.35) 0%, rgba(224,178,60,0.35) 70%, transparent 100%)', marginTop: '8px' }}></span>
                  </div>
                  <Hoverable as="div" style={{ flex: '1', minWidth: '0', background: 'rgba(22,25,32,0.85)', backdropFilter: 'blur(8px)', border: '1px dashed rgba(224,178,60,0.4)', borderRadius: '12px', padding: '18px 20px', marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '12px', transition: 'border-color 0.2s ease' }} hover={{ borderColor: '#E0B23C' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '14px', fontWeight: '500', letterSpacing: '0.04em', color: d.aColor }}>
                        {d.action}
                      </span>
                      <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#E0B23C', background: 'rgba(224,178,60,0.12)', border: '1px solid rgba(224,178,60,0.4)', borderRadius: '999px', padding: '3px 10px' }}>
                        SIMULATED
                      </span>
                      <span style={{ marginLeft: 'auto', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.06em', color: '#94A3B8', border: '1px solid #3A4152', borderRadius: '4px', padding: '3px 9px', flexShrink: '0' }}>
                        V5 PAPER
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5"></rect>
                          <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5"></path>
                        </svg>
                        {d.time}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z"></path>
                        </svg>
                        Confidence {d.confidence}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', color: '#6B7280' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <rect x="3" y="3" width="10" height="10" rx="2"></rect>
                          <circle cx="6.3" cy="6.3" r="0.8" fill="#6B7280" stroke="none"></circle>
                          <circle cx="9.7" cy="6.3" r="0.8" fill="#6B7280" stroke="none"></circle>
                          <path d="M6 9.5h4"></path>
                        </svg>
                        {d.model}
                      </span>
                    </div>
                    <div style={{ borderTop: '1px solid #1D212B', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7"></path>
                        </svg>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          OPERATION DETAIL
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 24px' }}>
                        {(d.op || []).map((kv: any, $index: number) => (
                          <React.Fragment key={$index}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                {kv.k}
                              </span>
                              <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', color: '#E2E8F0', textAlign: 'right' }}>
                                {kv.v}
                              </span>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid #1D212B', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z"></path>
                          <path d="M12.5 11l0.6 1.4L14.5 13l-1.4 0.6L12.5 15l-0.6-1.4L10.5 13l1.4-0.6z"></path>
                        </svg>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          REASONING
                        </span>
                      </div>
                      <p style={{ margin: '0', fontSize: '13px', lineHeight: '1.7', color: '#A5ACB8' }}>
                        {d.reasoning}
                      </p>
                    </div>
                    <div style={{ borderTop: '1px solid #1D212B', paddingTop: '12px', display: 'flex', flexDirection: 'column' }}>
                      <Hoverable as="button" onClick={d.traceToggle} style={{ display: 'flex', alignItems: 'center', gap: '7px', width: '100%', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', color: '#6B7280' }} hover={{ color: '#FFFFFF' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <path d="M5 2.5c-1.4 0-2 .8-2 2v1.8c0 .9-.4 1.7-1.2 1.7.8 0 1.2.8 1.2 1.7v1.8c0 1.2.6 2 2 2M11 2.5c1.4 0 2 .8 2 2v1.8c0 .9.4 1.7 1.2 1.7-.8 0-1.2.8-1.2 1.7v1.8c0 1.2-.6 2-2 2"></path>
                        </svg>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: 'currentColor' }}>
                          THINKING TRACE
                        </span>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10px', color: '#4B5563', marginLeft: '8px' }}>
                          {d.tokens} tokens
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'currentColor' }}>
                          {d.traceChevron}
                        </span>
                      </Hoverable>
                      <div style={{ display: 'grid', gridTemplateRows: d.traceRows, transition: 'grid-template-rows 0.3s ease-in-out' }}>
                        <div style={{ overflow: 'hidden', minHeight: '0' }}>
                          <pre style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '11px', lineHeight: '1.7', color: '#6B7280', background: '#0D0E12', border: '1px solid #1D212B', borderRadius: '8px', padding: '12px 14px' }}>
                            {d.trace}
                          </pre>
                        </div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid #1D212B', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
                          <path d="M8 2l5 2v4c0 3.2-2.2 5.3-5 6-2.8-.7-5-2.8-5-6V4z"></path>
                          <path d="M5.8 8l1.6 1.6 2.8-3.2"></path>
                        </svg>
                        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '10.5px', letterSpacing: '0.1em', color: '#6B7280' }}>
                          OFFCHAIN CHECK
                        </span>
                      </div>
                      <span style={{ fontSize: '12.5px', lineHeight: '1.6', color: '#94A3B8' }}>
                        {d.offchain}
                      </span>
                    </div>
                  </Hoverable>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid rgba(224,178,60,0.4)', background: 'rgba(224,178,60,0.07)', borderRadius: '10px', padding: '12px 16px' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#E0B23C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'} style={{ flexShrink: '0' }}>
              <path d="M8 2L15 14H1L8 2z"></path>
              <line x1="8" y1="7" x2="8" y2="10"></line>
              <circle cx="8" cy="12" r="0.5" fill="#E0B23C" stroke="none"></circle>
            </svg>
            <span style={{ fontSize: '12.5px', lineHeight: '1.6', color: '#C9A24B' }}>
              <strong style={{ color: '#E0B23C', fontWeight: '600' }}>
                This is a simulation.
              </strong>
              {' '}Every position, decision and result on this page runs against paper balances and a simulated price feed. Nothing here touches real funds or the live v5 vault.
            </span>
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
