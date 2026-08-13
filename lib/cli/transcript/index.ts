import { readFileSync, existsSync, statSync } from 'fs';
import { dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliType } from '../CliProvider';
import type { FileOp, FileChange, FileDiff } from './types';
import { parseCopilotTranscript } from './parseCopilot';
import { parseClaudeTranscript } from './parseClaude';
import { countLineDiff } from './diff';

/**
 * Native, transcript-based change detection. Reads a session's own on-disk
 * transcript (the authoritative record of the agent's file edits) and derives
 * per-session diffs — with NO dependency on git and correctly isolated to just
 * this session's work. See docs/design/native-diff-tracking.md.
 */

const execFileAsync = promisify(execFile);

const parsedTranscriptCache = new Map<string, { mtimeMs: number; ops: FileOp[] }>();
const sessionFileChangesCache = new Map<string, { mtimeMs: number; changes: FileChange[] }>();
const repoRootCache = new Map<string, string | null>();
const MAX_REPO_ROOT_CACHE_ENTRIES = 100;

interface GitContext {
  repoRootByDir: Map<string, string | null>;
}

function transcriptMtimeMs(transcriptPath: string): number | null {
  try {
    return statSync(transcriptPath).mtimeMs;
  } catch {
    parsedTranscriptCache.delete(transcriptPath);
    sessionFileChangesCache.delete(transcriptPath);
    return null;
  }
}

function parseTranscript(transcriptPath: string, cliType: CliType): FileOp[] {
  const mtimeMs = transcriptMtimeMs(transcriptPath);
  if (mtimeMs === null) return [];

  const cached = parsedTranscriptCache.get(transcriptPath);
  if (cached?.mtimeMs === mtimeMs) return cached.ops;

  // Kimi's wire.jsonl and Codex's rollout-*.jsonl are BOTH line-delimited JSON,
  // and neither uses Claude's schema. Falling through to parseClaudeTranscript
  // would mine a foreign format for tool calls and surface whatever
  // coincidentally matched as this session's edits. Report "no ops" until real
  // parsers land — an empty changed-files list is honest; a fabricated one is
  // not. (Codex wraps every line as {"timestamp","type","payload"}; its
  // per-item schema was not verified when CodexProvider was written.)
  const ops = cliType === 'kimi' || cliType === 'codex'
    ? []
    : cliType === 'copilot'
      ? parseCopilotTranscript(transcriptPath)
      : parseClaudeTranscript(transcriptPath);
  parsedTranscriptCache.set(transcriptPath, { mtimeMs, ops });
  return ops;
}

/** Ops grouped by absolute path, preserving transcript order within each file. */
function groupByPath(ops: FileOp[]): Map<string, FileOp[]> {
  const map = new Map<string, FileOp[]>();
  for (const op of ops) {
    const list = map.get(op.path);
    if (list) list.push(op);
    else map.set(op.path, [op]);
  }
  return map;
}

/**
 * Undo a single edit: turn the post-edit text back into the pre-edit text by
 * replacing `newStr` with `oldStr`. Best-effort (mirrors the CLI's own
 * first-occurrence replace semantics).
 */
function undoEdit(content: string, oldStr: string, newStr: string, replaceAll?: boolean): string {
  if (newStr === '' || !content.includes(newStr)) return content;
  if (replaceAll) return content.split(newStr).join(oldStr);
  const idx = content.indexOf(newStr);
  return content.slice(0, idx) + oldStr + content.slice(idx + newStr.length);
}

/**
 * Reconstruct the file's pre-session content by reverse-applying the session's
 * ops to the current on-disk content (newest → oldest).
 *
 * - Pure edit history (file existed before) → perfectly recovers the baseline.
 * - Create-then-edits → collapses to '' at the create (the file was new).
 * - A full overwrite of a pre-existing file is inherently lossy (the prior
 *   content isn't in the transcript); callers fall back to git HEAD for that.
 */
function reverseApply(current: string, ops: FileOp[]): string {
  let content = current;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.kind === 'edit') {
      content = undoEdit(content, op.oldStr ?? '', op.newStr ?? '', op.replaceAll);
    } else if (op.kind === 'create') {
      content = ''; // before a create, the file did not exist (session's view)
    }
    // 'delete' is terminal and handled at the status level, not here.
  }
  return content;
}

function createGitContext(): GitContext {
  return { repoRootByDir: new Map() };
}

function isUnderRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/') || path.startsWith(root + '\\');
}

function cacheRepoRoot(dir: string, root: string | null, context: GitContext): void {
  if (repoRootCache.size >= MAX_REPO_ROOT_CACHE_ENTRIES) repoRootCache.clear();
  repoRootCache.set(dir, root);
  context.repoRootByDir.set(dir, root);
}

function findCachedRepoRoot(dir: string, context: GitContext): string | null | undefined {
  if (context.repoRootByDir.has(dir)) return context.repoRootByDir.get(dir) ?? null;
  if (repoRootCache.has(dir)) {
    const root = repoRootCache.get(dir) ?? null;
    context.repoRootByDir.set(dir, root);
    return root;
  }

  for (const root of context.repoRootByDir.values()) {
    if (root && isUnderRoot(dir, root)) {
      context.repoRootByDir.set(dir, root);
      return root;
    }
  }

  for (const root of repoRootCache.values()) {
    if (root && isUnderRoot(dir, root)) {
      context.repoRootByDir.set(dir, root);
      return root;
    }
  }

  return undefined;
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
  });
  return stdout;
}

async function getRepoRoot(dir: string, context: GitContext): Promise<string | null> {
  const cached = findCachedRepoRoot(dir, context);
  if (cached !== undefined) return cached;

  try {
    const root = (await execGit(['rev-parse', '--show-toplevel'], dir)).trim() || null;
    cacheRepoRoot(dir, root, context);
    return root;
  } catch {
    cacheRepoRoot(dir, null, context);
    return null;
  }
}

/** Best-effort `git show HEAD:<path>` for the lossy-baseline fallback. Null on any failure. */
async function gitHead(filePath: string, context: GitContext): Promise<string | null> {
  try {
    const dir = dirname(filePath);
    const root = await getRepoRoot(dir, context);
    if (!root) return null;
    const rel = filePath.replace(root + '/', '').replace(root + '\\', '');
    return await execGit(['show', `HEAD:${rel}`], root);
  } catch {
    return null;
  }
}

/** Resolve { original, current, isNew, status } for one file from its ops. */
async function resolveFile(path: string, ops: FileOp[], context: GitContext): Promise<{
  original: string;
  current: string;
  isNew: boolean;
  status: FileChange['status'];
}> {
  const onDisk = existsSync(path);
  const earliestIsCreate = ops[0]?.kind === 'create';
  const lastIsDelete = ops[ops.length - 1]?.kind === 'delete';

  // Deleted this session (or gone from disk): before = git HEAD or best-effort empty.
  if (lastIsDelete || !onDisk) {
    const original = (await gitHead(path, context)) ?? '';
    return { original, current: '', isNew: false, status: 'deleted' };
  }

  let current = '';
  try {
    current = readFileSync(path, 'utf-8');
  } catch {
    current = '';
  }

  if (earliestIsCreate) {
    return { original: '', current, isNew: true, status: 'new' };
  }

  // Pre-existing file edited this session → reverse-apply to recover the baseline.
  let original = reverseApply(current, ops);
  // If reverse-apply couldn't change anything (edits didn't match, or a lossy
  // full overwrite), prefer git HEAD when it's available.
  if (original === current) {
    original = (await gitHead(path, context)) ?? original;
  }
  return { original, current, isNew: false, status: 'modified' };
}

/** List of changed files for a session (summary rows for the changes list). */
export async function getSessionFileChanges(transcriptPath: string, cliType: CliType): Promise<FileChange[]> {
  const mtimeMs = transcriptMtimeMs(transcriptPath);
  if (mtimeMs === null) return [];

  const cached = sessionFileChangesCache.get(transcriptPath);
  if (cached?.mtimeMs === mtimeMs) return cached.changes;

  const ops = parseTranscript(transcriptPath, cliType);
  if (ops.length === 0) {
    const changes: FileChange[] = [];
    sessionFileChangesCache.set(transcriptPath, { mtimeMs, changes });
    return changes;
  }

  const grouped = groupByPath(ops);
  const changes: FileChange[] = [];
  const gitContext = createGitContext();
  for (const [path, fileOps] of grouped) {
    const { original, current, status } = await resolveFile(path, fileOps, gitContext);
    if (status !== 'deleted' && original === current) continue; // net no-op (e.g. edited then reverted)
    const { additions, deletions } = status === 'deleted'
      ? { additions: 0, deletions: countLineDiff(original, '').deletions }
      : countLineDiff(original, current);
    changes.push({ path, status, additions, deletions });
  }
  sessionFileChangesCache.set(transcriptPath, { mtimeMs, changes });
  return changes;
}

/** Before/after content for a single file (feeds Monaco's DiffEditor). */
export async function getSessionFileDiff(
  transcriptPath: string,
  cliType: CliType,
  filePath: string,
): Promise<FileDiff | null> {
  const ops = parseTranscript(transcriptPath, cliType);
  const fileOps = ops.filter(o => o.path === filePath);
  if (fileOps.length === 0) return null;

  const { original, current, isNew } = await resolveFile(filePath, fileOps, createGitContext());
  return { file: filePath, original, current, isNew };
}

export function invalidateSessionFileChanges(transcriptPath: string): void {
  sessionFileChangesCache.delete(transcriptPath);
}

/** All absolute paths this session touched (successful file ops only). */
export function getSessionTouchedPaths(transcriptPath: string, cliType: CliType): string[] {
  const ops = parseTranscript(transcriptPath, cliType);
  return [...new Set(ops.map(o => o.path))];
}
