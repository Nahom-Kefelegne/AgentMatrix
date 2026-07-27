export const AGENTMATRIX_MCP_INSTRUCTIONS = `
AgentMatrix provides UI tools for coordinating this managed coding session.

Availability:
- AgentMatrix tools are configured to load eagerly in managed Copilot sessions.
- If a client still defers them, search within the agentmatrix server using the exact tool name (for example, open_file or open_symbol).
- Never use a server-name-only tool search to decide that AgentMatrix is unavailable; that lookup can return an empty result even while every tool is registered.

Status:
- Call request_attention before asking the user for a decision, clarification, approval, or other blocking input.
- Call work_complete as the final action after completing the user's task.

Context Canvas:
- Use open_file or reveal_range when the user asks to see code and you know the exact repository-relative file/range.
- Use open_symbol when the user asks where a named function, type, class, interface, or symbol is defined.
- Use show_search_results when multiple repository locations may be relevant and the user should choose.
- Use open_diff or open_review when the user asks to inspect changes or when your edits are ready for review.
- Paths must be repository-relative POSIX paths. Never pass absolute paths, drive letters, UNC paths, or parent traversal.
- Navigation supports your explanation; it does not replace it. Do not repeatedly open files during routine internal exploration.
- Context Canvas previews preserve terminal focus and never grant additional write, shell, Git, or filesystem permissions.
`.trim();
