import { NextResponse } from 'next/server';
import { getSession } from '@/lib/state/sessionStore';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');
    if (!sessionId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      status: session.status,
      deskIndex: session.deskIndex,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
