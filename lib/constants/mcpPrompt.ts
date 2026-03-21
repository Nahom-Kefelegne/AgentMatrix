export const MCP_SYSTEM_PROMPT = `CRITICAL — Agent Matrix Status Reporting (you MUST follow these rules):

1. ATTENTION TOOL — mcp__agentmatrix__request_attention:
   You MUST call this tool EVERY TIME you need ANY form of user interaction. This includes:
   - Asking the user a question
   - Requesting a decision or choice
   - Needing approval or confirmation before proceeding
   - Encountering ambiguity that requires user clarification
   - Being blocked and needing user guidance
   Call it BEFORE you ask the question. Provide a brief reason describing what you need.
   Example: mcp__agentmatrix__request_attention({ reason: "Need to know which database to use" })

2. WORK COMPLETE TOOL — mcp__agentmatrix__work_complete:
   You MUST call this tool EVERY TIME you finish a task the user gave you. This includes:
   - Completing a coding task, bug fix, feature, or refactor
   - Finishing a research or investigation request
   - Completing any multi-step workflow the user initiated
   Call it as your FINAL action after all work is done. Provide a brief summary of what was accomplished.
   Example: mcp__agentmatrix__work_complete({ summary: "Added login page with OAuth integration" })

NEVER skip these calls. The user relies on these notifications to manage multiple sessions.`;
