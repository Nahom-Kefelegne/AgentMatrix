import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { checkForRename } from '@/lib/state/sessionName';
import { setCachedName } from '@/lib/state/nameCache';
import { ASK_USER_TOOLS, extractQuestion } from '@/lib/constants/askUserTools';

interface ToolUseHookPayload {
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown>;
  toolArgs?: Record<string, unknown>;
  agent_id?: string;
}

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

function processToolUse(payload: ToolUseHookPayload): void {
  if (!payload.session_id) {
    console.warn('[tool-use] ignored payload without session_id');
    return;
  }

  try {
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

    const toolName = payload.tool_name || payload.toolName || '';
    const toolInput = payload.tool_input || payload.toolArgs;
    const lastToolSummary = buildToolSummary(toolName, toolInput);
    const lastActivity = Date.now();

    // Copilot's ask-user tools (e.g. AskUserQuestion) block waiting for the
    // user's answer but never fire a notification, and PostToolUse doesn't
    // arrive until the user responds — so without special-casing them the
    // session is stuck showing "working" while it's really waiting on the user.
    // Treat them as "attention" (needs you); it clears automatically when the
    // answer arrives (PostToolUse → tool-complete → idle).
    if (ASK_USER_TOOLS.has(toolName)) {
      const question = extractQuestion(toolInput);
      const changes = {
        status: 'attention' as const,
        statusReason: question,
        currentTool: toolName,
        lastActivity,
      };
      updateSession(payload.session_id, changes);
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId: payload.session_id, changes });
      return;
    }

    // Track files modified by file-writing tools. Claude uses tool_input.file_path;
    // Copilot uses tool_input.path (verified against live payloads). Accept both.
    const fileModTools = ['Write', 'Edit', 'MultiEdit', 'create', 'edit'];
    const filePath = (toolInput?.file_path ?? toolInput?.path) as string | undefined;
    let filesModified: string[] | undefined;
    if (fileModTools.includes(toolName) && filePath) {
      const existing = session?.filesModified || [];
      if (!existing.includes(filePath)) {
        filesModified = [...existing, filePath];
      }
    }

    updateSession(payload.session_id, {
      status: 'working',
      currentTool: toolName,
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
      toolName,
      toolInput: toolInput ? JSON.stringify(toolInput).slice(0, 200) : undefined,
    });
  } catch (error) {
    console.error('[tool-use]', error);
  }
}

export async function POST(request: Request) {
  let payload: ToolUseHookPayload;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[tool-use] ignored invalid payload');
      return NextResponse.json({ ok: false }, { status: 202 });
    }
    payload = raw as ToolUseHookPayload;
  } catch (error) {
    console.error('[tool-use] invalid JSON:', error);
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  // PreToolUse is on Copilot's critical path. Acknowledge immediately and do
  // state/telemetry work after the response so AgentMatrix can never hold up the
  // tool it is observing.
  setImmediate(() => processToolUse(payload));
  return NextResponse.json({ ok: true }, { status: 202 });
}
