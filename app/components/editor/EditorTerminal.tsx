'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../SocketProvider';

interface EditorTerminalProps {
  terminalId: string;
  cwd: string;
  visible: boolean;
}

export default function EditorTerminal({ terminalId, cwd, visible }: EditorTerminalProps) {
  const { socketRef, connected } = useSocketContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const spawnedRef = useRef(false);
  const cleanupRef = useRef(false);

  // Step 1: Initialize xterm.js (once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    cleanupRef.current = false;

    let terminal: any = null;

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

      if (cleanupRef.current) return;

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
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      termRef.current = terminal;
      fitRef.current = fitAddon;

      setTimeout(() => { try { fitAddon.fit(); } catch {} }, 50);
    })();

    return () => {
      cleanupRef.current = true;
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      fitRef.current = null;
    };
  }, []);

  // Step 2: Connect to PTY via socket (when socket is ready + xterm is ready)
  useEffect(() => {
    if (!connected) return;
    const socket = socketRef.current;
    if (!socket) return;

    // Wait for xterm to be initialized
    const waitForTerm = setInterval(() => {
      if (termRef.current && !spawnedRef.current) {
        clearInterval(waitForTerm);
        spawnedRef.current = true;

        const term = termRef.current;

        // Forward keyboard input to server
        term.onData((data: string) => {
          socket.emit('editor:terminal:input' as any, { id: terminalId, data });
        });

        // Receive PTY output
        const onData = (payload: { id: string; data: string }) => {
          if (payload.id === terminalId) {
            term.write(payload.data);
          }
        };
        socket.on('editor:terminal:data' as any, onData);

        const onExit = (payload: { id: string; exitCode: number }) => {
          if (payload.id === terminalId) {
            term.write(`\r\n\x1b[90m[Process exited with code ${payload.exitCode}]\x1b[0m\r\n`);
          }
        };
        socket.on('editor:terminal:exit' as any, onExit);

        // Spawn the shell with actual terminal dimensions
        const fit = fitRef.current;
        let spawnCols = 120;
        let spawnRows = 24;
        if (fit) {
          try {
            const dims = fit.proposeDimensions();
            if (dims) { spawnCols = dims.cols; spawnRows = dims.rows; }
          } catch {}
        }
        socket.emit('editor:terminal:spawn' as any, { id: terminalId, cwd, cols: spawnCols, rows: spawnRows });

        // Store cleanup
        term._editorCleanup = () => {
          socket.off('editor:terminal:data' as any, onData);
          socket.off('editor:terminal:exit' as any, onExit);
          socket.emit('editor:terminal:kill' as any, { id: terminalId });
        };
      }
    }, 100);

    return () => {
      clearInterval(waitForTerm);
      if (termRef.current?._editorCleanup) {
        termRef.current._editorCleanup();
        termRef.current._editorCleanup = null;
      }
      spawnedRef.current = false;
    };
  }, [connected, terminalId, cwd, socketRef]);

  // Step 3: Refit on visibility or resize
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit();
        const dims = fitRef.current?.proposeDimensions();
        if (dims) {
          socketRef.current?.emit('editor:terminal:resize' as any, {
            id: terminalId, cols: dims.cols, rows: dims.rows,
          });
        }
      } catch {}
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, terminalId, socketRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        const dims = fitRef.current?.proposeDimensions();
        if (dims) {
          socketRef.current?.emit('editor:terminal:resize' as any, {
            id: terminalId, cols: dims.cols, rows: dims.rows,
          });
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
