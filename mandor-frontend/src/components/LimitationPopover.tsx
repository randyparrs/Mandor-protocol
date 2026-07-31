import React from 'react';
import Hoverable from './Hoverable';
import type { ShellVals } from '../types';

/** Anchored popover explaining a vault's known limitation. Positioned in fixed
 *  coordinates computed by the controller from the badge that opened it. */
export default function LimitationPopover({ v }: { v: ShellVals }) {
  return (
    <div data-limit-pop="true" role="dialog" aria-label="Known limitation" style={{ position: 'fixed', top: v.limitTop, left: v.limitLeft, zIndex: '900', width: '340px', background: '#12141B', border: '1px solid rgba(245,158,11,0.24)', borderRadius: '10px', boxShadow: '0 20px 46px rgba(0,0,0,0.6)', padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: '9px', transformOrigin: 'top left', animation: 'limitPopIn 0.16s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: '0' }}>
          <path d="M8 2L15 14H1L8 2z"></path>
          <line x1="8" y1="7" x2="8" y2="10"></line>
          <circle cx="8" cy="12" r="0.5" fill="#F59E0B" stroke="none"></circle>
        </svg>
        <span style={{ fontSize: '12px', fontWeight: '600', color: '#F59E0B' }}>Known limitation</span>
        <Hoverable as="button" type="button" onClick={v.limitClose} aria-label="Close" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', color: '#6B7280', background: 'transparent', border: 'none', borderRadius: '5px', cursor: 'pointer', padding: '0' }} hover={{ color: '#DCE3EE', background: 'rgba(148,163,184,0.1)' }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8"></path>
          </svg>
        </Hoverable>
      </div>
      <span style={{ fontSize: '12.5px', lineHeight: '1.6', color: '#A5ACB8' }}>{v.limitBody}</span>
    </div>
  );
}
