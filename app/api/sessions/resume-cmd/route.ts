import { NextResponse } from 'next/server';
import { getSession } from '@/lib/state/sessionStore';
import { getSettings } from '@/lib/state/appSettings';
import { getProvider } from '@/lib/cli';

/**
 * Build the shell command a user can paste to resume this session
 * outside the app. The exact form is provider-owned via
 * buildResumeShellCommand() so it stays in sync with each CLI's flags.
 *
 * GET /api/sessions/resume-cmd?id=<sessionId>
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const cwd = session.cwd || '~';
    const name = session.name;
    const provider = getProvider(session.cliType || 'claude');

    // Claude can resume by name (the latest session with that name);
    // Copilot resumes by session ID. The provider's resume args take
    // either since both encode it as `--resume <token>`. Pass the most
    // useful token per CLI.
    const resumeToken = session.cliType === 'copilot' ? session.id : name;
    let cliCommand = provider.buildResumeShellCommand({ cwd, resumeId: resumeToken });

    // Optionally wrap in Agency when the user has it enabled.
    try {
      const { useAgency } = getSettings();
      if (useAgency) {
        cliCommand = cliCommand.replace(/^\S+/, `agency ${provider.type}`);
      }
    } catch { /* ignore — fall back to bare command */ }

    const command = `cd ${cwd} && ${cliCommand}`;
    return NextResponse.json({ command, cwd, name });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
