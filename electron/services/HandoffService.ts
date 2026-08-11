/**
 * Context handoff — the I/O half.
 *
 * All the reasoning about *what* a handoff bundle contains lives in
 * `lib/dispatch/handoffBundle.ts`, which is pure and unit-tested. This module
 * does only the things that need a disk or a PTY: locating transcripts through
 * the provider, reading a bounded head of one, asking the source agent for its
 * summary, writing the bundle out, and typing the reconciliation instruction
 * into the receiving session.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * The previous flow asked the source agent to summarize itself, handed the
 * receiver that summary, and told it to "internalize" and then DELETE the file.
 * The user's ask survived only as an LLM paraphrase (intent drift), the
 * previous agent's chosen direction arrived as established fact (work drift),
 * and deleting the file meant a second handoff had nothing to chain onto.
 *
 * Now the receiver gets the user's ask verbatim, RAW PATHS to every prior
 * session's transcript, and the summary explicitly labelled as the source
 * agent's own account — plus an instruction to reconcile the three before
 * writing any code. Nothing is deleted.
 */

import { PtyManager } from '../pty/PtyManager';
import { captureQuery } from '../../lib/cli/acp/captureQuery';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { getProvider } from '../../lib/cli';
import type { CliType } from '../../lib/cli/CliProvider';
import { getAllAppTasks } from '../../lib/state/appTaskStore';
import { getActiveSession } from '../../lib/state/activeSessionsCache';
import {
  ensureDir,
  HANDOFF_DIR,
  HANDOFF_INDEX_PATH,
  handoffBundleDir,
  handoffBundlePath,
  handoffMarkdownPath,
  handoffSourceSummaryPath,
} from '../../lib/state/paths';
import {
  AGENTMATRIX_INJECTION_MARKER,
  buildHandoffBundle,
  buildReconciliationInstruction,
  extractFirstUserMessage,
  isHandoffBundle,
  renderHandoffBundleMarkdown,
  resolveOriginalAsk,
  traceGrantDirs,
  type HandoffBundle,
  type OriginalAsk,
} from '../../lib/dispatch/handoffBundle';

/**
 * How much of a transcript to read when recovering the first user turn.
 *
 * Real transcripts reach 9+ MB, and the first human turn is within the first
 * few records, so reading the whole file would be pure waste on the main
 * process. `extractFirstUserMessage` tolerates a truncated trailing line, which
 * is what makes a bounded head safe.
 */
const TRANSCRIPT_HEAD_BYTES = 1_048_576; // 1 MiB

// ─── Small disk helpers ──────────────────────────────────────────────

/** Read at most `maxBytes` from the start of a file. Never throws. */
function readHead(path: string, maxBytes: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already gone */ }
    }
  }
}

function writeFileQuiet(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf-8');
  } catch (err) {
    console.error('[handoff] failed to write', path, err);
  }
}

// ─── Chain index: which handoff created which session ────────────────

type HandoffIndex = Record<string, string>; // receiving sessionId → handoffId

function readHandoffIndex(): HandoffIndex {
  try {
    const parsed = JSON.parse(readFileSync(HANDOFF_INDEX_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Record that `sessionId` was created by `handoffId`.
 *
 * This is the backwards link that makes A→B→C work: when B is later handed off,
 * we look B up here, load that bundle, and chain onto it. Called by the
 * `session:handoff` handler once the receiving session's id exists.
 */
export function recordHandoffReceiver(handoffId: string, sessionId: string): void {
  try {
    ensureDir(HANDOFF_DIR);
    const index = readHandoffIndex();
    index[sessionId] = handoffId;
    writeFileSync(HANDOFF_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  } catch (err) {
    console.error('[handoff] failed to record receiver', err);
  }
}

/** The bundle for the handoff that created `sessionId`, if it was one. */
function loadUpstreamBundle(sessionId: string): HandoffBundle | null {
  const upstreamId = readHandoffIndex()[sessionId];
  if (!upstreamId) return null;
  try {
    const parsed = JSON.parse(readFileSync(handoffBundlePath(upstreamId), 'utf-8'));
    return isHandoffBundle(parsed) ? parsed : null;
  } catch {
    // The bundle is gone or unreadable. Chaining degrades to a single hop
    // rather than failing the handoff; the trace will just be shorter.
    return null;
  }
}

// ─── Sourcing the ask ────────────────────────────────────────────────

/**
 * The `AppTask` linked to a session, if any. `assignedTo` holds a session id —
 * see `TaskBoard`'s assign flow.
 */
function findLinkedAppTask(sessionId: string) {
  try {
    const task = getAllAppTasks().find(t => t.assignedTo === sessionId);
    if (!task) return null;
    return { id: task.id, subject: task.subject ?? '', description: task.description ?? '' };
  } catch {
    return null;
  }
}

/**
 * Resolve the user's ask WITHOUT ever going through a model.
 *
 * The three sources are, in order: an upstream bundle (already verbatim), the
 * linked app task's subject + description (typed by the user into the task
 * board), and the first genuine user turn in the source session's raw
 * transcript (typed by the user into the CLI). If none is available the ask is
 * marked unavailable and stays visibly empty — the summary is never promoted
 * into that slot, because a paraphrase sitting where ground truth belongs is
 * exactly the drift this whole change exists to stop.
 */
function sourceOriginalAsk(
  sessionId: string,
  cliType: CliType,
  transcriptPath: string | undefined,
  upstream: HandoffBundle | null,
): OriginalAsk {
  const appTask = findLinkedAppTask(sessionId);

  let firstUserMessage: { text: string; transcriptPath: string } | null = null;
  let unavailableNote: string | undefined;

  if (!transcriptPath) {
    unavailableNote = `No linked app task, and no ${cliType} transcript could be located for session ${sessionId}.`;
  } else if (cliType === 'kimi') {
    unavailableNote =
      'No linked app task, and Kimi\'s wire.jsonl schema is unverified in this repo — guessing at its field '
      + 'names could surface model output as the user\'s ask, so nothing was extracted.';
  } else {
    const head = readHead(transcriptPath, TRANSCRIPT_HEAD_BYTES);
    const text = head === null ? undefined : extractFirstUserMessage(head, cliType);
    if (text !== undefined) {
      firstUserMessage = { text, transcriptPath };
    } else {
      unavailableNote =
        `No linked app task, and no user turn was found in the first ${TRANSCRIPT_HEAD_BYTES} bytes of `
        + `${transcriptPath}.`;
    }
  }

  return resolveOriginalAsk({
    inherited: upstream?.ask ?? null,
    appTask,
    firstUserMessage,
    unavailableNote,
  });
}

// ─── Step 1: build the bundle ────────────────────────────────────────

export interface PreparedHandoff {
  bundle: HandoffBundle;
  /** Absolute path to the markdown the receiver is pointed at. */
  markdownPath: string;
  /**
   * Directories the receiving session must be granted (`SpawnOptions.addDirs`)
   * for the bundle and every referenced transcript to be readable.
   */
  addDirs: string[];
}

export interface PrepareHandoffResult {
  success: boolean;
  error?: string;
  prepared?: PreparedHandoff;
}

/**
 * Ask the source session to summarize itself, then assemble and persist the
 * full bundle (verbatim ask + raw trace + that summary).
 *
 * The summary step is unchanged in substance — it is still a useful entry point
 * — but it is now one labelled section of a larger artifact rather than the
 * whole handoff.
 */
export async function prepareHandoff(
  ptyManager: PtyManager,
  sourceSessionId: string,
  contextRequest: string,
  handoffId: string,
  targetCwd: string,
): Promise<PrepareHandoffResult> {
  const sourcePty = ptyManager.getSession(sourceSessionId);
  if (!sourcePty || sourcePty.status === 'closed') {
    return { success: false, error: 'Source session not available' };
  }

  const cliType: CliType = sourcePty.cliType
    || getActiveSession(sourceSessionId)?.cliType
    || 'claude';

  const upstream = loadUpstreamBundle(sourceSessionId);

  // ── the summary (still generated by the source agent, now clearly labelled) ──
  const instruction = [
    `${AGENTMATRIX_INJECTION_MARKER} URGENT: Complete in under 30 seconds.`,
    `Create a context handoff document for: "${contextRequest}"`,
    `Include: decisions, file paths, code patterns, current state, next steps.`,
    `Be concise but thorough. Output only the document, no preamble.`,
  ].join(' ');

  const result = await captureQuery(
    ptyManager,
    sourcePty,
    instruction,
    { timeoutMs: 90000 },
    { label: 'Handoff' },
  );

  const summaryText = result.success ? result.content : '';

  // Resolve the transcript AFTER the summary, not before.
  //
  // A CLI only writes its transcript once the session has taken a turn, and for
  // a freshly-spawned session the summary above IS that first turn. Looking the
  // path up beforehand returned undefined, so the ask fell back to
  // 'unavailable' and the trace carried no path — while the transcript appeared
  // on disk moments later. Verified end-to-end: a session reporting "no
  // transcript" at lookup time had a 204KB transcript by the time the handoff
  // finished. The summary is what guarantees the flush, so it has to come first.
  //
  // The provider owns the per-CLI layout; never rebuild these paths here.
  // Claude: projects/<project>/<id>.jsonl. Copilot: session-state/<id>/events.jsonl.
  // Kimi: .../agents/main/wire.jsonl.
  let transcriptPath: string | undefined;
  try {
    transcriptPath = getProvider(cliType).getTranscriptPath(sourceSessionId);
  } catch (err) {
    console.error('[handoff] transcript lookup failed', err);
  }
  const ask = sourceOriginalAsk(sourceSessionId, cliType, transcriptPath, upstream);

  const bundle = buildHandoffBundle({
    handoffId,
    createdAt: Date.now(),
    targetCwd,
    contextRequest,
    source: {
      sessionId: sourceSessionId,
      cliType,
      transcriptPath,
      transcriptDir: transcriptPath ? dirname(transcriptPath) : undefined,
      transcriptNote: transcriptPath
        ? undefined
        : `The ${cliType} provider could not locate a transcript for this session.`,
    },
    previous: upstream,
    ask,
    summaryText,
  });

  // Persist BEFORE spawning: the bundle is the chain link, and the receiving
  // session is told to read the markdown almost immediately.
  ensureDir(handoffBundleDir(handoffId));
  const markdownPath = handoffMarkdownPath(handoffId);
  writeFileQuiet(handoffBundlePath(handoffId), JSON.stringify(bundle, null, 2));
  writeFileQuiet(markdownPath, renderHandoffBundleMarkdown(bundle));
  if (summaryText) writeFileQuiet(handoffSourceSummaryPath(handoffId), summaryText);

  // Fail only when there is nothing at all to hand over. A missing summary is
  // survivable now — the ask and the raw trace still carry the handoff — but a
  // missing ask AND a missing trace means the receiver would get nothing it
  // could act on, and silently spawning a blank session would be worse than an
  // error the user can see.
  const hasTrace = bundle.trace.some(ref => ref.path);
  if (!summaryText && ask.source === 'unavailable' && !hasTrace) {
    return {
      success: false,
      error: 'Nothing to hand off: no summary, no original ask, and no readable transcript.',
    };
  }

  return {
    success: true,
    prepared: {
      bundle,
      markdownPath,
      addDirs: computeAddDirs(bundle),
    },
  };
}

/**
 * Directories the receiving session needs read access to.
 *
 * SCOPING — deliberately the narrowest directory that works, never a state root:
 *
 *  - The handoff's OWN directory (`~/.agentmatrix/handoffs/<id>/`), not
 *    `HANDOFF_DIR`. Granting the shared folder would expose every handoff the
 *    user has ever run — other repos' asks and summaries — to read one file.
 *  - Each transcript's containing directory, from `dirname` of the provider's
 *    path. Never `~/.claude/projects` or `~/.copilot/session-state`, which hold
 *    every session the user has ever run on this machine. In practice this
 *    resolves to:
 *      Claude   ~/.claude/projects/<project>/        one repo's sessions
 *      Copilot  ~/.copilot/session-state/<id>/       exactly one session
 *      Kimi     .../<id>/agents/main/                exactly one session
 *    Claude's is the loosest of the three and is a known trade-off: its
 *    transcripts are per-project files in a shared directory, so the file's
 *    parent is the tightest grant the path layout permits. Granting the .jsonl
 *    file itself would be tighter still, but `--add-dir` is documented as taking
 *    directories and was not verified to accept a file — silently mis-scoping
 *    would be worse than a slightly wider, understood grant.
 */
function computeAddDirs(bundle: HandoffBundle): string[] {
  const dirs = [handoffBundleDir(bundle.handoffId), ...traceGrantDirs(bundle)];
  return [...new Set(dirs)];
}

// ─── Step 2: inject the reconciliation instruction ───────────────────

/**
 * Point the receiving session at the bundle and tell it to RECONCILE.
 *
 * Note what this no longer says: not "internalize this", and not "then delete
 * the file". The receiver's first job is to check the previous agent's work
 * against the user's actual words, and the artifacts have to survive for the
 * next hop in the chain.
 */
export async function injectHandoffIntoSession(
  ptyManager: PtyManager,
  newSessionId: string,
  prepared: PreparedHandoff,
): Promise<void> {
  const newPty = ptyManager.getSession(newSessionId);
  if (!newPty || newPty.status === 'closed') return;

  const instruction = buildReconciliationInstruction(prepared.bundle, prepared.markdownPath);

  // Write instruction, delayed Enter
  newPty.pty.write(instruction);
  setTimeout(() => newPty.pty.write('\r'), 100);
}

/**
 * NOTE: there is deliberately no `cleanupHandoff` any more.
 *
 * Handoff artifacts are the provenance trail. The bundle for A→B is what B→C is
 * built from, so deleting it silently truncates the chain: C would receive B's
 * summary as if it were the origin, with A's verbatim ask and A's transcript
 * gone. Disk cost is a few KB per handoff (transcripts are referenced by path,
 * never copied).
 */
