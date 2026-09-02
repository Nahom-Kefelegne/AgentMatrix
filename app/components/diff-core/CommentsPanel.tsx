'use client';

import type { ReviewComment } from './types';

interface CommentsPanelProps {
  comments: ReviewComment[];
  onDelete: (commentId: string) => void;
}

// The thin panel beneath the editor listing the active file's comments.
export function CommentsPanel({ comments, onDelete }: CommentsPanelProps) {
  return (
    <div style={{
      height: comments.length > 0 ? 120 : 36,
      borderTop: '1px solid #26262e', background: '#0f0f13',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'height 0.2s ease',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {comments.length === 0 && (
          <div style={{ padding: '8px 14px', fontSize: 12, color: '#555', fontStyle: 'italic' }}>
            Highlight code or click the gutter to add a review comment
          </div>
        )}
        {comments.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 12px', fontSize: 12,
            opacity: c.resolved ? 0.5 : 1,
          }}>
            <span style={{ color: c.resolved ? '#51cf66' : '#fbbf24', fontWeight: 700, minWidth: 50 }}>
              {c.resolved ? '\u2713' : ''} {c.side === 'original' ? 'Original ' : ''}Line {c.lineNumber}
            </span>
            <span style={{ flex: 1, color: '#ccc', textDecoration: c.resolved ? 'line-through' : 'none' }}>{c.text}</span>
            <button onClick={() => onDelete(c.id)} style={{
              padding: '2px 6px', borderRadius: 4, border: '1px solid #ff6b6b30',
              background: 'transparent', color: '#ff6b6b', fontSize: 10, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 600,
            }}>&times;</button>
          </div>
        ))}
      </div>
    </div>
  );
}
