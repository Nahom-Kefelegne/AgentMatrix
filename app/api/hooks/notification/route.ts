import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

// Notification types that genuinely need the user's attention. Other types
// (shell_completed, agent_completed, ...) are informational and would just spam
// the card, so they're logged only.
const ATTENTION_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);

/**
 * Copilot `Notification` hook. Copilot emits these for things like permission
 * prompts and background completions. NOTE: this event uses a documented mixed
 * payload casing (`sessionId` camelCase alongside snake_case fields), so we read
 * both spellings. Attention-worthy notifications flip the card to "attention".
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId || !getSession(sessionId)) return NextResponse.json({ ok: true });

    const type = payload.notification_type || payload.notificationType || '';
    const message = payload.title || payload.message || 'Needs your attention';

    if (!ATTENTION_TYPES.has(type)) {
      console.log(`[notification] ${sessionId.slice(0, 8)} ${type}: ${message}`);
      return NextResponse.json({ ok: true });
    }

    const changes = {
      status: 'attention' as const,
      statusReason: String(message).slice(0, 120),
      lastActivity: Date.now(),
    };
    updateSession(sessionId, changes);
    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[notification]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
