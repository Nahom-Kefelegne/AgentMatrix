/**
 * Tests for KimiProvider's pure helpers.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Only the pure functions are exercised — argument building, session-index
 * parsing, and process-line parsing. Nothing here spawns `kimi`, touches
 * ~/.kimi-code, or requires Kimi Code CLI to be installed.
 *
 * These tests encode Moonshot's DOCUMENTED command-line contract (see the
 * source citations in KimiProvider.ts). If Kimi changes a flag, these fail —
 * which is the point.
 */
import { describe, it, expect } from 'vitest';
import {
  buildKimiSpawnArgs,
  buildKimiResumeArgs,
  parseKimiSessionIndex,
  parseKimiProcessLines,
} from './KimiProvider';
// Model/permission tables live in the browser-safe module alongside the Claude
// and Copilot ones, so client bundles can read them without pulling in `fs`.
import { KIMI_MODELS } from './uiMetadata';

const CWD = '/repo';

describe('buildKimiSpawnArgs', () => {
  it('passes no flags for a bare session', () => {
    expect(buildKimiSpawnArgs({ cwd: CWD })).toEqual([]);
  });

  it('maps bypassPermissions to --yolo', () => {
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'bypassPermissions' }))
      .toEqual(['--yolo']);
  });

  it('maps auto to --auto and plan to --plan', () => {
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'auto' })).toEqual(['--auto']);
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'plan' })).toEqual(['--plan']);
  });

  it('never emits --yolo and --auto together (documented as mutually exclusive)', () => {
    for (const mode of ['bypassPermissions', 'auto', 'plan', 'default']) {
      const args = buildKimiSpawnArgs({ cwd: CWD, permissionMode: mode });
      expect(args.includes('--yolo') && args.includes('--auto')).toBe(false);
    }
  });

  it('emits no flag for permission modes Kimi has no equivalent for', () => {
    // Claude's acceptEdits has no Kimi counterpart — approximating it would
    // grant more or less than the caller asked for.
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'acceptEdits' })).toEqual([]);
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'default' })).toEqual([]);
    expect(buildKimiSpawnArgs({ cwd: CWD, permissionMode: 'nonsense' })).toEqual([]);
  });

  it('passes the model through --model', () => {
    expect(buildKimiSpawnArgs({ cwd: CWD, model: 'kimi-code/k3' }))
      .toEqual(['--model', 'kimi-code/k3']);
  });

  it('omits --model entirely when empty, so config default_model applies', () => {
    expect(buildKimiSpawnArgs({ cwd: CWD, model: '' })).toEqual([]);
  });

  it('IGNORES sessionId — Kimi has no --session-id flag', () => {
    // --session RESUMES; passing a fresh app-side id would try to resume a
    // session that does not exist. Regression guard for the tempting "fix".
    const args = buildKimiSpawnArgs({ cwd: CWD, sessionId: '01HZABCDEFGHJKMNPQRSTVWXYZ' });
    expect(args).toEqual([]);
    expect(args.join(' ')).not.toContain('01HZ');
  });

  it('ignores options Kimi documents no flag for', () => {
    const args = buildKimiSpawnArgs({
      cwd: CWD,
      name: 'my session',
      effort: 'high',
      allowedTools: 'Bash,Read',
      systemPrompt: 'you are in AgentMatrix',
    });
    expect(args).toEqual([]);
  });

  it('combines permission mode and model in a stable order', () => {
    expect(buildKimiSpawnArgs({
      cwd: CWD,
      permissionMode: 'bypassPermissions',
      model: 'kimi-code/kimi-for-coding',
    })).toEqual(['--yolo', '--model', 'kimi-code/kimi-for-coding']);
  });
});

describe('buildKimiResumeArgs', () => {
  it('resumes with --session <id>', () => {
    expect(buildKimiResumeArgs({ cwd: CWD, resumeId: 'abc123' }))
      .toEqual(['--session', 'abc123']);
  });

  it('carries permission mode and model onto the resume', () => {
    expect(buildKimiResumeArgs({
      cwd: CWD,
      resumeId: 'abc123',
      permissionMode: 'bypassPermissions',
      model: 'kimi-code/k3',
    })).toEqual(['--session', 'abc123', '--yolo', '--model', 'kimi-code/k3']);
  });

  it('does not emit --plan on resume (it starts a NEW session in plan mode)', () => {
    expect(buildKimiResumeArgs({ cwd: CWD, resumeId: 'abc123', permissionMode: 'plan' }))
      .toEqual(['--session', 'abc123']);
  });

  it('ignores fork — /fork is TUI-only, there is no CLI flag', () => {
    expect(buildKimiResumeArgs({ cwd: CWD, resumeId: 'abc123', fork: true }))
      .toEqual(['--session', 'abc123']);
  });

  it('never combines --session with --continue (documented as exclusive)', () => {
    const args = buildKimiResumeArgs({ cwd: CWD, resumeId: 'abc123', permissionMode: 'auto' });
    expect(args).not.toContain('--continue');
    expect(args).not.toContain('-c');
  });
});

describe('parseKimiSessionIndex', () => {
  const line = (o: object) => JSON.stringify(o);

  it('parses one record per line', () => {
    const text = [
      line({ sessionId: 'a1b2c3', sessionDir: '/home/u/.kimi-code/sessions/wd_repo_abc/a1b2c3', workDir: '/repo' }),
      line({ sessionId: 'd4e5f6', sessionDir: '/home/u/.kimi-code/sessions/wd_api_def/d4e5f6', workDir: '/api' }),
    ].join('\n');

    expect(parseKimiSessionIndex(text)).toEqual([
      { sessionId: 'a1b2c3', sessionDir: '/home/u/.kimi-code/sessions/wd_repo_abc/a1b2c3', workDir: '/repo' },
      { sessionId: 'd4e5f6', sessionDir: '/home/u/.kimi-code/sessions/wd_api_def/d4e5f6', workDir: '/api' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseKimiSessionIndex('')).toEqual([]);
    expect(parseKimiSessionIndex('\n\n  \n')).toEqual([]);
  });

  it('skips a truncated trailing line rather than throwing', () => {
    // The CLI appends live, so a partially-flushed last line is normal.
    const text =
      line({ sessionId: 'a1b2c3', sessionDir: '/s/a1b2c3', workDir: '/repo' }) +
      '\n{"sessionId":"d4e5f6","sessionDi';
    expect(parseKimiSessionIndex(text)).toEqual([
      { sessionId: 'a1b2c3', sessionDir: '/s/a1b2c3', workDir: '/repo' },
    ]);
  });

  it('skips records with no sessionId, and tolerates missing other fields', () => {
    const text = [
      line({ sessionDir: '/s/orphan', workDir: '/repo' }),
      line({ sessionId: 'a1b2c3' }),
      'not json at all',
      line([1, 2, 3]),
    ].join('\n');
    expect(parseKimiSessionIndex(text)).toEqual([
      { sessionId: 'a1b2c3', sessionDir: '', workDir: '' },
    ]);
  });

  it('lets a later record win, since the index is append-only', () => {
    const text = [
      line({ sessionId: 'a1b2c3', sessionDir: '/old', workDir: '/old-repo' }),
      line({ sessionId: 'a1b2c3', sessionDir: '/new', workDir: '/new-repo' }),
    ].join('\n');
    expect(parseKimiSessionIndex(text)).toEqual([
      { sessionId: 'a1b2c3', sessionDir: '/new', workDir: '/new-repo' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text =
      line({ sessionId: 'a1b2c3', sessionDir: '/s/a', workDir: '/repo' }) + '\r\n' +
      line({ sessionId: 'd4e5f6', sessionDir: '/s/d', workDir: '/api' }) + '\r\n';
    expect(parseKimiSessionIndex(text).map(e => e.sessionId)).toEqual(['a1b2c3', 'd4e5f6']);
  });
});

describe('parseKimiProcessLines', () => {
  it('extracts the id from --session on a resumed session', () => {
    const out = '/usr/local/bin/kimi --session 01HZABCDEFGH --yolo';
    expect(parseKimiProcessLines(out)).toEqual([{ sessionId: '01HZABCDEFGH' }]);
  });

  it('extracts the id from the -S short form and from --session=<id>', () => {
    expect(parseKimiProcessLines('node kimi/dist/main.mjs -S 01HZABCDEFGH'))
      .toEqual([{ sessionId: '01HZABCDEFGH' }]);
    expect(parseKimiProcessLines('kimi --session=01HZABCDEFGH'))
      .toEqual([{ sessionId: '01HZABCDEFGH' }]);
  });

  it('ignores processes unrelated to kimi', () => {
    // The Windows wmic query deliberately over-collects node.exe.
    const out = [
      'node /some/other/tool.js --session 01HZABCDEFGH',
      'C:\\Program Files\\nodejs\\node.exe server.js',
    ].join('\n');
    expect(parseKimiProcessLines(out)).toEqual([]);
  });

  it('ignores a bare --session with no id (the interactive selector)', () => {
    expect(parseKimiProcessLines('kimi --session')).toEqual([]);
    expect(parseKimiProcessLines('kimi --session --yolo')).toEqual([]);
  });

  it('finds ids across multiple lines', () => {
    const out = [
      'kimi --session 01HZAAAAAAAA',
      'kimi --yolo',                     // new session: no id on the cmdline
      'kimi --session 01HZBBBBBBBB',
    ].join('\n');
    expect(parseKimiProcessLines(out)).toEqual([
      { sessionId: '01HZAAAAAAAA' },
      { sessionId: '01HZBBBBBBBB' },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseKimiProcessLines('')).toEqual([]);
  });
});

describe('KIMI_MODELS', () => {
  it('offers a Default entry that omits --model so config default_model wins', () => {
    expect(KIMI_MODELS[0]).toEqual({ value: '', label: 'Default' });
  });

  it('uses the documented managed alias namespace', () => {
    const real = KIMI_MODELS.filter(m => m.value);
    expect(real.length).toBeGreaterThan(0);
    for (const model of real) {
      expect(model.value.startsWith('kimi-code/')).toBe(true);
    }
  });
});
