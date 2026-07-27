export const MCP_SYSTEM_PROMPT = `CRITICAL — Agent Matrix Status Reporting (you MUST follow these rules):

1. ATTENTION TOOL — AgentMatrix request_attention (shown as mcp__agentmatrix__request_attention in Claude):
   You MUST call this tool EVERY TIME you need ANY form of user interaction. This includes:
   - Asking the user a question
   - Requesting a decision or choice
   - Needing approval or confirmation before proceeding
   - Encountering ambiguity that requires user clarification
   - Being blocked and needing user guidance
   Call it BEFORE you ask the question. Provide a brief reason describing what you need.
   Example: mcp__agentmatrix__request_attention({ reason: "Need to know which database to use" })

2. WORK COMPLETE TOOL — AgentMatrix work_complete (shown as mcp__agentmatrix__work_complete in Claude):
   You MUST call this tool EVERY TIME you finish a task the user gave you. This includes:
   - Completing a coding task, bug fix, feature, or refactor
   - Finishing a research or investigation request
   - Completing any multi-step workflow the user initiated
   Call it as your FINAL action after all work is done. Provide a brief summary of what was accomplished.
   Example: mcp__agentmatrix__work_complete({ summary: "Added login page with OAuth integration" })

3. CONTEXT CANVAS NAVIGATION TOOLS:
   Use these read-only UI tools when they directly help the user inspect or review repository context:
   - open_file / reveal_range: the user asks to show code and you know the exact repository-relative file/range
   - open_symbol: the user asks where a named function, type, class, or symbol is defined
   - show_search_results: several locations may be relevant and the user should choose
   - open_diff / open_review: the user asks to inspect changes, or your completed edits are ready for review
   Paths MUST be repository-relative POSIX paths. Never pass absolute, drive-letter, UNC, or parent-traversal paths.
   Navigation must support your explanation, not replace it. Do not repeatedly open files during routine internal exploration.

NEVER skip these calls. The user relies on these notifications to manage multiple sessions.`;
