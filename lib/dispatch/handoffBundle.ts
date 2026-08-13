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
 * The bundle separates the four things that were blended into one summary:
 *
 *   1. THE ASK       the user's own words, VERBATIM. Never regenerated, never
 *                    passed through a model at any hop — see `OriginalAsk`.
 *   2. THE STANDARDS the project's own engineering rules, quoted VERBATIM from
 *                    the instruction file(s) on disk — see `ProjectStandards`.
 *   3. THE TRACE     absolute paths to the raw transcript of every session in
 *                    the chain, oldest first, each tagged with its `cliType` so
 *                    the receiver knows which schema it is grepping. Paths only:
 *                    real transcripts reach 9+ MB, so contents are never inlined.
 *   4. THE SUMMARY   the previous agent's own account, explicitly labelled as
 *                    possibly-drifted. Still useful as an entry point; never
 *                    ground truth.
 *
 * WHY STANDARDS ARE IN THE BUNDLE AT ALL
 * --------------------------------------
 * When an agent works IN the repo that holds `AGENTS.md`, its CLI discovers the
 * file natively and no help is needed. The gap is a handoff whose `targetCwd` is
 * a DIFFERENT directory from where the standards live: the receiver then works
 * to no standards at all, silently, and nothing ever checks that it read them.
 *
 * Note what this deliberately does NOT do: it does not push the standards in via
 * `SpawnOptions.systemPrompt`. That field reaches ONLY Claude (`ClaudeProvider`
 * maps it to `--append-system-prompt`); `CopilotProvider` ignores it and
 * `KimiProvider` has no equivalent flag. Standards injected that way would be
 * silently Claude-only — the same class of invisible failure this module exists
 * to remove. Quoting them into the bundle works for all three CLIs, because all
 * three can read a markdown file they have been pointed at.
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

// ─── The standards ───────────────────────────────────────────────────

/**
 * Instruction filenames to look for, in priority order.
 *
 * `AGENTS.md` first because it is the only one all three installed CLIs
 * recognise — it is the convention this repo standardises on. `CLAUDE.md` is
 * Claude's own additional filename, and `.github/copilot-instructions.md` is
 * Copilot's; both are included because a repo that predates the AGENTS.md
 * convention may only have one of those, and finding no standards when
 * standards exist is exactly the silent failure being fixed.
 *
 * Relative paths, resolved against a cwd by the I/O layer. Note the third entry
 * contains a separator: joining is the caller's job, and so is `dirname`.
 */
export const STANDARDS_FILENAMES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
] as const;

export type StandardsFilename = typeof STANDARDS_FILENAMES[number];

/**
 * Per-file cap on the verbatim excerpt, in characters.
 *
 * JUDGEMENT CALL, stated plainly. 8,000 characters is roughly 2,000 tokens, so
 * the worst realistic case (a source-repo file and a target-repo file, both
 * long) costs about 4,000 tokens of the receiver's context — comparable to one
 * medium source file, and far cheaper than the receiver building to no
 * standards at all. Most `AGENTS.md` files fit whole. When one does not, the
 * excerpt is still a byte-for-byte PREFIX and the absolute path is always
 * rendered next to it, so the receiver can read the remainder itself.
 *
 * The alternative — summarizing a long standards file to fit — is explicitly
 * rejected: a model-written paraphrase of a rule is not the rule.
 */
export const STANDARDS_EXCERPT_MAX_CHARS = 8_000;

/** Which cwd a standards file was discovered under. */
export type StandardsOrigin = 'source-cwd' | 'target-cwd';

export interface StandardsDoc {
  /** Absolute path to the file actually found. */
  path: string;
  /**
   * Narrowest directory that must be granted for `path` to be readable.
   * Computed by the caller (`dirname`), for the same reason `TranscriptRef.dir`
   * is: this module may not import `path`.
   */
  dir: string;
  /** Which convention matched, so the receiver knows what is in play. */
  filename: StandardsFilename;
  /** Whether this came from the source session's cwd or the target cwd. */
  origin: StandardsOrigin;
  /** The cwd it was found under. Absolute. */
  cwd: string;
  /**
   * The file's own bytes, VERBATIM — a prefix of the file, never a paraphrase.
   *
   * INVARIANT: `fileContents.startsWith(excerpt)` holds for every doc. Nothing
   * in this module or in `HandoffService` sends this text through a model, and
   * nothing reflows, re-wraps, or re-indents it. Same discipline as
   * `OriginalAsk.text`, for the same reason: a summarized rule is not the rule.
   */
  excerpt: string;
  /**
   * Characters dropped off the end of the excerpt. 0 when the whole file fits.
   *
   * A LOWER BOUND, not an exact figure: the I/O layer reads only a bounded head
   * of the file, so a pathologically large instruction file may have more
   * beyond what was measured. The rendered text says "at least".
   */
  omittedChars: number;
  /** True when `excerpt` is only the head of a longer file. */
  truncated: boolean;
}

/**
 * The standards half of the bundle.
 *
 * `state` exists so that "we looked and found nothing" is a value the bundle
 * HOLDS and RENDERS, exactly as `AskSource.unavailable` is. A missing standards
 * file must be visible to the receiver; an absent section would read as "there
 * are no rules here", which is indistinguishable from "nobody checked".
 */
export type StandardsState = 'found' | 'none-found';

export interface ProjectStandards {
  state: StandardsState;
  /** Every distinct file found, source cwd first. Empty when `none-found`. */
  docs: StandardsDoc[];
  /** Directories that were actually searched, so "none found" says where. */
  searchedDirs: string[];
  /** Filenames looked for, in priority order — rendered in the none-found case. */
  filenames: string[];
  /** Why nothing was found, or any caveat worth rendering. */
  note?: string;
}

/** True when the bundle carries at least one real standards file. */
export function hasStandards(standards: ProjectStandards | null | undefined): boolean {
  return !!standards && standards.state === 'found' && standards.docs.length > 0;
}

/**
 * The "we looked and found nothing" value. Never `null`, never an absent field:
 * the renderer must always have something to print.
 */
export function noStandardsFound(searchedDirs: string[] = [], note?: string): ProjectStandards {
  return {
    state: 'none-found',
    docs: [],
    searchedDirs,
    filenames: [...STANDARDS_FILENAMES],
    note: note
      ?? (searchedDirs.length === 0
        ? 'No directory could be searched: neither the source session\'s cwd nor the target cwd was known.'
        : 'None of the recognised instruction filenames exist in the directories searched.'),
  };
}

/**
 * Cut `contents` down to at most `maxChars`, VERBATIM.
 *
 * The result is always a byte-for-byte prefix of the input — that is the whole
 * point. The only cleverness is that when a cut lands mid-line, it is pulled
 * back to the previous newline (as long as that keeps at least half the budget),
 * so the excerpt ends on a whole rule rather than half a sentence. Pulling back
 * still yields a prefix, so the verbatim guarantee is untouched.
 */
export function excerptStandards(
  contents: string,
  maxChars: number = STANDARDS_EXCERPT_MAX_CHARS,
): { excerpt: string; omittedChars: number; truncated: boolean } {
  if (maxChars <= 0) {
    return { excerpt: '', omittedChars: contents.length, truncated: contents.length > 0 };
  }
  if (contents.length <= maxChars) {
    return { excerpt: contents, omittedChars: 0, truncated: false };
  }
  let cut = maxChars;
  const lastNewline = contents.lastIndexOf('\n', maxChars);
  if (lastNewline > maxChars / 2) cut = lastNewline;
  return {
    excerpt: contents.slice(0, cut),
    omittedChars: contents.length - cut,
    truncated: true,
  };
}

/** One candidate file, already located and read by the I/O layer. */
export interface StandardsCandidate {
  /** Absolute path. */
  path: string;
  /** `dirname(path)`, computed by the caller. */
  dir: string;
  filename: StandardsFilename;
  origin: StandardsOrigin;
  /** The cwd this candidate was found under. */
  cwd: string;
  /** The file's text as read from disk. Excerpting happens here, not there. */
  contents: string;
}

export interface StandardsInputs {
  candidates: readonly StandardsCandidate[];
  /** Directories the caller actually looked in, in the order it looked. */
  searchedDirs?: readonly string[];
  /** Override the per-file excerpt cap. Tests use this; production does not. */
  maxExcerptChars?: number;
  /** Rendered when nothing was found. */
  noneFoundNote?: string;
}

/**
 * Turn located files into the bundle's `standards` section. Pure.
 *
 * Order is preserved as given (the caller searches the source cwd first, then
 * the target cwd), and duplicates are collapsed BY ABSOLUTE PATH — when the
 * source and target cwd are the same directory, one file must not be reported
 * twice. The first occurrence wins, so a file present under both is attributed
 * to the source cwd.
 *
 * JUDGEMENT CALL: every distinct file found is reported, not just the
 * highest-priority one. A repo with both `AGENTS.md` and `CLAUDE.md` gets both
 * quoted. They are often near-duplicates, which costs some context — but
 * silently dropping one of two files that both claim to state the rules is the
 * failure mode this section exists to remove, and the receiver can see for
 * itself that they overlap.
 */
export function resolveProjectStandards(inputs: StandardsInputs): ProjectStandards {
  const searchedDirs = [...(inputs.searchedDirs ?? [])];
  const cap = inputs.maxExcerptChars ?? STANDARDS_EXCERPT_MAX_CHARS;

  const seen = new Set<string>();
  const docs: StandardsDoc[] = [];
  for (const candidate of inputs.candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    const { excerpt, omittedChars, truncated } = excerptStandards(candidate.contents, cap);
    docs.push({
      path: candidate.path,
      dir: candidate.dir,
      filename: candidate.filename,
      origin: candidate.origin,
      cwd: candidate.cwd,
      excerpt,
      omittedChars,
      truncated,
    });
  }

  if (docs.length === 0) return noStandardsFound(searchedDirs, inputs.noneFoundNote);

  return {
    state: 'found',
    docs,
    searchedDirs,
    filenames: [...STANDARDS_FILENAMES],
  };
}

/**
 * Directories that must be granted so the receiver can read every standards
 * file. Deduplicated, order preserved.
 *
 * SCOPING: `dir` is the file's own containing directory and nothing above it.
 * For `.github/copilot-instructions.md` that is `<repo>/.github` — tight. For a
 * root-level `AGENTS.md` the containing directory IS the repo root, which is as
 * narrow as the convention permits; the alternative would be granting the file
 * path itself, and `--add-dir` is documented as taking directories and was not
 * verified to accept a file. That trade-off is already documented for
 * transcripts in `HandoffService.computeAddDirs`, and it is the same one here.
 */
export function standardsGrantDirs(bundle: HandoffBundle): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const doc of bundle.standards?.docs ?? []) {
    if (!doc.dir || seen.has(doc.dir)) continue;
    seen.add(doc.dir);
    dirs.push(doc.dir);
  }
  return dirs;
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
  codex:
    'rollout-<timestamp>-<uuid>.jsonl under ~/.codex/sessions/YYYY/MM/DD/. Every line is a wrapper record '
    + '{"timestamp":…,"type":…,"payload":{…}}; the first line is {"type":"session_meta","payload":{"id","cwd",'
    + '"originator","cli_version",…}}. THE PER-ITEM SCHEMA BEYOND THAT HEADER IS UNVERIFIED in this repo: do NOT '
    + 'assume Claude or Copilot field names. Read the first few lines to learn the shape before grepping.',
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
  /**
   * The project's engineering rules, quoted verbatim. Never `null` and never
   * absent — "none found" is a value it holds, so the gap always renders.
   *
   * Optional in the TYPE only so that a v1 bundle written before this field
   * existed still satisfies `isHandoffBundle` when read back off disk at the
   * next hop. Every bundle `buildHandoffBundle` produces has it set.
   */
  standards?: ProjectStandards;
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
  /**
   * Standards discovered for THIS hop. Omit and the bundle records "none
   * found", which renders as a visible gap.
   *
   * Deliberately NOT inherited from `previous`, unlike the ask. The ask is the
   * user's fixed intent and must survive every hop unchanged; standards are a
   * property of the directories this particular hop runs in. Carrying an
   * upstream repo's `AGENTS.md` into a handoff that has since moved elsewhere
   * would present rules that do not govern the receiver's work as if they did.
   */
  standards?: ProjectStandards | null;
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
    standards: inputs.standards ?? noStandardsFound(),
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
  // Prefix check only. A marker appearing MID-string means the user's own text
  // and an injected prompt were submitted as one turn — see
  // `stripInjectedTail`, which recovers the user's half rather than discarding
  // the whole turn.
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
/**
 * Recover the user's half of a turn that also contains an injected prompt.
 *
 * `PromptInjector` types into the session's input box. If the user had text
 * sitting there unsubmitted when a summary/handoff fired, both are submitted as
 * ONE user turn and the transcript records them concatenated — observed live:
 *   "…Do not modify any source file.[agentmatrix] URGENT: Complete in under 30s…"
 *
 * Rejecting the whole turn would lose the ask entirely; keeping it would let
 * AgentMatrix's own words masquerade as the user's. Cutting at the marker keeps
 * exactly the user-authored prefix, still byte-for-byte — no rewriting.
 *
 * Returns undefined when nothing user-authored remains.
 */
export function stripInjectedTail(text: string): string | undefined {
  const at = text.indexOf(AGENTMATRIX_INJECTION_MARKER);
  if (at < 0) return text;
  const head = text.slice(0, at).replace(/[\r\n]+$/, '');
  return head.trim().length > 0 ? head : undefined;
}

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
      if (text !== undefined && isGenuineUserText(text)) {
        const user = stripInjectedTail(text);
        if (user !== undefined) return user;
      }
      continue;
    }

    // copilot
    if (record.type !== 'user.message') continue;
    const content = (record.data as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && isGenuineUserText(content)) {
      const user = stripInjectedTail(content);
      if (user !== undefined) return user;
    }
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

function standardsOriginLabel(origin: StandardsOrigin): string {
  return origin === 'source-cwd'
    ? 'the source session\'s working directory'
    : 'the target working directory';
}

/**
 * Section 2. Either every found file quoted verbatim, or a loud, specific
 * account of where we looked and found nothing.
 */
function renderStandardsSection(standards: ProjectStandards, out: string[]): void {
  out.push('## 2. THE STANDARDS — the project\'s engineering rules (BINDING)');
  out.push('');

  if (!hasStandards(standards)) {
    out.push('**No project standards file was found.**');
    out.push('');
    out.push(`Reason: ${standards.note ?? 'unknown.'}`);
    out.push('');
    if (standards.searchedDirs.length > 0) {
      out.push('Looked for '
        + standards.filenames.map(name => `\`${name}\``).join(', ')
        + ' in:');
      out.push('');
      for (const dir of standards.searchedDirs) out.push(`- \`${dir}\``);
      out.push('');
    }
    out.push(
      'This is stated rather than omitted on purpose: an absent section would read as "this project has no '
      + 'rules", which is indistinguishable from "nobody checked". Nothing has been substituted here — no '
      + 'invented conventions, and no rules inferred from the summary in section 4.',
    );
    out.push('');
    out.push(
      'Say so explicitly in your first reply, and ask the user where the project\'s standards live before you '
      + 'write code.',
    );
    return;
  }

  out.push(
    'Quoted verbatim from the file(s) below. These are the project\'s rules and they are BINDING on your work — '
    + 'they constrain HOW you build, while section 1 defines WHAT. They are reproduced here because your CLI '
    + 'will only discover an instruction file inside its own working directory, and a handoff can move you out '
    + 'of the directory where these live.',
  );
  out.push('');
  out.push(
    'None of this text has been through a model: it is a byte-for-byte prefix of the file, not a summary. Where '
    + 'an excerpt is truncated, the absolute path is given — read the rest yourself rather than guessing at it.',
  );
  out.push('');

  for (const doc of standards.docs) {
    out.push(`### \`${doc.filename}\` — ${standardsOriginLabel(doc.origin)}`);
    out.push('');
    out.push(`- Full file: \`${doc.path}\``);
    out.push(`- Found under: \`${doc.cwd}\``);
    if (doc.truncated) {
      out.push(
        `- Excerpt: the first ${doc.excerpt.length} characters, verbatim. At least ${doc.omittedChars} more `
        + 'characters follow in the file — open the path above to read them before you rely on this section '
        + 'being complete.',
      );
    } else {
      out.push(`- Excerpt: the complete file, verbatim (${doc.excerpt.length} characters).`);
    }
    out.push('');
    if (doc.excerpt.trim().length === 0) {
      out.push('**This file exists but is empty.** It states no rules; do not infer any.');
      out.push('');
      continue;
    }
    const fence = fenceFor(doc.excerpt);
    out.push(`${fence}markdown`);
    out.push(doc.excerpt);
    out.push(fence);
    out.push('');
  }

  out.push(
    'Where these rules and the previous agent\'s work in section 4 disagree, these rules win. Where these rules '
    + 'and the ask in section 1 genuinely conflict, do not silently pick one — say so and ask.',
  );
}

/**
 * Render the bundle as the markdown the receiving session is pointed at.
 *
 * Section order is the point: the ask comes first and is labelled ground truth;
 * the project's standards come second, because they constrain everything that
 * follows; the raw trace comes third; the previous agent's account comes last
 * and is labelled as possibly-drifted. The final section turns all of that into
 * an action — reconcile and acknowledge before building.
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

  // ── 2. THE STANDARDS ──
  // Never conditional: a bundle read back from an older build may have no
  // `standards` field at all, and that must still render as a visible gap.
  renderStandardsSection(bundle.standards ?? noStandardsFound(), out);
  out.push('');

  // ── 3. THE TRACE ──
  out.push('## 3. THE TRACE — raw prior transcripts (oldest first)');
  out.push('');
  if (bundle.trace.length === 0) {
    out.push('No prior transcripts are available.');
  } else {
    out.push(
      'These are the previous agents\' unedited session logs. Grep them; do not take the summary in section 4 '
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

  // ── 4. THE PREVIOUS AGENT'S ACCOUNT ──
  out.push('## 4. THE PREVIOUS AGENT\'S OWN ACCOUNT (NOT ground truth)');
  out.push('');
  if (!bundle.summary) {
    out.push('The source session produced no usable summary. Work from sections 1 to 3.');
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

  // ── 5. RECONCILE FIRST ──
  out.push('## 5. DO THIS FIRST — acknowledge, reconcile, then build');
  out.push('');
  out.push(
    'Every step below happens BEFORE you write any code, and each one produces visible output. An '
    + 'unacknowledged standard and an unreported divergence look identical to work done correctly — that is the '
    + 'silent failure this document exists to prevent.',
  );
  out.push('');

  const steps: string[] = [];
  if (hasStandards(bundle.standards)) {
    steps.push(
      'Read section 2 in full, plus the full file at each path it lists if the excerpt was truncated. Then '
      + 'ACKNOWLEDGE the standards explicitly: name each file you read, and list the specific constraints from '
      + 'it that apply to this task. "I have read the standards" on its own does not count — the list is the '
      + 'acknowledgement.',
    );
  } else {
    steps.push(
      'State explicitly that NO project standards file was found (section 2 records where we looked), and ask '
      + 'the user where the project\'s standards live. Do not invent conventions and do not infer them from the '
      + 'previous agent\'s summary.',
    );
  }

  if (bundle.ask.source === 'unavailable') {
    steps.push('Tell the user the original ask could not be recovered and ask them to restate it.');
    steps.push('Only then grep the transcripts in section 3 to see what was actually built.');
    steps.push('Report divergences between what they restate and what you find.');
  } else {
    steps.push('Re-read section 1. That, and only that, is what the user asked for.');
    steps.push(
      'Grep the transcripts in section 3 for what the previous agent(s) actually did — files created and '
      + 'edited, decisions taken, direction chosen. Use the per-CLI schema notes; the formats differ.',
    );
    steps.push(
      'Report, as a short list, every place prior work DIVERGES from the ask OR from the standards in '
      + 'section 2: work built in a direction the ask does not call for, scope the user never requested, parts '
      + 'of the ask never addressed, and existing code that breaks the project\'s own rules.',
    );
    steps.push(
      'If you find a divergence, say so and ask how to proceed BEFORE writing code. Do not inherit the '
      + 'previous direction just because infrastructure for it already exists.',
    );
    steps.push('If you find none, say so explicitly, then continue the work — under the standards in section 2.');
  }

  steps.forEach((step, index) => out.push(`${index + 1}. ${step}`));
  out.push('');
  out.push('Do not delete this file or anything in section 3.');
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
 * It also demands an EXPLICIT acknowledgement of the project standards. Being
 * handed rules and quietly not reading them is indistinguishable, from the
 * outside, from having read and followed them; requiring the receiver to name
 * the constraints back is what makes the difference observable.
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
  const standards = bundle.standards ?? noStandardsFound();
  const found = hasStandards(standards);

  const standardsItem = found
    ? `(2) the project's ENGINEERING STANDARDS, quoted verbatim from ${standards.docs.length} instruction `
      + `file${standards.docs.length === 1 ? '' : 's'} on disk — these are binding on how you work;`
    : '(2) a STANDARDS section recording that no project standards file could be found, and where we looked;';

  const standardsAction = found
    ? 'BEFORE anything else, read the standards section in full and acknowledge it explicitly in your first '
      + 'reply: name each standards file and list the specific constraints from it that apply to this task '
      + '(saying only "I have read the standards" does not count).'
    : 'BEFORE anything else, state explicitly in your first reply that NO project standards file was found, and '
      + 'ask where the project\'s standards live — do not invent conventions or infer them from the summary.';

  const parts = [
    `${AGENTMATRIX_INJECTION_MARKER} Before doing ANY work, read ${markdownPath}.`,
    'It contains four separate things:',
    '(1) the user\'s ORIGINAL ASK, verbatim and never passed through a model — this is ground truth;',
    standardsItem,
    `(3) absolute paths to ${traced} raw prior session transcript${traced === 1 ? '' : 's'}, oldest first, each tagged with which CLI wrote it;`,
    '(4) the previous agent\'s own summary, which is a paraphrase and may have drifted.',
    standardsAction,
    'Then grep the raw transcripts and cross-check what was actually built against the original ask,',
    'and report every place prior work diverges from that ask or from those standards — wrong direction,',
    'unrequested scope, parts of the ask never addressed, or code that breaks the project\'s own rules —',
    'and ask before continuing if you find any.',
    'Do NOT delete the handoff file or the transcripts; later handoffs read them.',
  ];
  return parts.join(' ');
}
