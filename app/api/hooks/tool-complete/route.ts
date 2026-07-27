import { NextResponse } from 'next/server';
import type { ToolCompletePayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { addAction, updateSession, getSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { getNavigationService } from '@/lib/navigation/NavigationService';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Use lastToolSummary from the preceding tool-use event (has file paths, etc.)
    const session = getSession(payload.session_id);
    const summary = session?.lastToolSummary || payload.tool_name;

    addAction(payload.session_id, {
      toolName: payload.tool_name,
      summary,
      timestamp: Date.now(),
    });

    const lastActivity = Date.now();

    // Tool completion is not turn completion. Keep the session's current status
    // (normally working, or attention for ask-user flows) until the Stop hook
    // closes the turn. This prevents the session list flickering idle between
    // consecutive agent tool calls.
    updateSession(payload.session_id, {
      currentTool: undefined,
      lastActivity,
    });

    const agentName = payload.agent_id ? getAgentName(payload.agent_id) : null;

    emitToClients(SOCKET_EVENTS.TOOL_COMPLETE, {
      sessionId: payload.session_id,
      agentName: agentName || null,
      toolName: payload.tool_name,
      summary,
    });

    // Nudge the changes viewer to re-fetch when a file-mutating tool finishes.
    const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'create', 'edit', 'apply_patch'];
    if (FILE_TOOLS.includes(payload.tool_name)) {
      getNavigationService().invalidateSession(payload.session_id);
      emitToClients('session:files-changed', { sessionId: payload.session_id });
    }

    const updated = getSession(payload.session_id);
    if (updated) {
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId: payload.session_id,
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
