import { NextResponse } from 'next/server';
import { homedir } from 'os';

/**
 * Best-effort detection of a Windows remote/RDP session. On RDP, every animated
 * pixel must be re-encoded and streamed to the client, so the app auto-enables
 * a reduced-motion mode (see app/page.tsx) to avoid saturating the remote
 * pipeline. Windows names RDP sessions "RDP-Tcp#<n>" (the physical console is
 * "Console"), and sets CLIENTNAME for a connected RDP client.
 */
function isRemoteSession(): boolean {
  if (process.platform !== 'win32') return false;
  const sessionName = process.env.SESSIONNAME || '';
  if (/^RDP-/i.test(sessionName)) return true;
  if (process.env.CLIENTNAME) return true;
  return false;
}

export async function GET() {
  return NextResponse.json({
    homedir: homedir(),
    platform: process.platform,
    remote: isRemoteSession(),
  });
}
