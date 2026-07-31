import React from 'react';
import Hoverable from './Hoverable';
import type { ShellVals } from '../types';

export default function Header({ v }: { v: ShellVals }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', height: '64px', padding: '0 28px', borderBottom: '1px solid #242936', flexShrink: '0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', minWidth: '0', flex: '1' }}>
        <h1 style={{ margin: '0', fontSize: '17px', fontWeight: '600', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          {v.pageTitle}
        </h1>
        <span style={{ fontSize: '12.5px', color: '#6B7280', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' }}>
          {v.pageDesc}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: '0' }}>
        {v.isDisconnected && (
          <>
          <Hoverable as="button" onClick={v.connect} style={{ display: 'inline-flex', alignItems: 'center', fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '14px', fontWeight: '600', color: '#FFFFFF', background: '#0066FF', border: 'none', borderRadius: '6px', padding: '9px 20px', cursor: 'pointer' }} hover={{ background: '#1A75FF' }}>
            Connect
          </Hoverable>
          </>
        )}
        {v.isConnected && (
          <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: '\'JetBrains Mono\', monospace', fontSize: '13px', color: '#A5ACB8', background: '#161920', border: '1px solid #242936', borderRadius: '6px', padding: '8px 14px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00E5A3', display: 'inline-block' }}></span>
            {v.walletDisplay}
          </span>
          <Hoverable as="button" onClick={v.disconnect} style={{ fontFamily: '\'Inter\', system-ui, sans-serif', fontSize: '13px', fontWeight: '500', color: '#6B7280', background: 'transparent', border: 'none', padding: '8px 6px', cursor: 'pointer' }} hover={{ color: '#A5ACB8' }}>
            Disconnect
          </Hoverable>
          </>
        )}
      </div>
    </header>
  );
}
