# Office Reintegration and Performance Plan

Status: **Core reintegration and frame controls implemented; deeper dirty-render optimization remains**

Date: 2026-08-19

## 1. Executive Decision

Office should return as an on-demand **fleet map inside the Control Center
shell**, not as a separately styled legacy page and never as a hidden,
continuously running canvas.

The recommended architecture is:

1. Keep the Control Center command rail and session rail visible.
2. Swap only the main workspace between Console and Office.
3. Lazy-load the Office React component, game engine, and sprite asset.
4. Keep Office fully unmounted outside the Office view.
5. Pause the engine on explicit Electron window hide/minimize events.
6. Render at a bounded rate: 30 FPS locally and 12 FPS in reduced/remote mode.
7. Rebuild the Office deterministically from the current session snapshot,
   including existing subagents.
8. Remove the legacy SessionDialog path from Office so the canvas never renders
   behind a second live terminal.

This preserves the distinctive pixel-art Office while maintaining the
console-first product and the performance guarantees established by Dashboard
V2.

## 2. Pre-Implementation Reality

Office is not deleted. It remains reachable from the Dashboard V2 navigation,
but selecting it exits the Dashboard V2 shell:

```text
Dashboard V2
  -> click Office
  -> DashboardV2Container unmounts
  -> legacy HeaderBar mounts
  -> OfficeCanvas mounts
  -> clicking a character opens legacy SessionDialog
```

The most important prior performance fix is still present:

- `OfficeCanvas` mounts only when `viewMode === 'office'`.
- Leaving Office unmounts the component.
- cleanup calls `GameEngine.stop()`.
- `GameEngine.stop()` cancels its `requestAnimationFrame`.

Do not regress to `display: none` or hidden mounting. A hidden Office previously
kept a 60 FPS game loop running behind the dashboard and caused material
Windows/RDP latency.

The implemented local flow is now:

```text
DashboardV2Container remains mounted
  -> DashboardV2Nav switches the main workspace
  -> SessionSidebar remains mounted
  -> OfficeWorkspace loads dynamically
  -> ConsoleWorkspace is absent while Office is active
  -> Open CLI unmounts Office and restores ConsoleWorkspace
```

## 3. Measured Baseline

The audit used a fresh `npm run build` and a local production server.

### Production build

```text
Next.js 16.1.6 / Turbopack
Compiled successfully in 4.1 seconds
TypeScript passed
58 static/dynamic routes finalized
```

### Initial route JavaScript

The initial `/` response currently loads:

```text
11 JavaScript files
922,743 raw bytes total
```

Office-specific interpretation:

| Asset | Current behavior | Raw | gzip |
|---|---|---:|---:|
| Page chunk containing `OfficeCanvas` | Loaded on initial `/` | 134,514 B | 37,373 B |
| Dynamic engine chunk containing `GameEngine` | Not in initial script list | 24,531 B | 7,386 B |
| `characters.png` | Loaded when engine initializes | 40,245 B | 38,815 B |

The 134 KB page chunk contains more than Office, so moving Office to a dynamic
workspace will not remove all 134 KB. It will, however, remove the Office
component and its direct UI dependencies from the default route and keep the
feature boundary analyzable.

### Implemented bundle result

After moving Office behind a dynamic workspace:

```text
Initial route: 915,477 raw bytes
Change:        -7,266 raw bytes
Office/engine symbols in initial scripts: none
```

The Office workspace preloads on Office navigation hover/focus, then mounts only
after the view is selected.

### Canvas dimensions

Current constants:

```text
Game canvas:      608 x 416
Text overlay:   1,520 x 1,040
Electron window: 1,400 x 900 by default
```

The Office display is larger than the default window before accounting for
navigation. It therefore enters with scrollbars rather than fitting the current
workspace.

The overlay clears up to:

```text
1,520 x 1,040 x 60 = 94,848,000 pixels per second
```

That number excludes text measurement, labels, bubbles, emoji, sprite draws,
sorting, and compositor/RDP encoding.

### Existing optimization that should remain

`TileMap.render()` already caches the complete static tile map in an offscreen
canvas and blits it each frame. Do not spend the first optimization pass
rewriting the tile renderer; the high-value work is frame frequency, overlay
work, React pointer updates, and lifecycle.

## 4. Findings

### P0 - Fix before treating Office as a first-class Dashboard V2 view

#### 4.1 Office uses the legacy shell

When Office is active, Dashboard V2's integrated navigation disappears and the
old floating `HeaderBar` returns.

Effects:

- visual discontinuity
- two navigation systems to maintain
- no active-state support in `DashboardV2Nav` for Office
- old theme/layout tokens remain necessary
- Office session clicks use the legacy modal rather than the console-first
  workspace

#### 4.2 Character click can run Office and a live terminal simultaneously

Clicking a character sets `selectedSessionId`. Because Dashboard V2 is not
active, `SessionDialog` mounts over Office while the game loop continues behind
it.

This is the exact pattern to avoid:

```text
60 FPS Office + xterm + modal reconciliation
```

With Dashboard V2 enabled, Office must never open `SessionDialog`.

#### 4.3 Hover updates root React state at pointer frequency

Every Office `mousemove` can call:

```ts
setHoveredChar(char);
setHoverPos({ x, y });
```

Those states live in the root `OfficeView`. Moving the pointer can therefore
re-render the application shell at mouse-event frequency.

Transient pointer coordinates should live in refs or a small Office-only
component. They should not drive root React rendering.

#### 4.4 Re-entry hydration is incomplete

`OfficeCanvas` subscribes to future raw socket events. `useSocket.onEvent()` does
not replay the prior `state:snapshot` to a subscriber that mounts later.

The fallback after engine initialization currently spawns only parent sessions:

```ts
sessions.forEach(session => engine.spawnCharacter(session));
```

It does not recreate:

- agents already active before Office opened
- their meeting-room placement
- attention emoji for existing attention sessions
- transient meeting state not represented by a new event

Office can therefore be stale immediately after opening.

#### 4.5 Engine state mutates React session objects

`GameEngine.spawnCharacter()` stores the `SessionData` object received through
React. `GameEngine.updateCharacter()` later calls:

```ts
Object.assign(session, changes);
```

That can mutate objects owned by `SocketProvider` outside React's state update.
The engine must store an internal copy or a narrower internal session record.

#### 4.6 There is no safe hidden-window pause

Electron intentionally uses:

```ts
backgroundThrottling: false
```

This is required because RDP can report a visible remote window as occluded.
The previous `document.hidden` guard caused a blank Office over Remote Desktop
and was correctly removed in `960fd0c`.

The consequence is that Office continues rendering when the user explicitly
hides or minimizes the AgentMatrix window.

Implemented: Electron now emits an explicit visibility signal based on real
`show`, `hide`, `minimize`, and `restore` events. Do not reintroduce
`document.hidden` as the authority.

#### 4.7 Fixed display sizing does not fit Dashboard V2

`OfficeCanvas` uses `100vw`, `100vh`, a 56px legacy header offset, and a fixed
1,520 x 1,040 display.

Embedding it in the Control Center workspace requires:

- container-relative sizing
- aspect-ratio-preserving fit
- no viewport assumptions
- pointer coordinates derived from the actual element rectangle

Current pointer conversion divides by constant `SCALE`, which will be wrong
after responsive fitting.

### P1 - High-value active-mode performance improvements

#### 4.8 The engine renders at display refresh rate

The loop renders once per `requestAnimationFrame`, normally 60 FPS, even though
the visual language is pixel art and does not require 60 rendered frames.

Recommended caps:

- local/default: 30 rendered frames per second
- reduced motion or remote session: 12 rendered frames per second
- explicitly hidden/minimized: zero Office frames

The browser may still invoke rAF at display rate; the engine should use an
accumulator and skip update/render work until the target interval elapses.

#### 4.9 Overlay work is repeated every frame

The 1.58 million-pixel overlay is cleared every frame. Every character then:

- sets font/alignment state
- calls `measureText()` for its label
- draws a label background and text
- checks/draws emoji
- checks/draws bubbles

Improvements:

1. Cache label width when a character is created or renamed.
2. Set shared font/alignment state once per render pass, not once per character.
3. Separate overlay dirtiness from the pixel layer.
4. In reduced-motion mode, keep persistent emoji static.
5. Redraw a fully static overlay only after state, selection, or layout changes.

#### 4.10 Character sort allocates every frame

`renderAll()` copies every character to an array and sorts by `y` every frame.

This is acceptable for a small fleet but creates avoidable allocation/GC
pressure with many subagents. Reuse a scratch array and sort only when a
character's vertical position changes.

#### 4.11 First frame waits for the sprite asset

`OfficeCanvas` awaits `engine.init()`, and `init()` waits for
`characters.png`, before calling `engine.start()`.

The engine already has fallback character rendering. It should:

1. paint the room and fallback characters immediately
2. load/decode the sprite asynchronously
3. invalidate and repaint when the image is ready

The module and sprite can also preload when the Office navigation control is
hovered or focused.

#### 4.12 Sprite and static-map caches are recreated on every entry

The browser will normally cache the PNG bytes, but every engine instance creates
a new `Image`, new `TileMap`, and new offscreen tile canvas.

Use module-level lazy promises/caches for:

- decoded sprite image
- immutable tile-map bitmap/canvas

Keep cache memory bounded and shared only while the renderer process lives.

### P2 - Cleanup and polish

#### 4.13 Dead API surface

Current unused Office surface:

- `OfficeCanvasHandle`
- `getCharacterScreenInfo()`
- root `canvasRef`
- `socketRef` OfficeCanvas prop
- `connected` OfficeCanvas prop

Removing this also removes an unused `toDataURL()` sprite-capture path.

#### 4.14 Legacy HeaderBar polling

`HeaderBar` performs `document.querySelector('[data-scroll-area]')` every 200 ms
to infer scrolled styling.

The integrated Control Center navigation does not need this poll. Removing the
legacy HeaderBar from Office removes the query and old Framer Motion active-pill
path.

#### 4.15 Status language is out of sync

Office uses older colors and hardcoded dark HoverCard styling. Its status color
map does not explicitly cover every current session status.

Office should consume the same semantic status treatment as Dashboard V2:

- attention
- working
- meeting
- idle
- done
- ready to review / warning context where appropriate

The pixel world remains distinctive; the surrounding chrome should use
`--mc-*` Control Center tokens.

## 5. Target Product Experience

Office becomes the spatial fleet view of the same Control Center, not a second
application.

```text
+---------------------------------------------------------------------+
| AM | Control Center  Office | New Resume Tasks | theme setup prefs  |
+---------------------------------------------------------------------+
| Session rail | Office fleet map                                     |
|              |                                                       |
| needs you    |      desks, meetings, agents, activity                |
| working      |                                                       |
| idle         |  Selected: session-name  status  [Open CLI]           |
+---------------------------------------------------------------------+
```

### Design direction

- **Subject:** an operational floor plan for coding-agent sessions.
- **Audience:** developers supervising several live CLI sessions.
- **Single job:** understand the fleet spatially and choose which session to
  inspect next.
- **Signature:** the pixel-art floor plan remains the memorable element.
- **Chrome:** quiet Control Center instrument framing.
- **Motion:** only session activity, movement, and short evidence signals;
  no additional ambient decoration.

### Interaction

1. Control Center and Office use the same top navigation.
2. The current view receives the active nav indicator.
3. The session rail remains keyboard accessible.
4. Selecting a session in the rail highlights its character.
5. Clicking a character selects it and updates a stable details strip.
6. **Open CLI** returns to Control Center with that session selected.
7. Double-click may be an optional shortcut, never the only accessible action.
8. Agent characters select their owning parent session.
9. Office never opens the legacy SessionDialog when Dashboard V2 is enabled.

The stable details strip should replace most HoverCard content. A small hover
tooltip may remain, but pointer position should update through a ref/CSS
transform rather than root React state.

## 6. Target Component Architecture

```text
OfficeView (application routing + modals)
  DashboardV2Container (mounted for dashboard and office)
    DashboardV2
      DashboardV2Nav
      SessionSidebar
      if viewMode === dashboard
        ConsoleWorkspace
      if viewMode === office
        OfficeWorkspace (dynamic import)
          OfficeCanvas
          OfficeSelectionStrip
```

### Why keep DashboardV2Container mounted

- selected session remains authoritative across views
- Context Canvas queue/reconnect state remains subscribed
- the attention model and session rail are reused
- returning to Console restores the same selected session
- no legacy selection bridge is required

`ConsoleWorkspace` and its terminal remain unmounted while Office is active, so
the app does not render a terminal and Office simultaneously.

### Why OfficeWorkspace should be dynamic

`OfficeWorkspace` should own:

- OfficeCanvas import
- Hover/selection presentation
- Office-only CSS
- engine preload hook
- responsive measurement

This isolates frequent pointer state and lets the default dashboard avoid
loading Office UI code.

## 7. Performance Architecture

### 7.1 Lifecycle states

The engine should have explicit states:

```ts
type OfficeEngineState =
  | 'stopped'
  | 'running'
  | 'suspended';
```

- `stopped`: component unmounted; listeners and rAF removed
- `running`: Office visible and AgentMatrix window explicitly visible
- `suspended`: Office selected but Electron window hidden/minimized

### 7.2 Electron visibility signal

Keep `backgroundThrottling: false`.

Add main-process events for:

- `show`
- `hide`
- `minimize`
- `restore`

Expose one preload subscription such as:

```ts
onWindowVisibilityChange(
  callback: (visible: boolean) => void,
): () => void;
```

Only explicit app visibility controls suspension. OS occlusion and
`document.hidden` do not.

### 7.3 Frame scheduler

Recommended first implementation:

```text
normal profile:  33.3 ms render interval (30 FPS)
reduced profile: 83.3 ms render interval (12 FPS)
suspended:       no scheduled frame
```

After the cap is validated, add dirty/animation-aware sleeping:

- no moving/fired characters
- no transient bubbles or lines
- no animated working indicator
- no non-static emoji
- no selection/layout changes

When those conditions are all true, stop scheduling rendered frames and wake on
the next engine event.

### 7.4 Rendering tiers

| Work | Frequency |
|---|---|
| Static tile background | cached once |
| Character pixel layer | target FPS while animation exists |
| Labels | only when position/name/layout changes |
| Persistent emoji in reduced mode | static |
| Transient bubble/connection line | target FPS until complete |
| Pointer hover position | DOM transform via ref, at most one update per rAF |

### 7.5 Responsive backing resolution

Use `ResizeObserver` on the Office workspace.

Compute:

```ts
displayScale = Math.min(
  availableWidth / CANVAS_W,
  availableHeight / CANVAS_H,
);
```

Render with the map aspect ratio. The pixel canvas can keep its native backing
resolution and scale through CSS.

The implemented first slice sizes the crisp overlay backing store to the fitted
CSS display dimensions. A future capped device-pixel-ratio pass is optional if
high-DPI text quality requires it and measurements show the additional pixels
are affordable.

Pointer conversion must use measured ratios:

```ts
canvasX = (clientX - rect.left) * CANVAS_W / rect.width;
canvasY = (clientY - rect.top) * CANVAS_H / rect.height;
```

## 8. Correct Snapshot Hydration

Opening Office must construct the complete current world before consuming new
events.

For every session:

1. clone the session into engine-owned state
2. spawn the parent directly at its authoritative desk/meeting destination
3. apply current status/tool/name/activity
4. show idle or attention indicator
5. spawn every existing `session.agents` entry
6. assign the same deterministic team key used by live `agent:start`
7. move the parent and agents to the correct meeting room

New sessions and agents received after hydration may still animate from the
entrance.

The raw event buffer should be:

- short-lived
- bounded
- cleared on cleanup
- replayed after snapshot hydration

Starting fallback rendering before sprite decode substantially shortens the
buffer window.

## 9. Implementation Phases

### Phase 1 - Control Center integration and correctness (implemented)

1. Add `viewMode` to Dashboard V2 navigation/view props.
2. Make `DashboardV2Nav` show the actual active view.
3. Render DashboardV2Container for both Dashboard and Office modes.
4. Add dynamic `OfficeWorkspace`.
5. Reuse `SessionSidebar` in Office.
6. Replace legacy SessionDialog click behavior with selected-session state and
   an explicit Open CLI action.
7. Move hover/selection state out of root `OfficeView`.
8. Add responsive fit and ratio-based pointer coordinates.
9. Hydrate parents and existing agents from the current sessions Map.
10. stop mutating React-owned SessionData.
11. remove unused Office refs/props and the unused sprite data-URL API.

Exit criteria:

- no legacy HeaderBar in Office
- no legacy SessionDialog from Office
- default 1,400 x 900 window has no Office scrollbars
- re-entry shows all current parents and agents
- dashboard and Office preserve the same selected session

### Phase 2 - Engine scheduling and cold entry (core items implemented)

Implemented:

1. Start fallback rendering before sprite decode completes.
2. Cache sprite decode and immutable tile bitmap across mounts.
3. Add explicit Electron hide/minimize suspension.
4. Cap render frequency to 30/12 FPS.
5. Integrate `html.reduce-motion` with frame and persistent-emoji policy.
6. Cache label measurements.
7. Bound and clear pre-ready event buffering.

Remaining:

1. Batch overlay context state.
2. Add dirty/animation-aware sleeping.
3. Reuse a cached render-order array for large subagent fleets.

Exit criteria:

- hidden/minimized Office records zero rendered frames
- reduced/remote Office renders no more than 12 frames per second
- warm Office entry paints within one animation frame after mount
- no >50 ms Office initialization long task in the target fleet test

### Phase 3 - Visual and accessibility fit

1. Style Office workspace with `--mc-*` shell tokens.
2. Keep the pixel map as the only visually loud element.
3. add stable selected-session details and Open CLI action
4. synchronize sidebar, selected character, and status semantics
5. expose a useful accessible description for the canvas
6. ensure every canvas-only action has a keyboard-accessible equivalent
7. test dark/light, narrow window, high DPI, and reduced motion

### Phase 4 - Stress validation and rollout

1. Add Office-specific opt-in perf counters.
2. compare initial-route chunks before/after dynamic split
3. run 1, 10, 30-session scenarios
4. run parent + 50-subagent stress scenario
5. switch Dashboard <-> Office 20 times and check memory/listeners
6. validate local macOS
7. validate Windows local
8. validate Windows RDP with physical display off
9. ship Office enabled only after budgets pass

### Automated interaction evidence

A production Electron smoke test at the default 1,400 x 900 window verified:

```text
Office active:
  active nav: Office
  session rail: present
  Office workspace: present
  console workspace: absent
  Office frame: 1,075 x 736
  overlay backing: 1,075 x 736
  overflow: false

Open CLI:
  active nav: Control Center
  Office workspace: absent
  console workspace: present
  session rail: present
```

Measured frame counts:

```text
Normal profile, 2.2 seconds: 70 frames including initial paints
Normal resume, 1 second:     30 frames
Reduced profile, 2.2 sec:    28 frames including initial paints
Reduced resume, 1 second:    12 frames
Suspended, 1 second:          0 frames in both profiles
```

Screenshot:

```text
~/.copilot/session-state/2538e249-cafb-46fe-adc2-ab33ccee1ed3/files/office-control-center-smoke.png
```

## 10. Performance Budgets

### Dashboard active

- zero Office rendered frames
- no Office raw-event subscriber
- no sprite request
- no engine chunk request
- OfficeWorkspace absent from the initial page chunk

### Office entry

- warm first meaningful paint: <= 100 ms
- cold first meaningful paint: <= 250 ms
- no main-thread task >= 50 ms attributable to Office initialization
- accurate existing parent/agent count on first painted stable state

### Office active

- local: <= 30 rendered frames/sec
- reduced/remote: <= 12 rendered frames/sec
- local p95 Office render work: <= 8 ms
- pointer movement does not re-render `OfficeView` or DashboardV2Container
- no unbounded event or connection-line growth

### Office hidden or exited

- explicit hidden/minimized: zero rendered frames
- unmounted: rAF canceled
- socket callback removed
- pointer/window listeners removed
- pending preload/init cannot start a stopped engine
- memory returns to a stable plateau after repeated view switching

## 11. Validation Method

Use existing instrumentation:

```text
?perf=1
localStorage.setItem('am-perf', '1')
AM_PERF=1
```

Add Office counters only when instrumentation is enabled:

- `office:mount`
- `office:first-paint`
- `office:frame`
- `office:suspended`
- `office:resume`
- `office:event-buffer-high-water`
- `office:characters`

Validation should include:

1. Chrome/Electron Performance recording
2. PerformanceObserver long tasks
3. frame count and render-time sampling
4. network check for lazy chunks/assets
5. heap snapshot before and after 20 view switches
6. listener/rAF cleanup probe
7. real RDP interaction, not only `prefers-reduced-motion`

## 12. Files Expected to Change

### Shell and routing

- `app/page.tsx`
- `app/components/dashboard-v2/DashboardV2.tsx`
- `app/components/dashboard-v2/DashboardV2Container.tsx`
- `app/components/dashboard-v2/DashboardV2Nav.tsx`
- `app/components/dashboard-v2/types.ts`

### Office UI

- new `app/components/office/OfficeWorkspace.tsx`
- move/refactor `app/components/OfficeCanvas.tsx`
- replace or refactor `app/components/HoverCard.tsx`
- `app/styles/mission-control.css`
- optional new `app/styles/office.css`

### Engine

- `lib/engine/GameEngine.ts`
- `lib/engine/CharacterManager.ts`
- `lib/engine/Character.ts`
- `lib/engine/SpriteSheet.ts`
- `lib/engine/TileMap.ts`

### Explicit visibility

- `electron/main.ts`
- `electron/preload.ts`
- a typed renderer declaration for `window.electronAPI`

### Documentation

- `docs/design/dashboard-v2.md`
- `docs/design/frontend-ui.md`
- this plan

## 13. Non-Goals

- Do not keep Office mounted behind the console.
- Do not restore the legacy floating navigation.
- Do not open a second terminal modal over Office.
- Do not rewrite the engine as DOM/React components.
- Do not add WebGL, WebGPU, or OffscreenCanvas before the frame-cap and overlay
  optimizations are measured.
- Do not use `document.hidden` as the RDP visibility authority.
- Do not add more ambient animation.
- Do not redesign the pixel office into a generic dashboard card grid.

## 14. Recommended First Implementation Slice

The safest first slice is:

1. dynamic `OfficeWorkspace`
2. Dashboard V2 shared nav/session rail
3. actual active view in DashboardV2Nav
4. no legacy SessionDialog from Office
5. isolated/ref-driven hover
6. responsive fit
7. complete cloned snapshot hydration
8. 30/12 FPS cap
9. explicit hide/minimize suspension

This slice addresses the largest correctness, integration, bundle, and runtime
risks without introducing a new rendering technology.
