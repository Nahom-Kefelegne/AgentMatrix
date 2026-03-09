import type { PtySession } from './PtyManager';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const OUTPUT_DIR = join(homedir(), '.claude');

export interface InjectionResult {
  success: boolean;
  content: string;
  lines: string[];
}

export interface InjectOptions {
  /** Max time to wait for output file (default 45s) */
  timeoutMs?: number;
  /** How often to check for file (default 2s) */
  pollIntervalMs?: number;
}

/** Get the output file path for a specific session */
function getOutputPath(sessionId: string): string {
  return join(OUTPUT_DIR, `agentmatrix-output-${sessionId}.txt`);
}

/**
 * Inject a prompt into a PTY session and capture structured output.
 *
 * Tells Claude to write the response to a session-specific temp file
 * using the Bash tool. Each session gets its own file to avoid race
 * conditions when multiple sessions are injected concurrently.
 *
 * The caller provides just the instruction — file-write wrapping is
 * handled automatically.
 */
export async function injectPrompt(
  ptySession: PtySession,
  instruction: string,
  opts: InjectOptions = {},
): Promise<InjectionResult> {
  const timeoutMs = opts.timeoutMs ?? 45000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const outputFile = getOutputPath(ptySession.id);

  const empty: InjectionResult = { success: false, content: '', lines: [] };

  if (ptySession.status === 'closed') return empty;

  // Clean up any previous output file for this session
  try { if (existsSync(outputFile)) unlinkSync(outputFile); } catch {}

  // Build the prompt: instruction + file write command
  const prompt = [
    instruction,
    `\nWrite ONLY the output to ${outputFile} using the Bash tool.`,
    `Do NOT include any explanation or preamble in the file. Just the raw output.`,
    `Do this now, no questions asked.`,
  ].join(' ');

  // Write prompt then submit with Enter
  ptySession.pty.write(prompt);
  // Small delay before pressing Enter so TUI processes the text
  setTimeout(() => ptySession.pty.write('\r'), 100);

  // Poll for the output file
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    if (existsSync(outputFile)) {
      try {
        const content = readFileSync(outputFile, 'utf-8').trim();
        unlinkSync(outputFile);

        if (content.length > 0) {
          const lines = content
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);

          return { success: true, content, lines };
        }
      } catch {}
    }
  }

  // Clean up on timeout
  try { if (existsSync(outputFile)) unlinkSync(outputFile); } catch {}

  return empty;
}
