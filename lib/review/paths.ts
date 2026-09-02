import path from 'path';
import {
  lstat,
  realpath,
} from 'fs/promises';
import { NavigationServiceError } from '@/lib/navigation/NavigationService';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function normalizeForComparison(value: string): string {
  return process.platform === 'win32' || process.platform === 'darwin'
    ? value.toLocaleLowerCase()
    : value;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(
    normalizeForComparison(root),
    normalizeForComparison(candidate),
  );
  return relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

export interface ValidatedReviewPath {
  path: string;
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  identity?: string;
  size?: number;
}

export async function validateReviewPath(
  root: string,
  value: unknown,
): Promise<ValidatedReviewPath> {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NavigationServiceError(
      'INVALID_REVIEW_PATH',
      'Review file path is required.',
    );
  }
  const raw = value.trim();
  if (
    raw.length > 1_024
    || CONTROL_CHARACTERS.test(raw)
    || raw.startsWith('/')
    || raw.startsWith('\\')
    || raw.startsWith('//')
    || /^[A-Za-z]:/.test(raw)
    || raw.includes('\\')
    || raw.split('/').some(segment => segment === '..')
  ) {
    throw new NavigationServiceError(
      'UNSAFE_REVIEW_PATH',
      'Review paths must be repository-relative POSIX paths.',
      403,
    );
  }

  const normalized = path.posix.normalize(raw.replace(/\/+/g, '/'));
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new NavigationServiceError(
      'UNSAFE_REVIEW_PATH',
      'Review path must stay inside the session repository.',
      403,
    );
  }

  const absolutePath = path.resolve(root, ...normalized.split('/'));
  if (!isWithinRoot(root, absolutePath)) {
    throw new NavigationServiceError(
      'REVIEW_PATH_OUTSIDE_ROOT',
      'Review path resolves outside the session repository.',
      403,
    );
  }

  let cursor = absolutePath;
  let leafStat: Awaited<ReturnType<typeof lstat>> | null = null;
  while (true) {
    try {
      const entry = await lstat(cursor);
      if (cursor === absolutePath) leafStat = entry;
      const resolved = await realpath(cursor);
      if (!isWithinRoot(root, resolved)) {
        throw new NavigationServiceError(
          'REVIEW_PATH_OUTSIDE_ROOT',
          'Review path crosses a symlink outside the session repository.',
          403,
        );
      }
      break;
    } catch (error) {
      if (error instanceof NavigationServiceError) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor || !isWithinRoot(root, parent)) {
        throw new NavigationServiceError(
          'REVIEW_PATH_OUTSIDE_ROOT',
          'Review path has no safe parent inside the session repository.',
          403,
        );
      }
      cursor = parent;
    }
  }

  if (leafStat?.isSymbolicLink()) {
    throw new NavigationServiceError(
      'REVIEW_SYMLINK_FORBIDDEN',
      'Review selection cannot target a symbolic link.',
      403,
    );
  }
  if (leafStat && !leafStat.isFile() && !leafStat.isDirectory()) {
    throw new NavigationServiceError(
      'REVIEW_FILE_REQUIRED',
      'Review selection must target a regular file.',
    );
  }

  return {
    path: normalized,
    absolutePath,
    exists: Boolean(leafStat),
    isDirectory: Boolean(leafStat?.isDirectory()),
    identity: leafStat ? `${leafStat.dev}:${leafStat.ino}` : undefined,
    size: leafStat?.size,
  };
}
