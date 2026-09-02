'use client';

import type { FloatingPopover, ReviewComment, ReviewSendMode } from './types';

interface CommentComposerPopoverProps {
  popover: FloatingPopover;
  commentText: string;
  setCommentText: (v: string) => void;
  floatingInputRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  onDelete: (commentId: string) => void;
  // When provided, the "view" popover renders Discuss/Act affordances for
  // unresolved comments. Terminal-injection behavior lives in the parent.
  onSendComment?: (comment: ReviewComment, mode: ReviewSendMode) => void;
}

// Floating glass popover anchored near the cursor for adding a new comment or
// viewing/acting on an existing one.
export function CommentComposerPopover({
  popover, commentText, setCommentText, floatingInputRef,
  sending, onAdd, onDismiss, onDelete, onSendComment,
}: CommentComposerPopoverProps) {
  return (
    <>
      <div onClick={onDismiss} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', left: popover.x, top: popover.y, zIndex: 301, width: 340,
        background: 'rgba(19, 19, 22, 0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
        animation: 'glass-in 0.15s ease', overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
            {popover.side === 'original' ? 'Original · ' : ''}
            {popover.line === popover.endLine ? `Line ${popover.line}` : `Lines ${popover.line}\u2013${popover.endLine}`}
          </span>
          <button onClick={onDismiss} style={{
            width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)', color: '#888', fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#ccc'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#888'; }}
          >&times;</button>
        </div>

        {popover.mode === 'view' && popover.comment && (
          <div style={{ padding: '12px 14px' }}>
            {popover.comment.resolved && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#51cf66', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13 }}>{'\u2713'}</span> Resolved
              </div>
            )}
            <div style={{
              fontSize: 13, color: popover.comment.resolved ? '#999' : '#e0e0e0', lineHeight: 1.6,
              padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${popover.comment.resolved ? 'rgba(81,207,102,0.15)' : 'rgba(255,255,255,0.05)'}`,
              textDecoration: popover.comment.resolved ? 'line-through' : 'none',
            }}>{popover.comment.text}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: '#555' }}>
                {new Date(popover.comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => onDelete(popover.comment!.id)} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,107,107,0.2)',
                background: 'rgba(255,107,107,0.08)', color: '#ff6b6b', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,107,107,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,107,107,0.08)'}
              >Delete</button>
              {!popover.comment.resolved && onSendComment && (
                <>
                  <button onClick={() => onSendComment(popover.comment!, 'discuss')} disabled={sending} style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                  >Discuss</button>
                  <button onClick={() => onSendComment(popover.comment!, 'fix')} disabled={sending} style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none',
                    background: 'rgba(251,191,36,0.9)', color: '#000', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,191,36,0.9)'}
                  >Act</button>
                </>
              )}
            </div>
          </div>
        )}

        {popover.mode === 'add' && (
          <div style={{ padding: '10px 14px 12px' }}>
            <textarea
              ref={floatingInputRef}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAdd(); }
                if (e.key === 'Escape') onDismiss();
              }}
              placeholder="Add a review comment..."
              rows={2}
              style={{
                width: '100%', resize: 'none', padding: '8px 10px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)',
                color: '#e0e0e0', fontSize: 13, fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(251,191,36,0.3)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#555' }}>Enter to add &middot; Esc to cancel</span>
              <button onClick={onAdd} disabled={!commentText.trim()} style={{
                padding: '5px 16px', borderRadius: 8, border: 'none',
                background: commentText.trim() ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.06)',
                color: commentText.trim() ? '#000' : '#555', fontSize: 12, fontWeight: 700,
                cursor: commentText.trim() ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'all 0.15s',
              }}>Add Comment</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
