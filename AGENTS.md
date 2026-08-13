# AGENTS.md — engineering standards for AgentMatrix

**This file is the single source of truth for every agent working in this repo**, whichever CLI
it runs as. `AGENTS.md` is the only instruction filename that Copilot CLI, Kimi Code, and Codex
all discover natively; `CLAUDE.md` points here so Claude Code picks up the same rules.

Edit this file to change the rules. Do not duplicate them elsewhere.

---

## 1. Provider architecture

- **Never branch on `cliType` at a call site.** Add a capability flag or a method to
  `CliProvider` and ask the provider. Branching spreads per-CLI knowledge into code that
  shouldn't have it, and it is how a new provider silently inherits another's behaviour.
- **A capability flag describes a real, verified capability — never an aspiration.** If a CLI has
  no ACP, `supportsAcp` is `false`, even if support is planned. A flag that lies produces a
  runtime failure far from its cause.
- When you add a provider, `CliType` is only the start. The full blast radius is: `lib/cli/index.ts`
  (three `CliType[]` arrays), `lib/cli/uiMetadata.ts` (model + permission tables and the
  exhaustive switches), `lib/state/orchestratorProvider.ts`, `lib/dispatch/WorkPacket.ts`
  (`DISPATCHABLE_PROVIDERS` has a compile-time drift guard), `SpawnModal.tsx` (`SELECTABLE_CLIS`),
  `CliIcon.tsx`, `SessionDialog.tsx`, and `terminalBridge.ts` (`validCliType`).
- **Prefer exhaustive `switch` over `x === 'copilot' ? … : …`.** With three or more providers a
  binary ternary silently hands the newcomer another CLI's tables. `tsc` will not catch it.

## 2. Never fail silently

This codebase's characteristic bug is a feature that degrades to nothing without saying so — a
`{ success: false, content: '', lines: [] }` with no reason. Several real outages traced to it.

- Return **why** something failed, not just that it did. Per-candidate rejection reasons beat a
  bare null.
- Distinguish "not installed" from "not capable" from "not permitted". Collapsing them makes logs
  useless.
- A missing input must be **visible**. Never substitute a plausible stand-in for absent data.
- If you catch an error, either handle it or log it. A bare `catch {}` around a spawn is how
  Deep Session Search was dead for every Claude-only user without a single error message.

## 3. Verbatim user intent

The user's original ask must reach every downstream agent **byte-for-byte**. It must never pass
through a model, be summarised, trimmed, or reflowed. An LLM paraphrase of an ask preserves a
misunderstanding perfectly and compounds it at each hop. See `lib/dispatch/handoffBundle.ts`.

## 4. Verify against reality, not documentation

- Claims about a CLI's flags, paths, or formats must be checked against the **actual binary** or
  its shipped source. Where that isn't possible, mark it `UNVERIFIED:` in a comment naming the
  gap and degrade safely (`null` / `[]` / `false`).
- Do not report a fix as working because a unit test passes. Several bugs here were only visible
  end-to-end — notably an ordering race where a transcript was read before the step that creates
  it.
- When a diagnostic tool you just wrote disagrees with the filesystem, suspect the tool.

## 5. Windows correctness

This is a primary target, not an afterthought. Real bugs shipped here:

- **Binary resolution:** `where <cmd>` lists the extensionless npm shim first; `CreateProcess`
  cannot execute it (error 193). Always resolve through `pickSpawnableBinary()`.
- **Encoding:** `.ps1` files must be UTF-8 **with BOM**. Without it PowerShell 5.1 reads them as
  CP1252, and a UTF-8 em dash becomes a smart quote that silently terminates a string.
- **Native args:** never pass a multi-line script to a native command as an argument — PowerShell
  does not escape embedded quotes. Write a temp file and pass its path, then check the exit code.
- **Reserved names:** `<dir>\nul` always resolves to the NUL device. Never create or read one.

## 6. Tests

- `npm test` runs vitest. Colocate `*.test.ts` next to the source.
- Keep the logic under test **pure**: inject availability probes and already-read data rather
  than touching `fs`, `child_process`, or electron. `resolveOrchestratorProvider` is the pattern.
- Modules under `lib/dispatch/` and `lib/cli/uiMetadata.ts` are imported by client bundles and
  must not pull in Node built-ins. Type-only imports are fine.
- Cover the failure paths, not just the happy one.

## 7. Comments

Explain **why**, not what. Record the evidence behind a non-obvious choice — the observed
behaviour, the measured number, the flag you verified. A comment saying a decision is unverified
is more valuable than one that sounds confident. See `CliProvider.ts` for the house style.
