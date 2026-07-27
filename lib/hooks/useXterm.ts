'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createTerminalLinks } from '@/lib/terminal-links';
import type { NavigationRequest } from '@/lib/navigation/types';

// Debounce for container resize events. 150ms is the xterm.js community sweet
// spot: prevents reflow storms during drag/animation while still feeling snappy.
const RESIZE_DEBOUNCE_MS = 150;

export interface UseXtermOptions {
  /** User keystrokes / paste from the terminal (already encoded by xterm). */
  onData?: (data: string) => void;
  /** Fires only when fit() actually changes cols/rows. */
  onResize?: (cols: number, rows: number) => void;
  /** Called once, after the terminal is opened and first-fitted. */
  onReady?: (terminal: any) => void;
  /** Intercept keys before xterm handles them (copy/paste, etc.). */
  customKeyHandler?: (e: KeyboardEvent, terminal: any) => boolean;
  readOnly?: boolean;
  theme?: Record<string, string>;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  scrollback?: number;
  cursorBlink?: boolean;
  cursorStyle?: 'bar' | 'block' | 'underline';
  sessionId?: string;
  onNavigate?: (request: NavigationRequest) => void;
}

export interface UseXtermHandle {
  /** Attach to the DOM node that should host the terminal. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Write bytes to the terminal. Safe before the terminal exists (buffered). */
  write: (data: string) => void;
  /** Re-fit the terminal to its container (guards against 0x0 / disposal). */
  fit: () => void;
  /** Focus the terminal (no-op when read-only or disposed). */
  focus: () => void;
  /** The live xterm Terminal, or null before it is created / after disposal. */
  getTerminal: () => any | null;
}

/**
 * Owns the xterm.js lifecycle for an embedded terminal: dynamic import,
 * addon loading, GPU/canvas renderer selection, the single fit/ResizeObserver
 * machinery, and correct disposal order. Callers supply behavior (input sink,
 * resize sink, key handling) via options and drive I/O through the returned
 * handle.
 *
 * The terminal is created exactly once per mount. Option callbacks are read
 * from a ref on every invocation, so passing fresh inline callbacks each
 * render does NOT recreate the terminal.
 */
export function useXterm(options: UseXtermOptions): UseXtermHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const acceptingWritesRef = useRef(true);
  // Buffers writes that arrive before the async terminal creation finishes so
  // no early PTY output is dropped.
  const pendingWritesRef = useRef<string[]>([]);

  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    acceptingWritesRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    // Disposal flag: guarded at the top of every async callback so nothing
    // touches xterm internals after terminal.dispose().
    let disposed = false;

    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      // Load CSS once
      if (!document.querySelector('link[data-xterm-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/xterm.css';
        link.setAttribute('data-xterm-css', '');
        document.head.appendChild(link);
      }

      if (disposed) return;

      const o = optsRef.current;
      const terminalLinks = createTerminalLinks(() => {
        const current = optsRef.current;
        return current.sessionId ? {
          sessionId: current.sessionId,
          onNavigate: current.onNavigate,
        } : undefined;
      });

      const terminal = new Terminal({
        theme: o.theme,
        fontSize: o.fontSize ?? 16,
        fontFamily: o.fontFamily ?? "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: o.lineHeight ?? 1.4,
        cursorBlink: o.cursorBlink ?? false,
        cursorStyle: o.cursorStyle ?? 'bar',
        scrollback: o.scrollback ?? 5000,
        scrollOnUserInput: true,
        linkHandler: terminalLinks.linkHandler,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const terminalLinksDisposable = terminalLinks.register(terminal);

      // ── Renderer ladder: WebGL (GPU) → Canvas (CPU) → DOM ──
      // WebGL is fastest but grainy and context-flaky over Windows Remote
      // Desktop, so Windows prefers the Canvas renderer (CPU-rasterized: crisp
      // on RDP and far faster than xterm's built-in DOM renderer). Elsewhere we
      // prefer WebGL and fall back to Canvas. If an addon can't load at all,
      // xterm keeps its DOM renderer. A lost WebGL context downgrades to Canvas
      // at runtime instead of rendering blank.
      const isWindows = navigator.platform?.toLowerCase().includes('win');

      // Track the active GPU/canvas renderer addon so cleanup can dispose it
      // explicitly and in the right order (see __cleanup below).
      let rendererAddon: any = null;

      const loadCanvas = async (): Promise<boolean> => {
        try {
          const { CanvasAddon } = await import('@xterm/addon-canvas');
          if (disposed) return false;
          const addon = new CanvasAddon();
          terminal.loadAddon(addon);
          rendererAddon = addon;
          return true;
        } catch { return false; }
      };
      const loadWebgl = async (): Promise<boolean> => {
        try {
          const { WebglAddon } = await import('@xterm/addon-webgl');
          if (disposed) return false;
          const addon = new WebglAddon();
          addon.onContextLoss(() => {
            try { addon.dispose(); } catch {}
            if (rendererAddon === addon) rendererAddon = null;
            if (!disposed) void loadCanvas();
          });
          terminal.loadAddon(addon);
          rendererAddon = addon;
          return true;
        } catch { return false; }
      };

      if (isWindows) {
        await loadCanvas();
      } else if (!(await loadWebgl())) {
        await loadCanvas();
      }

      // Component may have unmounted while the renderer addon was importing.
      if (disposed) {
        try { terminalLinksDisposable.dispose(); } catch {}
        terminalLinks.dispose();
        try { terminal.dispose(); } catch {}
        return;
      }

      termRef.current = terminal;
      fitRef.current = fitAddon;

      // ── Resize machinery: ONE fit function, ONE observer, ONE debounce ──
      let hasValidFit = false;
      const safeFit = () => {
        if (disposed) return;
        if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
        try { fitAddon.fit(); hasValidFit = true; } catch {}
      };

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const debouncedFit = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(safeFit, RESIZE_DEBOUNCE_MS);
      };

      // Fires only when fit() actually changes cols/rows — the single place we
      // notify the caller (which forwards to the PTY). No change → no event →
      // no redundant SIGWINCH.
      const onResizeDisposable = terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (disposed) return;
        optsRef.current.onResize?.(cols, rows);
      });

      const resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        if (!hasValidFit && container.clientWidth > 0 && container.clientHeight > 0) {
          safeFit();
        } else {
          debouncedFit();
        }
      });
      resizeObserver.observe(container);

      const onWindowResize = () => debouncedFit();
      window.addEventListener('resize', onWindowResize);

      // ── Input ──
      if (!o.readOnly) {
        terminal.focus();
        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) =>
          optsRef.current.customKeyHandler ? optsRef.current.customKeyHandler(e, terminal) : true,
        );
        terminal.onData((data: string) => optsRef.current.onData?.(data));
      }

      // Expose fit through the stable handle.
      (terminal as any).__safeFit = safeFit;

      // ── Focus handling ──
      const onWindowFocus = () => { if (!disposed && !optsRef.current.readOnly) terminal.focus(); };
      const onVisibilityChange = () => {
        if (!document.hidden && !disposed && !optsRef.current.readOnly) terminal.focus();
      };
      window.addEventListener('focus', onWindowFocus);
      document.addEventListener('visibilitychange', onVisibilityChange);

      // First fit BEFORE ready so the caller sees correct dims when it seeds
      // the PTY (resize-before-resume ordering).
      safeFit();

      // Flush any writes buffered before the terminal existed.
      if (pendingWritesRef.current.length > 0) {
        for (const chunk of pendingWritesRef.current) terminal.write(chunk);
        pendingWritesRef.current = [];
      }

      optsRef.current.onReady?.(terminal);

      // rAF safety net for containers that hadn't laid out at the sync fit.
      requestAnimationFrame(() => {
        if (disposed) return;
        if (!hasValidFit) safeFit();
      });

      // ── Cleanup (proper disposal order per xterm.js docs) ──
      (terminal as any).__cleanup = () => {
        disposed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        try { resizeObserver.disconnect(); } catch {}
        window.removeEventListener('resize', onWindowResize);
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        try { onResizeDisposable.dispose(); } catch {}
        try { terminalLinksDisposable.dispose(); } catch {}
        terminalLinks.dispose();
        // Dispose the GPU/canvas renderer addon FIRST, while the terminal's
        // render service is still alive. Letting terminal.dispose() dispose it
        // implicitly hits an xterm addon-dispose ordering race that throws
        // "Cannot read properties of undefined (reading '_isDisposed')".
        // Let Terminal own loaded-addon disposal. Explicitly clearing the
        // renderer before Terminal.dispose() leaves queued viewport work with
        // no dimensions provider (`RenderService.dimensions` crash).
        rendererAddon = null;
        try { terminal.dispose(); } catch {}
      };
    })();

    return () => {
      disposed = true;
      acceptingWritesRef.current = false;
      const terminal = termRef.current;
      termRef.current = null;
      fitRef.current = null;
      pendingWritesRef.current = [];
      if (terminal?.__cleanup) terminal.__cleanup();
    };
    // Create once per mount — callbacks are read live from optsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = useCallback((data: string) => {
    if (!acceptingWritesRef.current) return;
    if (termRef.current) {
      try { termRef.current.write(data); } catch { /* disposed during teardown */ }
    } else {
      pendingWritesRef.current.push(data);
    }
  }, []);

  const fit = useCallback(() => {
    if (!acceptingWritesRef.current) return;
    const term = termRef.current;
    if (term?.__safeFit) term.__safeFit();
    else { try { fitRef.current?.fit(); } catch {} }
  }, []);

  const focus = useCallback(() => {
    if (acceptingWritesRef.current && !optsRef.current.readOnly) termRef.current?.focus();
  }, []);

  const getTerminal = useCallback(() => termRef.current, []);

  return { containerRef, write, fit, focus, getTerminal };
}
