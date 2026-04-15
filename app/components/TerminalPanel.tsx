'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';

interface TerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
}

export default function TerminalPanel({ sessionId, sessionName, cwd, visible, readOnly }: TerminalPanelProps) {
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

    let terminal: any = null;
    let fitAddon: any = null;
    let cleanup = false;

    (async () => {
      // Dynamic import xterm (browser-only)
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      let WebglAddon: any = null;
      try { WebglAddon = (await import('@xterm/addon-webgl')).WebglAddon; } catch {}

      // Load CSS
      if (!document.querySelector('link[data-xterm-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/xterm.css';
        link.setAttribute('data-xterm-css', '');
        document.head.appendChild(link);
      }

      if (cleanup) return;

      terminal = new Terminal({
        theme: {
          background: '#0c0c18',
          foreground: '#e8e8f0',
          cursor: '#4a9eff',
          cursorAccent: '#0c0c18',
          selectionBackground: '#4a9eff50',
          black: '#222238',
          red: '#ff6b6b',
          green: '#51cf66',
          yellow: '#ffd43b',
          blue: '#4a9eff',
          magenta: '#cc5de8',
          cyan: '#20c997',
          white: '#e8e8f0',
          brightBlack: '#888',
          brightRed: '#ff8787',
          brightGreen: '#69db7c',
          brightYellow: '#ffe066',
          brightBlue: '#74c0fc',
          brightMagenta: '#da77f2',
          brightCyan: '#38d9a9',
          brightWhite: '#ffffff',
        },
        fontSize: 16,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 1.4,
        cursorBlink: false,
        cursorStyle: 'bar',
        scrollback: 5000,
        scrollOnUserInput: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      // Use WebGL renderer for faster rendering — skip on Windows where it
      // causes grainy text via remote desktop (no ClearType on GPU textures)
      const isWindows = navigator.platform?.toLowerCase().includes('win');
      if (WebglAddon && !isWindows) {
        try { terminal.loadAddon(new WebglAddon()); } catch {}
      }

      // Fit + resize PTY to match container.
      // Must send terminal:resize so the PTY knows the real dimensions.
      const fitAndResize = () => {
        if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
        try {
          fitAddon.fit();
          socket.emit('terminal:resize', {
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch {}
        return true;
      };

      // Try immediately, then observe until container has size
      if (!fitAndResize()) {
        const layoutObserver = new ResizeObserver(() => {
          if (fitAndResize()) layoutObserver.disconnect();
        });
        layoutObserver.observe(container);
        setTimeout(() => layoutObserver.disconnect(), 3000);
      }
      // Extra fits for dialog animation settling
      setTimeout(fitAndResize, 100);
      setTimeout(fitAndResize, 300);
      setTimeout(fitAndResize, 600);

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // Focus the terminal so keyboard works immediately
      terminal.focus();

      // Forward keystrokes to PTY (unless read-only)
      // Use Electron IPC when available (direct, no Socket.io hop) — falls back to socket
      const electronAPI = (window as any).electronAPI;
      const writeToTerminal = electronAPI?.terminalWrite
        ? (data: string) => electronAPI.terminalWrite(sessionId, data)
        : (data: string) => socket.emit('terminal:input', { sessionId, data });

      if (!readOnly) {
        // Handle special key combos that xterm doesn't send correctly
        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.key === 'Enter' && e.shiftKey) {
            if (e.type === 'keydown') {
              // Shift+Enter — send CSI u encoding so Claude TUI gets it as newline
              writeToTerminal('\x1b[13;2u');
            }
            return false;
          }
          // Ctrl+Shift+C — copy selection (Windows/Linux terminal convention)
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
          // Cmd+C on Mac — copy selection if text is selected, otherwise send SIGINT
          if (e.type === 'keydown' && e.code === 'KeyC' && e.metaKey && !e.shiftKey) {
            const sel = terminal.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel);
              return false;
            }
            // No selection — let it through as Ctrl+C (SIGINT)
            return true;
          }
          return true;
        });

        terminal.onData((data: string) => {
          writeToTerminal(data);
        });
      }

      // Receive PTY output — strip screen-clear sequences so history persists
      const stripClear = (s: string) =>
        s.replace(/\x1b\[2J/g, '')   // clear entire screen
         .replace(/\x1b\[3J/g, '')   // clear scrollback
         .replace(/\x1b\[H/g, '');   // cursor home (often paired with clear)
      const handleData = (msg: { sessionId: string; data: string }) => {
        if (msg.sessionId === sessionId) {
          terminal.write(stripClear(msg.data));
          if (statusRef.current !== 'connected') setStatus('connected');
        }
      };

      const handleExit = (msg: { sessionId: string; exitCode: number }) => {
        if (msg.sessionId === sessionId) {
          terminal.writeln(`\r\n\x1b[90m[Session exited with code ${msg.exitCode}]\x1b[0m`);
          setStatus('exited');
        }
      };

      socket.on('terminal:data' as any, handleData);
      socket.on('terminal:exit' as any, handleExit);

      // Attach to the already-spawned PTY (managed session)
      setStatus('connecting');
      socket.emit('terminal:resume' as any, { sessionId });

      // Resize again after resume — PTY now exists and can receive the dimensions
      setTimeout(fitAndResize, 200);
      setTimeout(fitAndResize, 500);

      // Handle resize — debounce to avoid flicker
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const doFit = () => fitAndResize();
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(doFit, 50);
      });
      resizeObserver.observe(container);

      // Catch browser zoom changes (ResizeObserver misses these sometimes)
      const onWindowResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(doFit, 100);
      };
      window.addEventListener('resize', onWindowResize);

      // Store cleanup refs
      (terminal as any).__cleanup = () => {
        socket.off('terminal:data' as any, handleData);
        socket.off('terminal:exit' as any, handleExit);
        window.removeEventListener('resize', onWindowResize);
        resizeObserver.disconnect();
        terminal.dispose();
      };
    })();

    return () => {
      cleanup = true;
      if (termRef.current?.__cleanup) {
        termRef.current.__cleanup();
        termRef.current = null;
      }
    };
  }, [sessionId, socketRef]);

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return;
    const socket = socketRef.current;
    const fit = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term && socket) {
          socket.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
        }
        term?.focus();
      } catch {}
    };
    // Fit multiple times — layout, paint, and after dialog animation settles
    const t1 = setTimeout(fit, 50);
    const t2 = setTimeout(fit, 200);
    const t3 = setTimeout(fit, 500);
    // Extra late fit to catch fullscreen→dialog transitions
    const t4 = setTimeout(fit, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [visible, sessionId, socketRef]);

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
