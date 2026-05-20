# Copilot-First Refactor — Status & Handoff

**Date:** 2026-05-14
**Phase complete:** Investigation + Design
**Phase next:** Implementation (start with design doc Phase 0)

This is a context-priming doc for the next session to pick up the Copilot-first refactor work cleanly. It captures what's been done, the current state of the repo, and the agreed-upon plan.

---

## 1. What This Refactor Is

Make Agent Matrix work as well (or better) for GitHub Copilot CLI as it does for Claude Code. Currently Copilot kind of works but the experience is bumpy — session resume, context tracking, file paths, UI options, and several backend services silently degrade or fail for Copilot.

**The two-line summary of intent:**
> Currently Agent Matrix is Claude-first with Copilot bolted on. Refactor so it's CLI-first, with Copilot getting equal compatibility plus unique features Claude can't match (ACP protocol, `/fleet`, tool-level permissions, plan/autopilot modes, mid-session model swap).

---

## 2. Recent Work In This Conversation

Chronological list of commits leading up to this handoff:

| Commit | Description |
|---|---|
| `a541e76` | Orphan CLI process reaper on Electron startup — fixes 25GB memory leak + "broken transcript chain" issue |
| `5cbcead` | TerminalPanel resize rewrite + PtyManager.gracefulShutdown — kills the xterm "dimensions undefined" race |
| `713e484` | Setup scripts use silent-fail hooks (match update scripts) — Claude/Copilot CLI from terminal no longer hangs |
| `dcfe88c` | Add Copilot CLI hook setup to setup/update scripts |
| `b134098` | Fix Copilot hook event name: `AgentStop` → `Stop` (per docs) |
| `72a1713` | **Add Copilot-first refactor design doc** (this is the plan) |

All on `main`, all pushed to origin.

---

## 3. The Plan (One-Screen Summary)

Full plan: **`docs/design/copilot-first-refactor.md`** (read this first).

```
Phase 0 — Compatibility blockers   (Week 1, ~3-4 PRs, ship behind no flag)
  └─ Make Copilot actually work end-to-end at parity with Claude.

Phase 1 — UI polish                (Week 2, ~3-4 PRs, ship behind no flag)
  └─ Every screen becomes CLI-aware. No hardcoded Claude options.

Phase 2 — ACP integration (C.1)    (Week 3-4, ~3 PRs, gated by copilotAcpEnabled flag)
  └─ Replace PromptInjector for Copilot programmatic tasks
     (summary/handoff/task-assign/deep-search).
  └─ Massive reliability win: 45s file-polling → <1s structured RPC.

Phase 3 — Copilot superpowers      (Week 5-7, ~4 PRs)
  └─ Tool-level permission UI, plan/autopilot mode toggle,
     mid-session model swap, /fleet view, preToolUse guardrails.

Phase A.1 — Structured View        (Week 8+, opt-in)
  └─ New tab in SessionDialog rendering ACP events as rich UI
     (separate sidecar session from PTY).

Phase A.2 — ACP-only Copilot       (Future, opt-in, default OFF initially)
  └─ New Copilot sessions default to ACP-only (no PTY).
```

---

## 4. Key Architecture Decisions Already Made

1. **Single `CliProvider` interface, expanded** — don't refactor what's there; add capability flags (`supportsMcp`, `supportsFork`, `supportsContextTracking`, `supportsSubagents`, `supportsAcp`) and missing methods (`discoverSessions`, `findSessionCwd`, `detectActiveSessionIds`, `getTrustPromptPatterns`, `getContextPromptPatterns`, `getPermissionModes`, `buildResumeShellCommand`).

2. **Sibling `CliTransport` abstraction for ACP** — don't force ACP into PTY-shaped `CliProvider`. New module at `lib/cli/acp/`. The two coexist; `provider.supportsAcp` flag tells UI when ACP is available.

3. **State migration to `~/.agentmatrix/`** — all 10+ `agentmatrix-*` files move out of `~/.claude/`. One-shot migrator on first launch.

4. **Hooks stay canonical** for cross-CLI events. ACP wins for sessions that have an active ACP connection (no double-counting). Hook handler short-circuits if `acpRegistry.has(sessionId)`.

5. **Never dual-spawn (PTY + ACP for same session)** — they'd diverge with two separate Copilot processes, two conversation histories. Use one or the other per session.

6. **ACP rollout is phased, not big-bang** — replace `PromptInjector` first (huge reliability win, zero UX change), then optionally add Structured View tab, eventually default new sessions to ACP-only.

7. **Use `@agentclientprotocol/sdk`** (official from Zed), NOT `@github/copilot-sdk` (wontfix for ACP support per [github/copilot-sdk#377](https://github.com/github/copilot-sdk/issues/377)).

---

## 5. Where To Start: Phase 0 (Compatibility Blockers)

Phase 0 is **pure bug fixes**. No feature flags. Ships immediately. Gets Copilot to feature parity with Claude.

10 tasks, broken into ~3-4 PRs. Full list in design doc §4 (Phase 0 table).

### Recommended PR breakdown

**PR #1 — Capability flags + provider interface expansion (Tasks 0.3, 0.7)**
- Add 5 capability flags + 7 new method signatures to `CliProvider`
- Implement all in both `ClaudeProvider` and `CopilotProvider`
- Fix status-not-returning-to-idle bug in `tool-complete/route.ts`
- Lowest risk; lays foundation for the rest.

**PR #2 — State storage migration (Task 0.2)**
- Move all `agentmatrix-*` files from `~/.claude/` to `~/.agentmatrix/`
- One-shot migrator on app startup
- Update all `lib/state/*.ts` modules + relevant API routes
- Test migration is idempotent.

**PR #3 — Multi-CLI session discovery & process detection (Tasks 0.4, 0.5, 0.6, 0.8, 0.10)**
- Use `provider.discoverSessions()` in `/api/sessions/list` and `/api/sessions/resolve`
- Use `provider.detectActiveSessionIds()` in `sessionScanner.ts`
- Guard MCP injection on `provider.supportsMcp` in `PtyManager.spawnNew()` line 296
- `/api/sessions/spawn` uses `provider.findBinary()` instead of hardcoded `claude`
- Trust/context prompt patterns moved to provider

**PR #4 — Session ID capture + Copilot context parsing (Tasks 0.1, 0.9)**
- Capture Copilot session ID from first hook payload
- Research Copilot's context output format (live test); implement `CopilotProvider.parseContextUsage()`
- Fall back gracefully if Copilot doesn't print context

### Verification checklist for end of Phase 0

- [ ] Spawn Copilot session → appears in dashboard with correct CLI badge
- [ ] Use a tool in Copilot → status: idle → working → idle (no stuck "working")
- [ ] Quit app → restart → both Claude and Copilot zombies killed, both CLIs auto-resume cleanly
- [ ] Resume modal shows Copilot sessions
- [ ] Trust prompt auto-accepts for Copilot
- [ ] No regressions for Claude users (visual smoke test)

---

## 6. Investigation Artifacts (Reference Material)

These were generated by parallel Explore/research agents and informed the design doc. The doc summarizes their findings; if you need depth, the agents can be re-run.

| Topic | Key finding |
|---|---|
| **UI Claude-specific audit** | 13 components need CLI-awareness; ResumeModal can't see Copilot sessions; "Sync with Claude" hardcoded; 4+ API routes hardcode `--dangerously-skip-permissions` |
| **Backend Claude-specific audit** | 16 places with hardcoded `~/.claude/` paths; session-ID capture is BROKEN for Copilot (no `--session-id` flag support); MCP system prompt only goes to Claude |
| **Copilot superpower research** | 17 unique Copilot features ranked by impact; top 3 to build: `/fleet` UI, ACP integration, native `--name` flag |
| **CliProvider abstraction audit** | 60% clean, 40% leaks Claude. State layer is the worst offender. Interface needs 5 capability flags + 7 methods added. |
| **Session lifecycle map** | 10 stages traced with file:line refs. Critical bug found: `session.status` never explicitly returns to `idle` after `ToolComplete` (visible bug for Copilot). |
| **ACP integration feasibility** | Recommend Option D (phased C→A). Use `@agentclientprotocol/sdk`. `/fleet` subagent events are NOT exposed via ACP — keep `SubagentStop` hook for that. |

---

## 7. Open Questions To Resolve During Phase 0

(From the design doc, repeated here for visibility.)

1. **Copilot session ID capture timing.** Does Copilot's first hook fire before user can type? If after, there's a window with no ID. Mitigation: watch first 5s of PTY output for UUID.
2. **Copilot context usage format.** What does Copilot print in TUI for context? Needs live capture. Worst case: hide context bar until ACP enabled.
3. **Trust prompt text in latest Copilot.** Current detection assumes "Do you trust the files in this folder". Has it changed?
4. **`gh auth` propagation via Agency.** Does `agency copilot` preserve `GH_TOKEN`? Verify in health probe.
5. **Orchestrator: CLI-aware or stay Claude-only?** Recommendation: stay Claude-only for now. Revisit if Claude hits rate limits.
6. **Migration cleanup timing.** When to delete old `~/.claude/agentmatrix-*` files: immediately after copy? After two releases?
7. **`--name` flag vs `/rename` for Copilot.** `--name` is cleaner; verify both work.

---

## 8. Files You'll Touch In Phase 0

Quick reference. Full list with descriptions in design doc §5.

### Add (new files)
- `lib/state/migrateStateStorage.ts` — one-shot migrator

### Heavy modify
- `lib/cli/CliProvider.ts` — interface expansion
- `lib/cli/ClaudeProvider.ts` — implement new methods
- `lib/cli/CopilotProvider.ts` — implement new methods + `parseContextUsage`
- `lib/state/sessionScanner.ts` — use provider methods
- `electron/pty/PtyManager.ts` — guard MCP injection, use `provider.findSessionCwd()`
- `electron/main.ts` — use `provider.getTrustPromptPatterns()`
- `electron/terminalBridge.ts watchForTrustPrompt` — use provider patterns

### Light modify
- `lib/state/appSettings.ts`, `nameCache.ts`, `activeSessionsCache.ts`, `appTaskStore.ts`, `adoConfig.ts` — move file paths
- `electron/services/HandoffService.ts`, `OrchestratorService.ts` — move file paths / accept cliType
- `electron/pty/PromptInjector.ts` — move output path
- `app/api/hooks/session-start/route.ts` — Copilot session ID capture
- `app/api/hooks/tool-complete/route.ts` — fix status idle bug
- `app/api/sessions/list/route.ts`, `resolve/route.ts`, `spawn/route.ts`, `restart/route.ts`, `resume-cmd/route.ts`, `review/route.ts` — multi-CLI / provider use
- `app/api/app-tasks/assign/route.ts` — move task file path

---

## 9. How To Pick Up Next Session

1. **Read** `docs/design/copilot-first-refactor.md` (the plan)
2. **Read** this status doc (you are here)
3. **Confirm** with user which phase to start (default: Phase 0)
4. **Verify** current repo state: `git log -5 --oneline` should show `72a1713` as recent
5. **Start** Phase 0, PR #1 (capability flags + interface expansion)
6. **Optional warm-up:** check the 7 open questions, answer the ones you can without user input (e.g., test Copilot trust prompt text live)

---

## 10. Things The User Cares About (Soft Signals)

Worth keeping in mind:
- **No regressions for Claude users.** Phase 0/1 must ship without flags but also without breaking anyone.
- **Memory leaks are a sore spot.** The 25GB OOM was a real incident. Keep an eye on long-running session memory.
- **Distribution to testers is active.** Setup scripts (`setup.sh`, `setup.ps1`, `update.sh`, `update.ps1`, `start.sh`, `start.ps1`) are user-facing. Don't break them.
- **Agency on by default for some testers.** Whatever changes you make should work both with and without Agency.
- **The 18-day-old zombie Copilot process from April 16 is fixed** by the orphan reaper. Don't re-introduce that pattern.
- **Transcripts are sacred.** Multiple Claude processes writing to the same `.jsonl` corrupts the parent-UUID chain → "thousands of lines disappear." The orphan reaper prevents this; don't undo that.

---

## 11. Recent Bug Patterns Worth Remembering

- **xterm "Cannot read properties of undefined (reading 'dimensions')"** — race between disposal and async fit. Fixed by `disposed` flag + canceling debounce timer.
- **PTY hangs on Cmd+Q spam** — fixed by `gracefulShutdown` that races `/exit` against 5s timeout, then SIGKILL stragglers.
- **Hook hang when app down** — fixed by `--connect-timeout 1` + silent fail in all 4 setup scripts.
- **Copilot transcript chain breaks** — fixed by killing orphan processes on startup before auto-resume runs.

---

## 12. Quick Sanity Tests After Resuming

Before writing any code, run these to make sure the repo is healthy:

```bash
cd /Users/nkefelegne/Desktop/DEV/AgentMatrix
git status                    # should be clean (besides codespace-telemetry-debug.log)
git log -5 --oneline          # 72a1713 should be most recent
npx tsc --noEmit              # should compile clean
ls docs/design/               # should include copilot-first-refactor.md, multi-cli-support.md
ls docs/handoffs/             # should include THIS file
```

If `tsc` errors out, fix that first before adding new code.
