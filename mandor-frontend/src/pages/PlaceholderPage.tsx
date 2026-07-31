import React from 'react';
import Hoverable from '../components/Hoverable';
import type { ShellVals } from '../types';

export default function PlaceholderPage({ v }: { v: ShellVals }) {
  return (
    <>
    <main style={{ flex: '1', minHeight: '0', overflowY: 'auto', padding: '28px', display: 'flex' }}>
      <div style={{ flex: '1', border: '1px dashed #242936', borderRadius: '10px', display: 'grid', placeItems: 'center', minHeight: '420px' }}>
        <span style={{ fontFamily: '\'JetBrains Mono\', monospace', fontSize: '12px', letterSpacing: '0.1em', color: '#6B7280' }}>
          {v.activeLabel} · PAGE CONTENT
        </span>
      </div>
    </main>
    </>
  );
}
