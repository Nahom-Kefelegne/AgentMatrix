'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';
import { useXterm } from '@/lib/hooks/useXterm';
import { TERMINAL_THEME } from '@/lib/terminalTheme';

// Copilot scrolls its own timeline with PageUp/PageDown and enables no mouse
// tracking, so the wheel is inert by default. Translate wheel deltas into
// paging keys for natural scrolling.
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';
// Roughly one physical wheel notch (~120px) per page.
const WHEEL_PAGE_STEP = 120;

interface CopilotTerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
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

  // Live output — raw passthrough. No stripping: Copilot owns its rendering.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleData = (msg: { sessionId: string; data: string }) => {
      if (msg.sessionId !== sessionId) return;
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

  // Mouse-wheel → PgUp/PgDn. Capture phase + preventDefault overrides xterm's
  // default alt-buffer arrow-key translation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || readOnly) return;
    let accum = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      accum += e.deltaY;
      while (Math.abs(accum) >= WHEEL_PAGE_STEP) {
        writeInput(accum > 0 ? PAGE_DOWN : PAGE_UP);
        accum += accum > 0 ? -WHEEL_PAGE_STEP : WHEEL_PAGE_STEP;
      }
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
            position: 'absolute', inset: 0, zIndex: 10,
            background: 'rgba(12, 12, 24, 0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            borderRadius: 8,
          }}>
            <div style={{
              width: 24, height: 24, border: '3px solid #2a2a3e', borderTopColor: '#4a9eff',
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
            background: '#0c0c18', border: '1px solid #1e1e30',
            pointerEvents: initializing ? 'none' : 'auto',
          }}
        />
      </div>
    </div>
  );
}
