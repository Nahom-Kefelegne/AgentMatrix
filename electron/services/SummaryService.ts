import type { Server as SocketIOServer } from 'socket.io';
import type { PtyManager } from '../pty/PtyManager';
import { type InjectOptions } from '../pty/PromptInjector';
import { captureQuery } from '../../lib/cli/acp/captureQuery';
import { updateSession } from '../../lib/state/sessionStore';
import { SOCKET_EVENTS } from '../../lib/types';

const SUMMARY_INSTRUCTION = `Summarize work done this session in exactly 3 bullet points, 4-5 words each. Each line must start with "- ". Nothing else.`;

/** Parse bullet points from lines */
function parseBullets(lines: string[]): string[] {
  return lines
    .filter(l => /^-\s/.test(l))
    .map(l => l.replace(/^-\s*/, ''))
    .filter(l => l.length >= 3 && l.length < 80)
    .slice(0, 3);
}

/** Request a work summary from a session and broadcast the result */
export async function requestSummary(
  io: SocketIOServer,
  ptyManager: PtyManager,
  sessionId: string,
  opts?: InjectOptions,
): Promise<string[]> {
  const ptySession = ptyManager.getSession(sessionId);
  if (!ptySession || ptySession.status === 'closed') return [];

  const result = await captureQuery(ptyManager, ptySession, SUMMARY_INSTRUCTION, opts, { label: 'Summary' });
  const bullets = parseBullets(result.lines);

  if (bullets.length > 0) {
    updateSession(sessionId, { summaryBullets: bullets } as any);
    io.emit(SOCKET_EVENTS.SESSION_UPDATE, {
      sessionId,
      changes: { summaryBullets: bullets },
    });
  }

  return bullets;
}
