# Copilot-First Refactor — Implementation Design

**Status:** Historical plan; Phase 0 + selective Phase 1 have landed (see `copilot-refactor-overview.md`, `cli-provider-architecture.md`, and `state-storage-layout.md` for current implementation details).
**Owners:** TBD
**Last Updated:** 2026-05-14
**Supersedes (in part):** `docs/design/multi-cli-support.md` (high-level architecture remains valid; this doc replaces the SDK section since `@github/copilot-sdk` won't support ACP and `@anthropic-ai/claude-agent-sdk` is unavailable to users — see [Architecture Decisions](#architecture-decisions))

---

## 1. Context

Agent Matrix shipped with a `CliProvider` abstraction that routes between Claude and Copilot CLIs. Auditing found the abstraction is **60% clean**: spawn args, prompt detection, model lists, and Agency wrapping all delegate properly to the provider. The other **40% leaks Claude assumptions**:

- All state files hardcoded to `~/.claude/` (settings, name cache, active sessions, tasks, ADO config)
- Session discovery only scans `~/.claude/projects/`
- MCP system prompt only injected for Claude
- `parseContextUsage()` returns `null` for Copilot
- Status never explicitly transitions back to `idle` after `ToolComplete` (visible bug for Copilot: sprites stuck "working")
- Several UI components show Claude-only options regardless of CLI

The result: Copilot kind of works, but the experience is bumpy and key features (resume, context tracking, MCP attention hooks) silently degrade.

Beyond fixing parity, **Copilot offers capabilities Claude cannot match**: ACP protocol (programmatic JSON-RPC), `/fleet` parallel subagents, tool-level permissions, plan/autopilot modes, mid-session model switching, custom agents, plugin marketplace. The goal of this refactor is to fully leverage those.

---

## 2. Goals & Non-Goals

### Goals
- **Compatibility parity**: Copilot sessions resume, track context, fire hooks, display correctly
- **Architectural cleanup**: capability flags on `CliProvider`, state paths use `provider.configDir`, dead code removed
- **ACP integration**: replace `PromptInjector` for Copilot programmatic tasks (summary, handoff, deep search, task assign)
- **Copilot-unique features**: tool-level permissions UI, plan/autopilot mode toggle, `/fleet` view, model swap mid-session
- **Zero disruption to Claude users**: every change is additive or feature-flagged; Claude path unchanged

### Non-Goals
- Replacing Claude with Copilot
- Full ACP-only mode for Copilot in this milestone (phased — see [Phase A.2](#phase-a2--acp-only-copilot-future-default))
- Cross-CLI handoff (Claude → Copilot context transfer) — separate effort
- Claude ACP support — no upstream server exists

---

## 3. Architecture Decisions

### 3.1 Single `CliProvider` interface, expanded with capability flags

The existing interface stays. We **add** methods rather than refactor what's there. New additions:

```typescript
interface CliProvider {
  // ... existing ...

  // Capability flags — UI/code branches on these
  readonly supportsMcp: boolean;
  readonly supportsFork: boolean;
  readonly supportsContextTracking: boolean;
  readonly supportsSubagents: boolean;
  readonly supportsAcp: boolean;

  // Session discovery (provider-specific)
  discoverSessions(filter?: { cwd?: string }): Promise<SessionInfo[]>;
  findSessionCwd(sessionId: string): string | undefined;
  parseTranscript?(transcriptPath: string): TranscriptMeta;

  // Process detection (returns session IDs running for this CLI)
  detectActiveSessionIds(): string[];

  // Prompt patterns (replaces hardcoded keywords in main.ts auto-resume)
  getTrustPromptPatterns(): string[];
  getContextPromptPatterns(): string[];

  // Permission mode UI metadata
  getPermissionModes(): Array<{ value: string; label: string; description: string }>;

  // Resume command (for UI "Copy resume command" buttons)
  buildResumeShellCommand(sessionId: string, cwd?: string): string;
}
```

### 3.2 Sibling `CliTransport` abstraction for ACP (Phase C+)

ACP is fundamentally not PTY — no TTY rows/cols, no shell args, no buffer replay. Rather than forcing it into `CliProvider`, we add a **sibling** abstraction:

```typescript
// Implemented as lib/cli/acp/AcpClient.ts for one-shot captureQuery() calls.
class AcpClient {
  start(): Promise<AcpSessionId>;
  resume(sessionId: AcpSessionId): Promise<void>;
  prompt(text: string, attachments?: ContentBlock[]): Promise<AcpStopReason>;
  cancel(): void;
  setMode(modeId: string): Promise<void>;
  dispose(): Promise<void>;
}

// One-shot helper for programmatic tasks
function runHeadlessAcpPrompt(opts): Promise<{ text; stopReason }>;
```

`CopilotProvider` (PTY) and `AcpClient` (ACP) coexist. The current implementation uses ACP for out-of-band `captureQuery()` calls rather than exposing a separate "Use ACP (preview)" session toggle. Claude has no ACP — `Provider.supportsAcp = false`.

### 3.3 State storage migration

All `agentmatrix-*` files move from `~/.claude/` to `~/.agentmatrix/` (CLI-neutral):

```
~/.agentmatrix/
├── settings.json           (was ~/.claude/agentmatrix-settings.json)
├── tasks.json              (was ~/.claude/agentmatrix-tasks.json)
├── names.json              (was ~/.claude/agentmatrix-names.json)
├── active-sessions.json    (was ~/.claude/agentmatrix-active-sessions.json)
├── ado.json                (was ~/.claude/agentmatrix-ado.json)
├── orchestrator.json       (was ~/.claude/agentmatrix-orchestrator.json)
├── reviews/                (was ~/.claude/agentmatrix-review-*.md)
├── tasks/                  (was ~/.claude/agentmatrix-task-*.md)
├── handoffs/               (was ~/.claude/agentmatrix-handoff-*.md)
└── output/                 (was ~/.claude/agentmatrix-output-*.txt)
```

**Migration:** On first startup after this change, detect old paths under `~/.claude/agentmatrix-*` and move them. Keep one-shot migrator for two releases, then drop.

### 3.4 Hooks remain canonical for cross-CLI events

Hooks already use the same `/api/hooks/*` endpoints for both CLIs. We keep them as the authoritative event source for:
- `SubagentStop` (the only way to track `/fleet` subagent lifecycle — ACP doesn't expose this)
- `SessionStart` / `SessionEnd`
- Any CLI run outside Agent Matrix that wants to feed events

When a session has both hooks AND an ACP connection, **ACP wins for that session** (no double-counting). Hook handler checks `if (acpRegistry.has(sessionId)) return 200;`.

### 3.5 ACP scope: programmatic tasks first, UI later

Three-phase ACP rollout:

| Phase | Scope | User-visible |
|---|---|---|
| **C.1** | `PromptInjector` → ACP for Copilot summary/handoff/task-assign/deep-search | None (faster, more reliable) |
| **A.1** | "Structured View" tab in SessionDialog (opt-in, separate session from PTY) | New UI |
| **A.2** | New Copilot sessions default to ACP-only, no PTY | Major UX change |

**Never do "Option B"** — running PTY + ACP for the **same** Copilot session means two separate Copilot processes with diverging conversation history. Wasteful and confusing.

---

## 4. Phased Implementation Plan

### Phase 0: Compatibility blockers (Week 1 — ~3-4 PRs)

Make Copilot actually work end-to-end at parity with Claude on PTY.

| # | Task | Files | Effort |
|---|---|---|---|
| 0.1 | Capture Copilot session ID from first hook payload | `app/api/hooks/session-start/route.ts`, `lib/state/activeSessionsCache.ts`, `lib/state/sessionStore.ts` | S |
| 0.2 | Move `agentmatrix-*` state files to `~/.agentmatrix/` with one-shot migration | All `lib/state/*.ts`, API routes writing temp files | M |
| 0.3 | Add capability flags to `CliProvider` interface; implement in both providers | `lib/cli/CliProvider.ts`, `ClaudeProvider.ts`, `CopilotProvider.ts` | S |
| 0.4 | Multi-CLI session discovery — `provider.discoverSessions()` + scan both dirs in `/api/sessions/list` and `/api/sessions/resolve` | `app/api/sessions/list/route.ts`, `app/api/sessions/resolve/route.ts`, `lib/state/sessionScanner.ts`, `electron/pty/PtyManager.findSessionCwd()` | M |
| 0.5 | Process detection — `provider.detectActiveSessionIds()`; replace `grep claude` everywhere | `lib/state/sessionScanner.ts`, `OrphanReaper.ts` (already partial) | S |
| 0.6 | Conditional MCP injection — only if `provider.supportsMcp` | `electron/pty/PtyManager.spawnNew()` line 296 | S |
| 0.7 | Status returns to `idle` after `ToolComplete` for sessions without active agents | `app/api/hooks/tool-complete/route.ts` | XS |
| 0.8 | Spawn API uses provider, not hardcoded `claude` | `app/api/sessions/spawn/route.ts` | S |
| 0.9 | Implement `CopilotProvider.parseContextUsage()` (research output format first) | `lib/cli/CopilotProvider.ts` | M |
| 0.10 | Trust/context prompt patterns moved to provider | `electron/main.ts` lines 203-218, `electron/terminalBridge.ts watchForTrustPrompt`, `lib/cli/*Provider.ts` | S |

**Verification:**
- Spawn Copilot session → appears in dashboard with correct CLI badge
- Use a tool → "working" → idle (no stuck working state)
- Quit app → orphan reaper kills both Claude and Copilot zombies
- Restart → both Claude and Copilot sessions auto-resume cleanly
- Resume modal shows Copilot sessions
- Trust prompt auto-accepts for Copilot

### Phase 1: UI polish (Week 2 — ~3-4 PRs)

Every screen becomes CLI-aware. No more hardcoded Claude options.

| # | Task | Files | Effort |
|---|---|---|---|
| 1.1 | SpawnModal: hide Claude-only fields when Copilot selected; show Copilot-only fields | `app/components/SpawnModal.tsx` | M |
| 1.2 | SpawnModal: use `provider.getModelList()` and `provider.getPermissionModes()` | `SpawnModal.tsx` | S |
| 1.3 | Use Copilot's native `--name` flag instead of `nameCache.json` for Copilot | `CopilotProvider.buildSpawnArgs`, terminalBridge spawn flow | S |
| 1.4 | AppSettingsModal: CLI selector dropdown, per-CLI defaults, per-CLI system prompt | `app/components/AppSettingsModal.tsx`, `lib/state/appSettings.ts` | M |
| 1.5 | Kill hardcoded `claude --resume` strings; use `provider.buildResumeShellCommand()` | `ResumeModal.tsx`, `SidePanel.tsx`, `SessionDialog.tsx`, `/api/sessions/restart/route.ts`, `/api/sessions/resume-cmd/route.ts` | S |
| 1.6 | TaskBoard "Sync with Claude" → "Sync"; rename function/parameter | `TaskBoard.tsx` | XS |
| 1.7 | HandoffModal: CLI-aware permission modes and model list | `HandoffModal.tsx` | S |
| 1.8 | Dashboard cards/Office sprites: distinct CLI badges (already partial — finish it) | `DashboardView.tsx`, `OfficeCanvas.tsx` | S |
| 1.9 | Page title / metadata neutral wording | `app/layout.tsx` | XS |

**Verification:**
- Switch CLI in SpawnModal — model dropdown, permission modes, and advanced fields all change
- AppSettings has separate defaults for Claude vs Copilot
- Copy resume command from any UI → uses correct CLI binary
- Cards/sprites visually distinguish Claude vs Copilot at a glance

### Phase 2: ACP integration (Weeks 3-4 — ~3 PRs)

**Phase C.1 from the ACP audit** — kill the `PromptInjector` hack for Copilot programmatic tasks.

| # | Task | Files | Effort |
|---|---|---|---|
| 2.1 | Add `@agentclientprotocol/sdk` dependency | `package.json` | XS |
| 2.2 | New module `lib/cli/acp/`: `AcpClient.ts`, `captureQuery.ts` | New files | L |
| 2.3 | Health probe: try `copilot --acp` + `initialize`; surface in Settings | `app/api/cli/health/route.ts`, `AppSettingsModal.tsx` | S |
| 2.4 | App setting: `copilotAcpEnabled` (default `false`) | `lib/state/appSettings.ts`, `AppSettingsModal.tsx` | XS |
| 2.5 | `PromptInjector` gains ACP branch for Copilot when flag enabled; falls back to PTY injection on any ACP error | `electron/pty/PromptInjector.ts` | M |
| 2.6 | `SummaryService`, `HandoffService`, task-assign route, deep-search orchestrator: use ACP path when available | `electron/services/*.ts`, `app/api/app-tasks/assign/route.ts` | M |
| 2.7 | Telemetry: log ACP vs PTY latency, error rate | New `lib/telemetry.ts` (lightweight) | S |

**Verification:**
- Toggle ACP setting on → summary generation drops from ~10s to <1s
- Force an ACP error → automatic fallback to PTY injection, no user-visible failure
- Telemetry shows latency improvement; error rate ≤ PTY baseline

### Phase 3: Copilot superpowers (Weeks 5-7 — ~4 PRs)

The features Claude can't match. These are the demo-worthy wins.

| # | Task | Files | Effort |
|---|---|---|---|
| 3.1 | Tool-level permission UI in SpawnModal: Allow/Deny columns, per-tool checkboxes, URL allowlist, pre-built templates | `SpawnModal.tsx`, `CopilotProvider.buildSpawnArgs` | L |
| 3.2 | Mode toggle in SessionDialog footer: Interactive / Plan / Autopilot. Plan mode opens "Plan Review" panel with editable checklist | `SessionDialog.tsx`, new `PlanReview.tsx`, ACP mode support | L |
| 3.3 | Mid-session model swap: footer dropdown sends `/model <name>` via ACP | `SessionDialog.tsx` | S |
| 3.4 | preToolUse hook returns JSON for guardrails (deny / modify args) | New `app/api/copilot/pre-tool-use/route.ts`, `setup.sh`/`.ps1` hook config update | M |
| 3.5 | `/fleet` view: parse ACP `tool_call.title` heuristically + `SubagentStop` hooks to render parallel agent tree in SessionDialog | New `FleetView.tsx`, hook payload parsing | L |

**Verification:**
- Spawn Copilot session with "Read-only" permission template — tools that write/exec are denied at runtime
- Switch from Interactive → Plan mid-session — UI shows editable plan
- `/fleet` invocation shows live tree of subagents in SessionDialog

### Phase A.1: Structured View (opt-in, Week 8+ — 2-3 PRs)

A second tab in SessionDialog that renders ACP events as rich UI (messages, collapsible tool calls, plan steps, mode badges) — **without** xterm.js. Spawned as a separate ACP session that mirrors the user's prompts. Clearly labeled "Mirror view (separate session)" to avoid confusion.

**Skip Phase A.2 (ACP-only Copilot) until A.1 is in production for 2+ release cycles.** See [Risks](#risks).

### Phase 3+ Extensions (future)

| Feature | Priority | Effort |
|---|---|---|
| Custom Agents Library UI (`.copilot/agents/*.agent.md`) | P1 | L |
| MCP Server Management UI (`~/.copilot/mcp-config.json`) | P1 | M |
| Share button (`/share`, `/share-gist`) | P2 | S |
| `/chronicle` daily standup widget | P2 | M |
| Plugin Marketplace UI | P2 | L |
| `--remote` mobile steering | P3 | S |
| Multi-directory sessions (`--add-dir`) | P3 | S |
| `/init` onboarding prompt | P3 | XS |

---

## 5. File-by-File Change Map

Grouped by phase. **Bold = new file.**

### Phase 0 (compatibility)

| File | Change |
|---|---|
| `lib/cli/CliProvider.ts` | Add 8 capability/method signatures |
| `lib/cli/ClaudeProvider.ts` | Implement new methods (most are existing logic, just lifted to interface) |
| `lib/cli/CopilotProvider.ts` | Implement new methods including `parseContextUsage` |
| `lib/state/appSettings.ts` | Move from `~/.claude/agentmatrix-settings.json` to `~/.agentmatrix/settings.json` |
| `lib/state/nameCache.ts` | Move file path |
| `lib/state/activeSessionsCache.ts` | Move file path |
| `lib/state/appTaskStore.ts` | Move file path |
| `lib/state/adoConfig.ts` | Move file path |
| `lib/state/sessionScanner.ts` | Use `provider.detectActiveSessionIds()`, `provider.discoverSessions()` |
| `electron/pty/PtyManager.ts` | Guard MCP injection on `provider.supportsMcp` (line 296), use `provider.findSessionCwd()` (line 122) |
| `electron/main.ts` | Use `provider.getTrustPromptPatterns()` and `getContextPromptPatterns()` (lines 203-218) |
| `electron/terminalBridge.ts watchForTrustPrompt` | Use provider patterns |
| `electron/services/OrchestratorService.ts` | Accept `cliType` parameter (currently always Claude); ship as Claude-default with override |
| `electron/services/HandoffService.ts` | Move handoff file path to `~/.agentmatrix/handoffs/` |
| `electron/pty/PromptInjector.ts` | Move output path to `~/.agentmatrix/output/` |
| `app/api/hooks/session-start/route.ts` | Detect Copilot session ID format; populate cache if Copilot |
| `app/api/hooks/tool-complete/route.ts` | Reset status to `idle` if no active agents |
| `app/api/sessions/list/route.ts` | Scan both `~/.claude/projects/` and `~/.copilot/session-state/` |
| `app/api/sessions/resolve/route.ts` | Multi-CLI lookup |
| `app/api/sessions/spawn/route.ts` | Use `provider.findBinary()` instead of hardcoded `claude` |
| `app/api/sessions/restart/route.ts` | Use provider |
| `app/api/sessions/resume-cmd/route.ts` | Use provider |
| `app/api/sessions/review/route.ts` | Move review file path |
| `app/api/app-tasks/assign/route.ts` | Move task file path; tell agent to read from `~/.agentmatrix/tasks/` |
| **`lib/state/migrateStateStorage.ts`** | One-shot migrator: move old `~/.claude/agentmatrix-*` to `~/.agentmatrix/` |
| `electron/main.ts startup` | Run `migrateStateStorage()` once on first launch after this change |

### Phase 1 (UI polish)

| File | Change |
|---|---|
| `app/components/SpawnModal.tsx` | Use `provider.getModelList()`, `getPermissionModes()`; conditional fields; native `--name` for Copilot |
| `app/components/AppSettingsModal.tsx` | CLI selector, per-CLI defaults, per-CLI system prompt |
| `lib/state/appSettings.ts` | Schema: `claudeDefaults` / `copilotDefaults` |
| `app/components/ResumeModal.tsx` | Use `provider.buildResumeShellCommand()` for copy buttons; scan both CLI dirs in deep search |
| `app/components/SidePanel.tsx` | Same |
| `app/components/SessionDialog.tsx` | Footer resume command + cleanup hardcoded strings; CLI badge |
| `app/components/TaskBoard.tsx` | "Sync with Claude" → "Sync"; rename `handleSyncClaude` → `handleSync`, etc. |
| `app/components/HandoffModal.tsx` | CLI-aware mode/model lists |
| `app/components/DashboardView.tsx` | Finish CLI badge distinction |
| `app/components/OfficeCanvas.tsx` | Sprite variant or overlay per CLI |
| `app/layout.tsx` | Description: "Real-time visualization of CLI agent sessions" |

### Phase 2 (ACP)

| File | Change |
|---|---|
| **`lib/cli/acp/types.ts`** | `AcpEvent`, `AcpToolCall`, `AcpPlanStep`, `AcpPermissionRequest`, `AcpSpawnOptions` |
| **`lib/cli/acp/AcpClient.ts`** | Class wrapping `copilot --acp --allow-all` |
| **`lib/cli/acp/runHeadlessAcpPrompt.ts`** | One-shot helper for SummaryService / handoff / task-assign |
| **`lib/cli/acp/index.ts`** | Registry: sessionId → connection |
| `package.json` | Add `@agentclientprotocol/sdk` |
| `electron/pty/PromptInjector.ts` | Branch: ACP first, PTY fallback |
| `electron/services/SummaryService.ts` | ACP path |
| `electron/services/HandoffService.ts` | ACP path |
| `electron/services/OrchestratorService.ts` | New sibling `AcpOrchestratorService` for Copilot deep search |
| `app/api/cli/health/route.ts` | ACP probe |
| `app/components/AppSettingsModal.tsx` | `copilotAcpEnabled` toggle |
| **`lib/telemetry.ts`** | Light-weight log: ACP/PTY usage, latency, errors |

### Phase 3 (superpowers)

| File | Change |
|---|---|
| `app/components/SpawnModal.tsx` | Permission tab: Allow/Deny columns, templates, URL allowlist |
| `lib/cli/CopilotProvider.ts` | `buildSpawnArgs` consumes structured permission spec → emits `--allow-tool=...` / `--deny-tool=...` |
| `app/components/SessionDialog.tsx` | Mode toggle (Interactive/Plan/Autopilot), model swap dropdown |
| **`app/components/PlanReview.tsx`** | Editable plan steps with checkboxes |
| **`app/components/FleetView.tsx`** | Subagent DAG / list view |
| **`app/api/copilot/pre-tool-use/route.ts`** | Returns structured JSON for guardrail decisions |
| `setup.sh`, `setup.ps1`, `update.sh`, `update.ps1` | Add `preToolUse` HTTP hook for guardrails |

---

## 6. Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Copilot ACP is public preview; schema changes break us | High | Med | Pin SDK version, feature-flag off by default, fall back to PTY on `-32601`/`-32004` |
| Copilot's session ID extraction from hook payload misses early hooks (race) | Med | Med | Watch first 5s of PTY output too as backup; surface "Detecting session..." in UI |
| State migration moves a file in use → data loss | Low | High | Atomic copy then delete; idempotent (re-run safely); back up old files for one release |
| `/fleet` subagents invisible over ACP | Certain | Med | Keep `SubagentStop` hook; render flat list when on ACP |
| Two parallel sessions (PTY + ACP for Mirror View) diverge | High | High | Mirror View labeled clearly; don't ship A.2 until A.1 has 2+ release cycles of clean data |
| Dual provider system (PTY + ACP) drifts | Med | Med | Type-strict interface; integration tests covering both |
| Custom MCP servers in `mcpServers[]` fail silently | Med | Low | Validate via no-op tool ping after `session/new` |
| `agency copilot --acp` stdio piping broken | Low | Med | Probe in health check; document non-Agency fallback |
| Hook payload field differences between CLIs (`session_id` vs `sessionId`) | Low | Low | Normalize at handler entry; both already use snake_case via PascalCase event names |
| User has Copilot installed but not authenticated → spawn fails opaquely | Med | Low | Detect via health probe; show "Run `gh auth login`" guidance in SpawnModal |
| Phase 2 increases startup time (extra Copilot ACP process per programmatic task) | Low | Low | Lazy-spawn on first use; cache one ACP orchestrator per CLI type |

---

## 7. Verification & Testing

### Per-phase smoke tests

Phase 0:
- Spawn → use → resume cycle works for both CLIs
- Force-quit Electron → restart → no orphan zombies, both CLIs auto-resume cleanly
- Resume modal lists sessions from both CLI directories
- Trust prompt auto-accepts for Copilot
- Status correctly returns to `idle` for Copilot sessions after tool completion

Phase 1:
- SpawnModal field changes are reactive to CLI selection
- AppSettings persists per-CLI defaults across restart
- "Copy resume command" produces correct binary in all locations

Phase 2:
- ACP health probe returns `installed: true` when `copilot --acp` is available
- Summary generation latency < 2s (vs 10s+ PTY baseline)
- ACP error → automatic PTY fallback; no user-visible error
- Telemetry shows expected latency reduction

Phase 3:
- Tool-level permissions enforce at runtime (e.g., `--deny-tool=Bash` actually blocks Bash invocations)
- Mode toggle reflects in Copilot's behavior (Plan mode produces structured plan)
- `/fleet` invocation populates FleetView with subagent state

### Cross-CLI compatibility matrix

A `docs/testing/cli-compatibility.md` table to track which features work for which CLI:

| Feature | Claude PTY | Copilot PTY | Copilot ACP |
|---|---|---|---|
| Spawn | ✅ | ✅ | (Phase A.2) |
| Resume | ✅ | ✅ | (Phase A.2) |
| Hooks | ✅ | ✅ | N/A (ACP events used) |
| File change tracking | ✅ | ✅ | ✅ |
| Context % | ✅ | (Phase 0.9) | ✅ |
| Subagent tracking | ✅ | (hooks) | (hooks fallback) |
| Code review | ✅ | (Phase 0) | ✅ |
| Handoff | ✅ | (Phase 0) | ✅ |
| Summary | ✅ | (Phase 0) | ✅ (faster) |
| Deep search | ✅ | (Phase 0) | ✅ (faster) |
| Plan mode UI | N/A | (Phase 3) | (Phase 3) |
| `/fleet` UI | N/A | (Phase 3) | (Phase 3, limited) |
| Mid-session model swap | N/A | N/A | (Phase 3) |

---

## 8. Open Questions

These need answers before or during Phase 0:

1. **Copilot session ID capture timing.** Does Copilot's first hook fire before or after the user can type? If after, we have a window where the session has no ID in our cache. Mitigation: watch first 5s of PTY output for any ID-like UUID.
2. **Copilot context usage format.** What does Copilot print in the TUI for context usage? Needs live capture. Worst case: hide the context bar for Copilot until ACP is enabled (where we get it via events).
3. **Trust prompt text in latest Copilot version.** Current detection assumes "Do you trust the files in this folder". Has it changed?
4. **`gh auth` propagation when Copilot spawned via `agency`.** Does Agency preserve `GH_TOKEN`? Verify in health probe.
5. **Should orchestrator be CLI-aware or stay Claude-only?** Recommendation: stay Claude-only for now (Claude is faster for orchestration tasks). Revisit if Claude users hit rate limits.
6. **Migration path for existing `~/.claude/agentmatrix-*` files.** When to delete old files: immediately after copy? After two releases? Choose based on user trust.
7. **Does Copilot need a `--name` flag pass-through or do we use `/rename` after spawn?** `--name` is cleaner; verify both work.

---

## 9. Rollout Order (recommended)

```
Week 1 — Phase 0 (compatibility)
   ↳ 3-4 PRs; each verifiable independently
   ↳ Ship behind no flag — these are bug fixes, ship them

Week 2 — Phase 1 (UI polish)
   ↳ 3-4 PRs; cosmetic but high-impact
   ↳ Ship behind no flag

Week 3-4 — Phase 2 (ACP integration C.1)
   ↳ 3 PRs; gated behind `copilotAcpEnabled` (default OFF)
   ↳ Dogfood with team for 1 release before considering default ON

Week 5-7 — Phase 3 (Copilot superpowers)
   ↳ 4 PRs; some require ACP (permissions, modes), some don't (FleetView from hooks)
   ↳ Permission UI gated behind a `granularPermissionsBeta` flag

Week 8+ — Phase A.1 (Structured View)
   ↳ 2-3 PRs; opt-in tab; only enabled if ACP works

Future — Phase A.2 (ACP-only Copilot)
   ↳ Only after A.1 has 2+ release cycles of clean data
```

---

## 10. Success Criteria

This refactor is **done** when:

- ✅ A new Copilot session spawned in Agent Matrix has feature parity with Claude (resume, context %, hooks, file tracking, code review, handoff, summary)
- ✅ State storage no longer leaks Claude assumptions (everything in `~/.agentmatrix/`)
- ✅ SpawnModal, AppSettings, ResumeModal, HandoffModal, TaskBoard fully CLI-aware
- ✅ ACP enabled improves Copilot summary/handoff latency by ≥ 5x
- ✅ At least 3 demo-worthy Copilot-only features shipped (tool-level perms, plan mode, FleetView)
- ✅ Zero regressions for existing Claude users (tested by 1-week shadow run before merge)
