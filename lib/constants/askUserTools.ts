/**
 * Copilot's built-in "ask the user a question" tool is `AskUserQuestion`; a few
 * likely MCP-server aliases are included so an interactive question reliably
 * surfaces on the dashboard as "needs you" (attention) rather than "working".
 *
 * Shared by the tool-use hook (sets attention when such a tool starts) and the
 * tool-complete hook (which must NOT clear attention when one of these tools
 * "completes" — Copilot fires PostToolUse immediately, before the user answers).
 */
export const ASK_USER_TOOLS = new Set<string>([
  'AskUserQuestion',
  'askUserQuestion',
  'ask_user',
  'askQuestion',
]);

/** Best-effort pull of the question text from an ask-user tool's input. */
export function extractQuestion(input: unknown): string {
  const ti = (input || {}) as Record<string, unknown>;
  const first = Array.isArray(ti.questions) ? (ti.questions[0] as Record<string, unknown> | undefined) : undefined;
  const q = ti.question ?? ti.prompt ?? ti.message ?? first?.question ?? first?.prompt;
  const text = typeof q === 'string' && q.trim() ? q.trim() : 'Waiting for your answer';
  return text.slice(0, 120);
}
