'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocketContext } from '../SocketProvider';

interface EditorTerminalProps {
  terminalId: string;
  cwd: string;
  visible: boolean;
}

export default function EditorTerminal({ terminalId, cwd, visible }: EditorTerminalProps) {
  const { socketRef } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const [spawned, setSpawned] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const socket = socketRef.current;
    if (!container || !socket) return;

    let terminal: any = null;
    let fitAddon: any = null;
    let cleanup = false;

    (async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

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
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // Fit after a tick
      setTimeout(() => {
        try { fitAddon.fit(); } catch {}
      }, 50);

      // Forward input to PTY
      terminal.onData((data: string) => {
        socket.emit('editor:terminal:input', { id: terminalId, data });
      });

      // Receive output
      const onData = (payload: { id: string; data: string }) => {
        if (payload.id === terminalId && terminal) {
          terminal.write(payload.data);
        }
      };
      socket.on('editor:terminal:data', onData);

      const onExit = (payload: { id: string; exitCode: number }) => {
        if (payload.id === terminalId && terminal) {
          terminal.write(`\r\n\x1b[90m[Process exited with code ${payload.exitCode}]\x1b[0m\r\n`);
        }
      };
      socket.on('editor:terminal:exit', onExit);

      const onReady = (payload: { id: string }) => {
        if (payload.id === terminalId) setSpawned(true);
      };
      socket.on('editor:terminal:ready', onReady);

      // Spawn the shell
      socket.emit('editor:terminal:spawn', { id: terminalId, cwd });

      terminal._cleanupListeners = () => {
        socket.off('editor:terminal:data', onData);
        socket.off('editor:terminal:exit', onExit);
        socket.off('editor:terminal:ready', onReady);
      };
    })();

    return () => {
      cleanup = true;
      if (terminal) {
        if (terminal._cleanupListeners) terminal._cleanupListeners();
        terminal.dispose();
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId, cwd, socketRef]);

  // Refit on visibility change or container resize
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit();
        const terminal = termRef.current;
        const fit = fitRef.current;
        if (terminal && fit) {
          const dims = fit.proposeDimensions();
          if (dims) {
            socketRef.current?.emit('editor:terminal:resize', {
              id: terminalId,
              cols: dims.cols,
              rows: dims.rows,
            });
          }
        }
      } catch {}
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, terminalId, socketRef]);

  // ResizeObserver for dynamic panel resizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        const terminal = termRef.current;
        const fit = fitRef.current;
        if (terminal && fit) {
          const dims = fit.proposeDimensions();
          if (dims) {
            socketRef.current?.emit('editor:terminal:resize', {
              id: terminalId,
              cols: dims.cols,
              rows: dims.rows,
            });
          }
        }
      } catch {}
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [terminalId, socketRef]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#0c0c18',
        overflow: 'hidden',
      }}
    />
  );
}
