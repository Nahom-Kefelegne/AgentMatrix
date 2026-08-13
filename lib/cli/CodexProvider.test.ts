/**
 * Tests for CodexProvider's pure helpers.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Only the pure functions are exercised — argument building, rollout header
 * parsing, rollout filename matching, and process-line parsing. Nothing here
 * spawns `codex`, touches ~/.codex, or requires Codex CLI to be installed.
 *
 * These tests encode OpenAI's DOCUMENTED and SOURCE-READ command-line contract
 * (see the citations at the top of CodexProvider.ts). If Codex renames a flag or
 * a subcommand, these fail — which is the point.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCodexSpawnArgs,
  buildCodexResumeArgs,
  parseCodexSessionMeta,
  rolloutFileMatchesSessionId,
  parseCodexProcessLines,
} from './CodexProvider';
// Model/permission tables live in the browser-safe module alongside the Claude,
// Copilot and Kimi ones, so client bundles can read them without pulling in `fs`.
import {
  CODEX_MODELS,
  CODEX_PERMISSION_MODES,
  buildResumeShellCommand,
  defaultPermissionModeForCli,
  modelsForCli,
  permissionModesForCli,
  uiCapabilitiesForCli,
} from './uiMetadata';

const CWD = '/repo';
const ID = '0199d68d-14ef-70c0-bf1e-4b001a0992c1';

describe('buildCodexSpawnArgs', () => {
  it('passes no flags for a bare session, so Codex picks sandbox + approvals itself', () => {
    expect(buildCodexSpawnArgs({ cwd: CWD })).toEqual([]);
  });

  it('maps bypassPermissions to the long-form bypass flag, not the --yolo alias', () => {
    const args = buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'bypassPermissions' });
    expect(args).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
    expect(args).not.toContain('--yolo');
  });

  it('maps the sandbox modes onto --sandbox with Codex\'s own kebab-case values', () => {
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'read-only' }))
      .toEqual(['--sandbox', 'read-only']);
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'workspace-write' }))
      .toEqual(['--sandbox', 'workspace-write']);
  });

  it('maps never-ask onto --ask-for-approval and leaves the sandbox alone', () => {
    const args = buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'never-ask' });
    expect(args).toEqual(['--ask-for-approval', 'never']);
    expect(args).not.toContain('--sandbox');
  });

  it('never combines --sandbox with the bypass flag', () => {
    // --dangerously-bypass-approvals-and-sandbox turns the sandbox off; pairing
    // it with a --sandbox value would be contradictory on its face.
    for (const mode of CODEX_PERMISSION_MODES.map(m => m.value)) {
      const args = buildCodexSpawnArgs({ cwd: CWD, permissionMode: mode });
      const bypass = args.includes('--dangerously-bypass-approvals-and-sandbox');
      expect(bypass && args.includes('--sandbox')).toBe(false);
    }
  });

  it('emits no flag for permission modes Codex has no equivalent for', () => {
    // Claude's acceptEdits and Kimi's plan have no Codex counterpart —
    // approximating either would grant more or less than the caller asked.
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'acceptEdits' })).toEqual([]);
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'plan' })).toEqual([]);
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'default' })).toEqual([]);
    expect(buildCodexSpawnArgs({ cwd: CWD, permissionMode: 'nonsense' })).toEqual([]);
  });

  it('passes the model through --model', () => {
    expect(buildCodexSpawnArgs({ cwd: CWD, model: 'gpt-5.6-sol' }))
      .toEqual(['--model', 'gpt-5.6-sol']);
  });

  it('omits --model entirely when empty, so Codex\'s own default applies', () => {
    expect(buildCodexSpawnArgs({ cwd: CWD, model: '' })).toEqual([]);
  });

  it('repeats --add-dir once per directory rather than comma-joining', () => {
    expect(buildCodexSpawnArgs({ cwd: CWD, addDirs: ['/a', '/b'] }))
      .toEqual(['--add-dir', '/a', '--add-dir', '/b']);
  });

  it('IGNORES sessionId — Codex has no --session-id flag', () => {
    // Codex mints the thread UUID itself; resume/fork consume an id, they do
    // not set one. Regression guard for the tempting "fix".
    const args = buildCodexSpawnArgs({ cwd: CWD, sessionId: ID });
    expect(args).toEqual([]);
    expect(args.join(' ')).not.toContain(ID);
  });

  it('ignores options Codex has no flag for', () => {
    // No --effort/--reasoning-effort exists on any Codex subcommand; no
    // per-tool allow-list; no --append-system-prompt; no -n for names.
    const args = buildCodexSpawnArgs({
      cwd: CWD,
      name: 'my session',
      effort: 'high',
      allowedTools: 'Bash,Read',
      systemPrompt: 'you are in AgentMatrix',
    });
    expect(args).toEqual([]);
  });

  it('combines permission mode, model and add-dirs in a stable order', () => {
    expect(buildCodexSpawnArgs({
      cwd: CWD,
      permissionMode: 'workspace-write',
      model: 'gpt-5.6-terra',
      addDirs: ['/other'],
    })).toEqual(['--sandbox', 'workspace-write', '--model', 'gpt-5.6-terra', '--add-dir', '/other']);
  });
});

describe('buildCodexResumeArgs', () => {
  it('resumes with the `resume` SUBCOMMAND and a positional id, not a flag', () => {
    const args = buildCodexResumeArgs({ cwd: CWD, resumeId: ID });
    expect(args).toEqual(['resume', ID]);
    expect(args).not.toContain('--resume');
  });

  it('forks with the sibling `fork` subcommand', () => {
    // Codex's fork is a different verb, not a --fork-session modifier.
    expect(buildCodexResumeArgs({ cwd: CWD, resumeId: ID, fork: true }))
      .toEqual(['fork', ID]);
  });

  it('carries permission mode and model onto the resume', () => {
    expect(buildCodexResumeArgs({
      cwd: CWD,
      resumeId: ID,
      permissionMode: 'bypassPermissions',
      model: 'gpt-5.5',
    })).toEqual(['resume', ID, '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.5']);
  });

  it('never emits the picker flags, since we always have an id', () => {
    const args = buildCodexResumeArgs({ cwd: CWD, resumeId: ID, permissionMode: 'read-only' });
    expect(args).not.toContain('--last');
    expect(args).not.toContain('--all');
  });
});

describe('parseCodexSessionMeta', () => {
  const metaLine = (payload: object) =>
    JSON.stringify({ timestamp: '2026-08-12T03:53:14.269Z', type: 'session_meta', payload });

  it('reads id and cwd out of the session_meta header', () => {
    const text = metaLine({ id: ID, cwd: '/Users/u/repo', originator: 'codex_cli', cli_version: '1.2.3' });
    expect(parseCodexSessionMeta(text)).toEqual({ id: ID, cwd: '/Users/u/repo' });
  });

  it('omits cwd rather than inventing one when the header lacks it', () => {
    expect(parseCodexSessionMeta(metaLine({ id: ID }))).toEqual({ id: ID });
    expect(parseCodexSessionMeta(metaLine({ id: ID, cwd: '' }))).toEqual({ id: ID });
  });

  it('finds session_meta even if it is not literally the first line', () => {
    const text = [
      JSON.stringify({ timestamp: 't', type: 'some_future_preamble', payload: {} }),
      metaLine({ id: ID, cwd: '/repo' }),
    ].join('\n');
    expect(parseCodexSessionMeta(text)).toEqual({ id: ID, cwd: '/repo' });
  });

  it('skips a truncated line rather than throwing (header reads are byte-bounded)', () => {
    const text = metaLine({ id: ID, cwd: '/repo' }) + '\n{"timestamp":"t","type":"resp';
    expect(parseCodexSessionMeta(text)).toEqual({ id: ID, cwd: '/repo' });
  });

  it('returns null when there is no session_meta record in the window', () => {
    expect(parseCodexSessionMeta('')).toBeNull();
    expect(parseCodexSessionMeta('\n\n  \n')).toBeNull();
    expect(parseCodexSessionMeta('not json at all')).toBeNull();
    expect(parseCodexSessionMeta(JSON.stringify({ type: 'response_item', payload: {} }))).toBeNull();
  });

  it('returns null for a session_meta with no id', () => {
    expect(parseCodexSessionMeta(metaLine({ cwd: '/repo' }))).toBeNull();
  });

  it('stops scanning after maxLines so a huge rollout is not walked', () => {
    const filler = Array.from({ length: 20 }, () => JSON.stringify({ type: 'x', payload: {} }));
    const text = [...filler, metaLine({ id: ID })].join('\n');
    expect(parseCodexSessionMeta(text, 10)).toBeNull();
    expect(parseCodexSessionMeta(text, 30)).toEqual({ id: ID });
  });

  it('handles CRLF line endings', () => {
    const text = metaLine({ id: ID, cwd: '/repo' }) + '\r\n';
    expect(parseCodexSessionMeta(text)).toEqual({ id: ID, cwd: '/repo' });
  });
});

describe('rolloutFileMatchesSessionId', () => {
  it('matches the documented rollout-<timestamp>-<uuid>.jsonl scheme', () => {
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${ID}.jsonl`, ID)).toBe(true);
  });

  it('matches the reverted-thread form, where a rollout id follows an underscore', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${ID}_${other}.jsonl`, ID)).toBe(true);
    // The trailing rollout id is NOT the thread id — matching it would resume
    // the wrong thread.
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${ID}_${other}.jsonl`, other)).toBe(false);
  });

  it('is case-insensitive about the uuid hex', () => {
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${ID.toUpperCase()}.jsonl`, ID)).toBe(true);
  });

  it('rejects a different session, a wrong prefix, and a wrong extension', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${other}.jsonl`, ID)).toBe(false);
    expect(rolloutFileMatchesSessionId(`${ID}.jsonl`, ID)).toBe(false);
    expect(rolloutFileMatchesSessionId(`rollout-2026-08-12T03-53-14-${ID}.json`, ID)).toBe(false);
  });

  it('rejects non-UUID ids outright, so nothing odd reaches path building', () => {
    expect(rolloutFileMatchesSessionId('rollout-x-my-session.jsonl', 'my-session')).toBe(false);
    expect(rolloutFileMatchesSessionId('rollout-x-...jsonl', '..')).toBe(false);
    expect(rolloutFileMatchesSessionId(`rollout-x-${ID}.jsonl`, '')).toBe(false);
  });
});

describe('parseCodexProcessLines', () => {
  it('extracts the id from `codex resume <uuid>`', () => {
    expect(parseCodexProcessLines(`/usr/local/bin/codex resume ${ID} --sandbox read-only`))
      .toEqual([{ sessionId: ID }]);
  });

  it('extracts the id from `codex fork <uuid>`', () => {
    expect(parseCodexProcessLines(`codex fork ${ID}`)).toEqual([{ sessionId: ID }]);
  });

  it('ignores processes unrelated to codex', () => {
    expect(parseCodexProcessLines(`some-other-tool resume ${ID}`)).toEqual([]);
  });

  it('ignores resume with no id (the picker) and with --last', () => {
    expect(parseCodexProcessLines('codex resume')).toEqual([]);
    expect(parseCodexProcessLines('codex resume --last')).toEqual([]);
    expect(parseCodexProcessLines('codex resume --all')).toEqual([]);
  });

  it('ignores a session NAME, which is not something we can look up on disk', () => {
    // `codex resume` accepts "uuid | session name"; discovery only ever yields
    // uuids, so a name would be an id the OrphanReaper could never resolve.
    expect(parseCodexProcessLines('codex resume my-refactor-session')).toEqual([]);
  });

  it('finds ids across multiple lines, skipping new sessions that carry none', () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const out = [
      `codex resume ${a}`,
      'codex --sandbox workspace-write',   // new session: no id on the cmdline
      `codex fork ${b}`,
    ].join('\n');
    expect(parseCodexProcessLines(out)).toEqual([{ sessionId: a }, { sessionId: b }]);
  });

  it('returns [] for empty output', () => {
    expect(parseCodexProcessLines('')).toEqual([]);
  });
});

describe('codex UI metadata', () => {
  it('offers a Default entry that omits --model so Codex\'s own default wins', () => {
    expect(CODEX_MODELS[0]).toEqual({ value: '', label: 'Default' });
  });

  it('lists the documented default model', () => {
    expect(CODEX_MODELS.map(m => m.value)).toContain('gpt-5.6-sol');
  });

  it('is wired into the exhaustive switches rather than falling through to Claude', () => {
    expect(modelsForCli('codex')).toBe(CODEX_MODELS);
    expect(permissionModesForCli('codex')).toBe(CODEX_PERMISSION_MODES);
  });

  it('does not default Codex to the sandbox-disabling bypass flag', () => {
    // Unlike Claude's --dangerously-skip-permissions, Codex's bypass also turns
    // the sandbox off. Defaulting to it would silently drop a protection layer.
    expect(defaultPermissionModeForCli('codex')).toBe('default');
  });

  it('hides every launch control Codex has no flag for', () => {
    expect(uiCapabilitiesForCli('codex')).toEqual({
      effort: false,
      allowedTools: false,
      appendSystemPrompt: false,
      agentMode: false,
    });
  });

  it('builds a resume/fork shell command matching the provider\'s argv', () => {
    expect(buildResumeShellCommand({ cliType: 'codex', resumeId: ID }))
      .toBe(`codex resume ${ID}`);
    expect(buildResumeShellCommand({ cliType: 'codex', resumeId: ID, fork: true }))
      .toBe(`codex fork ${ID}`);
  });
});
