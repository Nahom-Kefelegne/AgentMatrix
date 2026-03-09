import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { checkForRename } from '@/lib/state/sessionName';
import { setCachedName } from '@/lib/state/nameCache';
import { getAllAppTasks, updateAppTask } from '@/lib/state/appTaskStore';

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

    updateSession(payload.session_id, {
      status: 'working',
      currentTool: payload.tool_name,
      lastToolSummary,
      lastActivity,
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

    // Sync task tools back to app task store
    const toolName = payload.tool_name || '';
    if ((toolName.toLowerCase().includes('task') || toolName.toLowerCase().includes('todo')) && payload.tool_input) {
      try {
        const input = payload.tool_input as Record<string, unknown>;
        const subject = String(input.subject || '').trim();
        const taskStatus = String(input.status || '');
        if (subject && taskStatus) {
          const appTasks = getAllAppTasks();
          // Match by subject (case-insensitive) — any assigned task
          const match = appTasks.find(t =>
            t.status === 'assigned' &&
            t.subject.toLowerCase() === subject.toLowerCase()
          );
          if (match) {
            if (taskStatus === 'completed') {
              updateAppTask(match.id, { status: 'completed' });
            } else if (taskStatus === 'deleted') {
              updateAppTask(match.id, { status: 'pending', assignedTo: null, assignedToName: null, assignedAt: null });
            }
          }
        }
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-use]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
