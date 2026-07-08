'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';
import type { CliType } from '@/lib/types';
import { TERMINAL_THEME } from '@/lib/terminalTheme';

interface TerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
  cliType?: CliType;
}

// Debounce for container resize events. 150ms is the xterm.js community sweet
// spot: prevents reflow storms during drag/animation while still feeling snappy.
const RESIZE_DEBOUNCE_MS = 150;

export default function TerminalPanel({ sessionId, sessionName, cwd, visible, readOnly, cliType }: TerminalPanelProps) {
  const { socketRef } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'exited'>('idle');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [initializing, setInitializing] = useState(false);

  // Listen for session initializing state (summary generation on startup)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = (data: { sessionId: string; busy: boolean }) => {
      if (data.sessionId === sessionId) setInitializing(data.busy);
    };
    socket.on('session:initializing' as any, handler);
    return () => { socket.off('session:initializing' as any, handler); };
  }, [socketRef, sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    const socket = socketRef.current;
    if (!container || !socket) return;

    // Disposal flag: guarded at the top of every async callback so nothing
    // touches xterm internals after terminal.dispose().
    let disposed = false;

    (async () => {
      // Dynamic import xterm (browser-only)
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      let WebglAddon: any = null;
      try { WebglAddon = (await import('@xterm/addon-webgl')).WebglAddon; } catch {}

      // Load CSS once
      if (!document.querySelector('link[data-xterm-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/xterm.css';
        link.setAttribute('data-xterm-css', '');
        document.head.appendChild(link);
      }

      if (disposed) return;

      const terminal = new Terminal({
        theme: TERMINAL_THEME,
        fontSize: 16,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 1.4,
        cursorBlink: false,
        cursorStyle: 'bar',
        scrollback: 5000,
        scrollOnUserInput: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      // WebGL renderer for GPU-accelerated rendering. Skipped on Windows
      // (remote desktop makes GPU text grainy — canvas renderer looks better).
      const isWindows = navigator.platform?.toLowerCase().includes('win');
      // Keep a reference so cleanup can dispose it first (see __cleanup).
      let rendererAddon: any = null;
      if (WebglAddon && !isWindows && !disposed) {
        try {
          const addon = new WebglAddon();
          terminal.loadAddon(addon);
          rendererAddon = addon;
        } catch {}
      }

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // ── Resize machinery: ONE fit function, ONE observer, ONE debounce ──

      // Tracks whether we've successfully fit at least once with valid
      // dimensions. The first real fit is IMMEDIATE (no debounce) so
      // tab-switches / dialog-opens don't flash at 80x24 for 150ms.
      // Subsequent fits are debounced to prevent reflow storms.
      let hasValidFit = false;

      // safeFit: runs fitAddon.fit() with guards. Never emits socket events —
      // that's terminal.onResize's job (fires only when cols/rows actually change).
      const safeFit = () => {
        if (disposed) return;
        if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
        try { fitAddon.fit(); hasValidFit = true; } catch {}
      };

      // debouncedFit: coalesces rapid resize events (drag, animation) into
      // one fit per 150ms window. Prevents reflow storms.
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const debouncedFit = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(safeFit, RESIZE_DEBOUNCE_MS);
      };

      // terminal.onResize fires only when fit() actually changes cols/rows.
      // This is the ONLY place we emit terminal:resize to the server.
      // Replaces the old "jiggle" hack — if dims didn't change, no event fires,
      // so the PTY doesn't get redundant SIGWINCHs.
      const onResizeDisposable = terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (disposed) return;
        socket.emit('terminal:resize', { sessionId, cols, rows });
      });

      // Single ResizeObserver on the container handles ALL size changes:
      // initial layout, dialog animation, tab switches, window resize,
      // browser zoom, split pane layout — everything that changes container size.
      //
      // First fit (container 0x0 → real size) is immediate for snappy
      // tab-switch / dialog-open rendering. Later fits are debounced.
      const resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        if (!hasValidFit && container.clientWidth > 0 && container.clientHeight > 0) {
          safeFit();
        } else {
          debouncedFit();
        }
      });
      resizeObserver.observe(container);

      // Browser zoom sometimes slips past ResizeObserver — belt & suspenders.
      const onWindowResize = () => debouncedFit();
      window.addEventListener('resize', onWindowResize);

      // ── Input handling ──

      // Focus terminal immediately so keyboard works on open
      terminal.focus();

      // Use Electron IPC for zero-latency keystrokes, fall back to socket
      const electronAPI = (window as any).electronAPI;
      const writeToTerminal = electronAPI?.terminalWrite
        ? (data: string) => electronAPI.terminalWrite(sessionId, data)
        : (data: string) => socket.emit('terminal:input', { sessionId, data });

      if (!readOnly) {
        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.key === 'Enter' && e.shiftKey) {
            if (e.type === 'keydown') {
              // Shift+Enter — CSI u encoding so Claude TUI gets it as newline
              writeToTerminal('\x1b[13;2u');
            }
            return false;
          }
          // Ctrl+Shift+C — copy selection (Windows/Linux convention)
          if (e.type === 'keydown' && e.code === 'KeyC' && e.shiftKey && e.ctrlKey) {
            const sel = terminal.getSelection();
            if (sel) navigator.clipboard.writeText(sel);
            return false;
          }
          // Ctrl+Shift+V — paste from clipboard
          if (e.code === 'KeyV' && e.shiftKey && e.ctrlKey) {
            if (e.type === 'keydown') {
              e.preventDefault();
              navigator.clipboard.readText().then(text => {
                if (text) writeToTerminal(text);
              });
            }
            return false;
          }
          // Cmd+C on Mac — copy if selection, else SIGINT
          if (e.type === 'keydown' && e.code === 'KeyC' && e.metaKey && !e.shiftKey) {
            const sel = terminal.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel);
              return false;
            }
            return true;
          }
          return true;
        });

        terminal.onData((data: string) => {
          writeToTerminal(data);
        });
      }

      // ── Output handling ──

      // Strip screen-clear sequences only when user is scrolled up viewing
      // history, so history isn't wiped when the CLI TUI redraws.
      const stripClear = (s: string) =>
        s.replace(/\x1b\[2J/g, '')
         .replace(/\x1b\[3J/g, '')
         .replace(/\x1b\[H/g, '');

      // Copilot's TUI uses the alternate-screen buffer (\x1b[?1049h /
      // \x1b[?47h), which has NO scrollback by design. The user can't
      // scroll up past the visible viewport to re-read a long response.
      // Stripping alt-screen mode forces all rendering into the main
      // screen, where xterm's 5000-line scrollback can hold it.
      //
      // We also unconditionally strip \x1b[3J (erase-scrollback) for
      // Copilot — without this, Copilot can wipe scrollback between
      // turns even when the user is at the bottom.
      //
      // Claude's TUI tolerates either mode; we leave it untouched.
      const stripCopilotScrollKillers = (s: string) =>
        s.replace(/\x1b\[\?1049[hl]/g, '')   // primary alt-screen toggle
         .replace(/\x1b\[\?47[hl]/g, '')      // legacy alt-screen toggle
         .replace(/\x1b\[\?1047[hl]/g, '')    // alt-screen w/ save (xterm)
         .replace(/\x1b\[\?1048[hl]/g, '')    // save/restore cursor (xterm)
         .replace(/\x1b\[3J/g, '');           // erase scrollback

      const isAtBottom = () => {
        const buf = terminal.buffer.active;
        return buf.viewportY >= buf.baseY;
      };

      const handleData = (msg: { sessionId: string; data: string }) => {
        if (msg.sessionId !== sessionId) return;
        let payload = msg.data;
        // Copilot: always strip — needed live AND when scrolled up.
        if (cliType === 'copilot') payload = stripCopilotScrollKillers(payload);
        // Anyone (Claude included): when user is scrolled up, drop
        // visible-screen clears so the history they're reading isn't wiped.
        if (!isAtBottom()) payload = stripClear(payload);
        terminal.write(payload);
        if (statusRef.current !== 'connected') setStatus('connected');
      };

      const handleExit = (msg: { sessionId: string; exitCode: number }) => {
        if (msg.sessionId === sessionId) {
          terminal.writeln(`\r\n\x1b[90m[Session exited with code ${msg.exitCode}]\x1b[0m`);
          setStatus('exited');
        }
      };

      socket.on('terminal:data' as any, handleData);
      socket.on('terminal:exit' as any, handleExit);

      // ── Focus handling (named functions for proper cleanup) ──

      const onWindowFocus = () => {
        if (!disposed && !readOnly) terminal.focus();
      };
      const onVisibilityChange = () => {
        if (!document.hidden && !disposed && !readOnly) terminal.focus();
      };
      window.addEventListener('focus', onWindowFocus);
      document.addEventListener('visibilitychange', onVisibilityChange);

      // ── Initial resize + resume ──
      // CRITICAL ORDERING: resize the PTY BEFORE requesting buffer replay.
      // If we replayed first, the server would send us buffered output that
      // was generated at the OLD PTY dimensions (e.g., 80x24), but xterm is
      // about to fit to the NEW dimensions (e.g., 120x40). Those old-dims
      // cursor positions render at completely wrong spots in the new-dims
      // xterm, producing mangled output with scattered characters.
      //
      // By resizing first, Claude's SIGWINCH handler fires and it redraws
      // the alt-screen at the new dimensions. The live output that arrives
      // next is already in new-dims format.

      // Fit synchronously so we know the target dimensions BEFORE resume.
      // If container hasn't laid out yet, fit returns early and we emit the
      // default dims (no harm — real fit happens via ResizeObserver later).
      safeFit();

      // Emit resize with current dims (either fitted or default). If fit()
      // already changed dims, terminal.onResize already fired and emitted.
      // Re-emitting here is a no-op on the server if dims match. This is the
      // only place we send an unconditional initial resize.
      socket.emit('terminal:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });

      // Now safe to replay — server will resize PTY first (queued above),
      // then replay buffer. Claude's redraw at new dims overwrites scrollback.
      setStatus('connecting');
      socket.emit('terminal:resume' as any, { sessionId });

      // rAF safety net: if the container didn't have dimensions at the
      // synchronous fit above (e.g., dialog still animating in), try again
      // after the next paint. ResizeObserver will also catch this.
      requestAnimationFrame(() => {
        if (disposed) return;
        if (!hasValidFit) safeFit();
      });

      // ── Cleanup (proper disposal order per xterm.js docs) ──
      (terminal as any).__cleanup = () => {
        disposed = true;                                                     // 1. Flag — all callbacks bail
        if (debounceTimer) clearTimeout(debounceTimer);                      // 2. Cancel pending fit
        try { resizeObserver.disconnect(); } catch {}                        // 3. Stop observing
        window.removeEventListener('resize', onWindowResize);                // 4. Remove listeners
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        socket.off('terminal:data' as any, handleData);                      // 5. Remove socket listeners
        socket.off('terminal:exit' as any, handleExit);
        try { onResizeDisposable.dispose(); } catch {}                       // 6. Dispose xterm event sub
        // 7. Dispose the WebGL renderer addon FIRST, while the render service
        // is still alive — disposing it implicitly during terminal.dispose()
        // hits an xterm addon-dispose race ("reading '_isDisposed'").
        try { rendererAddon?.dispose(); } catch {}
        rendererAddon = null;
        try { fitAddon.dispose(); } catch {}                                 // 8. Dispose fit addon
        try { terminal.dispose(); } catch {}                                 // 9. Terminal last
      };
    })();

    return () => {
      disposed = true;
      if (termRef.current?.__cleanup) {
        termRef.current.__cleanup();
        termRef.current = null;
      }
      fitRef.current = null;
    };
  }, [sessionId, socketRef]);

  // Visibility: when the terminal becomes visible, refit and re-emit resize
  // to the PTY. This is critical for the fullscreen→modal case:
  //   - Modal's TerminalPanel is mounted but covered by fullscreen overlay
  //   - Fullscreen mounts its own TerminalPanel at larger dims, resizes PTY
  //   - Modal's xterm keeps receiving PTY output (at larger dims) into a
  //     smaller xterm → content mangles
  //   - Exiting fullscreen: ResizeObserver doesn't fire (container dims
  //     unchanged), so modal never tells PTY to resize back.
  // Explicitly refitting on visibility transition forces PTY back in sync,
  // so live content rendered after this point matches xterm's dims.
  useEffect(() => {
    if (!visible || !termRef.current || !fitRef.current || readOnly) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const socket = socketRef.current;

    term.focus();

    try {
      fit.fit();
      // Always emit, even if xterm dims didn't change — the PTY may be at
      // different dims (e.g., fullscreen just exited and shrunk us).
      if (socket) {
        socket.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
      }
    } catch {}
  }, [visible, sessionId, socketRef, readOnly]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
    }}>
      {/* Status bar */}
      <div style={{
        padding: '6px 0',
        fontSize: 13,
        color: '#aaa',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
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
          onClick={() => !initializing && termRef.current?.focus()}
          style={{
            height: '100%',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#0c0c18',
            border: '1px solid #1e1e30',
            willChange: 'transform',
            pointerEvents: initializing ? 'none' : 'auto',
          }}
        />
      </div>
    </div>
  );
}
