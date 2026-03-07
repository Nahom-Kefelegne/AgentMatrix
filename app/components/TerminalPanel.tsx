'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from './SocketProvider';

interface TerminalPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
}

export default function TerminalPanel({ sessionId, sessionName, cwd }: TerminalPanelProps) {
  const { socketRef } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'exited'>('idle');

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
          background: '#0a0a14',
          foreground: '#d0d0e0',
          cursor: '#4a9eff',
          cursorAccent: '#0a0a14',
          selectionBackground: '#4a9eff40',
          black: '#1a1a2e',
          red: '#ff6b6b',
          green: '#51cf66',
          yellow: '#ffd43b',
          blue: '#4a9eff',
          magenta: '#cc5de8',
          cyan: '#20c997',
          white: '#d0d0e0',
          brightBlack: '#555',
          brightRed: '#ff8787',
          brightGreen: '#69db7c',
          brightYellow: '#ffe066',
          brightBlue: '#74c0fc',
          brightMagenta: '#da77f2',
          brightCyan: '#38d9a9',
          brightWhite: '#f0f0f0',
        },
        fontSize: 15,
        fontFamily: "'Courier New', 'Menlo', 'Monaco', monospace",
        lineHeight: 1.3,
        cursorBlink: true,
        scrollback: 5000,
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

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && terminal) {
          fitAddon.fit();
          socket.emit('terminal:resize', {
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
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
  }, [sessionId, socketRef]);

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

      {/* xterm container */}
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#0a0a14',
          border: '1px solid #222238',
        }}
      />
    </div>
  );
}
