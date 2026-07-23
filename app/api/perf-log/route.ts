import { NextResponse } from 'next/server';

// Sink + config for client-side perf telemetry.
//
// GET  -> { enabled }  where enabled = (AM_PERF env is set). Lets the client
//         monitor turn itself on from the SAME env switch used for the PTY-path
//         telemetry, so `AM_PERF=1` at launch enables everything with no
//         DevTools/localStorage step.
// POST { line } -> console.log the client's perf summary to the app's terminal
//         stdout (same stream as request logs), not just the browser console.
export async function GET() {
  return NextResponse.json({ enabled: process.env.AM_PERF === '1' });
}

export async function POST(request: Request) {
  try {
    const { line } = await request.json();
    if (typeof line === 'string' && line) {
      console.log(`[perf:client] ${line}`);
    }
  } catch {
    /* ignore malformed payloads */
  }
  return new NextResponse(null, { status: 204 });
}
