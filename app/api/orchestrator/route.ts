import { NextResponse } from 'next/server';

/**
 * Query the orchestrator session.
 * The actual orchestrator runs in the Electron main process via PtyManager.
 * This API route forwards queries via socket to the main process.
 *
 * For now, orchestrator queries go through socket events directly
 * from the client (session:orchestrator-query). This route exists
 * as a placeholder for future REST-based orchestrator access.
 */
export async function POST(request: Request) {
  return NextResponse.json({
    error: 'Use socket event "orchestrator:query" instead',
  }, { status: 400 });
}
