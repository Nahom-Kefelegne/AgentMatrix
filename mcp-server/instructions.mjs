export const AGENTMATRIX_MCP_INSTRUCTIONS = `
AgentMatrix provides UI tools for coordinating this managed coding session.

Availability:
- AgentMatrix tools are configured to load eagerly in managed Copilot sessions.
- If a client still defers them, search within the agentmatrix server using the exact tool name (for example, present_code or request_decision).
- Never use a server-name-only tool search to decide that AgentMatrix is unavailable; that lookup can return an empty result even while every tool is registered.

Status:
- Call request_decision when a blocking question has 2-6 concrete choices. It marks the session as needing attention. After the call, provide one concise text fallback and stop until the user responds.
- Call request_attention before freeform clarification, approval, or blocking input that cannot be expressed as structured choices. Do not call request_attention in addition to request_decision.
- Call work_complete as the final action after completing the user's task.

Preferred Context Canvas tools:
- present_code: Show an exact verified repository file/range when seeing it materially helps the user understand a result. Markdown renders as a document with Source available.
- present_locations: Show several exact verified locations when callers, implementations, references, or candidates should be compared. Supply locations already discovered; never guess.
- present_changes: Show the meaningful session-attributed change set when edits are ready for inspection or the user asks what changed. Prefer this over opening each edited file.
- present_validation: Show test/build/lint/check results only after they actually ran. Never infer or fabricate status.
- update_plan: Update the retained session plan only at meaningful phase changes, not after every tool call.
- present_runtime_evidence: Show concise observed logs, errors, or requests when they prove or disprove something important. Never include secrets.
- present_browser_preview: Preview a known running loopback web app when visual inspection helps. Never guess that a server is available.

Anticipation:
- Proactively present evidence when it removes the user's likely next navigation, comparison, review, or copy/paste step.
- Good triggers include: a root cause best explained by one code range; several meaningful locations; edits ready for review; completed validation; a meaningful plan phase change; or runtime evidence that resolves a hypothesis.
- Prefer one primary Canvas presentation per turn unless the user explicitly asks for several.
- Canvas supports your explanation; it does not replace it. Always include a concise text fallback.

Do not present:
- Routine internal file reads, grep results, or exploratory tool calls.
- Every file you edit.
- Speculative paths, locations, validation outcomes, runtime evidence, or server URLs.
- A design document already auto-previewed from a successful docs/design change.
- The same content repeatedly after AgentMatrix reports it queued, pinned, or accepted.

Safety and presentation:
- Paths must be repository-relative POSIX paths. Never pass absolute paths, drive letters, UNC paths, or parent traversal.
- Context Canvas previews preserve terminal focus and never grant additional write, shell, Git, or filesystem permissions.
- The model never chooses another session, arbitrary HTML, Canvas layout, or focus policy.
- Typed tools may be accepted before their dedicated renderer is connected. Never claim the user saw a component unless AgentMatrix reports current Canvas delivery; use the terminal fallback.

Compatibility:
- open_file, reveal_range, open_diff, and open_review remain available temporarily.
- Prefer present_code, present_locations, and present_changes for new work.
- Repository and symbol search are disabled. Investigate with normal coding tools, then use present_locations for exact verified results when comparison helps the user.
`.trim();
