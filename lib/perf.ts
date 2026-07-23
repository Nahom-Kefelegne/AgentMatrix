'use client';

// Lightweight, opt-in client performance instrumentation. Everything here is a
// no-op unless perf logging is enabled, so it costs nothing in normal use.
//
// Enable at runtime (no rebuild) from the DevTools console or app:
//   localStorage.setItem('am-perf', '1'); location.reload();
// or append ?perf=1 to the URL. Disable with localStorage.removeItem('am-perf').
//
// When enabled it logs, every PERF_SUMMARY_MS:
//   • long tasks (main-thread blocks > 50ms) — count + total + worst (the #1
//     signal for "the UI feels slow/janky", especially on Windows/Electron)
//   • FPS (min / avg) and dropped-frame count from a rAF sampler
//   • component render counts (which components re-rendered and how often)
//   • named event counters (e.g. socket events, terminal bytes)
// and logs one-off slow spans (perfSpan) immediately when they exceed a budget.

const SUMMARY_MS = 3000;
const LONG_TASK_MS = 50;      // W3C long-task threshold
const FRAME_BUDGET_MS = 1000 / 60; // ~16.7ms; frames slower than this "dropped"

let enabled: boolean | null = null;

export function perfEnabled(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === 'undefined') return false;
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('perf') === '1') { localStorage.setItem('am-perf', '1'); }
    enabled = localStorage.getItem('am-perf') === '1';
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Best-effort forward of a perf summary to the server terminal (fire-and-forget). */
function forwardToTerminal(line: string): void {
  try {
    fetch('/api/perf-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

// ── Aggregated counters, flushed on an interval ──────────────────────────────
const renderCounts = new Map<string, number>();
const eventCounts = new Map<string, number>();
const eventBytes = new Map<string, number>();

let longTaskCount = 0;
let longTaskTotalMs = 0;
let longTaskWorstMs = 0;

let frameCount = 0;
let droppedFrames = 0;
let worstFrameMs = 0;
let lastFrameTs = 0;

let started = false;

/** Count a component render. Cheap; only records when perf is enabled. */
export function perfRender(component: string): void {
  if (!perfEnabled()) return;
  renderCounts.set(component, (renderCounts.get(component) ?? 0) + 1);
}

/** Count a named event, optionally with a byte size (e.g. terminal output). */
export function perfEvent(name: string, bytes = 0): void {
  if (!perfEnabled()) return;
  eventCounts.set(name, (eventCounts.get(name) ?? 0) + 1);
  if (bytes) eventBytes.set(name, (eventBytes.get(name) ?? 0) + bytes);
}

/**
 * Time a synchronous or async span; logs immediately if it exceeds `budgetMs`.
 * Usage: const end = perfSpan('open-dialog'); ...work...; end();
 */
export function perfSpan(name: string, budgetMs = 100): () => void {
  if (!perfEnabled()) return () => {};
  const t0 = performance.now();
  return () => {
    const dt = performance.now() - t0;
    if (dt >= budgetMs) {
      // eslint-disable-next-line no-console
      console.log(`%c[perf] slow span "${name}": ${dt.toFixed(1)}ms`, 'color:#f59e0b');
    }
  };
}

function flush(): void {
  const parts: string[] = [];
  if (longTaskCount > 0) {
    parts.push(`longtasks=${longTaskCount} total=${longTaskTotalMs.toFixed(0)}ms worst=${longTaskWorstMs.toFixed(0)}ms`);
  }
  if (frameCount > 0) {
    const fps = (frameCount / (SUMMARY_MS / 1000)).toFixed(0);
    parts.push(`fps~${fps} dropped=${droppedFrames} worstFrame=${worstFrameMs.toFixed(0)}ms`);
  }
  if (renderCounts.size > 0) {
    const renders = [...renderCounts.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join(' ');
    parts.push(`renders{ ${renders} }`);
  }
  if (eventCounts.size > 0) {
    const evs = [...eventCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const kb = eventBytes.get(k);
      return kb ? `${k}:${v}(${(kb / 1024).toFixed(0)}KB)` : `${k}:${v}`;
    }).join(' ');
    parts.push(`events{ ${evs} }`);
  }

  if (parts.length > 0) {
    const summary = parts.join('  ');
    // eslint-disable-next-line no-console
    console.log(`%c[perf] ${summary}`, 'color:#8b5cf6');
    // Also forward to the server so it shows up in the app's terminal stdout
    // (handy when you're reading the launch terminal rather than DevTools).
    forwardToTerminal(summary);
  }

  renderCounts.clear();
  eventCounts.clear();
  eventBytes.clear();
  longTaskCount = 0; longTaskTotalMs = 0; longTaskWorstMs = 0;
  frameCount = 0; droppedFrames = 0; worstFrameMs = 0;
}

/** Start the global monitor (long tasks + FPS + periodic summary). Idempotent. */
function startMonitor(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // eslint-disable-next-line no-console
  console.log('%c[perf] monitoring enabled — summaries every 3s (also sent to the app terminal). Disable: localStorage.removeItem("am-perf")', 'color:#8b5cf6;font-weight:bold');

  // Long tasks: main-thread blocks > 50ms.
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1;
        longTaskTotalMs += entry.duration;
        if (entry.duration > longTaskWorstMs) longTaskWorstMs = entry.duration;
        if (entry.duration >= 120) {
          // eslint-disable-next-line no-console
          console.log(`%c[perf] LONG TASK ${entry.duration.toFixed(0)}ms`, 'color:#ef4444');
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }

  // FPS / dropped frames via rAF sampler.
  lastFrameTs = performance.now();
  const sample = (ts: number) => {
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;
    frameCount += 1;
    if (dt > worstFrameMs) worstFrameMs = dt;
    if (dt > FRAME_BUDGET_MS * 1.5) droppedFrames += 1;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  setInterval(flush, SUMMARY_MS);
}

/**
 * Initialize perf monitoring. Turns on when EITHER the local flag is set
 * (localStorage 'am-perf' / ?perf=1) OR the server reports AM_PERF=1 — so a
 * single `AM_PERF=1` at launch enables both client and PTY telemetry with no
 * DevTools step. Idempotent.
 */
export function initPerfMonitor(): void {
  if (typeof window === 'undefined') return;
  if (perfEnabled()) { startMonitor(); return; }
  // Not enabled locally — ask the server whether AM_PERF is set.
  fetch('/api/perf-log')
    .then(r => r.json())
    .then((cfg: { enabled?: boolean }) => {
      if (cfg?.enabled) {
        enabled = true;
        try { localStorage.setItem('am-perf', '1'); } catch { /* ignore */ }
        startMonitor();
      }
    })
    .catch(() => { /* server flag unavailable */ });
}
