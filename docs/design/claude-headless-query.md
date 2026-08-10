# Design note: a headless out-of-band query path for Claude

**Status:** proposal — seeking a decision before implementation.
**Scope:** `lib/cli/CliProvider.ts`, `lib/cli/ClaudeProvider.ts`, `lib/cli/acp/captureQuery.ts`.

## The gap

Four user-facing features run out-of-band prompts through one chokepoint,
`captureQuery()`:

| Feature | Call site |
|---|---|
| Work summaries | `electron/services/SummaryService.ts:29` |
| Context handoff | `electron/services/HandoffService.ts:39` |
| Deep session search | `OrchestratorService.ts:179` → `terminalBridge.ts:790` |
| Task assignment | same orchestrator path |

Copilot takes ACP (`copilot --acp --stdio`): structured, streamed, invisible to
the user's terminal. Claude has `supportsAcp = false`, so it falls through to
`electron/pty/PromptInjector.ts`, which:

1. types the prompt into the **live PTY**, where the user can see it;
2. asks the agent to write its answer to a file;
3. polls the filesystem for that file (45s timeout, 2s interval).

It is slow, it visibly hijacks the terminal, and when prompt detection misfires
it fails silently — `{ success: false, content: '', lines: [] }` with no
diagnosis. All four features degrade together.

Claude has no ACP and is not going to grow one. But it does have a headless
mode that provides the same capability by a different mechanism:

```
claude -p "<prompt>" --output-format json --resume <session-id>
```

## The question this note is really about

Using it means running a second `claude` process against a session that is
**already live in a PTY**. Do the two fight over the transcript or a session
lock?

The answer determines whether the design is simple (direct `--resume`) or has
to be serialised — queued, PTY-paused, or routed through a single owning
process. So it was worth answering with an experiment rather than an argument.

## What was measured

A harness (`node-pty`) reproducing the app's conditions: interactive Claude in a
real PTY with a pinned `--session-id`, the same trust-prompt auto-accept the
app's watcher performs, then out-of-band headless queries against that same id.
A codeword is established in the live session; the headless query is asked to
retrieve it, which tests whether it genuinely sees live conversation history.

Environment: Claude Code 2.1.206, Windows 11, node-pty prebuilt.

### Results

**No session lock.** The headless query loads the session and reaches the API
while the PTY holds the same id. Uncontended 3633 ms vs contended 3579 ms — no
blocking, no waiting, no refusal.

**No fork.** `session_id` echoes back unchanged; it continues the same session
rather than branching.

**Coherent answers.** Both queries returned the codeword established in the live
session (`"ZEBRA-7741"`), confirming the headless process reads live history.

**No corruption, and — the important one — no clobber.** A live PTY loads the
transcript into memory at resume. If it rewrote from that stale copy, turns
appended by a headless query would vanish. It does not:

| Point in run | lines | bytes |
|---|---|---|
| after live turn 1 | 18 | 42,663 |
| **after headless query A** | **28** | 49,787 |
| **after live turn 2** | **34** | 54,447 |
| after headless query C | 48 | 65,303 |
| after live exit | 50 | 65,742 |

Monotonic throughout. The live TUI **appended on top of** the headless turns
(28 → 34) instead of overwriting them. `malformed=0, dupUuids=0` at every
snapshot; three simultaneous headless writers also produced zero malformed
lines and zero duplicate uuids. Appends are line-atomic.

**Invisible to the user.** The live PTY emitted 0 characters during the headless
query.

**Latency.** 11.7 s and 8.5 s once the prompt cache was warm, against
PromptInjector's 45 s timeout / 2 s poll.

### Caveats, stated plainly

- One earlier run saw the live PTY die with `0xC0000409`
  (`STATUS_STACK_BUFFER_OVERRUN`). It did **not** reproduce, and a related
  `conpty_console_list_agent` crash was observed independently in the same
  session, so it is attributed to node-pty/ConPTY in the harness rather than to
  contention. Flagged rather than buried.
- Single platform (Windows) and a single Claude Code version.
- Measured with short prompts and no tool use in the headless turn.

## Proposed design

Follow the existing capability-flag discipline — no branching on `cliType` at
call sites.

```ts
// CliProvider.ts, alongside supportsAcp
/** Can run an out-of-band prompt against an existing session without the PTY. */
readonly supportsHeadlessQuery: boolean;

/** Build argv for a one-shot headless query. Null when unsupported. */
buildHeadlessQueryArgs(opts: HeadlessQueryOptions): string[] | null;
```

- `ClaudeProvider`: `supportsHeadlessQuery = true`. **`supportsAcp` stays
  `false`** — Claude has no ACP, and a flag must describe the real capability.
- `CopilotProvider`: `supportsHeadlessQuery = false`; it has ACP.
- New `lib/cli/headless/HeadlessClient.ts`, mirroring `AcpClient`'s role:
  spawn, parse `--output-format json`, return the existing
  `{ success, content, lines }` shape so no caller changes.
- `captureQuery` gains one branch before the existing fallback:

```ts
if (provider.supportsAcp) { /* unchanged */ }
else if (provider.supportsHeadlessQuery) {
  const r = await runHeadless(...);
  if (r.success) return finish(r);
  console.warn('[headless] query failed, falling back to PromptInjector');
}
return finish(await injectPrompt(ptySession, instruction, opts));
```

The PromptInjector fallback stays, so a transient failure never kills a feature.

### Two implementation details worth pre-empting

- **stdin must be closed.** `claude -p` otherwise stalls ~3 s per call waiting
  for piped input ("no stdin data received in 3s"). Halved measured latency.
- **Windows binary resolution.** `findBinary()` must not hand `spawn` the
  extensionless npm shim — `CreateProcess` rejects it with error 193. Already
  fixed via `pickSpawnableBinary()`.

## Decisions I'd like from you

1. **Direct `--resume`, or `--fork-session`?** The evidence says direct is safe.
   But `--fork-session` also works headlessly, copies history, and leaves the
   original transcript byte-identical — at the cost of an orphan transcript per
   query. Direct means AgentMatrix's internal summary/handoff prompts become
   part of the user's visible conversation and consume their context window.
   PromptInjector has that same side effect today, so direct is not a
   regression — but fork is strictly cleaner if the orphan files are acceptable.
   **This is a maintainer call, not a technical blocker.**
2. **Should the flag be `supportsHeadlessQuery`, or something more general?** If
   a future provider has both ACP and a headless mode, `captureQuery` will want
   a preference order rather than an if/else ladder.
3. **Is the PromptInjector fallback still wanted** for Claude once this lands,
   or should a headless failure surface as a real error? Silent fallback is how
   the current failure mode became invisible.

## Testing

The repo had no test infrastructure. Vitest is now set up (`npm test`), and the
unit-testable seams here — argv building, JSON result parsing, the
`captureQuery` branch matrix per provider — are straightforward to cover.

What unit tests will **not** cover is the concurrency behaviour above; that
needs live-CLI integration tests, which are slow, need auth, and cost tokens per
run. Recommend a separately-tagged suite rather than part of the default run.
