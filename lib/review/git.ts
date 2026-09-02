import { spawn } from 'child_process';
import { NavigationServiceError } from '@/lib/navigation/NavigationService';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_BASE_TREE_CACHE_ENTRIES = 4;
const baseTreeCache = new Map<string, Map<string, string | null>>();

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export async function runReviewGit(
  cwd: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxOutputBytes?: number;
    allowedCodes?: number[];
    input?: Buffer;
  } = {},
): Promise<GitResult> {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_OUTPUT_BYTES,
    allowedCodes = [0],
    input,
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_LITERAL_PATHSPECS: '1',
      },
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => {
      child.kill();
      finish(() => reject(new NavigationServiceError(
        'REVIEW_CAPTURE_ABORTED',
        'Review capture was cancelled.',
        499,
      )));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new NavigationServiceError(
        'GIT_REVIEW_TIMEOUT',
        'Git did not complete the review operation in time.',
        504,
      )));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (input && child.stdin) {
      child.stdin.end(input);
    }

    child.stdout!.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxOutputBytes) {
        child.kill();
        finish(() => reject(new NavigationServiceError(
          'GIT_REVIEW_OUTPUT_LIMIT',
          'Git review output exceeded the configured limit.',
          413,
        )));
        return;
      }
      stdout.push(buffer);
    });
    child.stderr!.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => {
      finish(() => reject(new NavigationServiceError(
        'GIT_REVIEW_UNAVAILABLE',
        error.message,
        503,
      )));
    });
    child.on('close', code => {
      finish(() => {
        const result = {
          code: code ?? -1,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
        };
        if (!allowedCodes.includes(result.code)) {
          reject(new NavigationServiceError(
            'GIT_REVIEW_FAILED',
            result.stderr || `Git review command failed with code ${result.code}.`,
            400,
          ));
          return;
        }
        resolve(result);
      });
    });
  });
}

export async function resolveCommit(
  cwd: string,
  value: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await runReviewGit(
    cwd,
    ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`],
    { signal, allowedCodes: [0, 128] },
  );
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

export async function currentBranch(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await runReviewGit(
    cwd,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { signal, allowedCodes: [0, 1, 128] },
  );
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

export async function mergeBase(
  cwd: string,
  left: string,
  right: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await runReviewGit(
    cwd,
    ['merge-base', left, right],
    { signal, allowedCodes: [0, 1, 128] },
  );
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

export interface GitTreeEntry {
  mode: string;
  type: string;
  objectId: string;
  path: string;
}

export async function readTreeEntry(
  cwd: string,
  commit: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<GitTreeEntry | null> {
  const result = await runReviewGit(
    cwd,
    ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', commit, '--', filePath],
    { signal, maxOutputBytes: 16 * 1024 },
  );
  if (result.stdout.length === 0) return null;
  const record = result.stdout.toString('utf8').split('\0')[0];
  const match = record.match(/^(\d+)\s+(\S+)\s+([0-9a-f]+)\t([\s\S]+)$/);
  return match
    ? {
        mode: match[1],
        type: match[2],
        objectId: match[3],
        path: match[4],
      }
    : null;
}

export async function readIndexEntry(
  cwd: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<GitTreeEntry | null> {
  const result = await runReviewGit(
    cwd,
    ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', filePath],
    { signal, maxOutputBytes: 16 * 1024 },
  );
  if (result.stdout.length === 0) return null;
  const record = result.stdout.toString('utf8').split('\0')[0];
  const match = record.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t([\s\S]+)$/);
  return match
    ? {
        mode: match[1],
        type: match[1] === '160000' ? 'commit' : 'blob',
        objectId: match[2],
        path: match[3],
      }
    : null;
}

export async function readBlob(
  cwd: string,
  objectId: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const sizeResult = await runReviewGit(cwd, ['cat-file', '-s', objectId], {
    signal,
    maxOutputBytes: 1_024,
  });
  const size = Number.parseInt(sizeResult.stdout.toString('utf8').trim(), 10);
  if (!Number.isFinite(size) || size > maximumBytes) return null;
  const result = await runReviewGit(cwd, ['cat-file', '-p', objectId], {
    signal,
    maxOutputBytes: maximumBytes + 1,
  });
  return result.stdout;
}

export async function renameMap(
  cwd: string,
  baseSha: string,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const result = await runReviewGit(
    cwd,
    ['--literal-pathspecs', 'diff', '--name-status', '-z', '-M', baseSha],
    { signal, maxOutputBytes: 4 * 1024 * 1024 },
  );
  const fields = result.stdout.toString('utf8').split('\0');
  const renames = new Map<string, string>();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) break;
    if (status.startsWith('R')) {
      const previousPath = fields[index++];
      const nextPath = fields[index++];
      if (previousPath && nextPath) renames.set(nextPath, previousPath);
    } else {
      index += 1;
    }
  }
  return renames;
}

export async function findExactBasePath(
  cwd: string,
  baseSha: string,
  content: Buffer,
  signal?: AbortSignal,
): Promise<string | null> {
  const hashResult = await runReviewGit(cwd, ['hash-object', '--stdin'], {
    signal,
    input: content,
    maxOutputBytes: 1_024,
  });
  const objectId = hashResult.stdout.toString('utf8').trim();
  const cacheKey = `${cwd}\0${baseSha}`;
  let objects = baseTreeCache.get(cacheKey);
  if (!objects) {
    let tree: GitResult;
    try {
      tree = await runReviewGit(
        cwd,
        ['ls-tree', '-r', '-z', '--full-tree', baseSha],
        { signal, maxOutputBytes: 32 * 1024 * 1024 },
      );
    } catch (error) {
      if (
        error instanceof NavigationServiceError
        && error.code === 'GIT_REVIEW_OUTPUT_LIMIT'
      ) {
        return null;
      }
      throw error;
    }
    objects = new Map();
    for (const record of tree.stdout.toString('utf8').split('\0')) {
      const match = record.match(/^(\d+)\s+(\S+)\s+([0-9a-f]+)\t([\s\S]+)$/);
      if (match?.[2] !== 'blob') continue;
      if (objects.has(match[3])) objects.set(match[3], null);
      else objects.set(match[3], match[4]);
    }
    baseTreeCache.set(cacheKey, objects);
    while (baseTreeCache.size > MAX_BASE_TREE_CACHE_ENTRIES) {
      const oldest = baseTreeCache.keys().next().value as string | undefined;
      if (!oldest) break;
      baseTreeCache.delete(oldest);
    }
  }
  return objects.get(objectId) ?? null;
}

export async function isSparseSkipped(
  cwd: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await runReviewGit(
    cwd,
    ['--literal-pathspecs', 'ls-files', '-v', '--', filePath],
    { signal, maxOutputBytes: 16 * 1024 },
  );
  return result.stdout.toString('utf8').startsWith('S ');
}
