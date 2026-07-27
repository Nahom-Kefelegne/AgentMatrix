import { NextResponse } from 'next/server';
import { getAllSessions } from '@/lib/state/sessionStore';

export async function GET() {
  const sessions = getAllSessions().map(s => ({
    id: s.id,
    name: s.name,
    status: s.status,
    cwd: s.cwd,
    contextUsage: s.contextUsage,
  }));
  return NextResponse.json({ sessions });
}
