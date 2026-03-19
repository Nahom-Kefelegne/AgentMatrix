import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { checkForRename } from '@/lib/state/sessionName';
import { setCachedName } from '@/lib/state/nameCache';

function buildToolSummary(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return toolName;

  switch (toolName) {
    case 'Read':
      return `Reading ${toolInput.file_path ?? 'file'}`;
    case 'Edit':
      return `Editing ${toolInput.file_path ?? 'file'}`;
    case 'Write':
      return `Writing ${toolInput.file_path ?? 'file'}`;
    case 'Bash': {
      const cmd = String(toolInput.command ?? '');
      return `Running ${cmd.slice(0, 40)}`;
    }
    case 'Grep':
    case 'Glob':
      return `Searching ${toolInput.pattern ?? toolInput.glob ?? 'files'}`;
    case 'Agent':
      return 'Spawning agent';
    default:
      return toolName;
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    // Only update name if a /rename was detected — don't overwrite with slug/cwd
    const session = getSession(payload.session_id);
    if (session && payload.transcript_path) {
      const renamed = checkForRename(payload.transcript_path);
      if (renamed && renamed !== session.name) {
        updateSession(payload.session_id, { name: renamed });
        setCachedName(payload.session_id, renamed);
        emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
          sessionId: payload.session_id,
          changes: { name: renamed },
        });
      }
    }

    const lastToolSummary = buildToolSummary(payload.tool_name, payload.tool_input);
    const lastActivity = Date.now();

    // Track files modified by Write/Edit tools
    const fileModTools = ['Write', 'Edit'];
    const filePath = payload.tool_input?.file_path as string | undefined;
    let filesModified: string[] | undefined;
    if (fileModTools.includes(payload.tool_name) && filePath) {
      const existing = session?.filesModified || [];
      if (!existing.includes(filePath)) {
        filesModified = [...existing, filePath];
      }
    }

    updateSession(payload.session_id, {
      status: 'working',
      currentTool: payload.tool_name,
      lastToolSummary,
      lastActivity,
      ...(filesModified ? { filesModified } : {}),
    });

    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
      sessionId: payload.session_id,
      changes: { lastToolSummary, lastActivity },
    });

    // Resolve agent name so the client can find the right character
    const agentName = payload.agent_id ? getAgentName(payload.agent_id) : null;

    emitToClients(SOCKET_EVENTS.TOOL_START, {
      sessionId: payload.session_id,
      agentName: agentName || null,
      toolName: payload.tool_name,
      toolInput: payload.tool_input ? JSON.stringify(payload.tool_input).slice(0, 200) : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-use]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
