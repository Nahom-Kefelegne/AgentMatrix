/**
 * Tests for the pure half of context handoff.
 *
 *   npx vitest run lib/dispatch/handoffBundle.test.ts   — this file only
 *   npx vitest run                                       — one-shot, whole suite
 *   npm test                                             — same as `vitest run`
 *
 * Deliberately dependency-light, matching `orchestratorProvider.test.ts`:
 * everything under test in `handoffBundle.ts` is pure, so nothing here touches
 * the filesystem, a provider, or a PTY. Transcript text is passed in as a
 * string; grant directories are passed in pre-computed.
 *
 * The property most of these tests exist to protect: THE ASK IS NEVER
 * REGENERATED. It is copied from an app task, from a transcript record, or from
 * an upstream bundle — and it comes out the far end of a multi-hop chain
 * byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENTMATRIX_INJECTION_MARKER,
  HANDOFF_BUNDLE_VERSION,
  STANDARDS_EXCERPT_MAX_CHARS,
  STANDARDS_FILENAMES,
  buildHandoffBundle,
  buildReconciliationInstruction,
  excerptStandards,
  extractFirstUserMessage,
  fenceFor,
  formatAppTaskAsk,
  hasAskText,
  hasStandards,
  isHandoffBundle,
  mergeTrace,
  noStandardsFound,
  renderHandoffBundleMarkdown,
  resolveOriginalAsk,
  resolveProjectStandards,
  standardsGrantDirs,
  traceGrantDirs,
  type HandoffBundle,
  type StandardsCandidate,
  type TranscriptRef,
} from './handoffBundle';

// ─── Fixtures ────────────────────────────────────────────────────────

const ASK_TEXT = 'Add a rate limiter to the /login endpoint. Do NOT touch the session store.';

const CLAUDE_DIR = '/home/u/.claude/projects/-home-u-repo';
const CLAUDE_A = `${CLAUDE_DIR}/aaaa1111.jsonl`;
const CLAUDE_B = `${CLAUDE_DIR}/bbbb2222.jsonl`;
const COPILOT_DIR = '/home/u/.copilot/session-state/cccc3333';
const COPILOT_C = `${COPILOT_DIR}/events.jsonl`;

const SOURCE_CWD = '/src/api';
const TARGET_CWD = '/target/web';
const SOURCE_AGENTS_MD = `${SOURCE_CWD}/AGENTS.md`;
const TARGET_AGENTS_MD = `${TARGET_CWD}/AGENTS.md`;

/** Real-shaped standards text, including a fence, so verbatim survival is testable. */
const STANDARDS_TEXT = [
  '# Engineering standards',
  '',
  '- No `any`. Ever.',
  '- Every exported function carries a doc comment saying WHY.',
  '',
  '```sh',
  'npm test   # must pass before you claim done',
  '```',
].join('\n');

function standardsCandidate(over: Partial<StandardsCandidate> = {}): StandardsCandidate {
  return {
    path: SOURCE_AGENTS_MD,
    dir: SOURCE_CWD,
    filename: 'AGENTS.md',
    origin: 'source-cwd',
    cwd: SOURCE_CWD,
    contents: STANDARDS_TEXT,
    ...over,
  };
}

function claudeUserLine(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
}

function copilotUserLine(content: string): string {
  return JSON.stringify({ type: 'user.message', data: { content } });
}

/** Hop 1: A -> B, ask taken from A's linked app task. */
function bundleAtoB(): HandoffBundle {
  return buildHandoffBundle({
    handoffId: 'hf-1',
    createdAt: 1000,
    targetCwd: '/repo',
    contextRequest: 'carry over the auth work',
    source: {
      sessionId: 'sess-A',
      cliType: 'claude',
      transcriptPath: CLAUDE_A,
      transcriptDir: CLAUDE_DIR,
    },
    ask: resolveOriginalAsk({
      appTask: { id: 't-7', subject: 'Rate limit login', description: ASK_TEXT },
    }),
    summaryText: 'I built a Redis-backed token bucket and refactored the session store.',
  });
}

/** Hop 2: B -> C, chaining onto hop 1. B is a Copilot session. */
function bundleBtoC(previous: HandoffBundle): HandoffBundle {
  return buildHandoffBundle({
    handoffId: 'hf-2',
    createdAt: 2000,
    targetCwd: '/repo',
    contextRequest: 'keep going',
    source: {
      sessionId: 'sess-B',
      cliType: 'copilot',
      transcriptPath: COPILOT_C,
      transcriptDir: COPILOT_DIR,
    },
    previous,
    ask: resolveOriginalAsk({
      inherited: previous.ask,
      // B has its own (misleading) first user turn — the injected instruction.
      firstUserMessage: {
        text: `${AGENTMATRIX_INJECTION_MARKER} Before doing ANY work, read /tmp/handoff.md.`,
        transcriptPath: COPILOT_C,
      },
    }),
    summaryText: 'Continued the Redis work.',
  });
}

// ─── Sourcing the ask ────────────────────────────────────────────────

describe('resolveOriginalAsk — where the ask comes from', () => {
  it('uses the linked app task, joining subject and description verbatim', () => {
    const ask = resolveOriginalAsk({
      appTask: { id: 't-7', subject: 'Rate limit login', description: ASK_TEXT },
    });
    expect(ask.source).toBe('app-task');
    expect(ask.text).toBe(`Rate limit login\n\n${ASK_TEXT}`);
    expect(ask.locator).toBe('app task t-7');
  });

  it('uses just the subject when the task has no description', () => {
    const ask = resolveOriginalAsk({
      appTask: { id: 't-8', subject: 'Rate limit login', description: '   ' },
    });
    expect(ask.text).toBe('Rate limit login');
  });

  it('falls back to the first user message when there is no app task', () => {
    const ask = resolveOriginalAsk({
      appTask: null,
      firstUserMessage: { text: ASK_TEXT, transcriptPath: CLAUDE_A },
    });
    expect(ask.source).toBe('source-transcript');
    expect(ask.text).toBe(ASK_TEXT);
    expect(ask.locator).toBe(CLAUDE_A);
  });

  it('prefers the app task over the transcript when both exist', () => {
    const ask = resolveOriginalAsk({
      appTask: { id: 't-9', subject: 'From task', description: '' },
      firstUserMessage: { text: 'From transcript', transcriptPath: CLAUDE_A },
    });
    expect(ask.source).toBe('app-task');
    expect(ask.text).toBe('From task');
  });

  it('reports the ask as unavailable rather than substituting anything', () => {
    const ask = resolveOriginalAsk({ unavailableNote: 'transcript not found' });
    expect(ask.source).toBe('unavailable');
    expect(ask.text).toBe('');
    expect(ask.note).toBe('transcript not found');
    expect(hasAskText(ask)).toBe(false);
  });

  it('supplies a default note when the caller gives no reason', () => {
    expect(resolveOriginalAsk({}).note).toMatch(/no user turn could be recovered/i);
  });

  it('inherits ahead of both other sources, so a later hop keeps the original', () => {
    const ask = resolveOriginalAsk({
      inherited: { source: 'app-task', text: ASK_TEXT, locator: 'app task t-7' },
      appTask: { id: 't-99', subject: 'Something else entirely', description: '' },
      firstUserMessage: { text: 'the injected handoff instruction', transcriptPath: COPILOT_C },
    });
    expect(ask.text).toBe(ASK_TEXT);
    // The ORIGINAL provenance is preserved, not overwritten with 'inherited'.
    expect(ask.source).toBe('app-task');
    expect(ask.locator).toBe('app task t-7');
  });

  it('ignores an inherited ask that carries no text', () => {
    const ask = resolveOriginalAsk({
      inherited: { source: 'unavailable', text: '', note: 'nothing upstream' },
      appTask: { id: 't-10', subject: 'Real ask', description: '' },
    });
    expect(ask.source).toBe('app-task');
    expect(ask.text).toBe('Real ask');
  });
});

describe('formatAppTaskAsk', () => {
  it('preserves both fields byte-for-byte, including internal whitespace', () => {
    const subject = '  Fix   the  thing  ';
    const description = 'line 1\n\n  line 3 with `backticks`';
    expect(formatAppTaskAsk(subject, description)).toBe(`${subject}\n\n${description}`);
  });
});

// ─── Recovering the first user message ───────────────────────────────

describe('extractFirstUserMessage — Claude JSONL', () => {
  it('reads a plain string content', () => {
    const text = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'noise' }),
      claudeUserLine(ASK_TEXT),
      claudeUserLine('a later turn'),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('reads text blocks out of an array content', () => {
    const text = claudeUserLine([{ type: 'text', text: ASK_TEXT }]);
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('skips tool_result records, which are the CLI speaking rather than the user', () => {
    const text = [
      claudeUserLine([{ type: 'tool_result', tool_use_id: 'x', content: 'file written' }]),
      claudeUserLine(ASK_TEXT),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('skips sidechain and meta records', () => {
    const text = [
      claudeUserLine('subagent prompt', { isSidechain: true }),
      claudeUserLine('harness note', { isMeta: true }),
      claudeUserLine(ASK_TEXT),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('skips AgentMatrix\'s own injected prompts', () => {
    const text = [
      claudeUserLine(`${AGENTMATRIX_INJECTION_MARKER} Before doing ANY work, read /tmp/h.md.`),
      claudeUserLine(ASK_TEXT),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('skips slash-command plumbing and the local-command caveat', () => {
    const text = [
      claudeUserLine('Caveat: The messages below were generated by the user while running local commands.'),
      claudeUserLine('<command-name>/clear</command-name>'),
      claudeUserLine(ASK_TEXT),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('tolerates a truncated trailing line, so a bounded head is safe to pass', () => {
    const text = `${claudeUserLine(ASK_TEXT)}\n{"type":"assistant","mess`;
    expect(extractFirstUserMessage(text, 'claude')).toBe(ASK_TEXT);
  });

  it('returns undefined when there is no user turn at all', () => {
    expect(extractFirstUserMessage('{"type":"assistant"}', 'claude')).toBeUndefined();
    expect(extractFirstUserMessage('', 'claude')).toBeUndefined();
  });

  it('does not trim or reflow the recovered text', () => {
    const messy = '  leading and trailing  \n\n\ttabbed\n';
    expect(extractFirstUserMessage(claudeUserLine(messy), 'claude')).toBe(messy);
  });
});

describe('extractFirstUserMessage — Copilot events.jsonl', () => {
  it('reads data.content, not the harness-augmented transformedContent', () => {
    const line = JSON.stringify({
      type: 'user.message',
      data: { content: ASK_TEXT, transformedContent: `<current_datetime/>\n\n${ASK_TEXT}` },
    });
    expect(extractFirstUserMessage(line, 'copilot')).toBe(ASK_TEXT);
  });

  it('ignores non-user events and injected prompts', () => {
    const text = [
      JSON.stringify({ type: 'session.start', data: {} }),
      JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'edit' } }),
      copilotUserLine(`${AGENTMATRIX_INJECTION_MARKER} read the bundle`),
      copilotUserLine(ASK_TEXT),
    ].join('\n');
    expect(extractFirstUserMessage(text, 'copilot')).toBe(ASK_TEXT);
  });

  it('does not read a Claude transcript with the Copilot schema', () => {
    expect(extractFirstUserMessage(claudeUserLine(ASK_TEXT), 'copilot')).toBeUndefined();
  });
});

describe('extractFirstUserMessage — Kimi', () => {
  it('returns undefined: wire.jsonl\'s schema is unverified, so nothing is guessed', () => {
    const looksClaudeish = claudeUserLine(ASK_TEXT);
    expect(extractFirstUserMessage(looksClaudeish, 'kimi')).toBeUndefined();
    expect(extractFirstUserMessage(copilotUserLine(ASK_TEXT), 'kimi')).toBeUndefined();
  });
});

// ─── Trace assembly and chaining ─────────────────────────────────────

describe('mergeTrace', () => {
  const ref = (sessionId: string, over: Partial<TranscriptRef> = {}): TranscriptRef => ({
    hop: 0, sessionId, cliType: 'claude', ...over,
  });

  it('renumbers hops sequentially, oldest first', () => {
    const merged = mergeTrace([ref('a'), ref('b')], [ref('c')]);
    expect(merged.map(r => [r.sessionId, r.hop])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('keeps one entry per session, at its earliest position', () => {
    const merged = mergeTrace([ref('a'), ref('b')], [ref('a')]);
    expect(merged.map(r => r.sessionId)).toEqual(['a', 'b']);
  });

  it('backfills a path a later duplicate knows about', () => {
    const merged = mergeTrace(
      [ref('a', { note: 'not written yet' })],
      [ref('a', { path: CLAUDE_A, dir: CLAUDE_DIR })],
    );
    expect(merged[0].path).toBe(CLAUDE_A);
    expect(merged[0].dir).toBe(CLAUDE_DIR);
    expect(merged[0].note).toBeUndefined();
  });
});

describe('buildHandoffBundle — single hop', () => {
  const bundle = bundleAtoB();

  it('stamps the current version and no upstream chain', () => {
    expect(bundle.version).toBe(HANDOFF_BUNDLE_VERSION);
    expect(bundle.chain).toEqual([]);
  });

  it('traces exactly the source session, with its path and cliType', () => {
    expect(bundle.trace).toHaveLength(1);
    expect(bundle.trace[0]).toMatchObject({
      hop: 0, sessionId: 'sess-A', cliType: 'claude', path: CLAUDE_A, dir: CLAUDE_DIR,
    });
  });

  it('keeps the summary, attributed to the source session', () => {
    expect(bundle.summary?.sessionId).toBe('sess-A');
    expect(bundle.summary?.cliType).toBe('claude');
    expect(bundle.summary?.contextRequest).toBe('carry over the auth work');
  });

  it('records the trace gap when no transcript could be located', () => {
    const noTranscript = buildHandoffBundle({
      handoffId: 'hf-x', createdAt: 1, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 'sess-Z', cliType: 'kimi' },
      ask: resolveOriginalAsk({}),
    });
    expect(noTranscript.trace[0].path).toBeUndefined();
    expect(noTranscript.trace[0].note).toMatch(/no transcript/i);
    expect(noTranscript.summary).toBeNull();
  });

  it('treats a whitespace-only summary as no summary', () => {
    const blank = buildHandoffBundle({
      handoffId: 'hf-y', createdAt: 1, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude' },
      ask: resolveOriginalAsk({}),
      summaryText: '   \n  ',
    });
    expect(blank.summary).toBeNull();
  });
});

describe('buildHandoffBundle — multi-hop A -> B -> C', () => {
  const hop1 = bundleAtoB();
  const hop2 = bundleBtoC(hop1);

  it('gives C both A\'s and B\'s transcripts, in order', () => {
    expect(hop2.trace.map(r => r.sessionId)).toEqual(['sess-A', 'sess-B']);
    expect(hop2.trace.map(r => r.hop)).toEqual([0, 1]);
  });

  it('tags each transcript with the CLI that wrote it, because the formats differ', () => {
    expect(hop2.trace.map(r => r.cliType)).toEqual(['claude', 'copilot']);
    expect(hop2.trace[0].path).toBe(CLAUDE_A);
    expect(hop2.trace[1].path).toBe(COPILOT_C);
  });

  it('records the upstream handoff ids, oldest first', () => {
    expect(hop2.chain).toEqual(['hf-1']);
  });

  it('carries A\'s ask to C byte-for-byte, not B\'s injected instruction', () => {
    expect(hop2.ask.text).toBe(hop1.ask.text);
    expect(hop2.ask.text).toBe(`Rate limit login\n\n${ASK_TEXT}`);
    expect(hop2.ask.inheritedFrom).toBe('hf-1');
    expect(hop2.ask.text).not.toContain(AGENTMATRIX_INJECTION_MARKER);
  });

  it('replaces the summary with the immediate source\'s, not A\'s', () => {
    expect(hop2.summary?.sessionId).toBe('sess-B');
    expect(hop2.summary?.text).toBe('Continued the Redis work.');
  });

  it('survives a third hop: C -> D still holds A\'s ask and all three transcripts', () => {
    const hop3 = buildHandoffBundle({
      handoffId: 'hf-3', createdAt: 3000, targetCwd: '/repo', contextRequest: 'again',
      source: { sessionId: 'sess-C', cliType: 'claude', transcriptPath: CLAUDE_B, transcriptDir: CLAUDE_DIR },
      previous: hop2,
      ask: resolveOriginalAsk({ inherited: hop2.ask }),
      summaryText: 'more work',
    });
    expect(hop3.trace.map(r => r.sessionId)).toEqual(['sess-A', 'sess-B', 'sess-C']);
    expect(hop3.chain).toEqual(['hf-1', 'hf-2']);
    expect(hop3.ask.text).toBe(hop1.ask.text);
  });

  it('round-trips through JSON, which is how the chain is actually stored', () => {
    const revived = JSON.parse(JSON.stringify(hop2));
    expect(isHandoffBundle(revived)).toBe(true);
    expect(revived).toEqual(hop2);
  });
});

describe('traceGrantDirs', () => {
  it('deduplicates directories while preserving hop order', () => {
    const hop3 = buildHandoffBundle({
      handoffId: 'hf-3', createdAt: 3, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 'sess-C', cliType: 'claude', transcriptPath: CLAUDE_B, transcriptDir: CLAUDE_DIR },
      previous: bundleBtoC(bundleAtoB()),
      ask: resolveOriginalAsk({}),
    });
    // sess-A and sess-C share the Claude project dir; sess-B is Copilot.
    expect(traceGrantDirs(hop3)).toEqual([CLAUDE_DIR, COPILOT_DIR]);
  });

  it('omits refs with no locatable transcript', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-4', createdAt: 4, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 'sess-Z', cliType: 'kimi' },
      ask: resolveOriginalAsk({}),
    });
    expect(traceGrantDirs(bundle)).toEqual([]);
  });
});

// ─── Project standards ───────────────────────────────────────────────
//
// The property these protect mirrors the one protecting the ask: A STANDARDS
// EXCERPT IS NEVER MODEL TEXT. It is a byte-for-byte prefix of a file on disk,
// and when nothing is found that absence is a value the bundle holds and
// renders — never a quietly missing section.

describe('excerptStandards — bounded, but always verbatim', () => {
  it('returns a short file whole, untruncated', () => {
    const result = excerptStandards(STANDARDS_TEXT, 8000);
    expect(result.excerpt).toBe(STANDARDS_TEXT);
    expect(result.truncated).toBe(false);
    expect(result.omittedChars).toBe(0);
  });

  it('truncates at the cap and reports how much was dropped', () => {
    const long = 'x'.repeat(500);
    const result = excerptStandards(long, 100);
    expect(result.truncated).toBe(true);
    expect(result.excerpt).toHaveLength(100);
    expect(result.omittedChars).toBe(400);
  });

  it('pulls the cut back to a line boundary rather than splitting a rule', () => {
    const lines = ['- rule one', '- rule two', '- rule three that runs past the cap'].join('\n');
    const result = excerptStandards(lines, 25);
    // 25 lands inside "- rule three…"; the cut retreats to the newline after two.
    expect(result.excerpt).toBe('- rule one\n- rule two');
    expect(result.truncated).toBe(true);
  });

  it('does not retreat past half the budget, so a single long line still yields text', () => {
    const contents = `a\n${'b'.repeat(500)}`;
    const result = excerptStandards(contents, 100);
    expect(result.excerpt).toHaveLength(100);
  });

  it('is ALWAYS a byte-for-byte prefix — the verbatim guarantee', () => {
    const cases = [STANDARDS_TEXT, 'x'.repeat(500), 'a\nb\nc\n'.repeat(100), '', '\n\n\n'];
    for (const contents of cases) {
      for (const cap of [1, 7, 25, 100, 8000]) {
        const { excerpt, omittedChars } = excerptStandards(contents, cap);
        expect(contents.startsWith(excerpt)).toBe(true);
        expect(excerpt.length + omittedChars).toBe(contents.length);
      }
    }
  });

  it('defaults to the documented cap', () => {
    const huge = 'y'.repeat(STANDARDS_EXCERPT_MAX_CHARS + 100);
    expect(excerptStandards(huge).excerpt).toHaveLength(STANDARDS_EXCERPT_MAX_CHARS);
  });
});

describe('resolveProjectStandards', () => {
  it('records which filename matched and where it was found', () => {
    const standards = resolveProjectStandards({
      candidates: [standardsCandidate()],
      searchedDirs: [SOURCE_CWD, TARGET_CWD],
    });
    expect(standards.state).toBe('found');
    expect(hasStandards(standards)).toBe(true);
    expect(standards.docs).toHaveLength(1);
    expect(standards.docs[0]).toMatchObject({
      path: SOURCE_AGENTS_MD,
      dir: SOURCE_CWD,
      filename: 'AGENTS.md',
      origin: 'source-cwd',
      cwd: SOURCE_CWD,
      excerpt: STANDARDS_TEXT,
      truncated: false,
    });
    expect(standards.searchedDirs).toEqual([SOURCE_CWD, TARGET_CWD]);
  });

  it('reports every distinct file across the source and target cwd, in order', () => {
    const standards = resolveProjectStandards({
      candidates: [
        standardsCandidate(),
        standardsCandidate({
          path: `${SOURCE_CWD}/CLAUDE.md`, filename: 'CLAUDE.md', contents: '# Claude-only notes',
        }),
        standardsCandidate({
          path: TARGET_AGENTS_MD, dir: TARGET_CWD, cwd: TARGET_CWD,
          origin: 'target-cwd', contents: '# Target repo rules',
        }),
      ],
      searchedDirs: [SOURCE_CWD, TARGET_CWD],
    });
    expect(standards.docs.map(d => d.path)).toEqual([
      SOURCE_AGENTS_MD, `${SOURCE_CWD}/CLAUDE.md`, TARGET_AGENTS_MD,
    ]);
    expect(standards.docs.map(d => d.origin)).toEqual(['source-cwd', 'source-cwd', 'target-cwd']);
  });

  it('collapses the same absolute path, which is what source cwd === target cwd produces', () => {
    const standards = resolveProjectStandards({
      candidates: [
        standardsCandidate(),
        standardsCandidate({ origin: 'target-cwd' }), // same path, second sweep
      ],
      searchedDirs: [SOURCE_CWD],
    });
    expect(standards.docs).toHaveLength(1);
    expect(standards.docs[0].origin).toBe('source-cwd'); // first occurrence wins
  });

  it('truncates each doc independently at the cap', () => {
    const standards = resolveProjectStandards({
      candidates: [
        standardsCandidate({ contents: 'z'.repeat(300) }),
        standardsCandidate({ path: TARGET_AGENTS_MD, dir: TARGET_CWD, contents: 'short' }),
      ],
      maxExcerptChars: 100,
    });
    expect(standards.docs[0]).toMatchObject({ truncated: true, omittedChars: 200 });
    expect(standards.docs[0].excerpt).toHaveLength(100);
    expect(standards.docs[1]).toMatchObject({ truncated: false, excerpt: 'short' });
  });

  it('never rewrites the file text it was handed', () => {
    const messy = '  leading spaces\n\n\tTABBED RULE\ntrailing  \n';
    const standards = resolveProjectStandards({ candidates: [standardsCandidate({ contents: messy })] });
    expect(standards.docs[0].excerpt).toBe(messy);
  });

  it('falls to none-found when nothing was located, and says where it looked', () => {
    const standards = resolveProjectStandards({
      candidates: [],
      searchedDirs: [SOURCE_CWD, TARGET_CWD],
      noneFoundNote: 'nothing in either repo',
    });
    expect(standards.state).toBe('none-found');
    expect(hasStandards(standards)).toBe(false);
    expect(standards.docs).toEqual([]);
    expect(standards.searchedDirs).toEqual([SOURCE_CWD, TARGET_CWD]);
    expect(standards.note).toBe('nothing in either repo');
    expect(standards.filenames).toEqual([...STANDARDS_FILENAMES]);
  });

  it('supplies a default note when the caller gives no reason', () => {
    expect(resolveProjectStandards({ candidates: [] }).note).toMatch(/no directory could be searched/i);
    expect(resolveProjectStandards({ candidates: [], searchedDirs: ['/x'] }).note)
      .toMatch(/none of the recognised instruction filenames/i);
  });

  it('looks for the three filenames all installed CLIs recognise, AGENTS.md first', () => {
    expect(STANDARDS_FILENAMES).toEqual(['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']);
  });
});

describe('buildHandoffBundle — standards', () => {
  it('carries the resolved standards into the bundle', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-s', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude' },
      ask: resolveOriginalAsk({}),
      standards: resolveProjectStandards({ candidates: [standardsCandidate()] }),
    });
    expect(bundle.standards?.state).toBe('found');
    expect(bundle.standards?.docs[0].excerpt).toBe(STANDARDS_TEXT);
  });

  it('defaults to an explicit none-found state rather than leaving the field absent', () => {
    const bundle = bundleAtoB();
    expect(bundle.standards).toBeDefined();
    expect(bundle.standards?.state).toBe('none-found');
    expect(bundle.standards?.note).toBeTruthy();
  });

  it('does NOT inherit standards from the upstream bundle — they are per-hop', () => {
    const hop1 = buildHandoffBundle({
      handoffId: 'hf-1s', createdAt: 1, targetCwd: SOURCE_CWD, contextRequest: 'q',
      source: { sessionId: 'sess-A', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ appTask: { id: 't-1', subject: ASK_TEXT, description: '' } }),
      standards: resolveProjectStandards({ candidates: [standardsCandidate()] }),
    });
    // Hop 2 moves to a directory with no standards; hop 1's must NOT follow.
    const hop2 = buildHandoffBundle({
      handoffId: 'hf-2s', createdAt: 2, targetCwd: '/elsewhere', contextRequest: 'q',
      source: { sessionId: 'sess-B', cliType: 'copilot', transcriptPath: COPILOT_C, transcriptDir: COPILOT_DIR },
      previous: hop1,
      ask: resolveOriginalAsk({ inherited: hop1.ask }),
    });
    expect(hop2.ask.text).toBe(hop1.ask.text);          // the ask still chains
    expect(hop2.standards?.state).toBe('none-found');   // the standards do not
  });

  it('round-trips the standards through JSON, which is how the chain is stored', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-j', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude' },
      ask: resolveOriginalAsk({}),
      standards: resolveProjectStandards({ candidates: [standardsCandidate()] }),
    });
    const revived = JSON.parse(JSON.stringify(bundle));
    expect(isHandoffBundle(revived)).toBe(true);
    expect(revived.standards.docs[0].excerpt).toBe(STANDARDS_TEXT);
  });

  it('still validates a v1 bundle written before the standards field existed', () => {
    const legacy = { ...bundleAtoB() } as Partial<HandoffBundle>;
    delete legacy.standards;
    expect(isHandoffBundle(legacy)).toBe(true);
  });
});

describe('standardsGrantDirs', () => {
  it('grants each file\'s containing directory, deduplicated, order preserved', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-g', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude' },
      ask: resolveOriginalAsk({}),
      standards: resolveProjectStandards({
        candidates: [
          standardsCandidate(),
          standardsCandidate({ path: `${SOURCE_CWD}/CLAUDE.md`, filename: 'CLAUDE.md' }),
          standardsCandidate({
            path: `${TARGET_CWD}/.github/copilot-instructions.md`,
            dir: `${TARGET_CWD}/.github`,
            filename: '.github/copilot-instructions.md',
            origin: 'target-cwd',
            cwd: TARGET_CWD,
          }),
        ],
      }),
    });
    // Two files in one directory collapse to one grant; .github is granted on
    // its own rather than the repo root above it.
    expect(standardsGrantDirs(bundle)).toEqual([SOURCE_CWD, `${TARGET_CWD}/.github`]);
  });

  it('grants nothing when nothing was found', () => {
    expect(standardsGrantDirs(bundleAtoB())).toEqual([]);
  });

  it('tolerates a bundle with no standards field at all', () => {
    const legacy = { ...bundleAtoB(), standards: undefined } as HandoffBundle;
    expect(standardsGrantDirs(legacy)).toEqual([]);
  });
});

describe('isHandoffBundle', () => {
  it('rejects non-bundles', () => {
    expect(isHandoffBundle(null)).toBe(false);
    expect(isHandoffBundle([])).toBe(false);
    expect(isHandoffBundle({ handoffId: 'x' })).toBe(false);
    expect(isHandoffBundle({ handoffId: '', trace: [], chain: [], ask: { text: '', source: 'x' } })).toBe(false);
  });
});

// ─── Rendering ───────────────────────────────────────────────────────

describe('fenceFor', () => {
  it('defaults to three backticks', () => {
    expect(fenceFor('plain text')).toBe('```');
  });

  it('outgrows any backtick run in the text, so the ask survives unescaped', () => {
    expect(fenceFor('use `x` here')).toBe('```');
    expect(fenceFor('```js\ncode\n```')).toBe('````');
    expect(fenceFor('`````')).toBe('``````');
  });
});

describe('renderHandoffBundleMarkdown', () => {
  const hop2 = bundleBtoC(bundleAtoB());
  const md = renderHandoffBundleMarkdown(hop2);

  it('contains the ask verbatim', () => {
    expect(md).toContain(`Rate limit login\n\n${ASK_TEXT}`);
  });

  it('renders an ask containing code fences without mangling it', () => {
    const tricky = 'Do this:\n```sh\nnpm run build\n```\nand nothing else.';
    const bundle = buildHandoffBundle({
      handoffId: 'hf-f', createdAt: 1, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ firstUserMessage: { text: tricky, transcriptPath: CLAUDE_A } }),
    });
    const out = renderHandoffBundleMarkdown(bundle);
    expect(out).toContain(tricky);
    expect(out).toContain('````text');
  });

  it('lists every transcript path and labels its schema', () => {
    expect(md).toContain(CLAUDE_A);
    expect(md).toContain(COPILOT_C);
    expect(md).toContain('hop 0');
    expect(md).toContain('hop 1');
    expect(md).toContain('"type":"user"');       // Claude schema hint
    expect(md).toContain('"type":"user.message"'); // Copilot schema hint
  });

  it('orders the sections ask -> standards -> trace -> summary, and labels what is not ground truth', () => {
    const askAt = md.indexOf('## 1. THE ASK');
    const standardsAt = md.indexOf('## 2. THE STANDARDS');
    const traceAt = md.indexOf('## 3. THE TRACE');
    const summaryAt = md.indexOf('## 4. THE PREVIOUS');
    const reconcileAt = md.indexOf('## 5. DO THIS FIRST');
    expect(askAt).toBeGreaterThan(-1);
    expect(standardsAt).toBeGreaterThan(askAt);
    expect(traceAt).toBeGreaterThan(standardsAt);
    expect(summaryAt).toBeGreaterThan(traceAt);
    expect(reconcileAt).toBeGreaterThan(summaryAt);
    expect(md).toContain('GROUND TRUTH');
    expect(md).toContain('NOT ground truth');
  });

  it('tells the receiver not to delete anything', () => {
    expect(md).toMatch(/do not delete/i);
    expect(md).not.toMatch(/then delete the file/i);
  });

  it('does not inline transcript contents — paths only', () => {
    // A 9 MB transcript must never end up in here; the rendered doc stays small.
    // Standards ARE inlined, but capped per file — see the truncation tests.
    expect(md.length).toBeLessThan(10000);
  });

  it('makes a missing ask visible instead of substituting the summary', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-n', createdAt: 1, targetCwd: '/r', contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ unavailableNote: 'no task and no user turn found' }),
      summaryText: 'A CONFIDENT PARAPHRASE OF THE TASK',
    });
    const out = renderHandoffBundleMarkdown(bundle);
    expect(out).toContain('could not be recovered');
    expect(out).toContain('no task and no user turn found');
    // The summary still appears, but only in its own labelled section.
    const askSection = out.slice(out.indexOf('## 1.'), out.indexOf('## 2.'));
    expect(askSection).not.toContain('A CONFIDENT PARAPHRASE');
    expect(out).toContain('A CONFIDENT PARAPHRASE');
  });

  it('notes when the ask was carried through an earlier handoff', () => {
    expect(md).toContain('hf-1');
    expect(md).toMatch(/carried forward unchanged/i);
  });
});

describe('renderHandoffBundleMarkdown — the standards section', () => {
  function withStandards(candidates: StandardsCandidate[], maxExcerptChars?: number): string {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-r', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ firstUserMessage: { text: ASK_TEXT, transcriptPath: CLAUDE_A } }),
      standards: resolveProjectStandards(
        maxExcerptChars === undefined ? { candidates } : { candidates, maxExcerptChars },
      ),
    });
    return renderHandoffBundleMarkdown(bundle);
  }

  it('reproduces the standards text verbatim, fences and all', () => {
    const out = withStandards([standardsCandidate()]);
    expect(out).toContain(STANDARDS_TEXT);
    // The file contains a ``` fence, so the wrapper must outgrow it.
    expect(out).toContain('````markdown');
  });

  it('names the matched filename, the absolute path, and which cwd it came from', () => {
    const out = withStandards([standardsCandidate()]);
    expect(out).toContain('`AGENTS.md`');
    expect(out).toContain(SOURCE_AGENTS_MD);
    expect(out).toContain('the source session\'s working directory');
  });

  it('renders both repos\' standards when both exist', () => {
    const out = withStandards([
      standardsCandidate(),
      standardsCandidate({
        path: TARGET_AGENTS_MD, dir: TARGET_CWD, cwd: TARGET_CWD,
        origin: 'target-cwd', contents: '# Target repo rules\n- ship behind a flag',
      }),
    ]);
    expect(out).toContain(SOURCE_AGENTS_MD);
    expect(out).toContain(TARGET_AGENTS_MD);
    expect(out).toContain('- ship behind a flag');
    expect(out).toContain('the target working directory');
  });

  it('says so, loudly, when an excerpt was truncated, and gives the path for the rest', () => {
    const long = `${STANDARDS_TEXT}\n${'- another rule\n'.repeat(200)}`;
    const out = withStandards([standardsCandidate({ contents: long })], 120);
    expect(out).toMatch(/at least \d+ more characters follow/i);
    expect(out).toContain(SOURCE_AGENTS_MD);
    // Truncated, but what IS shown is still the file's own opening bytes.
    expect(out).toContain('# Engineering standards');
    expect(out).not.toContain('- another rule');
  });

  it('marks a standards file that exists but is empty, instead of printing a blank fence', () => {
    const out = withStandards([standardsCandidate({ contents: '   \n\n' })]);
    expect(out).toMatch(/exists but is empty/i);
    expect(out).toMatch(/do not infer any/i);
  });

  it('labels the standards as binding and never as a summary', () => {
    const out = withStandards([standardsCandidate()]);
    expect(out).toContain('## 2. THE STANDARDS');
    expect(out).toContain('BINDING');
    expect(out).toMatch(/verbatim/i);
    expect(out).toMatch(/not a summary/i);
  });

  it('makes a MISSING standards file visible, with the directories searched', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-ns', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ firstUserMessage: { text: ASK_TEXT, transcriptPath: CLAUDE_A } }),
      standards: noStandardsFound([SOURCE_CWD, TARGET_CWD]),
      summaryText: 'WE ALWAYS USE TABS AND NEVER WRITE TESTS',
    });
    const out = renderHandoffBundleMarkdown(bundle);
    expect(out).toContain('## 2. THE STANDARDS');
    expect(out).toContain('**No project standards file was found.**');
    expect(out).toContain(SOURCE_CWD);
    expect(out).toContain(TARGET_CWD);
    expect(out).toContain('`AGENTS.md`');
    expect(out).toContain('`.github/copilot-instructions.md`');
    // The summary is NOT allowed to fill the standards slot, exactly as it is
    // not allowed to fill the ask slot.
    const section = out.slice(out.indexOf('## 2.'), out.indexOf('## 3.'));
    expect(section).not.toContain('WE ALWAYS USE TABS');
    expect(section).toMatch(/ask the user where the project's standards live/i);
  });

  it('renders a standards section even for a bundle written before the field existed', () => {
    const legacy = { ...bundleAtoB(), standards: undefined } as HandoffBundle;
    const out = renderHandoffBundleMarkdown(legacy);
    expect(out).toContain('## 2. THE STANDARDS');
    expect(out).toContain('**No project standards file was found.**');
  });
});

describe('renderHandoffBundleMarkdown — the acknowledgement step', () => {
  it('requires naming the files and listing the constraints, not just "I read them"', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-a', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ firstUserMessage: { text: ASK_TEXT, transcriptPath: CLAUDE_A } }),
      standards: resolveProjectStandards({ candidates: [standardsCandidate()] }),
    });
    const out = renderHandoffBundleMarkdown(bundle);
    const steps = out.slice(out.indexOf('## 5. DO THIS FIRST'));
    expect(steps).toMatch(/ACKNOWLEDGE the standards explicitly/);
    expect(steps).toMatch(/does not count/i);
    // The acknowledgement is step 1 — before the divergence check, not after.
    expect(steps.indexOf('ACKNOWLEDGE')).toBeLessThan(steps.indexOf('DIVERGES'));
    expect(steps).toMatch(/DIVERGES from the ask OR from the standards/);
  });

  it('demands the gap be stated out loud when no standards were found', () => {
    const steps = renderHandoffBundleMarkdown(bundleAtoB());
    expect(steps).toMatch(/State explicitly that NO project standards file was found/);
    expect(steps).toMatch(/do not invent conventions/i);
  });
});

describe('buildReconciliationInstruction', () => {
  const hop2 = bundleBtoC(bundleAtoB());
  const instruction = buildReconciliationInstruction(hop2, '/state/handoffs/hf-2/handoff.md');

  it('points at the bundle and counts the traced transcripts', () => {
    expect(instruction).toContain('/state/handoffs/hf-2/handoff.md');
    expect(instruction).toContain('2 raw prior session transcripts');
  });

  it('asks for reconciliation, not internalization, and never for deletion', () => {
    expect(instruction).toMatch(/cross-check/i);
    expect(instruction).toMatch(/diverges/i);
    expect(instruction).toMatch(/do not delete/i);
    expect(instruction).not.toMatch(/internalize/i);
  });

  it('is marked as app plumbing so a later hop does not mistake it for the ask', () => {
    expect(instruction.startsWith(AGENTMATRIX_INJECTION_MARKER)).toBe(true);
    expect(extractFirstUserMessage(claudeUserLine(instruction), 'claude')).toBeUndefined();
  });

  it('is a single line — it is typed into a PTY', () => {
    expect(instruction).not.toContain('\n');
  });

  it('singularizes for a one-hop chain', () => {
    const single = buildReconciliationInstruction(bundleAtoB(), '/x/handoff.md');
    expect(single).toContain('1 raw prior session transcript,');
  });

  it('demands an explicit standards acknowledgement before any work', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-i', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({ firstUserMessage: { text: ASK_TEXT, transcriptPath: CLAUDE_A } }),
      standards: resolveProjectStandards({ candidates: [standardsCandidate()] }),
    });
    const text = buildReconciliationInstruction(bundle, '/x/handoff.md');
    expect(text).toMatch(/ENGINEERING STANDARDS/);
    expect(text).toMatch(/binding/i);
    expect(text).toMatch(/acknowledge it explicitly in your first reply/i);
    expect(text).toMatch(/list the specific constraints/i);
    expect(text).toMatch(/does not count/i);
    expect(text).toContain('1 instruction file');
    expect(text).not.toContain('\n'); // still one PTY line
  });

  it('pluralizes the instruction-file count', () => {
    const bundle = buildHandoffBundle({
      handoffId: 'hf-i2', createdAt: 1, targetCwd: TARGET_CWD, contextRequest: 'q',
      source: { sessionId: 's', cliType: 'claude', transcriptPath: CLAUDE_A, transcriptDir: CLAUDE_DIR },
      ask: resolveOriginalAsk({}),
      standards: resolveProjectStandards({
        candidates: [
          standardsCandidate(),
          standardsCandidate({ path: TARGET_AGENTS_MD, dir: TARGET_CWD, cwd: TARGET_CWD, origin: 'target-cwd' }),
        ],
      }),
    });
    expect(buildReconciliationInstruction(bundle, '/x/h.md')).toContain('2 instruction files');
  });

  it('tells the receiver to say so out loud when no standards were found', () => {
    const text = buildReconciliationInstruction(bundleAtoB(), '/x/handoff.md');
    expect(text).toMatch(/NO project standards file could be found/i);
    expect(text).toMatch(/ask where the project's standards live/i);
    expect(text).not.toContain('\n');
  });

  it('is still marked as app plumbing with the standards clause attached', () => {
    const text = buildReconciliationInstruction(bundleAtoB(), '/x/handoff.md');
    expect(text.startsWith(AGENTMATRIX_INJECTION_MARKER)).toBe(true);
    expect(extractFirstUserMessage(claudeUserLine(text), 'claude')).toBeUndefined();
  });
});
