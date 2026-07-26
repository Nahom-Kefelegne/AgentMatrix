import { NextResponse } from 'next/server';
import type { ToolCompletePayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { addAction, updateSession, getSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { ASK_USER_TOOLS } from '@/lib/constants/askUserTools';
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

    // Return status to 'idle' so the UI doesn't appear stuck "working"
    // between tool calls. Skip when subagents are still running or this
    // event is itself from a subagent — those keep the parent at 'working'
    // until SubagentStop arrives. Claude also flips back via its
    // prompt-ready PTY signal, but Copilot does not — fixes that gap.
    // Also skip when THIS completing tool is an ask-user tool: Copilot fires
    // PostToolUse immediately after presenting the question (before the user
    // answers), so idling here would wipe the "needs you" state that tool-use
    // just set. (Permission prompts differ — the completing tool there is the
    // real tool, so those still idle normally once approved.)
    const hasActiveAgents = !!(session && session.agents.length > 0);
    const isAgentEvent = !!payload.agent_id;
    const isAskUserComplete = ASK_USER_TOOLS.has(payload.tool_name || payload.toolName || '');
    const shouldIdle = !hasActiveAgents && !isAgentEvent && !isAskUserComplete;

    updateSession(payload.session_id, {
      currentTool: undefined,
      lastActivity,
      ...(shouldIdle ? { status: 'idle' as const } : {}),
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
          ...(shouldIdle ? { status: 'idle' as const } : {}),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-complete]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
