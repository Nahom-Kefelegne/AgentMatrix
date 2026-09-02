import { createHash, randomUUID } from 'crypto';
import {
  lstat,
  readFile,
} from 'fs/promises';
import type {
  ReviewBaseResolution,
  ReviewFileEntry,
  ReviewSnapshotMeta,
} from '@/lib/canvas/types';
import { countLineDiff } from '@/lib/cli/transcript/diff';
import {
  NavigationServiceError,
  type NavigationRoot,
} from '@/lib/navigation/NavigationService';
import { getSession } from '@/lib/state/sessionStore';
import {
  currentBranch,
  findExactBasePath,
  isSparseSkipped,
  mergeBase,
  readBlob,
  readIndexEntry,
  readTreeEntry,
  renameMap,
  resolveCommit,
} from './git';
import { validateReviewPath } from './paths';
import {
  retainReviewSnapshot,
  ReviewSnapshotStoreError,
  reviewSessionGeneration,
} from './snapshotStore';
import type {
  ReviewFileInput,
  ReviewSnapshotFile,
} from './types';
import { MAX_REVIEW_FILE_BYTES } from './types';
const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.length === 0) return false;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) controls++;
  }
  return controls / sample.length > 0.2;
}

function normalizeForCounts(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function stableRead(
  absolutePath: string,
  signal?: AbortSignal,
): Promise<{ content: Buffer; oversized: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      throw new NavigationServiceError(
        'REVIEW_CAPTURE_ABORTED',
        'Review capture was cancelled.',
        499,
      );
    }
    const before = await lstat(absolutePath);
    if (!before.isFile()) {
      throw new NavigationServiceError(
        'REVIEW_FILE_REQUIRED',
        'Review selection must target a regular file.',
      );
    }
    if (before.size > MAX_REVIEW_FILE_BYTES) {
      return { content: Buffer.alloc(0), oversized: true };
    }
    const content = await readFile(absolutePath);
    const after = await lstat(absolutePath);
    if (
      before.size === after.size
      && before.mtimeMs === after.mtimeMs
      && before.ino === after.ino
    ) {
      return { content, oversized: false };
    }
  }
  throw new NavigationServiceError(
    'WORKTREE_CHANGED_DURING_CAPTURE',
    'A selected file changed while the review snapshot was being captured.',
    409,
  );
}

function validateBaseRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > 200
    || CONTROL_CHARACTERS.test(value)
    || value.trim().startsWith('-')
    || !/^[A-Za-z0-9._/@{}~^+-]+$/.test(value.trim())
  ) {
    throw new NavigationServiceError(
      'INVALID_REVIEW_BASE',
      'baseRef must be a valid non-option Git commit-ish of 200 characters or fewer.',
    );
  }
  return value.trim();
}

async function resolveBase(
  root: NavigationRoot,
  requestedBaseRef: string | undefined,
  signal?: AbortSignal,
): Promise<{
  branch: string | null;
  headSha: string | null;
  effectiveBaseSha: string | null;
  resolution: ReviewBaseResolution;
}> {
  if (!root.isGitRepository) {
    if (requestedBaseRef) {
      throw new NavigationServiceError(
        'REVIEW_BASE_REQUIRES_GIT',
        'baseRef cannot be used because the session root is not a Git repository.',
      );
    }
    return {
      branch: null,
      headSha: null,
      effectiveBaseSha: null,
      resolution: 'non-git',
    };
  }
  const [branch, headSha] = await Promise.all([
    currentBranch(root.absolutePath, signal),
    resolveCommit(root.absolutePath, 'HEAD', signal),
  ]);
  if (!headSha) {
    return {
      branch,
      headSha: null,
      effectiveBaseSha: null,
      resolution: 'unborn',
    };
  }
  if (requestedBaseRef) {
    const explicit = await resolveCommit(
      root.absolutePath,
      requestedBaseRef,
      signal,
    );
    if (!explicit) {
      throw new NavigationServiceError(
        'REVIEW_BASE_NOT_FOUND',
        `The requested review base "${requestedBaseRef}" could not be resolved.`,
        404,
      );
    }
    return {
      branch,
      headSha,
      effectiveBaseSha: explicit,
      resolution: 'explicit',
    };
  }
  const upstream = await resolveCommit(
    root.absolutePath,
    '@{upstream}',
    signal,
  );
  if (upstream) {
    const derived = await mergeBase(
      root.absolutePath,
      upstream,
      headSha,
      signal,
    );
    if (derived) {
      return {
        branch,
        headSha,
        effectiveBaseSha: derived,
        resolution: 'upstream-merge-base',
      };
    }
  }
  return {
    branch,
    headSha,
    effectiveBaseSha: headSha,
    resolution: 'head-fallback',
  };
}

function unavailableFile(
  path: string,
  reason: ReviewFileInput['reason'],
  unavailableReason: NonNullable<ReviewFileEntry['unavailableReason']>,
  original = '',
  current = '',
): ReviewSnapshotFile {
  return {
    entry: {
      fileId: randomUUID(),
      path,
      reason,
      status: 'unavailable',
      additions: 0,
      deletions: 0,
      contentAvailable: false,
      unavailableReason,
    },
    original,
    current,
    originalHash: contentHash(original),
    currentHash: contentHash(current),
  };
}

export async function captureReviewSnapshot(options: {
  sessionId: string;
  root: NavigationRoot;
  files: ReviewFileInput[];
  baseRef?: unknown;
  signal?: AbortSignal;
}): Promise<{
  files: ReviewFileEntry[];
  snapshot: ReviewSnapshotMeta;
}> {
  const { sessionId, root, signal } = options;
  const generation = reviewSessionGeneration(sessionId);
  const requestedBaseRef = validateBaseRef(options.baseRef);
  const base = await resolveBase(root, requestedBaseRef, signal);
  const renames = base.effectiveBaseSha
    ? await renameMap(root.absolutePath, base.effectiveBaseSha, signal)
    : new Map<string, string>();

  const seenPaths = new Map<string, string>();
  const seenIdentities = new Set<string>();
  const validatedFiles: Array<{
    input: ReviewFileInput;
    validated: Awaited<ReturnType<typeof validateReviewPath>>;
  }> = [];
  for (const input of options.files) {
    const validated = await validateReviewPath(root.absolutePath, input.path);
    const comparisonKey =
      process.platform === 'win32' || process.platform === 'darwin'
        ? validated.path.toLocaleLowerCase()
        : validated.path;
    const existingPath = seenPaths.get(comparisonKey);
    if (existingPath === validated.path) continue;
    if (existingPath) {
      throw new NavigationServiceError(
        'AMBIGUOUS_REVIEW_PATH',
        `Selected review paths differ only by case: ${existingPath} and ${validated.path}.`,
      );
    }
    if (validated.identity && seenIdentities.has(validated.identity)) {
      throw new NavigationServiceError(
        'AMBIGUOUS_REVIEW_PATH',
        `Multiple selected paths resolve to the same file: ${validated.path}.`,
      );
    }
    seenPaths.set(comparisonKey, validated.path);
    if (validated.identity) seenIdentities.add(validated.identity);
    validatedFiles.push({ input, validated });
  }

  const capturedFiles: ReviewSnapshotFile[] = [];
  let capturedBytes = 0;
  for (const { input, validated } of validatedFiles) {
    let previousPath = renames.get(validated.path);
    let basePath = previousPath ?? validated.path;
    let treeEntry = base.effectiveBaseSha
      ? await readTreeEntry(
          root.absolutePath,
          base.effectiveBaseSha,
          basePath,
          signal,
        )
      : null;
    const indexEntry = root.isGitRepository
      ? await readIndexEntry(root.absolutePath, validated.path, signal)
      : null;
    const baseGitlink =
      treeEntry?.mode === '160000' || treeEntry?.type === 'commit';
    const currentGitlink =
      indexEntry?.mode === '160000' || indexEntry?.type === 'commit';
    const typeChanged =
      (baseGitlink && Boolean(indexEntry) && !currentGitlink)
      || (currentGitlink && Boolean(treeEntry) && !baseGitlink);
    if (typeChanged) {
      capturedFiles.push(unavailableFile(
        validated.path,
        input.reason,
        'type_changed',
      ));
      continue;
    }
    if (baseGitlink || currentGitlink) {
      const original = baseGitlink ? `${treeEntry!.objectId}\n` : '';
      const current = currentGitlink ? `${indexEntry!.objectId}\n` : '';
      const counts = countLineDiff(original, current);
      capturedFiles.push({
        entry: {
          fileId: randomUUID(),
          path: validated.path,
          reason: input.reason,
          status: previousPath
            ? 'renamed'
            : !baseGitlink
              ? 'added'
              : !currentGitlink
                ? 'deleted'
                : original === current
                  ? 'unchanged'
                  : 'modified',
          previousPath,
          additions: counts.additions,
          deletions: counts.deletions,
          contentAvailable: true,
          contentKind: 'gitlink',
        },
        original,
        current,
        originalHash: contentHash(original),
        currentHash: contentHash(current),
      });
      continue;
    }
    if (validated.isDirectory) {
      throw new NavigationServiceError(
        'REVIEW_FILE_REQUIRED',
        `Review selection must target a file: ${validated.path}.`,
      );
    }
    if (
      !validated.exists
      && root.isGitRepository
      && await isSparseSkipped(root.absolutePath, validated.path, signal)
    ) {
      capturedFiles.push(unavailableFile(
        validated.path,
        input.reason,
        'sparse',
      ));
      continue;
    }
    if (!validated.exists && !treeEntry) {
      throw new NavigationServiceError(
        'REVIEW_FILE_NOT_FOUND',
        `The selected review file does not exist and is not known to Git: ${validated.path}.`,
        404,
      );
    }

    let currentOversized =
      validated.exists && (validated.size ?? 0) > MAX_REVIEW_FILE_BYTES;
    const currentRead = validated.exists && !currentOversized
      ? await stableRead(validated.absolutePath, signal)
      : { content: Buffer.alloc(0), oversized: currentOversized };
    currentOversized ||= currentRead.oversized;
    const currentBuffer = currentRead.content;
    if (
      !treeEntry
      && validated.exists
      && !currentOversized
      && base.effectiveBaseSha
    ) {
      const exactPreviousPath = await findExactBasePath(
        root.absolutePath,
        base.effectiveBaseSha,
        currentBuffer,
        signal,
      );
      if (exactPreviousPath && exactPreviousPath !== validated.path) {
        previousPath = exactPreviousPath;
        basePath = exactPreviousPath;
        treeEntry = await readTreeEntry(
          root.absolutePath,
          base.effectiveBaseSha,
          basePath,
          signal,
        );
      }
    }

    let originalBuffer: Buffer = Buffer.alloc(0);
    let originalOversized = false;
    if (treeEntry?.type === 'blob') {
      const blob = await readBlob(
        root.absolutePath,
        treeEntry.objectId,
        MAX_REVIEW_FILE_BYTES,
        signal,
      );
      originalOversized = blob === null;
      originalBuffer = blob ?? Buffer.alloc(0);
    }
    if (originalOversized || currentOversized) {
      capturedFiles.push(unavailableFile(
        validated.path,
        input.reason,
        'too_large',
      ));
      continue;
    }
    if (isBinary(originalBuffer) || isBinary(currentBuffer)) {
      capturedFiles.push(unavailableFile(
        validated.path,
        input.reason,
        'binary',
      ));
      continue;
    }

    const fileBytes = originalBuffer.length + currentBuffer.length;
    if (capturedBytes + fileBytes > MAX_SNAPSHOT_BYTES) {
      capturedFiles.push(unavailableFile(
        validated.path,
        input.reason,
        'too_large',
      ));
      continue;
    }
    capturedBytes += fileBytes;
    const original = originalBuffer.toString('utf8');
    const current = currentBuffer.toString('utf8');
    const counts = countLineDiff(
      normalizeForCounts(original),
      normalizeForCounts(current),
    );
    const status: ReviewFileEntry['status'] = previousPath
      ? 'renamed'
      : !treeEntry && validated.exists
        ? 'added'
        : treeEntry && !validated.exists
          ? 'deleted'
          : original === current
            ? 'unchanged'
            : 'modified';
    capturedFiles.push({
      entry: {
        fileId: randomUUID(),
        path: validated.path,
        reason: input.reason,
        status,
        previousPath,
        additions: counts.additions,
        deletions: counts.deletions,
        contentAvailable: true,
      },
      original,
      current,
      originalHash: contentHash(original),
      currentHash: contentHash(current),
    });
  }

  if (!getSession(sessionId)) {
    throw new NavigationServiceError(
      'SESSION_ENDED',
      'The managed session ended before review capture completed.',
      410,
    );
  }
  for (const file of capturedFiles) {
    if (!file.entry.contentAvailable) continue;
    if (file.entry.contentKind === 'gitlink') {
      const indexEntry = root.isGitRepository
        ? await readIndexEntry(root.absolutePath, file.entry.path, signal)
        : null;
      const current = indexEntry?.mode === '160000'
        ? `${indexEntry.objectId}\n`
        : '';
      if (contentHash(current) !== file.currentHash) {
        throw new NavigationServiceError(
          'WORKTREE_CHANGED_DURING_CAPTURE',
          `The selected submodule changed before the review snapshot was finalized: ${file.entry.path}.`,
          409,
        );
      }
      continue;
    }
    const validated = await validateReviewPath(root.absolutePath, file.entry.path);
    const current = validated.exists && !validated.isDirectory
      ? await stableRead(validated.absolutePath, signal)
      : { content: Buffer.alloc(0), oversized: false };
    if (
      current.oversized
      || contentHash(current.content.toString('utf8')) !== file.currentHash
    ) {
      throw new NavigationServiceError(
        'WORKTREE_CHANGED_DURING_CAPTURE',
        `The selected file changed before the review snapshot was finalized: ${file.entry.path}.`,
        409,
      );
    }
  }
  const meta: ReviewSnapshotMeta = {
    snapshotRef: randomUUID(),
    branch: base.branch,
    headSha: base.headSha,
    requestedBaseRef: requestedBaseRef ?? null,
    effectiveBaseSha: base.effectiveBaseSha,
    baseResolution: base.resolution,
    isGitRepository: root.isGitRepository,
    capturedAt: Date.now(),
  };
  try {
    retainReviewSnapshot({
      sessionId,
      meta,
      files: capturedFiles,
    }, generation);
  } catch (error) {
    if (error instanceof ReviewSnapshotStoreError) {
      throw new NavigationServiceError(error.code, error.message, error.status);
    }
    throw error;
  }
  return {
    files: capturedFiles.map(file => file.entry),
    snapshot: meta,
  };
}
