'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';

interface TerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
}

export default function TerminalPanel({ sessionId, sessionName, cwd, visible }: TerminalPanelProps) {
  const { socketRef } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'exited'>('idle');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
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
        cursorBlink: true,
        scrollback: 5000,
        scrollOnUserInput: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // Focus the terminal so keyboard works immediately
      terminal.focus();

      // Forward keystrokes to PTY via socket
      terminal.onData((data: string) => {
        socket.emit('terminal:input', { sessionId, data });
      });

      // Receive PTY output
      const handleData = (msg: { sessionId: string; data: string }) => {
        if (msg.sessionId === sessionId) {
          terminal.write(msg.data);
          if (status !== 'connected') setStatus('connected');
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

      // Spawn the PTY
      setStatus('connecting');
      socket.emit('terminal:spawn', { sessionId });

      // Handle resize — debounce to avoid flicker
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const doFit = () => {
        if (!fitAddon || !terminal) return;
        try {
          fitAddon.fit();
          socket.emit('terminal:resize', {
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch {}
      };
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(doFit, 50);
      });
      resizeObserver.observe(container);

      // Store cleanup refs
      (terminal as any).__cleanup = () => {
        socket.off('terminal:data' as any, handleData);
        socket.off('terminal:exit' as any, handleExit);
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
  }, [sessionId, socketRef, started]);

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      // Small delay to let CSS layout settle
      const timer = setTimeout(() => {
        try {
          fitRef.current.fit();
          termRef.current?.focus();
        } catch {}
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!started) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 16, color: '#aaa' }}>
          Open a terminal for <span style={{ color: '#8ab4e0', fontWeight: 600 }}>{sessionName}</span>
        </div>
        {cwd && (
          <div style={{ fontSize: 14, color: '#666', fontFamily: "'Courier New', monospace" }}>{cwd}</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStarted(true)} style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Fork &amp; Connect
          </button>
        </div>
        <div style={{ fontSize: 13, color: '#555', maxWidth: 350, textAlign: 'center', lineHeight: 1.5 }}>
          This will fork the session and open an interactive terminal. The original session is not affected.
        </div>
      </div>
    );
  }

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
          <span style={{ color: '#666', fontSize: 12, fontFamily: "'Courier New', monospace" }}>
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
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#0c0c18',
          border: '1px solid #1e1e30',
        }}
      />
    </div>
  );
}
