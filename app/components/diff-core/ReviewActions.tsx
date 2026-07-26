'use client';

import type { ReviewSendMode } from './types';

interface ReviewActionsProps {
  totalComments: number;
  unresolvedCount: number;
  resolvedCount: number;
  sending: boolean;
  onSend: (mode: ReviewSendMode) => void;
}

// Footer review affordances: open/resolved counters plus the Discuss/Act
// buttons that hand the unresolved comments to the parent for delivery.
export function ReviewActions({ totalComments, unresolvedCount, resolvedCount, sending, onSend }: ReviewActionsProps) {
  return (
    <>
      {totalComments > 0 && (
        <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 8 }}>
          {unresolvedCount > 0 && <span style={{ color: '#fbbf24' }}>{unresolvedCount} open</span>}
          {resolvedCount > 0 && <span style={{ color: '#51cf66' }}>{resolvedCount} resolved</span>}
        </span>
      )}
      <button
        onClick={() => onSend('discuss')}
        disabled={unresolvedCount === 0 || sending}
        style={{
          padding: '8px 16px', borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          background: unresolvedCount > 0 ? 'rgba(255, 255, 255, 0.06)' : '#222',
          color: unresolvedCount > 0 ? '#ccc' : '#555',
          fontSize: 13, fontWeight: 600,
          cursor: unresolvedCount > 0 ? 'pointer' : 'default',
          fontFamily: 'inherit', backdropFilter: 'blur(8px)',
          opacity: sending ? 0.6 : 1, transition: 'all 0.15s',
        }}
      >Discuss</button>
      <button
        onClick={() => onSend('fix')}
        disabled={unresolvedCount === 0 || sending}
        style={{
          padding: '8px 20px', borderRadius: 8, border: 'none',
          background: unresolvedCount > 0 ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : '#222',
          color: unresolvedCount > 0 ? '#000' : '#555',
          fontSize: 13, fontWeight: 700,
          cursor: unresolvedCount > 0 ? 'pointer' : 'default',
          fontFamily: 'inherit', opacity: sending ? 0.6 : 1,
        }}
      >{sending ? 'Acting...' : 'Act'}</button>
    </>
  );
}
