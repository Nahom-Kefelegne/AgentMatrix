'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';
import { useXterm } from '@/lib/hooks/useXterm';
import { TERMINAL_THEME } from '@/lib/terminalTheme';

// Copilot's timeline scrolling has two regimes, depending on the Copilot version:
//
//   • Copilot 1.0.70+ enables SGR mouse tracking (DECSET 1000/1002/1003 + 1006)
//     inside its alt-screen TUI and scrolls its timeline LINE-BY-LINE under the
//     mouse wheel itself. This is why a normal terminal (e.g. Windows Terminal)
//     scrolls Copilot smoothly line-by-line. When mouse tracking is on we must
//     let xterm forward the wheel as native mouse events and NOT intercept it.
//     (Verified: 1.0.72 explicitly disables mouse tracking on teardown.)
//
//   • Older builds (≤1.0.69, verified by pty probe) enable NO mouse tracking, so
//     the wheel is inert. The ONLY timeline scroll primitive is PgUp/PgDn, one
//     viewport page (~23 lines) each — there is no finer-grained scroll (arrows,
//     Ctrl+E/U/B, SGR wheel all do nothing; Ctrl+O jumps to the latest output).
//     For these we translate the wheel into PgUp/PgDn pages.
//
// So the wheel handler is adaptive: pass through when mouse tracking is on, and
// fall back to page translation when it's off.
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';
// Mouse-tracking DECSET modes that make Copilot handle the wheel itself. 1006
// (SGR encoding) rides alongside these but isn't a tracking mode on its own.
const MOUSE_TRACKING_MODES = new Set(['1000', '1002', '1003']);
// Page-translation tuning for the mouse-tracking-off fallback. Because page
// jumps are inherently coarse, the goal is PREDICTABLE rather than smooth:
// reset the accumulator on direction change so reversing responds immediately,
// and rate-limit emits so trackpad inertia / a fast flick can't blast pages.
const WHEEL_PAGE_STEP_PX = 130; // accumulated wheel delta (px) needed per page
const WHEEL_LINE_DELTA_PX = 16; // px-per-line when a device reports line deltas
const WHEEL_FIRE_COOLDOWN_MS = 170; // min gap between page emits (~6 pages/s cap)

// Scan a raw PTY chunk for mouse-tracking DECSET (…h) / DECRST (…l) toggles and
// return the resulting state, or null if the chunk toggles none. Copilot may
// group modes (e.g. CSI ? 1002 ; 1006 h), so split each parameter list.
function scanMouseTracking(chunk: string): boolean | null {
  let state: boolean | null = null;
  const re = /\x1b\[\?([0-9;]+)([hl])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const enable = m[2] === 'h';
    for (const p of m[1].split(';')) {
      if (MOUSE_TRACKING_MODES.has(p)) state = enable;
    }
  }
  return state;
}

// Shift+Enter → insert a newline in the prompt instead of submitting. xterm.js
// doesn't implement modifyOtherKeys/kitty, so left alone it sends a bare CR for
// Shift+Enter (i.e. submits, same as Enter). Copilot negotiates modifyOtherKeys
// mode 2 on startup (CSI > 4 ; 2 m), whose canonical Shift+Enter encoding is
// `CSI 27 ; 2 ; 13 ~`. Verified empirically against the live Copilot TUI: this
// inserts a newline without submitting.
const SHIFT_ENTER = '\x1b[27;2;13~';

interface CopilotTerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
}

interface AcpActivity {
  id: string;
  label: string;
  prompt?: string;
  response?: string;
  status: 'running' | 'done' | 'failed';
  ts: number;
}

/**
 * Copilot-native console. Unlike the legacy Claude `TerminalPanel`, this
 * renders Copilot's full-screen alt-screen TUI faithfully: it never strips
 * alt-screen / cursor / clear sequences, forwards Copilot's own scroll keys
 * (PgUp/PgDn, Ctrl+O/E/T/F) untouched, and maps the mouse wheel to paging.
 * Shared xterm boilerplate lives in `useXterm`.
 */
export default function CopilotTerminalPanel({ sessionId, sessionName, cwd, visible, readOnly }: CopilotTerminalPanelProps) {
  const { socketRef } = useSocketContext();
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'exited'>('idle');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [initializing, setInitializing] = useState(false);

  // Whether Copilot currently has SGR mouse tracking enabled (1.0.70+). When
  // true, the wheel is left to xterm to forward as native mouse events; when
  // false we translate the wheel to PgUp/PgDn pages. Updated live by scanning
  // the PTY stream for mouse-tracking DECSET/DECRST toggles.
  const mouseTrackingRef = useRef(false);

  // Out-of-band (ACP) query activity echoed into the console for transparency.
  const [acpLog, setAcpLog] = useState<AcpActivity[]>([]);
  const [expandedAcp, setExpandedAcp] = useState<string | null>(null);

  // Input: Electron IPC for zero-latency keystrokes, socket fallback.
  const writeInput = useCallback((data: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.terminalWrite) electronAPI.terminalWrite(sessionId, data);
    else socketRef.current?.emit('terminal:input', { sessionId, data });
  }, [sessionId, socketRef]);

  // Only the visible/owning panel drives PTY size, so a hidden modal panel and
  // an open fullscreen panel for the same session don't fight over the single
  // PTY's dimensions.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const emitResize = useCallback((cols: number, rows: number) => {
    if (!visibleRef.current) return;
    socketRef.current?.emit('terminal:resize', { sessionId, cols, rows });
  }, [sessionId, socketRef]);

  // Copy/paste conventions match the legacy panel; every other key (including
  // Copilot's scroll/timeline shortcuts) flows straight through to the PTY.
  const customKeyHandler = useCallback((e: KeyboardEvent, term: any) => {
    // Shift+Enter — insert a newline in the prompt rather than submit.
    if (e.key === 'Enter' && e.shiftKey) {
      if (e.type === 'keydown') writeInput(SHIFT_ENTER);
      return false;
    }
    if (e.type === 'keydown' && e.code === 'KeyC' && e.shiftKey && e.ctrlKey) {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel);
      return false;
    }
    if (e.code === 'KeyV' && e.shiftKey && e.ctrlKey) {
      if (e.type === 'keydown') {
        e.preventDefault();
        navigator.clipboard.readText().then(text => { if (text) writeInput(text); });
      }
      return false;
    }
    if (e.type === 'keydown' && e.code === 'KeyC' && e.metaKey && !e.shiftKey) {
      const sel = term.getSelection();
      if (sel) { navigator.clipboard.writeText(sel); return false; }
      return true;
    }
    return true;
  }, [writeInput]);

  // Resize BEFORE resume so Copilot's SIGWINCH redraw targets the real xterm
  // dimensions (replaying at stale dims paints orphan borders / phantom text).
  const handleReady = useCallback((term: any) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
    setStatus('connecting');
    socket.emit('terminal:resume' as any, { sessionId });
  }, [sessionId, socketRef]);

  const { containerRef, write, fit, focus, getTerminal } = useXterm({
    theme: TERMINAL_THEME,
    fontSize: 16,
    lineHeight: 1.4,
    // Copilot is an alt-screen app that owns its own timeline scrollback, so
    // xterm's scrollback buffer is unused. Keep it minimal (main-screen
    // startup output only).
    scrollback: 1000,
    readOnly,
    onData: writeInput,
    onResize: emitResize,
    onReady: handleReady,
    customKeyHandler,
  });

  // Session initializing state (summary generation on startup).
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = (data: { sessionId: string; busy: boolean }) => {
      if (data.sessionId === sessionId) setInitializing(data.busy);
    };
    socket.on('session:initializing' as any, handler);
    return () => { socket.off('session:initializing' as any, handler); };
  }, [socketRef, sessionId]);

  // Out-of-band (ACP) query activity — upsert by id (running → done/failed).
  // Completed entries auto-dismiss after a while unless the user is viewing them.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = (a: AcpActivity & { sessionId: string }) => {
      if (a.sessionId !== sessionId) return;
      setAcpLog(prev => {
        const next = prev.filter(e => e.id !== a.id);
        // Merge so the 'done' event keeps the prompt captured on 'running'.
        const prior = prev.find(e => e.id === a.id);
        next.push({
          id: a.id, label: a.label, status: a.status, ts: a.ts,
          prompt: a.prompt ?? prior?.prompt,
          response: a.response ?? prior?.response,
        });
        return next.slice(-4); // keep the last few
      });
      if (a.status !== 'running') {
        setTimeout(() => {
          setAcpLog(prev => prev.filter(e => e.id !== a.id));
          setExpandedAcp(cur => (cur === a.id ? null : cur));
        }, 18000);
      }
    };
    socket.on('session:acp-activity' as any, handler);
    return () => { socket.off('session:acp-activity' as any, handler); };
  }, [socketRef, sessionId]);

  // Live output — raw passthrough. No stripping: Copilot owns its rendering.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleData = (msg: { sessionId: string; data: string }) => {
      if (msg.sessionId !== sessionId) return;
      // Track Copilot's mouse-tracking state so the wheel handler can pass
      // through (native line scroll) vs. translate to pages.
      const ms = scanMouseTracking(msg.data);
      if (ms !== null) mouseTrackingRef.current = ms;
      write(msg.data);
      if (statusRef.current !== 'connected') setStatus('connected');
    };
    const handleExit = (msg: { sessionId: string; exitCode: number }) => {
      if (msg.sessionId !== sessionId) return;
      write(`\r\n\x1b[90m[Session exited with code ${msg.exitCode}]\x1b[0m`);
      setStatus('exited');
    };

    socket.on('terminal:data' as any, handleData);
    socket.on('terminal:exit' as any, handleExit);
    return () => {
      socket.off('terminal:data' as any, handleData);
      socket.off('terminal:exit' as any, handleExit);
    };
  }, [sessionId, socketRef, write]);

  // Mouse-wheel handling. When Copilot has mouse tracking on (1.0.70+), let the
  // event fall through to xterm, which forwards it as native SGR mouse events so
  // Copilot scrolls its timeline line-by-line (matching a normal terminal). When
  // it's off (≤1.0.69, or before the TUI arms), intercept in the capture phase
  // and translate to PgUp/PgDn pages — the only scroll primitive those builds
  // expose. Capture + preventDefault is required for the fallback to override
  // xterm's default alt-buffer wheel→arrow-key translation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || readOnly) return;
    let accum = 0; // pending same-direction scroll magnitude (px)
    let lastDir = 0; // +1 = down (PgDn), -1 = up (PgUp)
    let lastFire = 0; // timestamp (ms) of the last page emit
    const onWheel = (e: WheelEvent) => {
      // Native path: Copilot owns the wheel. Don't touch the event — xterm's
      // own handler will encode it as an SGR mouse report and send it to the PTY.
      if (mouseTrackingRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const px =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_DELTA_PX :
        e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * WHEEL_PAGE_STEP_PX :
        e.deltaY;
      const dir = Math.sign(px);
      if (dir === 0) return;

      // Reversing direction starts fresh so the opposite scroll fires at once
      // instead of first having to burn down leftover momentum in the old
      // direction — the main cause of the laggy/jumpy reversal feel.
      if (dir !== lastDir) {
        accum = 0;
        lastDir = dir;
      }
      accum += Math.abs(px);
      if (accum < WHEEL_PAGE_STEP_PX) return;

      // Armed, but rate-limit emits so trackpad inertia / a fast flick can't
      // blast many pages. Stay charged and wait; a later event past the
      // cooldown fires the page.
      const now = e.timeStamp || performance.now();
      if (now - lastFire < WHEEL_FIRE_COOLDOWN_MS) return;

      writeInput(dir > 0 ? PAGE_DOWN : PAGE_UP);
      lastFire = now;
      accum = 0; // consume fully — never bank residual into later inertia events
    };
    container.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', onWheel, { capture: true } as any);
  }, [containerRef, readOnly, writeInput]);

  // On becoming visible (e.g. exiting fullscreen back to the modal), refit and
  // re-sync the PTY so live content matches xterm's dimensions.
  useEffect(() => {
    if (!visible || readOnly) return;
    focus();
    fit();
    const term = getTerminal();
    const socket = socketRef.current;
    if (term && socket) {
      socket.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
    }
  }, [visible, readOnly, sessionId, socketRef, fit, focus, getTerminal]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Status bar */}
      <div style={{
        padding: '6px 0', fontSize: 13, color: '#aaa',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: status === 'connected' ? '#51cf66' :
                     status === 'connecting' ? '#f0c040' :
                     status === 'exited' ? '#ff6b6b' : '#666',
          display: 'inline-block',
        }} />
        <span>
          {status === 'connected' ? `Connected to ${sessionName}` :
           status === 'connecting' ? `Connecting to ${sessionName}...` :
           status === 'exited' ? 'Session exited' :
           `Terminal for ${sessionName}`}
        </span>
        {cwd && (
          <span style={{ color: '#9ca3af', fontSize: 12, fontFamily: "'Courier New', monospace" }}>
            {cwd}
          </span>
        )}
      </div>

      {/* Hide xterm scrollbar */}
      <style>{`
        .xterm-viewport::-webkit-scrollbar { width: 6px; }
        .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .xterm-viewport::-webkit-scrollbar-thumb:hover { background: #555; }
      `}</style>

      {/* xterm container */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {initializing && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 30,
            background: 'rgba(15, 15, 19, 0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            borderRadius: 8,
          }}>
            <div style={{
              width: 24, height: 24, border: '3px solid #2a2a30', borderTopColor: '#6366f1',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 14, color: '#aaa' }}>Session initializing...</div>
            <div style={{ fontSize: 12, color: '#555' }}>Generating work summary</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        <div
          ref={containerRef}
          onClick={() => !initializing && focus()}
          style={{
            height: '100%', borderRadius: 8, overflow: 'hidden',
            background: '#131316', border: '1px solid #26262e',
            pointerEvents: initializing ? 'none' : 'auto',
          }}
        />

        {/* Out-of-band (ACP) query activity — a floating, transparency strip that
            shows queries the app runs against this session (summary/handoff) plus
            their responses. Overlaid (not inline) so it never disturbs Copilot's
            alt-screen TUI or shifts layout. */}
        {acpLog.length > 0 && (
          <div style={{
            position: 'absolute', right: 12, bottom: 12, zIndex: 20,
            width: 'min(440px, 70%)', display: 'flex', flexDirection: 'column', gap: 6,
            pointerEvents: 'none',
          }}>
            <style>{`@keyframes acp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            {acpLog.map(a => {
              const open = expandedAcp === a.id;
              const dot = a.status === 'running' ? '#6366f1' : a.status === 'done' ? '#51cf66' : '#ff6b6b';
              const preview = a.status === 'running'
                ? 'Running\u2026'
                : (a.response?.split('\n').map(l => l.trim()).find(Boolean) || (a.status === 'failed' ? 'No response' : '\u2014'));
              return (
                <div key={a.id} onClick={() => setExpandedAcp(open ? null : a.id)} style={{
                  pointerEvents: 'auto', cursor: 'pointer',
                  background: 'rgba(19, 19, 22, 0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid #2a2a30', borderRadius: 10,
                  boxShadow: '0 8px 28px rgba(0,0,0,0.45)', overflow: 'hidden',
                  animation: 'acp-in 0.18s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px' }}>
                    {a.status === 'running' ? (
                      <span style={{ width: 12, height: 12, flexShrink: 0, border: '2px solid #2a2a30', borderTopColor: dot, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    ) : (
                      <span style={{ width: 12, height: 12, flexShrink: 0, borderRadius: '50%', background: dot }} />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.02em', flexShrink: 0 }}>{a.label}</span>
                    <span style={{
                      fontSize: 12, color: '#c8c8d0', flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{preview}</span>
                    <span style={{ fontSize: 10, color: '#71717a', flexShrink: 0 }}>{open ? '\u2715' : '\u2039'}</span>
                  </div>
                  {open && (
                    <div style={{ borderTop: '1px solid #24242c', padding: '9px 11px', maxHeight: 260, overflowY: 'auto' }}>
                      {a.prompt && (
                        <>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Prompt</div>
                          <div style={{ fontSize: 12, color: '#a1a1aa', whiteSpace: 'pre-wrap', marginBottom: 10, fontFamily: "'Menlo', monospace", lineHeight: 1.45 }}>{a.prompt}</div>
                        </>
                      )}
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Response</div>
                      <div style={{ fontSize: 12, color: '#e4e4e7', whiteSpace: 'pre-wrap', fontFamily: "'Menlo', monospace", lineHeight: 1.45 }}>
                        {a.status === 'running' ? '\u2026' : (a.response || (a.status === 'failed' ? '(failed)' : '(empty)'))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
