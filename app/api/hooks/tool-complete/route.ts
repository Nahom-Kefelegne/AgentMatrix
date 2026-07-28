import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { addAction, updateSession, getSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { getNavigationService } from '@/lib/navigation/NavigationService';
import { extractSessionFileChanges } from '@/lib/navigation/fileChanges';
import type { SessionFileChange } from '@/lib/types';
import path from 'path';

async function validateFileChanges(
  sessionId: string,
  rawChanges: SessionFileChange[],
): Promise<SessionFileChange[] | null> {
  const session = getSession(sessionId);
  if (!session) return null;
  const service = getNavigationService();
  const root = await service.resolveRoot(sessionId);
  const base = session.cwd || root.absolutePath;
  const validated: SessionFileChange[] = [];

  for (const change of rawChanges) {
    let candidate = change.path;
    if (
      path.isAbsolute(candidate)
      || /^[A-Za-z]:[\\/]/.test(candidate)
      || candidate.startsWith('\\\\')
    ) {
      const relative = path.relative(root.absolutePath, path.resolve(candidate));
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return null;
      }
      candidate = relative.replace(/\\/g, '/');
    } else {
      const relative = path.relative(root.absolutePath, path.resolve(base, candidate));
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return null;
      }
      candidate = relative.replace(/\\/g, '/');
    }
    if (change.op === 'delete') {
      validated.push({ ...change, path: candidate });
      continue;
    }
    try {
      const target = await service.validateRequestTarget(sessionId, { path: candidate });
      if (target?.path) validated.push({ ...change, path: target.path });
    } catch {
      // Omit the path list entirely when extraction is incomplete so clients
      // perform broad session invalidation instead of trusting a partial list.
      return null;
    }
  }
  return validated;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    const toolName = payload.tool_name || payload.toolName || '';
    const toolInput = payload.tool_input ?? payload.toolArgs;
    const agentId = payload.agent_id || payload.agentId;
    if (typeof sessionId !== 'string' || !sessionId) {
      return NextResponse.json({ ok: false }, { status: 202 });
    }

    // Use lastToolSummary from the preceding tool-use event (has file paths, etc.)
    const session = getSession(sessionId);
    const summary = session?.lastToolSummary || toolName;

    addAction(sessionId, {
      toolName,
      summary,
      timestamp: Date.now(),
    });

    const lastActivity = Date.now();

    // Tool completion is not turn completion. Keep the session's current status
    // (normally working, or attention for ask-user flows) until the Stop hook
    // closes the turn. This prevents the session list flickering idle between
    // consecutive agent tool calls.
    updateSession(sessionId, {
      currentTool: undefined,
      lastActivity,
    });

    const agentName = agentId ? getAgentName(agentId) : null;

    emitToClients(SOCKET_EVENTS.TOOL_COMPLETE, {
      sessionId,
      agentName: agentName || null,
      toolName,
      summary,
    });

    // Nudge the changes viewer to re-fetch when a file-mutating tool finishes.
    const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'create', 'edit', 'apply_patch'];
    if (FILE_TOOLS.includes(toolName)) {
      getNavigationService().invalidateSession(sessionId);
      const changes = await validateFileChanges(
        sessionId,
        extractSessionFileChanges(toolName, toolInput),
      );
      emitToClients('session:files-changed', {
        sessionId,
        completedAt: lastActivity,
        ...(changes && changes.length > 0 ? { changes } : {}),
      });
    }

    const updated = getSession(sessionId);
    if (updated) {
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId,
        changes: {
          currentTool: undefined,
          lastActivity,
          recentActions: updated.recentActions,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-complete]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
