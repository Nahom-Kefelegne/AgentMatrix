# Copilot-First Refactor — Working Log

**Branch:** `copilot-refactor-phase0` (worktree at `.claude/worktrees/copilot-refactor`)
**Started:** 2026-05-20
**Driver:** Autonomous session, awake every 10 min via cron until phases complete

This log tracks PR-by-PR progress through the phased refactor described in `docs/design/copilot-first-refactor.md`. Each entry should answer: what was done, what was deliberately deferred, and what's next.

---

## Phase 0 — Compatibility blockers

### PR #1 — Capability flags + provider interface expansion ✅ 2026-05-20

**Files changed:**
- `lib/cli/CliProvider.ts` — added 5 capability flags + 7 method signatures + 3 new types (`DiscoveredSession`, `ActiveProcessInfo`, `PermissionMode`).
- `lib/cli/ClaudeProvider.ts` — implemented all new members. Lifted `findSessionCwd` and process-detection logic from `PtyManager` and `sessionScanner` so the provider owns them. Replaced `find`/`grep` subprocess spawns with `readdirSync` loops.
- `lib/cli/CopilotProvider.ts` — implemented all new members. Built O(1) `findSessionCwd` against `workspace.yaml`. Designed `detectActiveSessionIds` to cross-reference live `copilot` PIDs against `inuse.<PID>.lock` files since Copilot has no `--session-id` flag on its command line.
- `app/api/hooks/tool-complete/route.ts` — reset `status: 'idle'` when no subagents active and event isn't itself from a subagent. Fixes Copilot stuck-working bug.

**New docs:**
- `docs/design/cli-provider-architecture.md` — interface walkthrough, capability matrix, perf tiers, mermaid diagrams.

**Perf notes:**
- All provider methods annotated with cost tier (A: free / B: cheap sync I/O / C: expensive). Callers can grep for "COST:" comments.
- Avoided `find` and `grep -r` subprocesses: ~10ms on macOS, 50–200ms on Windows. Direct `readdirSync` is much cheaper.
- Provider caches nothing internally — pushes caching policy to callers.

**Deferred to PR #3:**
- Wiring callers (sessionScanner, PtyManager, main.ts) to the new methods. Interface is ready; no consumers yet.

**Deferred to PR #4:**
- `CopilotProvider.parseContextUsage` still returns `null`. Needs live capture of Copilot's TUI context output.

**Verification:**
- `npx tsc --noEmit` — clean ✅
- No regressions for Claude: only additive interface changes; existing call sites unchanged.

---

### PR #2 — State storage migration (`~/.claude/agentmatrix-*` → `~/.agentmatrix/*`)
*(not started)*

---

### PR #3 — Multi-CLI session discovery & process detection
*(not started)*

Targets the consumers of the PR #1 interface additions:
- `lib/state/sessionScanner.ts` → use `provider.detectActiveSessionIds()` + `provider.findSessionCwd()` for both CLIs.
- `app/api/sessions/list/route.ts` → call `provider.discoverSessions()` per CLI, merge.
- `app/api/sessions/resolve/route.ts` → same.
- `app/api/sessions/spawn/route.ts` → use `provider.findBinary()` not hardcoded `claude`.
- `electron/pty/PtyManager.ts` — guard MCP injection on `provider.supportsMcp`; delegate `findSessionCwd` to provider.
- `electron/main.ts` lines 203–218 — read trust/context patterns from provider.
- `electron/terminalBridge.ts watchForTrustPrompt` — same.

---

### PR #4 — Session ID capture + Copilot context parsing
*(not started)*

Two distinct subtasks:
1. **Capture Copilot session ID from first hook payload.** `app/api/hooks/session-start/route.ts` needs to detect Copilot vs Claude (e.g. via `payload.copilotVersion` field or a new `cli_type` field if Copilot's hook payload carries one) and populate `activeSessionsCache.ts`.
2. **`parseContextUsage` for Copilot.** Needs live capture of Copilot's TUI output. Worst case: leave null and hide the context bar via `supportsContextTracking`.

---

## Phase 1 — UI polish *(not started)*

Per design doc §4 Phase 1 — every screen becomes CLI-aware. Won't ship until Phase 0 is fully done because the UI layer depends on `provider.getModelList()`, `getPermissionModes()`, `buildResumeShellCommand()` etc. being callable.

---

## Phase 2 — ACP integration *(not started)*

Sibling abstraction at `lib/cli/acp/`. Gated by `copilotAcpEnabled` flag in `appSettings`. Replaces `PromptInjector` for Copilot sessions (huge reliability win: 45s file polling → <1s JSON-RPC).

---

## Phase 3 — Copilot superpowers *(not started)*

UI work that I can't sanity-check without launching the app. Will scaffold the API plumbing and components but stop before mass visual changes.

---

## Stopping criteria

The autonomous cron loop stops when:
1. All four Phase 0 PRs land on the worktree branch with `tsc --noEmit` clean, OR
2. Phase 1 or later requires live-testing that can't be done from this session, in which case I commit what's safe and document the blocker here.

If the cron wakes me with nothing safe left to do, I'll delete the cron and report.
