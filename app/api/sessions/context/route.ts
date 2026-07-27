import { NextResponse } from 'next/server';
import { refreshSessionContextUsage } from '@/lib/state/contextUsage';
import { getAllSessions } from '@/lib/state/sessionStore';

export const runtime = 'nodejs';

export async function GET() {
  const sessions = getAllSessions();
  const entries = await Promise.all(sessions.map(async session => {
    try {
      const usage = await refreshSessionContextUsage(session.id);
      return usage === null ? null : [session.id, usage] as const;
    } catch (error) {
      console.warn(`[session-context] Could not refresh ${session.id.slice(0, 8)}:`, error);
      return null;
    }
  }));

  return NextResponse.json({
    contexts: Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry !== null)),
  });
}
