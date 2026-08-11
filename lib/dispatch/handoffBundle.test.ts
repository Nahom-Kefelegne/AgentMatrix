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
  buildHandoffBundle,
  buildReconciliationInstruction,
  extractFirstUserMessage,
  fenceFor,
  formatAppTaskAsk,
  hasAskText,
  isHandoffBundle,
  mergeTrace,
  renderHandoffBundleMarkdown,
  resolveOriginalAsk,
  traceGrantDirs,
  type HandoffBundle,
  type TranscriptRef,
} from './handoffBundle';

// ─── Fixtures ────────────────────────────────────────────────────────

const ASK_TEXT = 'Add a rate limiter to the /login endpoint. Do NOT touch the session store.';

const CLAUDE_DIR = '/home/u/.claude/projects/-home-u-repo';
const CLAUDE_A = `${CLAUDE_DIR}/aaaa1111.jsonl`;
const CLAUDE_B = `${CLAUDE_DIR}/bbbb2222.jsonl`;
const COPILOT_DIR = '/home/u/.copilot/session-state/cccc3333';
const COPILOT_C = `${COPILOT_DIR}/events.jsonl`;

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

  it('orders the sections ask -> trace -> summary, and labels the summary as not ground truth', () => {
    const askAt = md.indexOf('## 1. THE ASK');
    const traceAt = md.indexOf('## 2. THE TRACE');
    const summaryAt = md.indexOf('## 3. THE PREVIOUS');
    const reconcileAt = md.indexOf('## 4. DO THIS FIRST');
    expect(askAt).toBeGreaterThan(-1);
    expect(traceAt).toBeGreaterThan(askAt);
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
    expect(md.length).toBeLessThan(8000);
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
});
