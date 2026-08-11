import type { CliType } from '../../lib/types';
import type { PtyManager, PtySession } from '../pty/PtyManager';

export type SessionRestartPhase = 'stopping' | 'starting';

export interface SessionRestartProfile {
  sessionId: string;
  cwd: string;
  cliType: CliType;
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  copilotMode?: string;
  cols?: number;
  rows?: number;
}

interface RestartSessionOptions {
  stopTimeoutMs?: number;
  pollIntervalMs?: number;
  beforeResume?: () => void | Promise<void>;
  onPhase?: (phase: SessionRestartPhase) => void;
  onSpawned?: (session: PtySession) => void | Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function restartPtySession(
  ptyManager: Pick<PtyManager, 'hasPty' | 'sendExitSequence' | 'kill' | 'spawnResume'>,
  profile: SessionRestartProfile,
  options: RestartSessionOptions = {},
): Promise<PtySession> {
  const stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;

  options.onPhase?.('stopping');
  if (ptyManager.hasPty(profile.sessionId)) {
    await ptyManager.sendExitSequence(profile.sessionId);
    const deadline = Date.now() + stopTimeoutMs;
    while (ptyManager.hasPty(profile.sessionId) && Date.now() < deadline) {
      await delay(pollIntervalMs);
    }
    if (ptyManager.hasPty(profile.sessionId)) {
      ptyManager.kill(profile.sessionId);
      await delay(Math.min(100, pollIntervalMs));
    }
  }

  await options.beforeResume?.();
  options.onPhase?.('starting');
  const session = ptyManager.spawnResume(profile.sessionId, {
    cwd: profile.cwd,
    resumeId: profile.sessionId,
    cliType: profile.cliType,
    permissionMode: profile.permissionMode,
    model: profile.model,
    effort: profile.effort,
    allowedTools: profile.allowedTools,
    copilotMode: profile.copilotMode,
    cols: profile.cols,
    rows: profile.rows,
  });
  await options.onSpawned?.(session);
  return session;
}
