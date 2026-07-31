import React from 'react';
import Hoverable from './Hoverable';
import type { ShellVals } from '../types';

export default function Sidebar({ v }: { v: ShellVals }) {
  return (
    <aside style={{ width: '248px', flexShrink: '0', background: '#161920', borderRight: '1px solid #242936', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100vh', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '64px', padding: '0 20px', borderBottom: '1px solid #242936', flexShrink: '0' }}>
        <svg viewBox="0 0 700 530" fill="none" aria-hidden={'true'} style={{ display: 'block', height: '24px', width: 'auto', flexShrink: '0' }}>
          <defs>
            <linearGradient id="mGradU124" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2180FF"></stop>
              <stop offset="1" stopColor="#0057E8"></stop>
            </linearGradient>
            <linearGradient id="mGradStubL24" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0B549E"></stop>
              <stop offset="1" stopColor="#2FA8EC"></stop>
            </linearGradient>
            <linearGradient id="mGradStubR24" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#00795C"></stop>
              <stop offset="1" stopColor="#00D598"></stop>
            </linearGradient>
          </defs>
          <path d="M140 283 L173 370 L115 530 L43 530 Z" fill="url(#mGradStubL24)"></path>
          <path d="M560 283 L527 370 L585 530 L657 530 Z" fill="url(#mGradStubR24)"></path>
          <path d="M8 0 L87 0 L382 530 L303 530 Z" fill="#0066FF"></path>
          <path d="M613 0 L692 0 L397 530 L318 530 Z" fill="#00E5A3"></path>
          <path d="M147 0 L222 0 L339.4 201.3 L302 265.6 Z" fill="#00E5A3"></path>
          <path d="M483 0 L562 0 L318.9 416.7 L280.3 347.4 Z" fill="url(#mGradU124)"></path>
          <rect x="3" y="0" width="65" height="530" fill="#0066FF"></rect>
          <rect x="633" y="0" width="65" height="530" fill="#00E5A3"></rect>
        </svg>
        <span style={{ fontSize: '15px', fontWeight: '600', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          Mandor Protocol
        </span>
      </div>
      <div style={{ flex: '1', minHeight: '0', overflowY: 'auto' }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '22px 12px 24px' }}>
          {(v.navItems || []).map((item: any, $index: number) => (
            <React.Fragment key={$index}>
              <Hoverable as="button" onClick={item.select} style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '500', color: item.color, background: item.bg, border: 'none', borderRadius: '6px', padding: '10px 12px', cursor: 'pointer' }} hover={{ color: '#DCE3EE', background: 'rgba(148,163,184,0.07)' }}>
                <span style={{ display: 'inline-flex', width: '18px', height: '18px', flexShrink: '0', alignItems: 'center', justifyContent: 'center' }} dangerouslySetInnerHTML={item.iconHtml}></span>
                {' '}{item.label}{' '}
              </Hoverable>
            </React.Fragment>
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexShrink: '0' }}>
        <div style={{ height: '1px', background: '#242936', margin: '0 12px' }}></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 20px 16px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start', border: '1px solid #242936', borderRadius: '999px', padding: '5px 12px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00E5A3', display: 'inline-block', flexShrink: '0', animation: 'statusPulse 2.4s ease-in-out infinite' }}></span>
            <span style={{ fontSize: '11.5px', fontWeight: '500', color: '#94A3B8' }}>
              Arc Testnet
            </span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Hoverable as="a" href="#" aria-label="Discord" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', color: '#64748B' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden={'true'}>
                <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"></path>
              </svg>
            </Hoverable>
            <Hoverable as="a" href="#" aria-label="X" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', color: '#64748B' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden={'true'}>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
              </svg>
            </Hoverable>
            <Hoverable as="a" href="https://github.com" target="_blank" rel="noopener noreferrer" aria-label="GitHub" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', color: '#64748B' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden={'true'}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"></path>
              </svg>
            </Hoverable>
            <Hoverable as="a" href="#" aria-label="Docs" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', color: '#64748B' }} hover={{ color: '#FFFFFF', background: 'rgba(148,163,184,0.08)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden={'true'}>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </Hoverable>
          </div>
          <Hoverable as="a" href="#" style={{ fontSize: '11px', fontWeight: '500', color: '#64748B' }} hover={{ color: '#FFFFFF' }}>
            Terms &amp; Conditions
          </Hoverable>
        </div>
      </div>
    </aside>
  );
}
