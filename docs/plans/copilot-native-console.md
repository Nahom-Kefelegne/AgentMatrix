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

### Track B — Identity, naming & lifecycle (empirically probed 2026-07-07)

Probed against Copilot CLI 1.0.67/1.0.69 with a PTY harness on throwaway sessions.
**Findings:**
- `--session-id=<uuid>` **sets the UUID for a NEW session** (creates
  `~/.copilot/session-state/<uuid>/`). App-id can == Copilot-id. ✅
- `-n <name>` persists in `workspace.yaml` as `name:` + `user_named: true` and
  **survives resume**. `session-store.db` stores `summary` (first prompt), not name.
- `--resume=<id>` **preserves the same UUID — no fork**; name persists. **Agency does
  NOT fork Copilot** on resume (unlike Claude). So Copilot naming is *structurally
  stable*, unlike Claude's transcript-embedded, fork-losing names.
- **Copilot does NOT prevent double-running** a session: a 2nd `--resume` of an
  already-running/locked UUID succeeds and can spawn **phantom new sessions**. The app
  must guard.
- **`/exit` does NOT exit Copilot's TUI** (leaves a stale `inuse.<PID>.lock`). Clean
  exit = **Ctrl-C (`\x03`) ×2** with a short delay → graceful shutdown + lock removed.
  Stale locks are **self-healed by Copilot on the next resume** and don't block it.

**Status (2026-07-07):** B1, B4, B5 implemented + validated (tsc/build green; B1/B4
verified live against Copilot). B3 satisfied by B1. B2 deferred.
- **B1.** ✅ `CopilotProvider.buildSpawnArgs` emits `--session-id=<uuid>` + `-n <name>`;
  `SpawnOptions.name` added; `spawnNew` passes the resolved name; stale
  `detectActiveSessionIds` comment fixed. Verified: dir created at exact UUID,
  `workspace.yaml` gets `name` + `user_named: true`. Claude untouched (already passed
  `--session-id`, ignores `name`).
- **B2.** ⏸ DEFERRED — reading `session-store.db` needs a native SQLite dep
  (`better-sqlite3`/node-gyp), risky with the expired mirror token + node 20.11 (no
  built-in `node:sqlite`). Pure optimization; the existing `workspace.yaml` discovery
  already yields names. Revisit as an optional PR (or via a pure-WASM reader).
- **B3.** ✅ SATISFIED by B1 — Copilot names are now durable in `workspace.yaml` and
  `discoverSessions()` already reads `meta.name`. **`nameCache` kept intact** (Claude +
  shared routes depend on it); nothing deleted.
- **B4.** ✅ Provider-owned exit: `CliProvider.getExitSequence()` — Claude `/exit`;
  Copilot **Ctrl-C ×2** (400ms gap). Wired into `PtyManager.sendExitSequence` (used by
  `gracefulShutdown` + `terminal:end`). Verified: Ctrl-C ×2 releases the lock (clean
  shutdown); `/exit` did not. Claude behavior identical.
- **B5.** ✅ Running-session guard: cold-path `terminal:resume` now calls
  `reapOrphansForSessions([id])` (kills a live foreign process for that id + cleans its
  Copilot lock) before spawning, so a resume can't spawn a phantom duplicate. Targeted
  to the one id; warm path still guarded by `hasPty`.
- **B6.** ✅ Provider-owned **rename**: `CliProvider.renameSession()`. Copilot has no
  working rename slash command (`/rename` `/name` `/title` are no-ops — verified), so it
  writes `name:`+`user_named: true` into `workspace.yaml` (safe while running, survives
  resume — verified e2e). Claude keeps the in-TUI `/rename` PTY injection (now gated to
  Claude only in `SessionDialog`). `/api/sessions/rename` calls the provider + keeps
  `nameCache`/`sessionStore` in sync.

### Session UX fixes (2026-07-07)
- **Resume Modal**: All/Claude/Copilot filter + shared `CliIcon` (real brand marks;
  extracted to `app/components/CliIcon.tsx`, dashboard uses it too).
- **Empty-session hide**: `CopilotProvider.discoverSessions` skips sessions with no name
  AND no conversation (`events.jsonl` has a real user/assistant message). Copilot-only.
- **Block-scalar name parse fix**: `parseFlatYaml` now folds `name: |-` multi-line values
  (recovers auto-generated names); discovery caps to 60 chars.
- **Close-while-clicking race**: shared `endingSessions` guard in `terminalBridge`;
  `terminal:resume` refuses a session mid-teardown (covers dashboard + modal paths).

### Track C — Hooks + ACP (investigated 2026-07-07; reframed per user)

Full hooks reference: `docs/design/copilot-hooks-reference.md` (13 documented events,
config format, per-event payloads, discovery locations).

**Key findings:**
- Copilot has a **native hooks system** (we don't write hooks — we configure them). It
  reads hook config from `~/.copilot/hooks/*.json`, `.github/hooks/*.json`, settings
  files, etc. and fires `command`/`http`/`prompt` hooks.
- **13 documented events** (we only wired 7): `sessionStart`, `sessionEnd`,
  `userPromptSubmitted`, `preToolUse` (can allow/deny/modify tools), `postToolUse`,
  `postToolUseFailure`, `agentStop`/`Stop`, `subagentStart`, `subagentStop`,
  `errorOccurred`, `preCompact`, `notification` (CLI-only), `permissionRequest`
  (CLI-only, can allow/deny).
- **CRITICAL BUG (verified):** Copilot **blocks HTTP hooks to localhost** unless
  `COPILOT_HOOK_ALLOW_LOCALHOST=1` is in the CLI's env. AgentMatrix uses
  `http://localhost:3000` hooks but **never sets this var**, so **all Copilot hooks are
  silently dead** right now — the app receives no session/tool events from Copilot.
- The hook config (`~/.copilot/hooks/agentmatrix.json`) is a **manual on-disk artifact**
  — nothing in the codebase generates it, so it's missing on a fresh install.

**Plan:**
- **C-hooks-1 (localhost fix, HIGH):** set `COPILOT_HOOK_ALLOW_LOCALHOST=1` in the
  Copilot spawn env so hooks fire at all.
- **C-hooks-2 (config gen):** generate `~/.copilot/hooks/agentmatrix.json` on startup
  (idempotent) instead of relying on a hand-placed file.
- **C-hooks-3 (expand events):** add routes + wiring for the high-value new events —
  `errorOccurred`, `postToolUseFailure`, `preCompact`, `userPromptSubmitted`,
  `notification`, `permissionRequest` — to enrich session state (errors, compaction,
  live prompts, background-agent notifications, permission surfacing).
- **C-acp (ACP runner):** build `lib/cli/acp/` (`copilot --acp`) to replace the
  Claude-era `PromptInjector` for Summary/Handoff/Orchestrator (bypass Agency; PTY
  fallback). ACP verified working: `initialize` → `session/load{sessionId,cwd,
  mcpServers:[]}` → `session/prompt{sessionId,prompt:[{type:text,text}]}`, streams
  `agent_message_chunk`, ~2.5s, loads full history, **safe alongside a live PTY**.

  **Mini-plan (executing):**
  - `lib/cli/acp/AcpClient.ts` — spawn `copilot --acp` (direct binary via
    `CopilotProvider.findBinary`, bypass Agency), JSON-RPC over stdio; `initialize` →
    `loadSession` → `prompt` (collect streamed text) → `dispose`; timeout + kill;
    auto-approve any `session/request_permission` defensively.
  - `lib/cli/acp/captureQuery.ts` — unified helper: if session is Copilot
    (`supportsAcp`) run via ACP, else fall back to `injectPrompt` (Claude PTY). Same
    `{success, content, lines}` return shape as PromptInjector so callers don't change.
  - Wire `SummaryService`, `HandoffService`, `OrchestratorService` through the helper.
    Claude keeps PromptInjector; orchestrator (currently Claude) uses fallback until it
    migrates to Copilot, then gets ACP for free.
  - Keep `PromptInjector` (Claude fallback + safety net). ACP is experimental → never
    the only path.

### Track C (old) — deferred infra
- **C3.** Windows orphan reaping (OrphanReaper returns [] on Windows).

### Copilot context-usage bar (investigated 2026-07-08)

The context % bar is blank for Copilot (`parseContextUsage` returns null) but works
for Claude. **Findings:**
- Copilot emits **no context %** in its TUI text stream, so the Claude-style
  text-parse approach can't work.
- `~/.copilot/session-store.db` → `assistant_usage_events.input_tokens` is the
  **running context total** (grows each turn — it's the full context sent to the
  model). Latest turn's `input_tokens` = current context size.
- The **`sqlite3` CLI is available** (`/usr/bin/sqlite3`); `-readonly` reads are
  WAL-safe (works while Copilot writes) and fast (~12ms). Avoids a native SQLite dep.
- Copilot runs a **~1M context** window (long_context tier; TUI footer "1M context").

**Plan (implementing):**
- **Ctx-1:** `CliProvider.getContextUsage(sessionId): Promise<number|null>`. Copilot
  reads the latest `input_tokens` via `sqlite3 -readonly` (async `execFile`, UUID-
  validated, graceful null on any failure incl. Windows/no-sqlite3) and computes
  `input_tokens / windowForModel` (default 1,000,000). Claude returns null (keeps its
  text `parseContextUsage`).
- **Ctx-2:** in `PtyManager`, on a Copilot busy→ready transition, fire-and-forget
  `getContextUsage(id)` and emit `onContextUpdate` (non-blocking). Flip
  `supportsContextTracking=true` for Copilot.
- **Ctx-3:** `ContextBar` already renders when `usage !== null` — no UI change needed.

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
