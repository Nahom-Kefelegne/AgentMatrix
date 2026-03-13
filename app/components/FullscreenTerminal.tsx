'use client';

import { useState, useCallback, useRef } from 'react';
import type { SessionData } from '@/lib/types';
import TerminalPanel from './TerminalPanel';

interface FullscreenTerminalProps {
  session: SessionData;
  sessions: Map<string, SessionData>;
  readOnly?: boolean;
  onExit: () => void;
}

export default function FullscreenTerminal({ session, sessions, readOnly, onExit }: FullscreenTerminalProps) {
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(50);
  const [showPicker, setShowPicker] = useState(false);
  const dragging = useRef(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const ratio = (ev.clientX / window.innerWidth) * 100;
      setSplitRatio(Math.max(20, Math.min(80, ratio)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const otherSessions = Array.from(sessions.values()).filter(s => s.id !== session.id);
  const splitSession = splitSessionId ? sessions.get(splitSessionId) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: '#0c0c18', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: '#111118', borderBottom: '1px solid #1e1e30',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#eee' }}>{session.name}</span>
          {splitSession && (
            <>
              <span style={{ color: '#333', fontSize: 12 }}>|</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#7aafff' }}>{splitSession.name}</span>
              <button onClick={() => setSplitSessionId(null)} style={{
                padding: '2px 8px', borderRadius: 4, border: '1px solid #ff6b6b30',
                background: 'transparent', color: '#ff6b6b', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Close Split</button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!splitSessionId && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowPicker(!showPicker)} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #3a3a4e',
                background: '#1e1e30', color: '#ccc', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Split Screen
              </button>
              {showPicker && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: '#1a1a2a', border: '1px solid #2a2a3e', borderRadius: 8,
                  minWidth: 220, maxHeight: 300, overflowY: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  zIndex: 9999,
                }}>
                  {otherSessions.length > 0 ? otherSessions.map(s => (
                    <div key={s.id} onClick={() => { setSplitSessionId(s.id); setShowPicker(false); setSplitRatio(50); }} style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: 14, color: '#eee', fontWeight: 600,
                      borderBottom: '1px solid #222235',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = '#222238'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>{s.name}</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.cwd || s.id.slice(0, 12)}</div>
                    </div>
                  )) : (
                    <div style={{ padding: '12px 14px', color: '#666', fontSize: 13 }}>No other sessions</div>
                  )}
                </div>
              )}
            </div>
          )}
          <button onClick={onExit} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#ccc', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Exit Fullscreen
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Primary terminal */}
        <div style={{ width: splitSessionId ? `${splitRatio}%` : '100%', height: '100%', padding: '4px' }}>
          <TerminalPanel sessionId={session.id} sessionName={session.name} cwd={session.cwd} visible readOnly={readOnly} />
        </div>

        {/* Resize handle */}
        {splitSessionId && (
          <div onMouseDown={handleDragStart} style={{
            width: 6, cursor: 'col-resize', background: '#1e1e30',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 2, height: 40, background: '#3a3a4e', borderRadius: 1 }} />
          </div>
        )}

        {/* Split terminal */}
        {splitSession && (
          <div style={{ width: `${100 - splitRatio}%`, height: '100%', padding: '4px' }}>
            <TerminalPanel sessionId={splitSession.id} sessionName={splitSession.name} cwd={splitSession.cwd} visible readOnly={readOnly} />
          </div>
        )}
      </div>
    </div>
  );
}
