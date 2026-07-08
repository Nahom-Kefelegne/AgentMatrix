import type { PtyManager, PtySession } from '../../../electron/pty/PtyManager';
import { injectPrompt, type InjectionResult, type InjectOptions } from '../../../electron/pty/PromptInjector';
import { getProvider } from '../index';
import { AcpClient } from './AcpClient';
import type { CliType } from '../CliProvider';

/**
 * Run an out-of-band instruction against a session and capture its text output.
 *
 * Provider-owned strategy:
 *  - Copilot (supportsAcp): use ACP (`copilot --acp`) — load the session and
 *    run the prompt out-of-band, streaming the reply. No PTY typing, no
 *    write-a-file-and-poll, doesn't disturb the visible terminal.
 *  - Claude (and any ACP failure): fall back to the legacy PromptInjector,
 *    which types the prompt into the PTY and polls for an output file.
 *
 * Returns the same `{ success, content, lines }` shape as PromptInjector so
 * callers (Summary/Handoff/Orchestrator) don't need to branch.
 */
export async function captureQuery(
  ptyManager: PtyManager,
  ptySession: PtySession,
  instruction: string,
  opts: InjectOptions = {},
): Promise<InjectionResult> {
  const empty: InjectionResult = { success: false, content: '', lines: [] };
  if (!ptySession || ptySession.status === 'closed') return empty;

  const cliType: CliType = ptySession.cliType || 'claude';
  const provider = getProvider(cliType);

  if (provider.supportsAcp) {
    const acpResult = await runViaAcp(ptyManager, ptySession, instruction, opts);
    // Fall through to the PTY injector if ACP couldn't produce output, so a
    // transient ACP failure never leaves the feature dead.
    if (acpResult.success) return acpResult;
    console.warn(`[acp] query failed for ${ptySession.id.slice(0, 8)}, falling back to PromptInjector`);
  }

  return injectPrompt(ptySession, instruction, opts);
}

async function runViaAcp(
  ptyManager: PtyManager,
  ptySession: PtySession,
  instruction: string,
  opts: InjectOptions,
): Promise<InjectionResult> {
  const empty: InjectionResult = { success: false, content: '', lines: [] };
  const cliType: CliType = ptySession.cliType || 'copilot';
  const provider = getProvider(cliType);

  let binaryPath: string;
  try {
    binaryPath = provider.findBinary();
  } catch {
    return empty;
  }

  const cwd = ptyManager.findSessionCwd(ptySession.id, cliType) || process.cwd();

  const client = new AcpClient(binaryPath, cwd);
  try {
    await client.initialize();
    await client.loadSession(ptySession.id);
    return await client.runQuery(ptySession.id, instruction, opts.timeoutMs ?? 45000);
  } catch (err) {
    console.error(`[acp] error for ${ptySession.id.slice(0, 8)}:`, err);
    return empty;
  } finally {
    client.dispose();
  }
}
