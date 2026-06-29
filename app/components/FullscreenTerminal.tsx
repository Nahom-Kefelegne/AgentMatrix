'use client';

import { useState } from 'react';
import type { SessionData } from '@/lib/types';
import TerminalPanel from './TerminalPanel';

interface FullscreenTerminalProps {
  session: SessionData;
  sessions: Map<string, SessionData>;
  readOnly?: boolean;
  onExit: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  working: '#34d399', idle: '#a1a1aa', meeting: '#a78bfa',
  attention: '#f59e0b', done: '#3b82f6',
};

type Layout = '1x1' | '1x2' | '2x1' | '2x2' | '1+2';

const LAYOUTS: { key: Layout; label: string; maxPanes: number; icon: React.ReactNode }[] = [
  { key: '1x1', label: 'Single', maxPanes: 1, icon: <LayoutIcon cells={[[1]]} /> },
  { key: '1x2', label: 'Side by side', maxPanes: 2, icon: <LayoutIcon cells={[[1, 1]]} /> },
  { key: '2x1', label: 'Stacked', maxPanes: 2, icon: <LayoutIcon cells={[[1], [1]]} /> },
  { key: '1+2', label: '1 + 2', maxPanes: 3, icon: <LayoutIcon cells={[[2], [1, 1]]} /> },
  { key: '2x2', label: 'Quad', maxPanes: 4, icon: <LayoutIcon cells={[[1, 1], [1, 1]]} /> },
];

function LayoutIcon({ cells }: { cells: number[][] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, width: 20, height: 14 }}>
      {cells.map((row, r) => (
        <div key={r} style={{ display: 'flex', gap: 1, flex: 1 }}>
          {row.map((span, c) => (
            <div key={c} style={{
              flex: span, borderRadius: 1,
            }} className="dark:bg-[#71717a] bg-[#a1a1aa]" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function FullscreenTerminal({ session, sessions, readOnly, onExit }: FullscreenTerminalProps) {
  const [panes, setPanes] = useState<string[]>([session.id]);
  const [layout, setLayout] = useState<Layout>('1x1');
  const [showPicker, setShowPicker] = useState(false);
  const [showLayout, setShowLayout] = useState(false);

  const layoutConfig = LAYOUTS.find(l => l.key === layout)!;

  const addPane = (id: string) => {
    if (panes.length >= 4 || panes.includes(id)) return;
    const newPanes = [...panes, id];
    setPanes(newPanes);
    setShowPicker(false);
    // Auto-upgrade layout to fit
    const count = newPanes.length;
    if (count === 2 && layout === '1x1') setLayout('1x2');
    if (count === 3 && (layout === '1x1' || layout === '1x2' || layout === '2x1')) setLayout('1+2');
    if (count === 4 && layout !== '2x2') setLayout('2x2');
  };

  const removePane = (id: string) => {
    if (panes.length <= 1) return;
    setPanes(panes.filter(p => p !== id));
  };

  const changeLayout = (l: Layout) => {
    const max = LAYOUTS.find(x => x.key === l)!.maxPanes;
    setLayout(l);
    if (panes.length > max) setPanes(panes.slice(0, max));
    setShowLayout(false);
  };

  const usedIds = new Set(panes);
  const available = Array.from(sessions.values()).filter(s => !usedIds.has(s.id));
  const canAdd = panes.length < 4 && available.length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      display: 'flex', flexDirection: 'column',
    }} className="dark:bg-[#0a0a0c] bg-white">
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 8px', height: 42, flexShrink: 0,
        borderBottom: '1px solid',
      }} className="dark:border-[#1e1e24] border-[#e5e5e5] dark:bg-[#111114] bg-[#fafafa]">
        {/* Left: tabs */}
        <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: 0 }}>
          {panes.map(id => {
            const s = sessions.get(id);
            if (!s) return null;
            const color = STATUS_COLORS[s.status] || STATUS_COLORS.idle;
            return (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 14px', fontSize: 13, fontWeight: 600,
                borderRight: '1px solid',
              }} className="dark:border-[#1e1e24] border-[#e5e5e5] dark:text-[#d4d4d8] text-[#3f3f46]">
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
                {panes.length > 1 && (
                  <button onClick={() => removePane(id)} style={{
                    width: 20, height: 20, borderRadius: 4, border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, padding: 0, transition: 'all 0.15s',
                  }} className="dark:text-[#52525b] text-[#d4d4d8] dark:hover:text-[#fafafa] hover:text-[#0a0a0a] dark:hover:bg-[#27272a] hover:bg-[#e5e5e5]">
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {/* Add pane button */}
          {canAdd && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <button onClick={() => { setShowPicker(!showPicker); setShowLayout(false); }} style={{
                height: 32, paddingInline: 12, borderRadius: 8, border: '1px solid',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontSize: 13, fontWeight: 600, margin: '0 6px', transition: 'all 0.15s',
              }} className="dark:border-[#27272a] border-[#e5e5e5] dark:text-[#71717a] text-[#a1a1aa] dark:hover:text-[#fafafa] hover:text-[#0a0a0a] dark:hover:bg-[#1e1e24] hover:bg-[#f0f0f0]">
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add
              </button>

              {showPicker && (
                <div className="dropdown" style={{ top: '100%', left: 0, marginTop: 4, minWidth: 240, zIndex: 9999 }}>
                  {available.map(s => (
                    <button key={s.id} className="dropdown-item" onClick={() => addPane(s.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: STATUS_COLORS[s.status] || STATUS_COLORS.idle,
                        }} />
                        <span style={{ fontWeight: 600 }}>{s.name}</span>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2, fontFamily: 'monospace' }}>
                        {s.cwd || s.id.slice(0, 12)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: layout picker + exit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Layout picker */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setShowLayout(!showLayout); setShowPicker(false); }} style={{
              height: 32, paddingInline: 10, borderRadius: 8, border: '1px solid',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
            }} className="dark:border-[#27272a] border-[#e5e5e5] dark:text-[#a1a1aa] text-[#52525b] dark:hover:text-[#fafafa] hover:text-[#0a0a0a] dark:hover:bg-[#1e1e24] hover:bg-[#f0f0f0]">
              {layoutConfig.icon}
              <span>{layoutConfig.label}</span>
            </button>
            {showLayout && (
              <div className="dropdown" style={{ top: '100%', right: 0, marginTop: 4, minWidth: 160, zIndex: 9999 }}>
                {LAYOUTS.map(l => (
                  <button key={l.key} className="dropdown-item" onClick={() => changeLayout(l.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      fontWeight: layout === l.key ? 700 : 500,
                    }}>
                    {l.icon}
                    <span>{l.label}</span>
                    {layout === l.key && <span style={{ marginLeft: 'auto', fontSize: 12 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={onExit} className="glass-btn" style={{ fontSize: 12, padding: '5px 12px' }}>
            Exit
          </button>
        </div>
      </div>

      {/* Terminal panes — layout-driven */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {layout === '1x1' && (
          <PaneSlot id={panes[0]} sessions={sessions} readOnly={readOnly} />
        )}
        {layout === '1x2' && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <PaneSlot id={panes[0]} sessions={sessions} readOnly={readOnly} border="right" />
            <PaneSlot id={panes[1]} sessions={sessions} readOnly={readOnly} />
          </div>
        )}
        {layout === '2x1' && (
          <>
            <PaneSlot id={panes[0]} sessions={sessions} readOnly={readOnly} border="bottom" />
            <PaneSlot id={panes[1]} sessions={sessions} readOnly={readOnly} />
          </>
        )}
        {layout === '1+2' && (
          <>
            <PaneSlot id={panes[0]} sessions={sessions} readOnly={readOnly} border="bottom" />
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <PaneSlot id={panes[1]} sessions={sessions} readOnly={readOnly} border="right" />
              <PaneSlot id={panes[2]} sessions={sessions} readOnly={readOnly} />
            </div>
          </>
        )}
        {layout === '2x2' && (
          <>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <PaneSlot id={panes[0]} sessions={sessions} readOnly={readOnly} border="right" />
              <PaneSlot id={panes[1]} sessions={sessions} readOnly={readOnly} />
            </div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0, borderTop: '1px solid' }}
              className="dark:border-[#1e1e24] border-[#e5e5e5]">
              <PaneSlot id={panes[2]} sessions={sessions} readOnly={readOnly} border="right" />
              <PaneSlot id={panes[3]} sessions={sessions} readOnly={readOnly} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PaneSlot({ id, sessions, readOnly, border }: {
  id?: string; sessions: Map<string, SessionData>; readOnly?: boolean;
  border?: 'right' | 'bottom';
}) {
  const s = id ? sessions.get(id) : undefined;
  return (
    <div style={{
      flex: 1, minHeight: 0, minWidth: 0, padding: 4,
      borderRight: border === 'right' ? '1px solid' : 'none',
      borderBottom: border === 'bottom' ? '1px solid' : 'none',
    }} className="dark:border-[#1e1e24] border-[#e5e5e5]">
      {s ? (
        <TerminalPanel sessionId={s.id} sessionName={s.name} cwd={s.cwd} visible readOnly={readOnly} cliType={s.cliType} />
      ) : (
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }} className="dark:text-[#3f3f46] text-[#d4d4d8]">
          Empty — add a session
        </div>
      )}
    </div>
  );
}
