import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyNavigationCapability } from '@/lib/navigation/rootRegistry';
import { getSession } from '@/lib/state/sessionStore';
import { getActiveSession } from '@/lib/state/activeSessionsCache';

export const runtime = 'nodejs';

/**
 * Agent-invokable handoff.
 *
 * Before this route existed, an agent that decided to delegate ("hand this to
 * Claude") had no way to make it happen — the `session:handoff` socket event was
 * fired only by the HandoffModal in the UI, so agents could narrate a handoff
 * but never trigger one. The `request_handoff` MCP tool posts here.
 *
 * Security model matches the navigation route: the SOURCE session is always the
 * authenticated caller (the session-id header, which the MCP process sets from
 * its own env — never a tool argument). An agent therefore can only hand off its
 * OWN session, never someone else's. A `sourceSessionId` in the body that
 * disagrees with the header is rejected rather than honoured.
 *
 * The handoff itself (summarize → spawn → inject) can take tens of seconds
 * because it captures a summary from the live source agent first. That is far
 * past the MCP client's request timeout, so this route STARTS the handoff and
 * returns 202 immediately with the handoff id; progress is broadcast on the
 * `session:handoff-status` socket event, exactly as the UI path reports it.
 */

const VALID_CLI = new Set(['claude', 'copilot', 'kimi', 'codex']);

type HandoffTrigger = (data: {
  sourceSessionId: string;
  contextRequest: string;
  targetCwd: string;
  handoffId: string;
  sessionName?: string;
  cliType?: string;
}) => Promise<{ ok: boolean; newSessionId?: string; error?: string }>;

/**
 * The trigger is registered on globalThis by setupTerminalBridge (same process,
 * but this route has no closure access to io/ptyManager). Read it here rather
 * than importing terminalBridge, which would pull node-pty into the route.
 */
function getHandoffTrigger(): HandoffTrigger | null {
  const trigger = (globalThis as Record<string, unknown>).__agentmatrixHandoff;
  return typeof trigger === 'function' ? (trigger as HandoffTrigger) : null;
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const sessionId = request.headers.get('x-agentmatrix-session-id');
  const capability = request.headers.get('x-agentmatrix-capability');
  if (!sessionId || !verifyNavigationCapability(sessionId, capability)) {
    return fail('UNAUTHORIZED_MCP_IDENTITY', 'A managed MCP capability is required.', 401);
  }

  const source = getSession(sessionId);
  if (!source) {
    return fail('SESSION_NOT_FOUND', 'The managed session is no longer active.', 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
  }

  // The source is the caller, from its authenticated identity — never a tool arg.
  if (body.sourceSessionId !== undefined && body.sourceSessionId !== sessionId) {
    return fail(
      'SESSION_ID_MISMATCH',
      'An agent can only hand off its own session; the source is its MCP identity, not an argument.',
      403,
    );
  }

  const targetCli = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  if (!VALID_CLI.has(targetCli)) {
    return fail('INVALID_TARGET', `"to" must be one of: ${[...VALID_CLI].join(', ')}.`, 400);
  }
  if (targetCli === source.cliType) {
    return fail('SAME_PROVIDER', `The source session is already ${targetCli}; hand off to a different provider.`, 400);
  }

  const contextRequest = typeof body.context_request === 'string' ? body.context_request.trim() : '';
  if (!contextRequest) {
    return fail('INVALID_REQUEST', 'context_request is required: what the receiving agent should continue.', 400);
  }
  if (contextRequest.length > 4000) {
    return fail('INVALID_REQUEST', 'context_request must be 4000 characters or fewer.', 400);
  }

  // Default the receiver's cwd to the source's, so it lands in the same repo and
  // discovers the same AGENTS.md. An explicit cwd is honoured when given.
  const targetCwd = typeof body.cwd === 'string' && body.cwd.trim()
    ? body.cwd.trim()
    : (source.cwd || getActiveSession(sessionId)?.cwd || process.cwd());

  const trigger = getHandoffTrigger();
  if (!trigger) {
    return fail('HANDOFF_UNAVAILABLE', 'The handoff subsystem is not ready (no PTY bridge registered).', 503);
  }

  const handoffId = `agent-${randomUUID().slice(0, 12)}`;
  const sourceName = source.name || sessionId.slice(0, 8);
  const sessionName = `${sourceName}→${targetCli}`;

  // Fire and forget: the summary capture can take tens of seconds, well past the
  // MCP client's request timeout. Progress is on the socket; failures are logged.
  void trigger({ sourceSessionId: sessionId, contextRequest, targetCwd, handoffId, sessionName, cliType: targetCli })
    .catch((err) => console.error('[handoff:request] trigger failed', handoffId, err));

  return NextResponse.json(
    {
      accepted: true,
      handoffId,
      to: targetCli,
      targetCwd,
      message: `Handoff started to a new ${targetCli} session. It receives your session's verbatim ask, the raw transcript path, and the project standards, and must reconcile before working. Track progress in the AgentMatrix dashboard.`,
    },
    { status: 202 },
  );
}
