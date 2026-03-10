import type { PtySession } from './PtyManager';
import { OutputParser } from './OutputParser';
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
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function getOutputPath(sessionId: string): string {
  return join(OUTPUT_DIR, `agentmatrix-output-${sessionId}.txt`);
}

/** Check if the PTY output buffer indicates prompt is ready */
function isPromptReady(ptySession: PtySession): boolean {
  // Check entire buffer — strip ANSI from each chunk and look for prompt
  const fullClean = ptySession.outputBuffer
    .slice(-10)
    .map(chunk => OutputParser.stripAnsi(chunk))
    .join('');
  return /[❯\u276F]\s*$/.test(fullClean);
}

/**
 * Inject a prompt into a PTY session and capture structured output.
 *
 * Writes prompt + Enter in quick succession with a confirmation
 * check that the prompt indicator was present in the buffer.
 * Then polls for the output file.
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

  // Wait briefly for prompt if not ready (check every 300ms, max 3s)
  for (let i = 0; i < 10; i++) {
    if (isPromptReady(ptySession)) break;
    await new Promise(r => setTimeout(r, 300));
  }

  // Clean up previous output file
  try { if (existsSync(outputFile)) unlinkSync(outputFile); } catch {}

  // Build prompt
  const prompt = [
    instruction,
    `\nWrite ONLY the output to ${outputFile} using the Bash tool.`,
    `Do NOT include any explanation or preamble in the file. Just the raw output.`,
    `Do this now, no questions asked.`,
  ].join(' ');

  // Write prompt text then Enter — use a single write with \r appended
  ptySession.pty.write(prompt + '\r');

  // Poll for output file
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    if (existsSync(outputFile)) {
      try {
        const content = readFileSync(outputFile, 'utf-8').trim();
        unlinkSync(outputFile);

        if (content.length > 0) {
          return {
            success: true,
            content,
            lines: content.split('\n').map(l => l.trim()).filter(l => l.length > 0),
          };
        }
      } catch {}
    }
  }

  try { if (existsSync(outputFile)) unlinkSync(outputFile); } catch {}
  return empty;
}
