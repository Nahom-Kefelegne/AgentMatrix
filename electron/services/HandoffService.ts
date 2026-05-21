import { PtyManager } from '../pty/PtyManager';
import { injectPrompt } from '../pty/PromptInjector';
import { existsSync, unlinkSync } from 'fs';
import { handoffFilePath, HANDOFF_DIR, ensureDir } from '../../lib/state/paths';

export function getHandoffPath(handoffId: string): string {
  ensureDir(HANDOFF_DIR);
  return handoffFilePath(handoffId);
}

/**
 * Step 1: Ask the source session to summarize context and write to handoff file.
 * Uses PromptInjector — source session writes output to its own output file.
 * We then use that as the handoff content.
 */
export async function generateHandoffSummary(
  ptyManager: PtyManager,
  sourceSessionId: string,
  contextRequest: string,
  handoffId: string,
): Promise<{ success: boolean; error?: string }> {
  const sourcePty = ptyManager.getSession(sourceSessionId);
  if (!sourcePty || sourcePty.status === 'closed') {
    return { success: false, error: 'Source session not available' };
  }

  const handoffPath = getHandoffPath(handoffId);
  try { if (existsSync(handoffPath)) unlinkSync(handoffPath); } catch {}

  const instruction = [
    `URGENT: Complete in under 30 seconds.`,
    `Create a context handoff document for: "${contextRequest}"`,
    `Include: decisions, file paths, code patterns, current state, next steps.`,
    `Be concise but thorough. No preamble.`,
    `Write the output to ${handoffPath} instead of the default output file.`,
  ].join(' ');

  // Override the output file path for this injection
  const result = await injectPrompt(sourcePty, instruction, { timeoutMs: 90000 });

  // The injector writes to the per-session output file, but we told Claude
  // to write to the handoff path instead. Check if it exists.
  if (existsSync(handoffPath)) {
    return { success: true };
  }

  // Fallback: Claude might have written to the default output file
  // In that case, the result.content has the summary
  if (result.success && result.content.length > 0) {
    const { writeFileSync } = require('fs');
    writeFileSync(handoffPath, result.content);
    return { success: true };
  }

  return { success: false, error: 'Failed to generate summary' };
}

/**
 * Step 2: Inject handoff read instruction into the new session.
 */
export async function injectHandoffIntoSession(
  ptyManager: PtyManager,
  newSessionId: string,
  handoffId: string,
): Promise<void> {
  const newPty = ptyManager.getSession(newSessionId);
  if (!newPty || newPty.status === 'closed') return;

  const handoffPath = getHandoffPath(handoffId);

  const instruction = [
    `Read the file at ${handoffPath}. It contains context from a previous session.`,
    `Internalize all the information — decisions, file paths, patterns, and current state.`,
    `Then delete the file. Confirm you have the context with a brief one-line acknowledgment.`,
  ].join(' ');

  // Write instruction, delayed Enter
  newPty.pty.write(instruction);
  setTimeout(() => newPty.pty.write('\r'), 100);
}

/** Clean up a handoff file */
export function cleanupHandoff(handoffId: string): void {
  try {
    const path = getHandoffPath(handoffId);
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}
