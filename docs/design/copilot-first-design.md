# Copilot-First Design Recommendation

**Status:** Opinionated. Based on the empirical findings in `cli-primitives-compendium.md` and the lifecycle audit in `session-lifecycle-audit.md`.
**Date:** 2026-06-09. Context: Claude Code access ending soon; Copilot must reach feature parity with Claude (and surpass it where Copilot's primitives are richer).

This doc says **what to build, what to drop, and what to lean on.** Not a design exercise — concrete decisions with file:line targets where applicable.

---

## 1. The new mental model

Before this audit we thought of Copilot as "Claude minus a few things." That was wrong. The actual shape:

```mermaid
mindmap
  root((CLI Primitives))
    Claude wins
      Structured headless (--json, --stream-json)
      Agent SDK
      Mature path/permission grammar
      Auto mode classifier
      Memory subsystem
    Both
      --session-id deterministic IDs
      --continue / --resume
      Hooks (Copilot reads .claude/settings.json)
      MCP
      CLAUDE.md / AGENTS.md
      Plan mode
    Copilot wins
      ACP (loadSession + MCP + images)
      Per-session SQLite (todos, inbox, research)
      13 hook events (vs 9) including permissionRequest, errorOccurred, postToolUseFailure, preCompact
      --remote cross-device steering
      Plugin marketplace + SDK
      Built-in -n NAME naming
      --resume by name/prefix/task-id
      /chronicle local history insights
      /pr, /research, /diagnose
      Inter-session messaging via inbox_entries
```

Copilot's surface is **larger** than Claude's in several places. The job is to (a) stop fighting Copilot's primitives with our own workarounds and (b) expose Copilot's wins in our UI.

---

## 2. Three principles for the design

### P1. Trust the CLI for what it already does well.
Stop building workarounds for problems the CLI already solves:
- Use `-n <name>` instead of nameCache for Copilot
- Use `/session rename` instead of mutating nameCache directly
- Use `/cd` for cwd persistence (it persists across resume in 1.0.65+)
- Use `--session-id=<uuid>` for deterministic IDs (yes, it works)
- Use ACP for structured streams instead of PTY scraping

### P2. Surface what's already there.
We have a UI shell. The features below already exist server-side and just need a button:
- `/chronicle standup` → daily card
- `/share` → export button
- `/session checkpoints` → restore-point dropdown
- `/remote on` → settings toggle
- `/diagnose` → debug action
- `/pr auto` → PR status with CI watch
- `inbox_entries` → cross-session message viewer

### P3. ACP as the privileged transport for programmatic flows.
Copilot's headless mode is text-only. Anywhere we need structured data (summary, deep search, task assignment, handoff), use ACP instead. Bypass Agency for the ACP path (Agency breaks it).

---

## 3. The phased plan

### Phase 0 — Stop the bleeding (this week)

These are short fixes that directly address the resume/exit problems from the lifecycle audit AND the wrong assumptions in our current code. Each is its own PR.

| # | Change | File(s) | Risk | Time |
|---|---|---|---|---|
| 0.1 | `process.on('SIGINT'/'SIGTERM')` handlers — call gracefulShutdown | `electron/main.ts` | very low | 30m |
| 0.2 | Pass `--session-id=<uuid>` for Copilot spawns | `lib/cli/CopilotProvider.ts:buildSpawnArgs` | very low | 10m |
| 0.3 | Pass `-n <name>` for Copilot spawns; drop nameCache mutation for Copilot | `CopilotProvider.buildSpawnArgs`, `terminalBridge.ts` spawn path | low | 1h |
| 0.4 | Remove unobserved hook events from Copilot config (`Stop`, `SubagentStart`, `SubagentStop`); add `userPromptSubmitted`, `permissionRequest`, `errorOccurred`, `postToolUseFailure`, `preCompact` | `setup.sh`, `setup.ps1`, `update.sh`, `update.ps1` + handlers | low | 1h |
| 0.5 | OrphanReaper: clean Copilot's `inuse.*.lock` files after killing PIDs; sync-wait between SIGTERM and SIGKILL | `electron/services/OrphanReaper.ts` | low | 30m |
| 0.6 | Agency stagger: 1500ms between auto-resume spawns when `useAgency` | `electron/main.ts` auto-resume loop | low | 15m |
| 0.7 | Pass `--no-default-mcps` to Agency for non-ADO cwds | `electron/pty/PtyManager.spawnPty` | low | 30m |
| 0.8 | Make `terminal:resume` idempotent (Set of onData subscribers); client debounce | `electron/terminalBridge.ts`, `electron/pty/PtyManager.ts`, `app/components/TerminalPanel.tsx` | medium | 2h |
| 0.9 | Update `MEMORY.md` with corrections from the compendium | `MEMORY.md` | n/a | 10m |

Total: ~6 hours of clean work that closes most of the live bugs.

### Phase 1 — Adopt Copilot's primitives (next week)

| # | Change | File(s) | Effort |
|---|---|---|---|
| 1.1 | Use ACP for `PromptInjector` when cliType is Copilot (handoff, summary, task-assign, deep-search) | new `lib/cli/acp/`, `electron/pty/PromptInjector.ts` branches | M |
| 1.2 | Bypass Agency for ACP path | `electron/pty/PtyManager.ts` | S |
| 1.3 | Read Copilot's per-session `session.db` directly; surface `inbox_entries` as inter-session message thread in session dialog | new `lib/copilot/sessionDb.ts`, `SessionDialog.tsx` | M |
| 1.4 | Query `~/.copilot/session-store.db` directly for resume search (faster than walking session-state dirs) | `CopilotProvider.discoverSessions` | S |
| 1.5 | Wire `permissionRequest` hook to a centralized AM approval modal | `app/api/hooks/permission-request/route.ts`, `app/components/PermissionModal.tsx` | M |
| 1.6 | Wire `errorOccurred` + `postToolUseFailure` hooks to session error analytics | new analytics surface | S |
| 1.7 | Wire `preCompact` hook to warn user "session is about to compact" | session status banner | XS |

### Phase 2 — Surface Copilot-only superpowers (week after)

| # | Feature | UI surface | Effort |
|---|---|---|---|
| 2.1 | `/chronicle standup` daily card on dashboard | new component | M |
| 2.2 | `/share` and `/share-gist` buttons in session dialog | SessionDialog action | XS |
| 2.3 | `/session checkpoints` restore-point dropdown | SessionDialog | S |
| 2.4 | `/init` "set up AGENTS.md" toggle in SpawnModal | SpawnModal | XS |
| 2.5 | `/remote on/off` toggle in Settings + remote-session indicator on cards | AppSettingsModal, DashboardView | S |
| 2.6 | `/pr auto` PR status widget per session | SessionDialog | M |
| 2.7 | `/usage` per-session token-cost widget | DashboardView | S |
| 2.8 | `/diff` integration replacing ChangesViewer for Copilot | SessionDialog | M |
| 2.9 | `/diagnose` debug action | SessionDialog | XS |
| 2.10 | Plugin marketplace browser ([@copilot-plugins](https://github.com/orgs/copilot-plugins/repositories), awesome-copilot) | new tab | L |

### Phase 3 — Hide Claude-only UI for Copilot sessions

| # | Change | UI surface |
|---|---|---|
| 3.1 | Hide "fork session" button when cliType=Copilot (until `/fork` exits experimental) | SessionDialog |
| 3.2 | Hide "context %" bar when cliType=Copilot (until `parseContextUsage` is wired) | SessionDialog |
| 3.3 | Hide "auto mode" option for Copilot | SpawnModal |
| 3.4 | Hide "path-scoped rules" UI for Copilot | (none today) |

### Phase 4 — Claude harvest (before access ends)

This is what to grab while we still have it. Each item is a doc/code capture, not a deploy.

| # | What | Why | Where |
|---|---|---|---|
| 4.1 | Capture transcript format reference for all 13 Claude event types | so we can keep parsing existing Claude transcripts after the rebrand | `docs/reference/claude-transcript-schema.md` |
| 4.2 | Capture Claude hook payload schemas, ordering, exit-code semantics | so behavior is documented after access lapses | `docs/reference/claude-hooks-schema.md` |
| 4.3 | Snapshot Claude headless `--output-format json` schema | for the niche flows we still use Claude for | `docs/reference/claude-headless-schema.md` |
| 4.4 | Document Claude permission grammar (compound commands, glob/wildcard rules, protected paths) | for porting concepts to Copilot's grammar | `docs/reference/claude-permissions-grammar.md` |
| 4.5 | Document auto memory (MEMORY.md) loading behavior | informs whether to port the concept | `docs/reference/claude-memory.md` |

---

## 4. Specific code decisions (with rationale)

### 4.1 Adopt Copilot `--session-id` immediately

**Why:** Our `MEMORY.md` says "Copilot sessions don't have --session-id" — that's outdated. Track 1's empirical probe confirmed it works on 1.0.66-2. The Agency-wrapped probe confirmed Agency forwards user-provided `--session-id` without overriding. So we can use deterministic IDs end-to-end.

**Change:**
```ts
// lib/cli/CopilotProvider.ts — buildSpawnArgs
buildSpawnArgs(opts: SpawnOptions): string[] {
  const args: string[] = [];
  if (opts.sessionId) args.push('--session-id', opts.sessionId);  // NEW
  if (opts.name)      args.push('-n', opts.name);                  // NEW
  if (opts.permissionMode === 'bypassPermissions') args.push('--allow-all');
  // ... rest unchanged
}
```

**Impact:**
- Resolves the open bug "Starting Copilot session with Agency opens Claude instead, can't find session ID"
- AM tracks the same UUID Copilot uses; hook payloads match the store key
- Session resume by exact UUID becomes deterministic

### 4.2 Drop unsupported hooks from Copilot config; add the ones we missed

**Why:** Empirical probe of 1,391 hook events found zero `Stop`/`SubagentStart`/`SubagentStop` fires. They're likely PascalCase Claude names that Copilot's matcher doesn't normalize for those specific events. Meanwhile `userPromptSubmitted`, `permissionRequest`, `postToolUseFailure`, `errorOccurred`, `preCompact` ARE supported and we're not subscribing.

**Change:** Rewrite the Copilot hook config in `setup.sh` / `setup.ps1` / `update.sh` / `update.ps1`:

```json
{
  "version": 1,
  "hooks": {
    "SessionStart":  [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-start", "timeoutSec": 2 }],
    "SessionEnd":    [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-end",   "timeoutSec": 2 }],
    "UserPromptSubmit":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/user-prompt-submit", "timeoutSec": 2 }],
    "PreToolUse":    [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-use",      "timeoutSec": 2 }],
    "PostToolUse":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-complete", "timeoutSec": 2 }],
    "PostToolUseFailure": [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-failure", "timeoutSec": 2 }],
    "PermissionRequest":  [{ "type": "http", "url": "http://localhost:3000/api/hooks/permission-request", "timeoutSec": 2 }],
    "ErrorOccurred": [{ "type": "http", "url": "http://localhost:3000/api/hooks/error",         "timeoutSec": 2 }],
    "PreCompact":    [{ "type": "http", "url": "http://localhost:3000/api/hooks/pre-compact",   "timeoutSec": 2 }],
    "SubagentStart": [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-start",   "timeoutSec": 2 }],
    "SubagentStop":  [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-stop",    "timeoutSec": 2 }],
    "Stop":          [{ "type": "http", "url": "http://localhost:3000/api/hooks/stop",          "timeoutSec": 2 }]
  }
}
```

(Kept `Stop` / `SubagentStart` / `SubagentStop` since the docs claim they're supported — flag for empirical verification, not removal.)

Add new handlers under `app/api/hooks/{user-prompt-submit,tool-failure,permission-request,error,pre-compact}/route.ts`.

### 4.3 Migrate `PromptInjector` to ACP for Copilot

**Why:** Today's `PromptInjector` writes a prompt telling the CLI "write your output to file X" then polls X for up to 45s. ACP gives us structured request/response in <1s with no file polling. Track 1 confirmed Copilot's ACP exposes `loadSession: true`, MCP HTTP/SSE, image/embeddedContext prompts, session list.

**Caveat:** ACP must bypass Agency (Agency-Copilot ACP crashes). So the ACP path means:
1. Spawn `~/.copilot-cli/<ver>/copilot --acp` directly
2. JSON-RPC over stdio
3. `initialize` → `session/load <existing-uuid>` or `session/new`
4. `session/prompt` with the task
5. Stream `session/update` (agent_message_chunk + tool_call notifications)

**Module layout:**
```
lib/cli/acp/
├── types.ts            # AcpEvent, AcpToolCall, AcpPlanStep, AcpPermissionRequest, AcpSpawnOptions
├── AcpClient.ts             # class wrapping `copilot --acp --allow-all`
├── runHeadlessAcpPrompt.ts  # one-shot helper for SummaryService / handoff / task-assign / orchestrator
└── index.ts            # registry: sessionId → connection
```

**Where it lights up:**
- `electron/services/SummaryService.ts` — use ACP when cliType=Copilot
- `electron/services/HandoffService.ts` — same
- `electron/services/OrchestratorService.ts` — new sibling `CopilotAcpOrchestratorService` for Copilot deep search
- `app/api/app-tasks/assign/route.ts` — same

**Risk:** ACP is EXPERIMENTAL. Open issues #845 (some tools bypass approval) and #989 (wrong tool IDs in permission requests) are real. Mitigate by:
- Feature flag `copilotAcpEnabled` defaults true once Phase 1 lands; users can disable via Settings
- Always fall back to PTY-based `PromptInjector` on ACP error
- Surface ACP errors prominently so we can file them upstream

### 4.4 Surface `inbox_entries` from Copilot's per-session SQLite

**Why:** Copilot has built-in inter-session messaging that `/fleet` and `/sidekicks` use. We can read it directly. This is something Claude has no equivalent for and it's a real differentiator.

**Module layout:**
```
lib/copilot/sessionDb.ts
  openSessionDb(sessionId): Database
  getInboxEntries(sessionId, opts?): InboxEntry[]
  getTodos(sessionId): Todo[]
  getResearchFindings(sessionId): Research[]
```

Read-only access. Use `better-sqlite3` (already a transitive dep via Next.js? if not, vendor it). The schemas are documented in the compendium.

**UI:**
- New "Messages" tab in `SessionDialog` for Copilot sessions
- Tooltip-style hover on session sprite shows unread count badge
- Click to read a message marks `read_at` (or use `/inbox` slash command — TBD)

### 4.5 Make resume search query `session-store.db`

**Why:** Today `CopilotProvider.discoverSessions` walks every dir under `~/.copilot/session-state/` reading workspace.yaml. The global `session-store.db` already has the same data indexed and FTS5-searchable.

**Change:**
```ts
// lib/cli/CopilotProvider.ts
discoverSessions(): DiscoveredSession[] {
  return openSessionStoreDb()
    .prepare('SELECT id, cwd, repository, summary, updated_at FROM sessions ORDER BY updated_at DESC')
    .all()
    .map(row => ({
      id: row.id,
      cwd: row.cwd,
      name: row.summary || `Session-${row.id.slice(0, 8)}`,
      lastModified: new Date(row.updated_at).getTime(),
    }));
}
```

Add full-text search variant for global resume search:
```ts
discoverSessionsByText(query: string): DiscoveredSession[] {
  return db.prepare(`
    SELECT s.id, s.cwd, s.summary, s.updated_at
    FROM search_index si JOIN sessions s ON si.session_id = s.id
    WHERE si.content MATCH ? ORDER BY s.updated_at DESC LIMIT 50
  `).all(query);
}
```

That replaces the orchestrator-based deep search for Copilot sessions, with much better perf and no LLM call.

### 4.6 ACP transport bypasses Agency

**Why:** Agency's `--session-id` injection conflicts with Copilot's `--acp` flag. Empirically confirmed code=1.

**Change:**
```ts
// electron/pty/PtyManager.spawnPty — when args contain --acp
const useAgencyForThis = useAgency && !args.includes('--acp');
if (useAgencyForThis) {
  // wrap with agency
} else {
  // direct copilot binary
}
```

Document the loss: ACP sessions don't get Bluebird MCP, don't get Agency telemetry, don't appear in Agency Hub. Acceptable trade-off for the ACP win.

### 4.7 Stagger Agency auto-resume

**Why:** Track 5 from the earlier lifecycle audit identified the 60s MCP-init storm as the cause of mass code=1. Adding `--no-default-mcps` for non-ADO cwds eliminates the cause for most sessions; staggering covers the rest.

**Change:**
```ts
// electron/main.ts auto-resume loop
const settings = getSettings();
const usingAgency = settings.useAgency;
const stagger = usingAgency ? 1500 : 0;

for (const [i, s] of cached.entries()) {
  try {
    /* existing spawnResume + handlers */
  } catch (err) { console.error('[auto-resume]', err); }
  if (stagger && i < cached.length - 1) {
    await new Promise(r => setTimeout(r, stagger));
  }
}
```

14 sessions × 1500ms = 21s total auto-resume. Acceptable — the dashboard renders progressively as each SessionStart arrives.

### 4.8 Pass `--no-default-mcps` when Bluebird isn't needed

**Why:** Track 2 from the Agency probe confirmed Bluebird auto-skips when no ADO org is configured (`mcp_config.rs:694`) but Agency still spawns the wrapper subprocess to check. With `--no-default-mcps` we skip the whole dance.

**Heuristic:** Pass `--no-default-mcps` unless the spawn cwd is inside a known ADO repo (we can detect this by checking if `~/.agentmatrix/ado.json` has the cwd as an `organization` member, or by checking for `.azdo-config` files).

For now, simpler: a Settings checkbox "Enable Agency MCPs (Bluebird, Workiq)" defaulting off. Users who need them can re-enable.

---

## 5. The kill-list — what to remove

In the spirit of "stop fighting the CLI":

| Remove | Replace with | Where |
|---|---|---|
| `nameCache` mutation for Copilot | `-n <name>` flag | `terminalBridge.ts` spawn paths |
| Custom cwd-tracking for Copilot resume | Trust Copilot's `/cd` persistence (1.0.65+) | `findSessionCwd` short-circuit |
| File-polling `PromptInjector` for Copilot | ACP `session/prompt` | `PromptInjector.ts` |
| Walking `~/.copilot/session-state/` for resume search | Query `session-store.db` | `CopilotProvider.discoverSessions` |
| Custom permission-prompt PTY scraping for Copilot | `permissionRequest` hook | new `permission-request/route.ts` |
| Hardcoded `Stop`/`SubagentStart`/`SubagentStop` Copilot hooks if empirically unsupported | Drop or rename per actual support | `setup.sh` etc. |

---

## 6. Quick-win PR order

The first commit could ship today and immediately improves things:

| PR | What | Risk | Impact |
|---|---|---|---|
| **A** (today) | Phase 0.1 SIGINT handlers + 0.5 reaper lock cleanup + 0.6 stagger + 0.7 `--no-default-mcps` | Low | Stops orphan accumulation, fixes mass code=1 |
| **B** | Phase 0.2 Copilot `--session-id` + 0.3 `-n` + 0.4 hook event corrections + 0.9 MEMORY update | Low | Fixes "can't find Copilot session ID", reduces hook config drift |
| **C** | Phase 0.8 idempotent `terminal:resume` | Medium | Fixes UI flicker, lost output during dialog flips |
| **D** | Phase 1.1 + 1.2 — ACP transport for Copilot (PromptInjector) | High | Order-of-magnitude reliability win for summary/handoff/task-assign |
| **E** | Phase 1.3 — `inbox_entries` Messages tab | Medium | New Copilot-only differentiator |
| **F** | Phase 1.4 — `session-store.db` resume search | Low | Faster resume modal for Copilot |
| **G** | Phase 1.5 — `permissionRequest` hook + AM modal | Medium | Replaces PTY-scraping for permissions |
| **H** | Phase 2.1–2.5 — `/chronicle`, `/share`, `/session checkpoints`, `/init`, `/remote` UI | Low | New surfaces |
| **I** | Phase 3 — Hide Claude-only UI for Copilot sessions | Low | Cleanup |
| **J** | Phase 4 — Claude reference docs harvest | n/a | Preservation before access lapses |

A through D buy us the new architecture. E through I are improvements. J is insurance.

---

## 7. Confidence checkpoints

This design is informed by empirical probes — but several things still need verification before committing the larger pieces:

| Question | How to settle | When |
|---|---|---|
| Does Copilot actually fire on `.claude/settings.json` hooks? | Add a unique URL to `~/.claude/settings.json` and watch | Before PR B |
| Are `Stop`/`SubagentStart`/`SubagentStop` truly unsupported by Copilot, or just unobserved? | Run a `/fleet` task with verbose hook logging | Before PR B |
| Does ACP `session/load` work for arbitrary existing UUIDs? | One-line probe via `@agentclientprotocol/sdk` | Before PR D |
| What does Copilot do with our `--no-default-mcps`? | Run an Agency-Copilot spawn with the flag, observe MCP subprocesses | Before PR A |
| Are `inbox_entries` actually populated in single-session use, or only in `/fleet`? | Inspect existing session.db files | Before PR E |

These are all small live-test things — none block PR A.

---

## 8. What this means for our existing branch (`copilot-refactor-phase0`)

The current branch has Phase 0 PRs #1–#4 from the prior plan plus the lifecycle audit doc. **Layered on top of that**, this new design says:

- PRs #1, #2, #3 from the prior plan are still good (provider interface, state migration, multi-CLI wiring)
- PR #4 (Copilot context parsing) is **moot** — use ACP context updates instead
- Phase 1 from the prior plan (UI polish via uiMetadata) is still good
- **The big new direction**: bypass Agency for ACP, surface inbox_entries, use session-store.db for search, switch PromptInjector to ACP

The lifecycle audit's fix-list (SIGINT handlers, lock-file cleanup, stagger, idempotent resume) becomes **PR A** above. Same code changes, just renamed in the new plan.

---

## 9. Open product questions for the user

Things this design doesn't decide for you:

1. **ACP feature flag default** — should it be opt-in or opt-out for users when Phase 1 ships?
2. **Inbox messages tab vs. icon-only** — how prominently should we surface `inbox_entries`?
3. **Plugin marketplace** — do we want to be a distribution channel for Agent Matrix-curated Copilot plugins? Sizeable scope if yes.
4. **Claude session preservation** — when Claude access ends, do we want to keep showing old Claude sessions read-only, or hide them?
5. **Bluebird/Workiq default** — should "Enable Agency MCPs" default off (recommended for perf) or on (recommended for ADO-heavy users)?

---

## 10. Summary

We were building Copilot support against an outdated mental model. The compendium audit corrects that. This design picks:

- **Trust Copilot's CLI** for what it does well (naming, IDs, cwd persistence, hooks superset, ACP, marketplace)
- **Surface what's already there** (`/chronicle`, `/share`, `/session`, `/remote`, `inbox_entries`)
- **Use ACP as the privileged transport** for any programmatic flow (summary, handoff, task assign, orchestrator)
- **Bypass Agency where it gets in the way** (ACP path)
- **Stop the bleeding from the lifecycle bugs** with one short PR (SIGINT + lock cleanup + stagger + `--no-default-mcps`)
- **Harvest Claude reference docs** before access ends so we keep the knowledge

Total scope: ~3 weeks of focused work to land PRs A–G. The rest is incremental.
