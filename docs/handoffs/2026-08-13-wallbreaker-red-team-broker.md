# Claude handoff: Wallbreaker red-team broker

## Verbatim user messages

The following user messages are the source intent for this task and must remain
verbatim in any downstream handoff.

```text
no lets offer all tools from wallbreakser to all agents under agent matrix, so for example an orchestrator can ask a different agent to do something and rather than the agent re asking and going back and forth with the orchestrator it can use the context and .md files that are shared amongst them to make a call weather or not to use the wallbreaker tools but it should be readily available

ok lets build that, hand that task off to claude
```

## Agreed implementation boundary

Implement the brokered, authorization-gated Red Team capability described below.
Every managed agent can read red-team evidence and request a run using shared
task context. Only an isolated Wallbreaker worker may invoke Wallbreaker itself.
Do not expose Wallbreaker attack-generation, obfuscation, or guardrail-evasion
MCP tools directly to ordinary coding agents or add them to their MCP configs.

The policy/authorization decision must not depend solely on LLM interpretation
of shared Markdown or task context. Make it deterministic and auditable.

## Verified local environment

- AgentMatrix repository: `C:\Users\YeabA\Documents\Agent matrix\AgentMatrix`
- Wallbreaker repository: `C:\Users\YeabA\wallbreaker`
- Runnable interpreter: `C:\Users\YeabA\wallbreaker\.venv\Scripts\python.exe`
- `python -m wallbreaker --help` succeeds with that interpreter.
- Wallbreaker supports `check`, `report`, `export`, and baseline comparison.
- Its default `RunLog` output is the relative `sessions/` directory; do not
  silently mix those artifacts with the project workspace.

## Required design constraints

- Keep this separate from `CliProvider`; Wallbreaker is not a managed coding
  CLI session and must not be added as a `CliType`.
- Provide clear, distinct readiness and rejection reasons: unavailable
  executable, invalid configuration, unauthorized target, and denied or failed
  run. Never replace absent input with a plausible default.
- Use a Windows-spawnable executable path. Any PATH lookup must go through
  `pickSpawnableBinary()`; do not select the first `where` result.
- Use argument arrays, not shell strings. Do not surface credentials in logs,
  UI, task data, or handoffs.
- Store results as immutable, private AgentMatrix evidence associated with the
  requesting task/session and its explicit authorization record. Show summary
  metadata before raw artifacts.
- Preserve exact user wording above in any further agent handoff.
- Follow `AGENTS.md` fully, including pure failure-path tests colocated with
  the code under test.

## Deliverable

Implement the smallest usable AgentMatrix MVP: configuration/readiness checks,
a request-and-authorization policy boundary, an isolated runner interface, and
structured evidence import/reporting. Include tests and report changed files,
verification performed, and remaining integration gaps.
