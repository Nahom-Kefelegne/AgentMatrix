/**
 * Context-usage arithmetic for the Claude provider.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Deliberately dependency-light: every function under test is pure and takes
 * already-parsed data (or a raw JSONL string), so nothing here touches the
 * filesystem, Electron, or a real transcript. The fs-facing wrapper
 * (`ClaudeProvider.getContextUsage`) is intentionally not covered — it is a
 * thin loop over these helpers.
 *
 * Fixtures below mirror shapes captured from real ~/.claude/projects
 * transcripts, including the `<synthetic>` error placeholder and the
 * `isSidechain` subagent flag.
 */
import { describe, it, expect } from 'vitest';
import {
  sumContextTokens,
  isUsableUsageEntry,
  selectLatestUsageEntry,
  findLatestUsageEntryInTail,
  contextPercentFromEntry,
  contextWindowForModel,
  findLastCustomTitleInTail,
  type ClaudeAssistantEntry,
} from './ClaudeProvider';

/** Build an assistant entry the way a transcript line deserialises. */
const entry = (
  usage: Record<string, number> | null,
  opts: { model?: string; isSidechain?: boolean; type?: string } = {},
): ClaudeAssistantEntry => ({
  type: opts.type ?? 'assistant',
  ...(opts.isSidechain !== undefined ? { isSidechain: opts.isSidechain } : {}),
  message: {
    model: opts.model ?? 'claude-opus-4-8',
    ...(usage ? { usage } : {}),
  },
});

/** A 200k-window model, so token→percent maths is easy to read. */
const SMALL = 'claude-sonnet-4-6';

describe('sumContextTokens', () => {
  it('sums the three context-occupying counts', () => {
    // The verified real-transcript example: 133 + 1112 + 360788 = 362033.
    expect(sumContextTokens({
      input_tokens: 133,
      cache_creation_input_tokens: 1112,
      cache_read_input_tokens: 360788,
      output_tokens: 999,
    })).toBe(362033);
  });

  it('excludes output_tokens — those were produced, not resident', () => {
    expect(sumContextTokens({ input_tokens: 10, output_tokens: 5000 })).toBe(10);
  });

  it('treats missing fields as zero', () => {
    expect(sumContextTokens({ input_tokens: 100 })).toBe(100);
    expect(sumContextTokens({ cache_read_input_tokens: 42 })).toBe(42);
    expect(sumContextTokens({})).toBe(0);
  });

  it('ignores non-numeric and negative garbage', () => {
    const garbage = {
      input_tokens: 'lots' as unknown as number,
      cache_creation_input_tokens: -500,
      cache_read_input_tokens: NaN,
    };
    expect(sumContextTokens(garbage)).toBe(0);
  });

  it('handles null/undefined without throwing', () => {
    expect(sumContextTokens(null)).toBe(0);
    expect(sumContextTokens(undefined)).toBe(0);
  });
});

describe('isUsableUsageEntry', () => {
  it('accepts a normal main-session assistant turn', () => {
    expect(isUsableUsageEntry(entry({ input_tokens: 5000 }))).toBe(true);
  });

  it('rejects sidechain (subagent) turns — they have their own context', () => {
    expect(isUsableUsageEntry(entry({ input_tokens: 5000 }, { isSidechain: true }))).toBe(false);
  });

  it('rejects the <synthetic> model used for injected error placeholders', () => {
    // Real shape: an auth-failure line whose usage block is entirely zeros.
    expect(isUsableUsageEntry(entry({ input_tokens: 0 }, { model: '<synthetic>' }))).toBe(false);
    // Even if it somehow carried tokens, the model is still not a real turn.
    expect(isUsableUsageEntry(entry({ input_tokens: 900 }, { model: '<synthetic>' }))).toBe(false);
  });

  it('rejects non-assistant line types', () => {
    expect(isUsableUsageEntry(entry({ input_tokens: 5000 }, { type: 'user' }))).toBe(false);
    expect(isUsableUsageEntry(entry({ input_tokens: 5000 }, { type: 'ai-title' }))).toBe(false);
  });

  it('rejects entries with no usage block or zero tokens', () => {
    expect(isUsableUsageEntry(entry(null))).toBe(false);
    expect(isUsableUsageEntry(entry({}))).toBe(false);
    expect(isUsableUsageEntry(entry({ output_tokens: 700 }))).toBe(false);
  });

  it('rejects null/undefined/non-objects', () => {
    expect(isUsableUsageEntry(null)).toBe(false);
    expect(isUsableUsageEntry(undefined)).toBe(false);
  });
});

describe('selectLatestUsageEntry', () => {
  it('returns the last usable entry, not the first', () => {
    const picked = selectLatestUsageEntry([
      entry({ input_tokens: 100 }),
      entry({ input_tokens: 200 }),
      entry({ input_tokens: 300 }),
    ]);
    expect(sumContextTokens(picked?.message?.usage)).toBe(300);
  });

  it('skips trailing sidechain entries to find the real main-session turn', () => {
    // A subagent finishing after the main turn must not clobber the reading.
    const picked = selectLatestUsageEntry([
      entry({ input_tokens: 50_000 }),
      entry({ input_tokens: 900 }, { isSidechain: true }),
      entry({ input_tokens: 1200 }, { isSidechain: true }),
    ]);
    expect(sumContextTokens(picked?.message?.usage)).toBe(50_000);
  });

  it('skips a trailing <synthetic> error entry', () => {
    const picked = selectLatestUsageEntry([
      entry({ input_tokens: 7000 }),
      entry({ input_tokens: 0 }, { model: '<synthetic>' }),
    ]);
    expect(sumContextTokens(picked?.message?.usage)).toBe(7000);
  });

  it('returns null when nothing qualifies', () => {
    expect(selectLatestUsageEntry([])).toBeNull();
    expect(selectLatestUsageEntry([entry(null), entry({})])).toBeNull();
    expect(selectLatestUsageEntry([entry({ input_tokens: 5 }, { isSidechain: true })])).toBeNull();
  });

  it('tolerates null entries and non-array input', () => {
    expect(selectLatestUsageEntry([null, undefined, entry({ input_tokens: 9 })])?.type).toBe('assistant');
    expect(selectLatestUsageEntry(null)).toBeNull();
    expect(selectLatestUsageEntry(undefined)).toBeNull();
  });
});

describe('contextWindowForModel', () => {
  it('defaults to 200k for unknown or empty models', () => {
    expect(contextWindowForModel('')).toBe(200_000);
    expect(contextWindowForModel('some-future-model')).toBe(200_000);
  });

  it('returns the 1M window for known large-context models', () => {
    expect(contextWindowForModel('claude-opus-4-8')).toBe(1_000_000);
    expect(contextWindowForModel('claude-opus-5')).toBe(1_000_000);
    expect(contextWindowForModel('claude-sonnet-5')).toBe(1_000_000);
    expect(contextWindowForModel('claude-fable-5')).toBe(1_000_000);
  });

  it('matches dated model variants and the [1m] beta tag', () => {
    expect(contextWindowForModel('claude-opus-4-8-20260115')).toBe(1_000_000);
    expect(contextWindowForModel('claude-sonnet-4-5[1m]')).toBe(1_000_000);
  });

  it('is case-insensitive', () => {
    expect(contextWindowForModel('Claude-Opus-5')).toBe(1_000_000);
  });
});

describe('contextPercentFromEntry', () => {
  it('computes an integer percentage against the model window', () => {
    // 50,000 / 200,000 = 25%
    expect(contextPercentFromEntry(entry({ input_tokens: 50_000 }, { model: SMALL }))).toBe(25);
    // 500,000 / 1,000,000 = 50%
    expect(contextPercentFromEntry(entry({ input_tokens: 500_000 }, { model: 'claude-opus-4-8' }))).toBe(50);
  });

  it('sums all three counts before dividing', () => {
    const pct = contextPercentFromEntry(entry({
      input_tokens: 10_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 20_000,
    }, { model: SMALL }));
    expect(pct).toBe(20); // 40,000 / 200,000
  });

  it('rounds to the nearest integer', () => {
    expect(contextPercentFromEntry(entry({ input_tokens: 2999 }, { model: SMALL }))).toBe(1);
    expect(contextPercentFromEntry(entry({ input_tokens: 1000 }, { model: SMALL }))).toBe(1);
  });

  it('clamps to 99 rather than reporting a full or over-full window', () => {
    expect(contextPercentFromEntry(entry({ input_tokens: 200_000 }, { model: SMALL }))).toBe(99);
    // An under-sized window guess degrades to 99, never >100.
    expect(contextPercentFromEntry(entry({ input_tokens: 900_000 }, { model: SMALL }))).toBe(99);
  });

  it('never returns a negative percentage', () => {
    const pct = contextPercentFromEntry(entry({ input_tokens: 5, cache_read_input_tokens: -100 }, { model: SMALL }));
    expect(pct).toBeGreaterThanOrEqual(0);
  });

  it('returns null when there are no tokens to report', () => {
    expect(contextPercentFromEntry(entry(null))).toBeNull();
    expect(contextPercentFromEntry(entry({}))).toBeNull();
    expect(contextPercentFromEntry(null)).toBeNull();
    expect(contextPercentFromEntry(undefined)).toBeNull();
  });
});

describe('findLatestUsageEntryInTail', () => {
  const line = (obj: unknown) => JSON.stringify(obj);

  it('finds the most recent usable entry in a JSONL chunk', () => {
    const chunk = [
      line(entry({ input_tokens: 100 })),
      line({ type: 'user', message: { content: 'hi' } }),
      line(entry({ input_tokens: 777 })),
    ].join('\n');
    expect(sumContextTokens(findLatestUsageEntryInTail(chunk)?.message?.usage)).toBe(777);
  });

  it('skips a truncated leading line, as produced by a byte-offset tail read', () => {
    // A tail read starts mid-line; that fragment must not break parsing.
    const chunk = [
      '_tokens":12345,"cache_read_input_tokens":6}}}',
      line(entry({ input_tokens: 4242 })),
    ].join('\n');
    expect(sumContextTokens(findLatestUsageEntryInTail(chunk)?.message?.usage)).toBe(4242);
  });

  it('ignores trailing sidechain and synthetic lines', () => {
    const chunk = [
      line(entry({ input_tokens: 8080 })),
      line(entry({ input_tokens: 30 }, { isSidechain: true })),
      line(entry({ input_tokens: 0 }, { model: '<synthetic>' })),
      line({ type: 'ai-title', aiTitle: 'Something' }),
    ].join('\n');
    expect(sumContextTokens(findLatestUsageEntryInTail(chunk)?.message?.usage)).toBe(8080);
  });

  it('tolerates blank lines and a trailing newline', () => {
    const chunk = `\n${line(entry({ input_tokens: 55 }))}\n\n`;
    expect(sumContextTokens(findLatestUsageEntryInTail(chunk)?.message?.usage)).toBe(55);
  });

  it('returns null for empty, garbage, or usage-free input', () => {
    expect(findLatestUsageEntryInTail('')).toBeNull();
    expect(findLatestUsageEntryInTail(null)).toBeNull();
    expect(findLatestUsageEntryInTail(undefined)).toBeNull();
    expect(findLatestUsageEntryInTail('not json at all\n{{{{\n')).toBeNull();
    expect(findLatestUsageEntryInTail('{"usage": broken json')).toBeNull();
    expect(findLatestUsageEntryInTail(line({ type: 'user', message: { content: 'x' } }))).toBeNull();
  });
});

describe('findLastCustomTitleInTail', () => {
  it('returns the newest title when several are present', () => {
    // Claude re-appends the title on each checkpoint; the last one wins.
    const chunk = [
      JSON.stringify({ type: 'custom-title', customTitle: 'Old name', sessionId: 'a' }),
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify({ type: 'custom-title', customTitle: 'New name', sessionId: 'a' }),
    ].join('\n');
    expect(findLastCustomTitleInTail(chunk)).toBe('New name');
  });

  it('does not confuse ai-title with custom-title', () => {
    const chunk = JSON.stringify({ type: 'ai-title', aiTitle: 'Generated', sessionId: 'a' });
    expect(findLastCustomTitleInTail(chunk)).toBeNull();
  });

  it('returns null for empty or garbage input', () => {
    expect(findLastCustomTitleInTail('')).toBeNull();
    expect(findLastCustomTitleInTail(null)).toBeNull();
    expect(findLastCustomTitleInTail('garbage\n{"custom-title" oops')).toBeNull();
  });
});
