# Copilot-Native Console — Build Plan

Status: **in progress** · Branch: `copilot-refactor-phase0`

AgentMatrix is going **Copilot-first** (Claude access is ending). The embedded
terminal console was built for Claude's inline-scrolling TUI; Copilot renders very
differently, so the console needs a targeted rebuild rather than patches. This plan
covers (1) the Copilot-native console and (2) how it integrates cleanly with the rest
of the app.

Related design docs: `docs/design/terminal-fitting.md`, `docs/design/electron-pty.md`,
`docs/design/frontend-ui.md`, `docs/design/copilot-first-design.md`,
`docs/design/cli-provider-architecture.md`.

---

## 1. Verified Copilot rendering behavior

Confirmed via byte-level PTY probes of the Copilot CLI:

- Full-screen **alt-screen** app (`ESC[?1049h`) using **absolute cursor positioning**
  (`ESC[<row>;<col>H`); enables bracketed paste (`2004`).
- **No mouse-tracking** modes enabled (1000/1002/1003/1006 all off) → the scroll wheel
  is inert by default.
- **Manages its own timeline scrollback internally.** Scrolling is keyboard-only:
  **PgUp/PgDn** (page), **Ctrl+O** (expand recent), **Ctrl+E** (expand all),
  **Ctrl+T** (reasoning), **Ctrl+F** (timeline search).
- xterm's own scrollback is **useless** for Copilot (alt-screen never writes the main
  buffer) — this was the source of the "scroll up shows garbage" bug.
- Redraws correctly on **SIGWINCH** (PTY resize). Never use Ctrl+L (clears the screen).
- `--session-id=<uuid>` **works on spawn** (empirically confirmed, even under Agency).

**Implication:** the console must be a **faithful raw passthrough** (never mutate
Copilot's byte stream) and must feed Copilot the keys/nudges it expects.

---

## 2. Current architecture & the broken seams

Flow: `SessionDialog` / `FullscreenTerminal` → `TerminalPanel` (xterm) → socket.io
(`terminalBridge`) → `PtyManager` (node-pty) → `CliProvider` (spawn/resume args).

| # | Seam | Problem | Fix |
|---|------|---------|-----|
| 1 | Identity gap (**linchpin**) | `spawnNew` passes `sessionId: opts.sessionUuid` to `buildSpawnArgs`, but `CopilotProvider.buildSpawnArgs` never emits `--session-id`. Copilot mints its own UUID → app-id ≠ Copilot-id. Breaks `--resume <id>`, `findSessionCwd`, name recovery. (`CopilotProvider.ts:177`, `PtyManager.ts:250`) | Emit `--session-id=<uuid>` so app-id == Copilot-id (B1) |
| 2 | Single-callback PTY output | `PtySession.onData` is one mutable slot (`PtyManager.ts:310`); the trust-watcher swaps it (`terminalBridge.ts:37`) and every reconnect overwrites it → subscribers clobber | Subscriber `Set` fan-out (A0) |
| 3 | Non-idempotent `terminal:resume` | Re-wires output + re-emits replay on every call (`terminalBridge.ts:227`) → remount duplicates output | Idempotent resume (A1) |
| 4 | Two panels per session | `FullscreenTerminal` mounts a 2nd `TerminalPanel`; both emit resize for one PTY → contention | Single-owner resize (A3) |
| 5 | Alt-screen stripping | `stripCopilotScrollKillers` (`TerminalPanel.tsx:243`) fights Copilot's rendering | New passthrough panel (A2) |

---

## 3. Integration contract (what the new console must honor)

**Props in:** `sessionId` (== Copilot real UUID), `sessionName`, `cwd`, `cliType`,
`visible`, `readOnly`.

**Client → server:** `terminal:resume {sessionId}` (idempotent);
`terminal:input {sessionId, data}` (raw bytes); `terminal:resize {sessionId, cols, rows}`
(emitted ONLY by the visible/owning panel).

**Server → client:** `terminal:data {sessionId, data}` (raw bytes, **no stripping** for
Copilot); `terminal:exit`, `session:state`, `session:context`, `session:initializing`.

**Rendering (Copilot):** never strip alt-screen/cursor/erase codes; forward
PgUp/PgDn/Ctrl+O/E/T/F untouched; translate **mouse-wheel → PgUp/PgDn**; repaint via
resize, never Ctrl+L.

**Ownership:** exactly ONE panel per session owns PTY size (visible wins).

**Output multiplexing:** `PtySession.onData` → subscriber `Set` so socket-emit +
trust-watcher + state-monitor coexist.

**Identity:** spawn with `--session-id=<uuid>` (+ optional `-n <name>`).

---

## 4. Architecture decision — clean split (confirmed)

A dedicated **`CopilotTerminalPanel`** (native passthrough) + a shared **`useXterm()`**
hook (in `lib/hooks/`) for boilerplate (theme, fit/ResizeObserver, disposal,
copy/paste, renderer selection). Legacy `TerminalPanel` stays for Claude and can be
retired later. `SessionDialog` / `FullscreenTerminal` pick the component by `cliType`.

Rejected: a single component branching on `cliType` — the anti-pattern the
`CliProvider` abstraction exists to avoid.

---

## 5. Phased implementation

### Track A — Console (implemented; pending on-device test)
- **A0. Subscriber-Set PTY output** ✅ `PtySession.subscribers: Set<cb>`; `onOutput`
  adds/removes; `createPtySession` fans out. All three `onData`-swapping monitors
  (trust-prompt, orchestrator startup, auto-resume) converted to subscribers.
- **A1. Idempotent `terminal:resume`** ✅ per-socket `subscribeOutput` Map replaces all
  6 `onOutput` call sites; re-subscribe drops the prior sub; torn down on disconnect.
- **A2. `CopilotTerminalPanel` + `useXterm()`** ✅ `lib/hooks/useXterm.ts` (shared
  boilerplate) + `app/components/CopilotTerminalPanel.tsx` (raw passthrough, wheel→
  PgUp/PgDn, copy/paste keys). Routed via new `app/components/SessionConsole.tsx`.
  Shared theme extracted to `lib/terminalTheme.ts`.
- **A3. Single-owner resize** ✅ only the visible panel emits `terminal:resize`;
  `PtySession.cols/rows` persisted; `PtyManager.forceRepaint()` (SIGWINCH nudge)
  replaces the Copilot `Ctrl+L` seed — subscribe-then-repaint, works even when idle.
- **A4. Renderer ladder (Win+Mac)** ✅ added `@xterm/addon-canvas`; WebGL→Canvas→DOM
  selection (Windows prefers Canvas), WebGL `onContextLoss`→Canvas downgrade; dropped
  `willChange:'transform'` on the Copilot container for crispness.

Validation: `npx tsc --noEmit` + `npm run build` pass. Still to do: dev-build manual
test (modal open/close mid-run, fullscreen toggle, resume-after-restart, long-output
PgUp/PgDn + wheel, trust auto-accept) and Windows/RDP Canvas verification.

### Track B — Identity & naming (makes resume/discovery correct)
- **B1.** `CopilotProvider.buildSpawnArgs` emits `--session-id=<uuid>` (+ optional
  `-n <name>`); fix the stale "doesn't accept --session-id" comment.
- **B2.** Copilot discovery → `~/.copilot/session-store.db` (`sessions.summary`) with
  `workspace.yaml` fallback.
- **B3.** Drop `nameCache` for Copilot (names stable once app-id == UUID and since
  Copilot isn't forked on resume); keep it for Claude. Gate on one probe: does `-n`
  persist across resume?

### Track C — Infra replacement (later PRs)
- **C1.** ACP runner lib (`lib/cli/acp/`) replacing `PromptInjector` for
  Summary/Handoff/Orchestrator (bypass Agency; PTY fallback).
- **C2.** Hook expansion (permissionRequest, errorOccurred, postToolUseFailure,
  preCompact, userPromptSubmitted).
- **C3.** Windows orphan reaping.

---

## 6. Validation & guardrails

- After each phase: `npx tsc --noEmit` + `npm run build`; dev-build manual test —
  open/close modal mid-run, fullscreen toggle, resume-after-restart, long-output
  PgUp/PgDn, trust-prompt auto-accept still fires. **Windows/RDP:** verify Canvas
  renderer is crisp + responsive (A4).
- Constraints: never dual-spawn PTY+ACP for one session; transcripts are sacred; don't
  block the main thread (Windows perf); ACP stays experimental with PTY fallback.
- Kept from prior work (validated): `main.ts` SIGINT/SIGTERM shutdown + Agency resume
  stagger; `OrphanReaper.ts` synchronous kill + Copilot stale-lock cleanup.
- Nothing commits without user go-ahead.

Once Track A ships, write a proper design doc at `docs/design/copilot-terminal.md`
describing the as-built console.
