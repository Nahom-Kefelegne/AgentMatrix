# Terminal Fitting — How It Works

## Overview

The terminal rendering chain is: **PTY (node-pty) → Socket.io → xterm.js**. The PTY and xterm.js must agree on the terminal dimensions (cols × rows). If they disagree, the CLI's TUI renders at the wrong width, causing garbled/wrapped output.

## The Problem

1. PTY spawns at default **80×24**
2. xterm.js opens inside a dialog/panel of arbitrary pixel size
3. `fitAddon.fit()` calculates the correct cols×rows for the container size
4. But if we don't **tell the PTY** the new dimensions, the CLI still thinks it's 80×24

## The Solution: `fitAndResize()`

Single function in `TerminalPanel.tsx` that always does both:

```typescript
const fitAndResize = () => {
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
  try {
    fitAddon.fit();                          // Resize xterm.js to fill container
    socket.emit('terminal:resize', {         // Tell PTY the new dimensions
      sessionId,
      cols: terminal.cols,
      rows: terminal.rows,
    });
  } catch {}
  return true;
};
```

## When It Fires

### On Mount (initial open)
```
terminal.open(container)
  → fitAndResize() immediately
  → if container has no size yet: ResizeObserver watches until it does
  → fitAndResize() at 100ms, 300ms, 600ms (dialog animation settling)
```

### After Resume
```
socket.emit('terminal:resume')  → PTY replays buffered output
  → fitAndResize() at 200ms     → PTY now exists, receives dimensions
  → fitAndResize() at 500ms     → safety net for slow connections
```

### On Container Resize (ResizeObserver)
```
Dialog resized / panel dragged / fullscreen toggle
  → ResizeObserver fires
  → debounced 50ms → fitAndResize()
```

### On Window Resize (zoom, devtools toggle)
```
window 'resize' event
  → debounced 100ms → fitAndResize()
```

### On Visibility Change (tab switch, fullscreen exit)
```
visible prop changes to true
  → fitAndResize() at 50ms, 200ms, 500ms, 1000ms
```

## Key File: `app/components/TerminalPanel.tsx`

| Section | Lines | What |
|---------|-------|------|
| `fitAndResize()` definition | ~107-120 | The core function |
| Initial mount fits | ~122-130 | Immediate + ResizeObserver + staggered timeouts |
| Post-resume fits | ~216-217 | After `terminal:resume` event |
| ResizeObserver | ~225-229 | Container size changes |
| Window resize | ~231-234 | Zoom / devtools / window changes |
| Visibility fits | ~268-286 | Tab switch / fullscreen transitions |

## PTY Default Dimensions

Set in `electron/pty/PtyManager.ts` → `spawnPty()`:
- Default: **80×24** (conservative — fits any dialog size)
- The terminal panel resizes the PTY to actual size when it opens

## Common Glitch Scenarios

| Symptom | Cause | Fix |
|---------|-------|-----|
| Text wraps at wrong column | PTY thinks 80 cols, xterm shows 120 | `fitAndResize()` must fire after mount |
| Output garbled after opening dialog | PTY buffer was rendered at 80×24, dialog is wider | Post-resume `fitAndResize()` triggers TUI redraw |
| Fullscreen → dialog transition garbled | Both terminals sent competing resize events | `visible={!terminalFullscreen}` on dialog terminal |
| Zoom in/out breaks layout | `ResizeObserver` missed the zoom change | `window.addEventListener('resize')` as fallback |
| Content correct but wrong on first paint | Dialog animation not settled when fit runs | Staggered fits at 100ms, 300ms, 600ms |

## What We Cannot Fix

- **CLI internal TUI layout changes** (e.g., Claude Buddy appearing, tool panels opening) — these are handled by the CLI itself within the PTY dimensions we provide
- **Buffered output from before resize** — already rendered at old dimensions, in the scrollback buffer. Only new output respects the new dimensions.

## FullscreenTerminal Fitting

`app/components/FullscreenTerminal.tsx` renders `TerminalPanel` components in panes. Each pane's `TerminalPanel` has its own `fitAndResize()`. The `visible` prop is always `true` for fullscreen panes. Layout changes (adding/removing panes, switching layouts) trigger ResizeObserver on each pane's container.

## Editor Terminal Fitting

`app/components/editor/EditorTerminal.tsx` uses a similar but simpler pattern:
- Fit after 50ms on mount
- Fit on first data received (shell started)
- Fit 500ms after spawn
- ResizeObserver on container
- Sends `editor:terminal:resize` (separate from `terminal:resize`)
