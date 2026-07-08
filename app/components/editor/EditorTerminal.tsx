'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../SocketProvider';

interface EditorTerminalProps {
  terminalId: string;
  cwd: string;
  visible: boolean;
}

// Identical xterm setup to the working TerminalPanel, just using editor:terminal:* events
export default function EditorTerminal({ terminalId, cwd, visible }: EditorTerminalProps) {
  const { socketRef } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'connected' | 'exited'>('idle');

  useEffect(() => {
    const container = containerRef.current;
    const socket = socketRef.current;
    if (!container || !socket) return;

    let terminal: any = null;
    let fitAddon: any = null;
    let cleanup = false;

    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (!document.querySelector('link[data-xterm-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/xterm.css';
        link.setAttribute('data-xterm-css', '');
        document.head.appendChild(link);
      }

      if (cleanup) return;

      // Same config as working TerminalPanel
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
        fontSize: 14,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        scrollOnUserInput: true,
        macOptionIsMeta: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // Fit after xterm is fully rendered
      await new Promise(r => setTimeout(r, 50));
      if (cleanup) return;
      try { fitAddon.fit(); } catch {}

      terminal.focus();

      // Forward keystrokes to PTY
      terminal.onData((data: string) => {
        socket.emit('editor:terminal:input' as any, { id: terminalId, data });
      });

      // Receive output from PTY
      let firstData = true;
      const handleData = (msg: { id: string; data: string }) => {
        if (msg.id === terminalId) {
          terminal.write(msg.data);
          // Force resize sync on first output — shell is now running
          if (firstData) {
            firstData = false;
            setTimeout(() => {
              if (cleanup || !fitAddon || !terminal) return;
              try {
                fitAddon.fit();
                socket.emit('editor:terminal:resize' as any, {
                  id: terminalId, cols: terminal.cols, rows: terminal.rows,
                });
              } catch {}
            }, 200);
          }
        }
      };

      const handleExit = (msg: { id: string; exitCode: number }) => {
        if (msg.id === terminalId) {
          terminal.writeln(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m`);
          setStatus('exited');
        }
      };

      socket.on('editor:terminal:data' as any, handleData);
      socket.on('editor:terminal:exit' as any, handleExit);

      // Spawn the shell with correct dimensions
      const spawnCols = terminal.cols;
      const spawnRows = terminal.rows;
      socket.emit('editor:terminal:spawn' as any, {
        id: terminalId,
        cwd,
        cols: spawnCols,
        rows: spawnRows,
      });

      // Force a resize after shell starts to ensure PTY size matches
      setTimeout(() => {
        if (cleanup || !fitAddon || !terminal) return;
        try {
          fitAddon.fit();
          socket.emit('editor:terminal:resize' as any, {
            id: terminalId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch {}
      }, 500);

      // Resize handling — debounced, same pattern as TerminalPanel
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const doFit = () => {
        if (!fitAddon || !terminal || !terminal.element) return;
        try {
          fitAddon.fit();
          socket.emit('editor:terminal:resize' as any, {
            id: terminalId,
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

      (terminal as any).__cleanup = () => {
        socket.off('editor:terminal:data' as any, handleData);
        socket.off('editor:terminal:exit' as any, handleExit);
        socket.emit('editor:terminal:kill' as any, { id: terminalId });
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
      fitRef.current = null;
    };
  }, [terminalId, cwd, socketRef]);

  // Re-fit when panel becomes visible
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return;
    const socket = socketRef.current;
    const fit = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term && socket) {
          socket.emit('editor:terminal:resize' as any, {
            id: terminalId, cols: term.cols, rows: term.rows,
          });
        }
        term?.focus();
      } catch {}
    };
    const t1 = setTimeout(fit, 50);
    const t2 = setTimeout(fit, 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [visible, terminalId, socketRef]);

  return (
    <>
      <style>{`
        .xterm-viewport::-webkit-scrollbar { width: 6px; }
        .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .xterm-viewport::-webkit-scrollbar-thumb:hover { background: #555; }
      `}</style>
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        style={{
          width: '100%',
          height: '100%',
          background: '#0c0c18',
          overflow: 'hidden',
        }}
      />
    </>
  );
}
