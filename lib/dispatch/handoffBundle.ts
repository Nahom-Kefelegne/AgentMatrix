/**
 * The context-handoff *bundle*: what a receiving session is handed when work
 * moves from one CLI session into a fresh one.
 *
 * WHY THIS EXISTS
 * ---------------
 * Handoff used to be a single artifact: the source agent was asked to summarize
 * itself, and the receiver was told to read that summary, internalize it, and
 * then DELETE it. Two things went wrong, both of them silent:
 *
 *   INTENT DRIFT — the user's original ask survived only as an LLM paraphrase.
 *     If the source agent misunderstood the task, the summary preserved the
 *     misunderstanding perfectly, and every later hop compounded it.
 *   WORK DRIFT — if the source agent built in the wrong direction, the receiver
 *     inherited that as established fact, with no way to tell "what the user
 *     asked for" apart from "what the previous agent happened to do".
 *
 * The bundle separates the three things that were blended into one summary:
 *
 *   1. THE ASK      the user's own words, VERBATIM. Never regenerated, never
 *                   passed through a model at any hop — see `OriginalAsk`.
 *   2. THE TRACE    absolute paths to the raw transcript of every session in the
 *                   chain, oldest first, each tagged with its `cliType` so the
 *                   receiver knows which schema it is grepping. Paths only:
 *                   real transcripts reach 9+ MB, so contents are never inlined.
 *   3. THE SUMMARY  the previous agent's own account, explicitly labelled as
 *                   possibly-drifted. Still useful as an entry point; never
 *                   ground truth.
 *
 * THIS MODULE IS DATA + PURE FUNCTIONS ONLY.
 * No `fs`, no `path`, no `electron` — same constraint `WorkPacket.ts` documents,
 * for the same reason (it is importable from either side of the IPC boundary and
 * has to be unit-testable without touching disk). Anything that needs the
 * filesystem — locating transcripts, reading the head of one, writing the
 * rendered markdown — lives in `electron/services/HandoffService.ts`. That is
 * also why `TranscriptRef` carries a pre-computed `dir`: `dirname` is I/O-adjacent
 * and belongs on the caller's side.
 *
 * A bundle must survive `JSON.stringify` → disk → `JSON.parse` unchanged,
 * because that round trip is exactly how PROVENANCE CHAINS: the bundle written
 * for A→B is read back when B→C happens, so C receives A's transcript *and*
 * B's, in order, and A's original ask rather than B's retelling of it. This is
 * why the old "then delete the file" step had to go — it destroyed the trail.
 */

import type { CliType } from '../cli/CliProvider';

/** Bumped only on a breaking shape change; readers should tolerate unknowns. */
export const HANDOFF_BUNDLE_VERSION = 1;

/**
 * Prefix stamped onto every instruction AgentMatrix types into a session on the
 * user's behalf (the summary request, the reconciliation instruction).
 *
 * It exists so `extractFirstUserMessage` can tell the app's own injected prompts
 * apart from real user turns. Without it, a session that was itself created by a
 * handoff would report the injected handoff instruction as "the user's original
 * ask" — machine text masquerading as ground truth, i.e. the exact failure this
 * module exists to prevent.
 */
export const AGENTMATRIX_INJECTION_MARKER = '[agentmatrix]';

// ─── The ask ─────────────────────────────────────────────────────────

/**
 * Where the verbatim ask came from. Ordered by authority, and that order is
 * enforced by `resolveOriginalAsk`:
 *
 *  - `inherited`         an upstream bundle already carried the user's words.
 *                        Highest authority: at hop B→C the source session's own
 *                        first "user" turn is the handoff instruction the app
 *                        typed into it, so inheriting is the only way A's real
 *                        ask reaches C.
 *  - `app-task`          the linked `AppTask`'s subject + description, i.e. text
 *                        the user typed into the task board.
 *  - `source-transcript` the first genuine user turn in the source session's raw
 *                        transcript. Still the user's words, just recovered from
 *                        the CLI's own log.
 *  - `unavailable`       nothing could be sourced. This is deliberately a state
 *                        the bundle can hold and render: a missing ask must be
 *                        VISIBLE, never quietly backfilled from the summary.
 */
export type AskSource = 'inherited' | 'app-task' | 'source-transcript' | 'unavailable';

export interface OriginalAsk {
  source: AskSource;
  /**
   * The user's words, byte-for-byte. Empty string only when
   * `source === 'unavailable'`.
   *
   * INVARIANT: every value that ever lands here is copied — from an `AppTask`
   * field, from a JSON-decoded transcript `content` string, or from an upstream
   * bundle's `text`. No code path in this module or in `HandoffService` sends it
   * through a model, and nothing summarizes, truncates, or reflows it.
   */
  text: string;
  /** Human-readable provenance, e.g. `app task t-4` or the transcript path. */
  locator?: string;
  /** Set when the ask was carried forward: the handoff id it came from. */
  inheritedFrom?: string;
  /** Why the ask is `unavailable`, or any caveat worth rendering. */
  note?: string;
}

/** True when an ask carries actual user text (as opposed to recording absence). */
export function hasAskText(ask: OriginalAsk | null | undefined): boolean {
  return !!ask && ask.source !== 'unavailable' && ask.text.length > 0;
}

/**
 * Join an `AppTask`'s two user-authored fields into one block.
 *
 * Concatenation only — both halves are reproduced byte-for-byte, so this stays
 * within the verbatim guarantee. `description` is often empty for quick tasks.
 */
export function formatAppTaskAsk(subject: string, description: string): string {
  const body = description.trim().length > 0 ? description : '';
  return body ? `${subject}\n\n${body}` : subject;
}

/** Inputs to `resolveOriginalAsk`, all already fetched by the caller. */
export interface AskCandidates {
  /** The upstream bundle's ask, when the source session came from a handoff. */
  inherited?: OriginalAsk | null;
  /** The `AppTask` linked to the source session, if any. */
  appTask?: { id: string; subject: string; description: string } | null;
  /** First genuine user turn recovered from the source transcript. */
  firstUserMessage?: { text: string; transcriptPath: string } | null;
  /** Why nothing could be recovered — rendered when the ask is unavailable. */
  unavailableNote?: string;
}

/**
 * Pick the ask, highest-authority source first. Never invents text.
 *
 * JUDGEMENT CALL, stated plainly: the brief said "prefer the linked AppTask,
 * otherwise the first user message". `inherited` is placed AHEAD of both,
 * because provenance chaining requires it — see `AskSource`. If a handoff chain
 * ever legitimately re-tasks the receiver with a *new* AppTask, this order would
 * keep showing the original ask; that is the safer failure (it preserves the
 * user's words) but it is a real trade-off, not a settled question.
 */
export function resolveOriginalAsk(candidates: AskCandidates): OriginalAsk {
  const { inherited, appTask, firstUserMessage } = candidates;

  if (hasAskText(inherited)) {
    // Copy, preserving the ORIGINAL source and locator so the rendered bundle
    // still says where the user's words actually came from, plus the hop they
    // travelled through.
    const carried: OriginalAsk = {
      source: inherited!.source,
      text: inherited!.text,
    };
    if (inherited!.locator !== undefined) carried.locator = inherited!.locator;
    if (inherited!.note !== undefined) carried.note = inherited!.note;
    return carried;
  }

  if (appTask) {
    const text = formatAppTaskAsk(appTask.subject, appTask.description);
    if (text.trim().length > 0) {
      return { source: 'app-task', text, locator: `app task ${appTask.id}` };
    }
  }

  if (firstUserMessage && firstUserMessage.text.length > 0) {
    return {
      source: 'source-transcript',
      text: firstUserMessage.text,
      locator: firstUserMessage.transcriptPath,
    };
  }

  return {
    source: 'unavailable',
    text: '',
    note: candidates.unavailableNote
      ?? 'No linked app task, and no user turn could be recovered from the source transcript.',
  };
}

// ─── The trace ───────────────────────────────────────────────────────

export interface TranscriptRef {
  /** Position in the chain; 0 is the oldest session. Assigned by the builder. */
  hop: number;
  sessionId: string;
  /**
   * Which CLI wrote this file. Load-bearing, not decoration: the three schemas
   * are mutually unreadable (Claude `type:user|assistant` JSONL, Copilot
   * `user.message`/`assistant.message` events.jsonl, Kimi wire.jsonl), so a
   * receiver that greps the wrong field names finds nothing and concludes,
   * wrongly, that the prior session did nothing.
   */
  cliType: CliType;
  /** Absolute path to the raw transcript. Absent when it couldn't be located. */
  path?: string;
  /**
   * Narrowest directory that must be granted for `path` to be readable.
   * Computed by the caller (`dirname`), carried here so the pure layer can
   * aggregate grants without importing `path`.
   */
  dir?: string;
  /** Why `path` is missing, so the gap is visible instead of looking empty. */
  note?: string;
}

/** Per-CLI grep guidance. Keep in step with the parsers in lib/cli/transcript/. */
export const TRANSCRIPT_SCHEMA_HINTS: Readonly<Record<CliType, string>> = {
  claude:
    'JSONL, one JSON record per line. User turns: {"type":"user","message":{"role":"user","content":…}} '
    + '(content is a string, or an array of blocks). Assistant turns: {"type":"assistant",…}; tool calls are '
    + '"tool_use" blocks inside assistant messages, and their outcomes are "tool_result" blocks inside the '
    + 'FOLLOWING user record (so a "user" record is not necessarily a human turn). Sidechain/subagent records '
    + 'carry "isSidechain":true.',
  copilot:
    'events.jsonl, one event per line. User turns: {"type":"user.message","data":{"content":…}} — prefer '
    + '"content" over "transformedContent", which has harness text injected. Assistant turns: '
    + '"assistant.message". Tool calls: "tool.execution_start" {toolCallId,toolName,arguments} paired with '
    + '"tool.execution_complete" {toolCallId,success}.',
  kimi:
    'wire.jsonl — the main agent\'s communication record. ITS SCHEMA IS UNVERIFIED in this repo: do NOT assume '
    + 'Claude or Copilot field names. Read the first few lines to learn the shape before grepping for anything.',
};

/**
 * Merge trace entries oldest-first, one entry per session.
 *
 * Duplicates are possible when a chain revisits a session; the first (oldest)
 * position wins so ordering stays stable, but a later duplicate can fill in a
 * `path`/`dir` the earlier one lacked — the transcript may not have existed on
 * disk yet at the earlier hop.
 */
export function mergeTrace(...groups: ReadonlyArray<readonly TranscriptRef[]>): TranscriptRef[] {
  const order: string[] = [];
  const bySession = new Map<string, TranscriptRef>();

  for (const group of groups) {
    for (const ref of group) {
      const existing = bySession.get(ref.sessionId);
      if (!existing) {
        order.push(ref.sessionId);
        bySession.set(ref.sessionId, { ...ref });
        continue;
      }
      if (existing.path === undefined && ref.path !== undefined) {
        existing.path = ref.path;
        existing.dir = ref.dir;
        delete existing.note;
      }
    }
  }

  return order.map((sessionId, index) => ({ ...bySession.get(sessionId)!, hop: index }));
}

/**
 * Directories that must be granted so the receiver can read every transcript in
 * the trace. Deduplicated, order preserved (oldest hop first).
 */
export function traceGrantDirs(bundle: HandoffBundle): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const ref of bundle.trace) {
    if (!ref.dir || seen.has(ref.dir)) continue;
    seen.add(ref.dir);
    dirs.push(ref.dir);
  }
  return dirs;
}

// ─── The summary ─────────────────────────────────────────────────────

/**
 * The source agent's own account of its work. Named `SourceAccount` rather than
 * `Summary` on purpose: the receiver has to treat it as testimony from an
 * interested party, not as a record.
 */
export interface SourceAccount {
  sessionId: string;
  cliType: CliType;
  /** What the user asked the source agent to carry over (the modal's field). */
  contextRequest: string;
  /** The generated summary. Model output — may be wrong, may have drifted. */
  text: string;
}

// ─── The bundle ──────────────────────────────────────────────────────

export interface HandoffBundle {
  version: number;
  handoffId: string;
  /** Epoch ms, matching the repo's `createdAt` convention. */
  createdAt: number;
  /** Working directory the receiving session was spawned in. */
  targetCwd: string;
  /** Upstream handoff ids, oldest first, excluding this one. Empty on hop 1. */
  chain: string[];
  ask: OriginalAsk;
  /** Oldest session first; the last entry is the immediate source session. */
  trace: TranscriptRef[];
  /** `null` when the source agent produced no usable summary. */
  summary: SourceAccount | null;
}

export interface BundleInputs {
  handoffId: string;
  createdAt: number;
  targetCwd: string;
  /** The immediate source session, plus where its transcript lives. */
  source: {
    sessionId: string;
    cliType: CliType;
    transcriptPath?: string;
    transcriptDir?: string;
    /** Why the transcript is missing, when it is. */
    transcriptNote?: string;
  };
  /** The bundle from the handoff that created the source session, if any. */
  previous?: HandoffBundle | null;
  ask: OriginalAsk;
  /** The source agent's summary text; omit/empty for "no summary". */
  summaryText?: string | null;
  /** The context-transfer request the user typed. */
  contextRequest: string;
}

/**
 * Assemble a bundle. Pure: everything it needs has already been read.
 *
 * Chaining lives here. `previous` is the bundle written for the handoff that
 * created the source session, recovered from disk by the caller. Its trace is
 * prepended to the source session's own ref, so A→B→C yields
 * `[A, B]` for C — oldest first — and `chain` records `[A→B]` so the whole
 * lineage is walkable.
 */
export function buildHandoffBundle(inputs: BundleInputs): HandoffBundle {
  const { source, previous } = inputs;

  const sourceRef: TranscriptRef = {
    hop: 0, // reassigned by mergeTrace
    sessionId: source.sessionId,
    cliType: source.cliType,
  };
  if (source.transcriptPath !== undefined) {
    sourceRef.path = source.transcriptPath;
    if (source.transcriptDir !== undefined) sourceRef.dir = source.transcriptDir;
  } else {
    sourceRef.note = source.transcriptNote
      ?? `No transcript could be located for this ${source.cliType} session.`;
  }

  const trace = mergeTrace(previous?.trace ?? [], [sourceRef]);

  const chain = previous ? [...previous.chain, previous.handoffId] : [];

  const summaryText = inputs.summaryText?.trim();
  const summary: SourceAccount | null = summaryText
    ? {
      sessionId: source.sessionId,
      cliType: source.cliType,
      contextRequest: inputs.contextRequest,
      text: inputs.summaryText!,
    }
    : null;

  const ask: OriginalAsk = { ...inputs.ask };
  if (previous && hasAskText(previous.ask) && ask.text === previous.ask.text) {
    ask.inheritedFrom = previous.handoffId;
  }

  return {
    version: HANDOFF_BUNDLE_VERSION,
    handoffId: inputs.handoffId,
    createdAt: inputs.createdAt,
    targetCwd: inputs.targetCwd,
    chain,
    ask,
    trace,
    summary,
  };
}

/** Structural check for a bundle read back off disk (possibly hand-edited). */
export function isHandoffBundle(value: unknown): value is HandoffBundle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  if (typeof b.handoffId !== 'string' || b.handoffId.length === 0) return false;
  if (!Array.isArray(b.trace) || !Array.isArray(b.chain)) return false;
  const ask = b.ask as Record<string, unknown> | undefined;
  if (typeof ask !== 'object' || ask === null) return false;
  if (typeof ask.text !== 'string' || typeof ask.source !== 'string') return false;
  return true;
}

// ─── First-user-message recovery (pure; caller supplies the text) ─────

const CLAUDE_LOCAL_COMMAND_PREFIXES = ['<command-name>', '<command-message>', '<local-command-stdout>'];
const CLAUDE_LOCAL_COMMAND_CAVEAT = 'Caveat: The messages below were generated by the user';

/** Is this recovered text a real human turn, or app/harness plumbing? */
function isGenuineUserText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith(AGENTMATRIX_INJECTION_MARKER)) return false;
  if (trimmed.startsWith(CLAUDE_LOCAL_COMMAND_CAVEAT)) return false;
  return !CLAUDE_LOCAL_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

/** Pull the text out of a Claude `message.content` (string or block array). */
function claudeContentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  // A `user` record carrying tool_result blocks is the CLI reporting a tool's
  // output back to the model, not a human speaking. Skip the record entirely.
  if (content.some(block => (block as { type?: unknown })?.type === 'tool_result')) return undefined;
  const parts = content
    .filter(block => (block as { type?: unknown })?.type === 'text')
    .map(block => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string');
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Recover the first genuine user turn from raw transcript text.
 *
 * Returns the text EXACTLY as the CLI recorded it — no trimming, no reflowing,
 * no stripping. The filtering above decides *which record* counts as a human
 * turn; it never rewrites the record it picks. That is what keeps this inside
 * the verbatim guarantee.
 *
 * `kimi` returns undefined by design: wire.jsonl's schema is unverified here,
 * and guessing at field names could surface model output as "the user's ask" —
 * strictly worse than reporting the ask as unavailable.
 *
 * Malformed trailing lines are tolerated, so a caller may pass a bounded HEAD of
 * a multi-megabyte transcript rather than the whole file.
 */
export function extractFirstUserMessage(
  transcriptText: string,
  cliType: CliType,
): string | undefined {
  if (cliType === 'kimi') return undefined;

  for (const line of transcriptText.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // truncated head, or a line schema we don't care about
    }

    if (cliType === 'claude') {
      if (record.type !== 'user') continue;
      if (record.isSidechain === true || record.isMeta === true) continue;
      const message = record.message as { role?: unknown; content?: unknown } | undefined;
      if (!message || message.role !== 'user') continue;
      const text = claudeContentText(message.content);
      if (text !== undefined && isGenuineUserText(text)) return text;
      continue;
    }

    // copilot
    if (record.type !== 'user.message') continue;
    const content = (record.data as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && isGenuineUserText(content)) return content;
  }

  return undefined;
}

// ─── Rendering ───────────────────────────────────────────────────────

/**
 * A fence long enough to hold `text` unaltered. The ask is user prose and may
 * itself contain ``` fences; picking a longer fence is how the ask survives into
 * markdown byte-for-byte instead of being escaped or truncated.
 */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function askSourceLabel(ask: OriginalAsk): string {
  switch (ask.source) {
    case 'app-task':
      return `the linked app task (${ask.locator ?? 'unknown id'})`;
    case 'source-transcript':
      return `the first user turn in the source session's raw transcript (${ask.locator ?? 'unknown path'})`;
    case 'inherited':
      return ask.locator ?? 'an upstream handoff';
    case 'unavailable':
      return 'NOT AVAILABLE';
  }
}

/**
 * Render the bundle as the markdown the receiving session is pointed at.
 *
 * Section order is the point: the ask comes first and is labelled ground truth;
 * the raw trace comes second; the previous agent's account comes last and is
 * labelled as possibly-drifted. The final section turns that into an action —
 * reconcile before building.
 */
export function renderHandoffBundleMarkdown(bundle: HandoffBundle): string {
  const out: string[] = [];

  out.push(`# Context handoff — ${bundle.handoffId}`);
  out.push('');
  out.push(
    '<!-- Written by AgentMatrix. DO NOT DELETE: if this session is handed off again, '
    + 'the next bundle is built from this one. Deleting it breaks the provenance chain. -->',
  );
  out.push('');
  out.push(`Target working directory: \`${bundle.targetCwd}\``);
  if (bundle.chain.length > 0) {
    out.push(`Upstream handoffs (oldest first): ${bundle.chain.map(id => `\`${id}\``).join(' → ')}`);
  }
  out.push('');

  // ── 1. THE ASK ──
  out.push('## 1. THE ASK — the user\'s own words (GROUND TRUTH)');
  out.push('');
  if (bundle.ask.source === 'unavailable') {
    out.push('**The user\'s original ask could not be recovered.**');
    out.push('');
    out.push(`Reason: ${bundle.ask.note ?? 'unknown.'}`);
    out.push('');
    out.push(
      'It has deliberately NOT been replaced with the previous agent\'s summary — a paraphrase in this slot '
      + 'would be indistinguishable from ground truth. Ask the user to restate what they want before you '
      + 'build anything.',
    );
  } else {
    out.push(`Copied verbatim from ${askSourceLabel(bundle.ask)}.`);
    if (bundle.ask.inheritedFrom) {
      out.push('');
      out.push(
        `Carried forward unchanged through handoff \`${bundle.ask.inheritedFrom}\`. These are still the `
        + 'user\'s original bytes — this text has never been through a model.',
      );
    }
    out.push('');
    const fence = fenceFor(bundle.ask.text);
    out.push(`${fence}text`);
    out.push(bundle.ask.text);
    out.push(fence);
    out.push('');
    out.push('This is the specification. Where anything below disagrees with it, this wins.');
  }
  out.push('');

  // ── 2. THE TRACE ──
  out.push('## 2. THE TRACE — raw prior transcripts (oldest first)');
  out.push('');
  if (bundle.trace.length === 0) {
    out.push('No prior transcripts are available.');
  } else {
    out.push(
      'These are the previous agents\' unedited session logs. Grep them; do not take the summary in section 3 '
      + 'as a substitute. They can be large (multiple MB), so search them rather than reading them whole.',
    );
    out.push('');
    for (const ref of bundle.trace) {
      out.push(`### hop ${ref.hop} — session \`${ref.sessionId}\` (${ref.cliType})`);
      out.push('');
      if (ref.path) {
        out.push(`- Path: \`${ref.path}\``);
      } else {
        out.push(`- Path: **unavailable** — ${ref.note ?? 'not located.'}`);
      }
      out.push(`- Schema: ${TRANSCRIPT_SCHEMA_HINTS[ref.cliType]}`);
      out.push('');
    }
  }
  out.push('');

  // ── 3. THE PREVIOUS AGENT'S ACCOUNT ──
  out.push('## 3. THE PREVIOUS AGENT\'S OWN ACCOUNT (NOT ground truth)');
  out.push('');
  if (!bundle.summary) {
    out.push('The source session produced no usable summary. Work from sections 1 and 2.');
  } else {
    out.push(
      `Written by the source session (\`${bundle.summary.sessionId}\`, ${bundle.summary.cliType}) about itself, `
      + 'in response to the user\'s transfer request below. It is a model-generated paraphrase: it may be '
      + 'incomplete, and if that agent misunderstood the task it will describe the misunderstanding faithfully. '
      + 'Treat it as a map of where to look, not as a statement of what is true.',
    );
    out.push('');
    const requestFence = fenceFor(bundle.summary.contextRequest);
    out.push('Transfer request the user typed:');
    out.push('');
    out.push(`${requestFence}text`);
    out.push(bundle.summary.contextRequest);
    out.push(requestFence);
    out.push('');
    const summaryFence = fenceFor(bundle.summary.text);
    out.push(`${summaryFence}markdown`);
    out.push(bundle.summary.text);
    out.push(summaryFence);
  }
  out.push('');

  // ── 4. RECONCILE FIRST ──
  out.push('## 4. DO THIS FIRST — reconcile, then build');
  out.push('');
  if (bundle.ask.source === 'unavailable') {
    out.push('1. Tell the user the original ask could not be recovered and ask them to restate it.');
    out.push('2. Only then grep the transcripts in section 2 to see what was actually built.');
    out.push('3. Report divergences between what they restate and what you find.');
  } else {
    out.push('1. Re-read section 1. That, and only that, is what the user asked for.');
    out.push(
      '2. Grep the transcripts in section 2 for what the previous agent(s) actually did — files created and '
      + 'edited, decisions taken, direction chosen. Use the per-CLI schema notes; the formats differ.',
    );
    out.push(
      '3. Report, as a short list, every place prior work DIVERGES from the ask: work built in a direction the '
      + 'ask does not call for, scope the user never requested, and parts of the ask never addressed.',
    );
    out.push(
      '4. If you find a divergence, say so and ask how to proceed BEFORE writing code. Do not inherit the '
      + 'previous direction just because infrastructure for it already exists.',
    );
    out.push('5. If you find none, say so explicitly, then continue the work.');
  }
  out.push('');
  out.push('Do not delete this file or anything in section 2.');
  out.push('');

  return out.join('\n');
}

/**
 * The one-line instruction typed into the receiving session's PTY.
 *
 * Deliberately NOT "read this and internalize it" — that framing is what made
 * the previous agent's account read as fact. This asks for a reconciliation
 * report before any work starts, and it never asks the receiver to delete
 * anything.
 *
 * Prefixed with `AGENTMATRIX_INJECTION_MARKER` so that if this session is later
 * handed off, `extractFirstUserMessage` can recognise this turn as app plumbing
 * rather than mistaking it for the user's original ask.
 */
export function buildReconciliationInstruction(
  bundle: HandoffBundle,
  markdownPath: string,
): string {
  const traced = bundle.trace.filter(ref => ref.path).length;
  const parts = [
    `${AGENTMATRIX_INJECTION_MARKER} Before doing ANY work, read ${markdownPath}.`,
    'It contains three separate things:',
    '(1) the user\'s ORIGINAL ASK, verbatim and never passed through a model — this is ground truth;',
    `(2) absolute paths to ${traced} raw prior session transcript${traced === 1 ? '' : 's'}, oldest first, each tagged with which CLI wrote it;`,
    '(3) the previous agent\'s own summary, which is a paraphrase and may have drifted.',
    'Grep the raw transcripts and cross-check what was actually built against the original ask,',
    'then report every place prior work diverges from that ask — wrong direction, unrequested scope,',
    'or parts of the ask never addressed — and ask before continuing if you find any.',
    'Do NOT delete the handoff file or the transcripts; later handoffs read them.',
  ];
  return parts.join(' ');
}
