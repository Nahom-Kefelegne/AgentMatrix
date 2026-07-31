import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { realpath, readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSession } from '@/lib/state/sessionStore';
import type {
  NavigationAction,
  NavigationFile,
  NavigationRequest,
  NavigationSearchMatch,
  NavigationSearchResponse,
  NavigationSymbolMatch,
  SourceRange,
} from './types';
import {
  getRegisteredNavigationRoot,
  registerNavigationRoot,
} from './rootRegistry';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_RESULTS = 100;
const MAX_DIRECTORIES = 2_000;
const MAX_FILES = 10_000;
const SEARCH_CACHE_TTL_MS = 5_000;
const SEARCH_CACHE_SIZE = 100;
const GENERATED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.turbo', '.cache', 'node_modules', 'bower_components',
  'coverage', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__',
]);

export class NavigationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'NavigationServiceError';
  }
}

export interface NavigationRoot {
  sessionId: string;
  absolutePath: string;
  repoRef: string;
  isGitRepository: boolean;
}

export interface ReadFileOptions {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface ReadNavigationFile extends NavigationFile {}

export interface SearchOptions {
  mode: 'content' | 'symbol';
  scope?: string;
  signal?: AbortSignal;
  onBatch?: (matches: NavigationSearchMatch[]) => void;
}

interface SearchCacheValue {
  expiresAt: number;
  value: NavigationSearchResponse;
}

interface InFlightSearch {
  controller: AbortController;
  promise: Promise<NavigationSearchResponse>;
  consumers: number;
  settled: boolean;
}

interface WalkResult {
  matches: NavigationSearchMatch[];
  truncated: boolean;
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function normalizeForComparison(value: string): string {
  return isWindows() ? value.toLocaleLowerCase() : value;
}

function repositoryReference(root: string): string {
  return `repo:${createHash('sha256').update(normalizeForComparison(root)).digest('hex').slice(0, 24)}`;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeForComparison(root), normalizeForComparison(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toPosixRelative(root: string, target: string): string {
  const relative = path.relative(root, target).replace(/\\/g, '/');
  if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new NavigationServiceError('PATH_OUTSIDE_ROOT', 'The resolved path is outside the session repository.', 403);
  }
  return relative;
}

function decodePathCandidate(value: string): string {
  // Reject separator/traversal characters even when they have been encoded
  // repeatedly (for example %25252e%25252e). A valid repository path has no
  // need to encode these structural characters.
  if (/%(?:25)*(?:2e|2f|5c)/i.test(value)) {
    throw new NavigationServiceError('ENCODED_PATH_TRAVERSAL', 'Encoded path traversal or separators are not allowed.', 403);
  }
  let decoded = value;
  for (let count = 0; count < 8; count++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return next;
      decoded = next;
    } catch {
      throw new NavigationServiceError('INVALID_PATH_ENCODING', 'Path contains invalid percent encoding.');
    }
  }
  return decoded;
}

function rejectUnsafeModelPath(value: string): void {
  const decoded = decodePathCandidate(value);
  if (!decoded || decoded.includes('\0')) {
    throw new NavigationServiceError('INVALID_PATH', 'A non-empty path without NUL bytes is required.');
  }
  if (
    decoded.startsWith('/') ||
    decoded.startsWith('\\') ||
    decoded.startsWith('//') ||
    /^[A-Za-z]:/.test(decoded) ||
    decoded.includes('\\')
  ) {
    throw new NavigationServiceError('ABSOLUTE_PATH_FORBIDDEN', 'Paths must be repository-relative POSIX paths.', 403);
  }
  if (decoded.split('/').some(segment => segment === '..')) {
    throw new NavigationServiceError('PATH_TRAVERSAL', 'Parent-directory path segments are not allowed.', 403);
  }
}

function canonicalRelativePath(value: string): string {
  rejectUnsafeModelPath(value);
  const decoded = decodePathCandidate(value).replace(/\/+/g, '/');
  const normalized = path.posix.normalize(decoded);
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').some(segment => segment === '..')
  ) {
    throw new NavigationServiceError('PATH_TRAVERSAL', 'Path must stay inside the repository.', 403);
  }
  return normalized;
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.length === 0) return false;
  let controlCharacters = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) controlCharacters++;
  }
  return controlCharacters / sample.length > 0.2;
}

function validateRangeWithinContent(range: SourceRange | undefined, content: string): void {
  validateSourceRange(range);
  if (!range) return;

  const lines = content.split(/\r\n|\r|\n/);
  const lineCount = lines.length;
  if (range.start.line > lineCount) {
    throw new NavigationServiceError(
      'INVALID_RANGE',
      `Range start line ${range.start.line} exceeds the file's ${lineCount} lines.`,
    );
  }
  if (range.end && range.end.line > lineCount) {
    throw new NavigationServiceError(
      'INVALID_RANGE',
      `Range end line ${range.end.line} exceeds the file's ${lineCount} lines.`,
    );
  }

  const validateColumn = (
    line: number,
    column: number | undefined,
    field: string,
  ) => {
    if (column === undefined) return;
    const maximum = (lines[line - 1]?.length ?? 0) + 1;
    if (column > maximum) {
      throw new NavigationServiceError(
        'INVALID_RANGE',
        `${field} ${column} exceeds line ${line}'s maximum column ${maximum}.`,
      );
    }
  };
  validateColumn(range.start.line, range.start.column, 'Range start column');
  if (range.end) {
    validateColumn(range.end.line, range.end.column, 'Range end column');
    if (
      range.end.line === range.start.line
      && range.start.column !== undefined
      && range.end.column !== undefined
      && range.end.column < range.start.column
    ) {
      throw new NavigationServiceError(
        'INVALID_RANGE',
        'Range end column must not precede its start column on the same line.',
      );
    }
  }
}

function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const languages: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.md': 'markdown',
    '.css': 'css', '.scss': 'scss', '.less': 'less', '.html': 'html', '.xml': 'xml',
    '.svg': 'xml', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.ps1': 'powershell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.sql': 'sql',
    '.graphql': 'graphql', '.gql': 'graphql', '.rb': 'ruby', '.php': 'php',
    '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala', '.vue': 'vue', '.svelte': 'svelte',
  };
  const name = path.basename(filePath).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  return languages[extension] ?? 'plaintext';
}

function rangeFromOptions(options: ReadFileOptions): SourceRange | undefined {
  const values = [options.startLine, options.startColumn, options.endLine, options.endColumn];
  if (values.every(value => value === undefined)) return undefined;
  const startLine = options.startLine;
  if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
    throw new NavigationServiceError('INVALID_RANGE', 'startLine must be a positive integer.');
  }
  if (options.startColumn !== undefined && (!Number.isInteger(options.startColumn) || options.startColumn < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'startColumn must be a positive integer.');
  }
  if (options.endLine !== undefined && (!Number.isInteger(options.endLine) || options.endLine < startLine)) {
    throw new NavigationServiceError('INVALID_RANGE', 'endLine must not precede startLine.');
  }
  if (options.endColumn !== undefined && (!Number.isInteger(options.endColumn) || options.endColumn < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'endColumn must be a positive integer.');
  }
  return {
    start: { line: startLine, column: options.startColumn },
    end: options.endLine === undefined ? undefined : { line: options.endLine, column: options.endColumn },
  };
}

function abortError(): NavigationServiceError {
  return new NavigationServiceError('REQUEST_ABORTED', 'Navigation request was cancelled.', 499);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isSymbolDeclaration(line: string): boolean {
  return /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:class|interface|enum|type|function|def|fn|func|struct|trait|namespace|module)\s+[\w$]+/.test(line)
    || /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.test(line)
    || /^\s*(?:public|private|protected|static|readonly)\s+[\w$]+\s*\(/.test(line);
}

function symbolName(line: string): string | undefined {
  const match = line.match(/(?:class|interface|enum|type|function|def|fn|func|struct|trait|namespace|module|const|let|var)\s+([\w$]+)/)
    ?? line.match(/(?:public|private|protected|static|readonly)\s+([\w$]+)\s*\(/);
  return match?.[1];
}

async function gitRoot(cwd: string, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let stderr = '';
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      signal?.removeEventListener('abort', onAbort);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve(null);
      else reject(error);
    });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(abortError());
      if (code === 0 && output.trim()) resolve(output.trim());
      else if (code === 1 || code === 128) resolve(null);
      else reject(new NavigationServiceError('REPOSITORY_RESOLUTION_FAILED', stderr.trim() || 'Could not resolve repository root.', 500));
    });
  });
}

async function gitIndexVersion(root: string): Promise<string> {
  const gitDir = path.join(root, '.git');
  try {
    const gitDirStat = await stat(gitDir);
    if (gitDirStat.isDirectory()) {
      const index = await stat(path.join(gitDir, 'index'));
      return `index:${Math.floor(index.mtimeMs)}:${index.size}`;
    }
    return `worktree:${Math.floor(gitDirStat.mtimeMs)}:${gitDirStat.size}`;
  } catch {
    return `filesystem:${Math.floor(Date.now() / SEARCH_CACHE_TTL_MS)}`;
  }
}

export class NavigationService {
  private readonly rootCache = new Map<string, NavigationRoot>();
  private readonly searchCache = new Map<string, SearchCacheValue>();
  private readonly inFlightSearches = new Map<string, InFlightSearch>();

  invalidateSession(sessionId: string): void {
    const root = this.rootCache.get(sessionId);
    this.rootCache.delete(sessionId);
    if (!root) return;
    const prefix = `${root.absolutePath}\u0000`;
    for (const key of this.searchCache.keys()) {
      if (key.startsWith(prefix)) this.searchCache.delete(key);
    }
    for (const [key, search] of this.inFlightSearches) {
      if (key.startsWith(prefix)) {
        search.controller.abort();
        this.inFlightSearches.delete(key);
      }
    }
  }

  async resolveRoot(sessionId: string, signal?: AbortSignal): Promise<NavigationRoot> {
    if (!sessionId || sessionId.length > 200) {
      throw new NavigationServiceError('INVALID_SESSION', 'A valid managed session ID is required.');
    }
    throwIfAborted(signal);
    const session = getSession(sessionId);
    const registered = getRegisteredNavigationRoot(sessionId);
    const cwd = session?.cwd ?? registered?.cwd;
    if (!cwd) {
      throw new NavigationServiceError('SESSION_NOT_FOUND', 'Managed session was not found or has no working directory.', 404);
    }

    const cached = this.rootCache.get(sessionId);
    if (cached && registered?.cwd === cwd) return cached;

    let resolvedCwd: string;
    try {
      resolvedCwd = await realpath(cwd);
    } catch {
      throw new NavigationServiceError('SESSION_ROOT_UNAVAILABLE', 'The managed session working directory is unavailable.', 404);
    }
    const discoveredRoot = await gitRoot(resolvedCwd, signal);
    throwIfAborted(signal);
    const absolutePath = await realpath(discoveredRoot ?? resolvedCwd);
    registerNavigationRoot(sessionId, cwd, absolutePath);
    const registeredRoot = getRegisteredNavigationRoot(sessionId);
    const root: NavigationRoot = {
      sessionId,
      absolutePath,
      repoRef: registeredRoot?.repoIdentity ?? repositoryReference(absolutePath),
      isGitRepository: Boolean(discoveredRoot),
    };
    this.rootCache.set(sessionId, root);
    return root;
  }

  async readFile(
    sessionId: string,
    relativePath: string,
    options: ReadFileOptions = {},
    signal?: AbortSignal,
  ): Promise<ReadNavigationFile> {
    const root = await this.resolveRoot(sessionId, signal);
    const resolved = await this.resolveModelPath(root, relativePath, signal);
    throwIfAborted(signal);

    let fileStat;
    try {
      fileStat = await stat(resolved.absolutePath);
    } catch {
      throw new NavigationServiceError('FILE_NOT_FOUND', 'The requested file does not exist.', 404);
    }
    if (!fileStat.isFile()) {
      throw new NavigationServiceError('NOT_A_FILE', 'The requested path is not a file.');
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      throw new NavigationServiceError(
        'FILE_TOO_LARGE',
        `The requested file exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MB navigation limit.`,
        413,
      );
    }

    const contentBuffer = await readFile(resolved.absolutePath);
    throwIfAborted(signal);
    if (isBinary(contentBuffer)) {
      throw new NavigationServiceError('BINARY_FILE', 'The requested file appears to be binary and cannot be displayed.', 415);
    }

    return {
      sessionId,
      repoRef: root.repoRef,
      path: resolved.relativePath,
      content: contentBuffer.toString('utf8'),
      language: detectLanguage(resolved.relativePath),
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      range: rangeFromOptions(options),
    };
  }

  async search(
    sessionId: string,
    query: string,
    options: SearchOptions,
  ): Promise<NavigationSearchResponse> {
    if (typeof query !== 'string' || !query.trim()) {
      throw new NavigationServiceError('INVALID_QUERY', 'A non-empty search query is required.');
    }
    if (query.length > 512) {
      throw new NavigationServiceError('QUERY_TOO_LONG', 'Search query must be 512 characters or fewer.');
    }
    const root = await this.resolveRoot(sessionId, options.signal);
    let scope: string | undefined;
    if (options.scope) {
      const resolvedScope = await this.resolveModelPath(root, options.scope, options.signal);
      const scopeStat = await stat(resolvedScope.absolutePath).catch(() => undefined);
      if (!scopeStat?.isDirectory()) {
        throw new NavigationServiceError('INVALID_SCOPE', 'Search scope must name an existing directory.');
      }
      scope = resolvedScope.relativePath;
    }
    const indexVersion = await gitIndexVersion(root.absolutePath);
    const key = [root.absolutePath, indexVersion, options.mode, scope ?? '', query].join('\u0000');
    const cached = this.searchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.searchCache.delete(key);
      this.searchCache.set(key, cached);
      options.onBatch?.(cached.value.matches);
      return cached.value;
    }
    if (cached) this.searchCache.delete(key);

    // Streaming callers get progressive batches from their own cancellable
    // process. Sharing an in-flight promise would hide intermediate results.
    if (options.onBatch) {
      const value = await this.performSearch(
        root,
        query,
        options.mode,
        scope,
        indexVersion,
        options.signal ?? new AbortController().signal,
        options.onBatch,
      );
      this.storeSearchCache(key, value);
      return value;
    }

    let inFlight = this.inFlightSearches.get(key);
    if (!inFlight) {
      const controller = new AbortController();
      inFlight = {
        controller,
        consumers: 0,
        settled: false,
        promise: this.performSearch(root, query, options.mode, scope, indexVersion, controller.signal)
          .then(value => {
            this.storeSearchCache(key, value);
            return value;
          })
          .finally(() => {
            const current = this.inFlightSearches.get(key);
            if (current) current.settled = true;
            this.inFlightSearches.delete(key);
          }),
      };
      this.inFlightSearches.set(key, inFlight);
    }
    return this.consumeSearch(inFlight, options.signal);
  }

  async resolveDeveloperLink(sessionId: string, raw: string, signal?: AbortSignal): Promise<{
    path: string;
    range?: SourceRange;
    repoRef: string;
  }> {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 4_096 || raw.includes('\0')) {
      throw new NavigationServiceError('INVALID_LINK', 'A valid terminal link is required.');
    }

    const root = await this.resolveRoot(sessionId, signal);
    const parsed = parseDeveloperLink(raw.trim());
    validateSourceRange(parsed.range);
    const candidate = parsed.path;
    if (candidate.replace(/\\/g, '/').split('/').some(segment => segment === '..')) {
      throw new NavigationServiceError('PATH_OUTSIDE_ROOT', 'The link contains parent-directory traversal.', 403);
    }
    let absolutePath: string;
    try {
      if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\')) {
        absolutePath = path.resolve(candidate);
      } else {
        absolutePath = path.resolve(root.absolutePath, candidate);
      }
      const realTarget = await realpath(absolutePath);
      if (!isWithinRoot(root.absolutePath, realTarget)) {
        throw new NavigationServiceError('PATH_OUTSIDE_ROOT', 'The link points outside the managed session repository.', 403);
      }
      return {
        path: toPosixRelative(root.absolutePath, realTarget),
        range: parsed.range,
        repoRef: root.repoRef,
      };
    } catch (error) {
      if (error instanceof NavigationServiceError) throw error;
      throw new NavigationServiceError('LINK_TARGET_NOT_FOUND', 'The linked file does not exist in the managed session repository.', 404);
    }
  }

  async resolveDocumentLink(
    sessionId: string,
    documentPath: string,
    raw: string,
    signal?: AbortSignal,
  ): Promise<
    | { kind: 'fragment'; fragment: string }
    | { kind: 'external'; url: string }
    | { kind: 'target'; path: string; fragment?: string; repoRef: string }
  > {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 4_096 || raw.includes('\0')) {
      throw new NavigationServiceError('INVALID_LINK', 'A valid document link is required.');
    }
    const reference = raw.trim();
    if (reference.startsWith('#')) {
      let fragment: string;
      try {
        fragment = decodeURIComponent(reference.slice(1)).trim();
      } catch {
        throw new NavigationServiceError('INVALID_FRAGMENT', 'Document fragment is invalid.');
      }
      if (!fragment || fragment.length > 256) {
        throw new NavigationServiceError('INVALID_FRAGMENT', 'Document fragment is invalid.');
      }
      return { kind: 'fragment', fragment };
    }
    if (/^https?:\/\//i.test(reference)) {
      const url = new URL(reference);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new NavigationServiceError('UNSAFE_URL', 'Only HTTP(S) document links are allowed.', 403);
      }
      return { kind: 'external', url: url.href };
    }
    if (
      reference.startsWith('//')
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
      || reference.startsWith('/')
      || reference.includes('\\')
    ) {
      throw new NavigationServiceError('UNSAFE_URL', 'This document link scheme is not allowed.', 403);
    }

    const root = await this.resolveRoot(sessionId, signal);
    const document = await this.resolveModelPath(root, documentPath, signal);
    const hashIndex = reference.indexOf('#');
    const pathPart = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
    let fragment: string | undefined;
    try {
      fragment = hashIndex >= 0 ? decodeURIComponent(reference.slice(hashIndex + 1)).trim() : undefined;
    } catch {
      throw new NavigationServiceError('INVALID_FRAGMENT', 'Document fragment is invalid.');
    }
    const queryIndex = pathPart.indexOf('?');
    const withoutQuery = queryIndex >= 0 ? pathPart.slice(0, queryIndex) : pathPart;
    let decoded: string;
    try {
      decoded = decodeURIComponent(withoutQuery);
    } catch {
      throw new NavigationServiceError('INVALID_PATH_ENCODING', 'Document link contains invalid percent encoding.');
    }
    if (!decoded || decoded.includes('\0') || decoded.includes('\\')) {
      throw new NavigationServiceError('INVALID_LINK', 'Document link path is invalid.');
    }

    const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(document.relativePath), decoded));
    if (
      candidate === '..'
      || candidate.startsWith('../')
      || path.posix.isAbsolute(candidate)
    ) {
      throw new NavigationServiceError('PATH_OUTSIDE_ROOT', 'Document link points outside the repository.', 403);
    }
    const resolved = await this.resolveModelPath(root, candidate, signal);
    return {
      kind: 'target',
      path: resolved.relativePath,
      fragment: fragment || undefined,
      repoRef: root.repoRef,
    };
  }

  async validateRequestTarget(
    sessionId: string,
    target: NavigationRequest['target'],
    signal?: AbortSignal,
  ): Promise<NavigationRequest['target']> {
    if (!target) return undefined;
    const root = await this.resolveRoot(sessionId, signal);
    const resolved = await this.resolveModelPath(root, target.path, signal);
    return {
      path: resolved.relativePath,
      range: target.range,
      symbol: target.symbol,
      fragment: target.fragment,
    };
  }

  async validateFileTarget(
    sessionId: string,
    target: NavigationRequest['target'],
    signal?: AbortSignal,
  ): Promise<NavigationRequest['target']> {
    if (!target) return undefined;
    const root = await this.resolveRoot(sessionId, signal);
    const resolved = await this.resolveModelPath(root, target.path, signal);
    throwIfAborted(signal);
    let fileStat;
    try {
      fileStat = await stat(resolved.absolutePath);
    } catch {
      throw new NavigationServiceError('FILE_NOT_FOUND', 'The requested file does not exist.', 404);
    }
    if (!fileStat.isFile()) {
      throw new NavigationServiceError('NOT_A_FILE', 'The requested path is not a file.');
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      throw new NavigationServiceError(
        'FILE_TOO_LARGE',
        `The requested file exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MB navigation limit.`,
        413,
      );
    }
    const contentBuffer = await readFile(resolved.absolutePath);
    throwIfAborted(signal);
    if (isBinary(contentBuffer)) {
      throw new NavigationServiceError(
        'BINARY_FILE',
        'The requested file appears to be binary and cannot be displayed.',
        415,
      );
    }
    validateRangeWithinContent(target.range, contentBuffer.toString('utf8'));
    return {
      path: resolved.relativePath,
      range: target.range,
      symbol: target.symbol,
      fragment: target.fragment,
    };
  }

  private async consumeSearch(inFlight: InFlightSearch, signal?: AbortSignal): Promise<NavigationSearchResponse> {
    inFlight.consumers++;
    return new Promise((resolve, reject) => {
      let complete = false;
      const release = () => {
        if (complete) return;
        complete = true;
        inFlight.consumers--;
        signal?.removeEventListener('abort', onAbort);
        if (!inFlight.settled && inFlight.consumers === 0) inFlight.controller.abort();
      };
      const onAbort = () => {
        release();
        reject(abortError());
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      inFlight.promise.then(
        value => {
          if (!complete) {
            release();
            resolve(value);
          }
        },
        error => {
          if (!complete) {
            release();
            reject(error);
          }
        },
      );
    });
  }

  private async performSearch(
    root: NavigationRoot,
    query: string,
    mode: 'content' | 'symbol',
    scope: string | undefined,
    indexVersion: string,
    signal: AbortSignal,
    onBatch?: (matches: NavigationSearchMatch[]) => void,
  ): Promise<NavigationSearchResponse> {
    const startedAt = performance.now();
    let walkResult: WalkResult;
    if (root.isGitRepository) {
      walkResult = await this.gitSearch(root, query, mode, scope, signal, onBatch);
    } else {
      walkResult = await this.walkSearch(root, query, mode, scope, signal, onBatch);
    }

    return {
      sessionId: root.sessionId,
      repoRef: root.repoRef,
      query,
      matches: walkResult.matches,
      truncated: walkResult.truncated,
      indexVersion,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  private storeSearchCache(key: string, value: NavigationSearchResponse): void {
    this.searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    while (this.searchCache.size > SEARCH_CACHE_SIZE) {
      const oldest = this.searchCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.searchCache.delete(oldest);
    }
  }

  private async resolveModelPath(
    root: NavigationRoot,
    rawPath: string,
    signal?: AbortSignal,
  ): Promise<{ absolutePath: string; relativePath: string }> {
    const relativePath = canonicalRelativePath(rawPath);
    const lexicalPath = path.resolve(root.absolutePath, ...relativePath.split('/'));
    if (!isWithinRoot(root.absolutePath, lexicalPath)) {
      throw new NavigationServiceError('PATH_OUTSIDE_ROOT', 'Path resolves outside the session repository.', 403);
    }
    throwIfAborted(signal);
    let absolutePath: string;
    try {
      absolutePath = await realpath(lexicalPath);
    } catch {
      throw new NavigationServiceError('FILE_NOT_FOUND', 'The requested file does not exist.', 404);
    }
    if (!isWithinRoot(root.absolutePath, absolutePath)) {
      throw new NavigationServiceError('SYMLINK_OUTSIDE_ROOT', 'The requested path resolves outside the session repository.', 403);
    }
    return { absolutePath, relativePath: toPosixRelative(root.absolutePath, absolutePath) };
  }

  private async gitSearch(
    root: NavigationRoot,
    query: string,
    mode: 'content' | 'symbol',
    scope: string | undefined,
    signal: AbortSignal,
    onBatch?: (matches: NavigationSearchMatch[]) => void,
  ): Promise<WalkResult> {
    const args = [
      // Keep interactive search index-backed. `--untracked` forces Git to walk
      // every untracked path in very large monorepos and turned common queries
      // into multi-second waits. Newly-created files remain reachable via direct
      // session paths/diffs; repository search prioritizes tracked working-tree
      // content and returns quickly.
      'grep', '-n', '-I', '--no-color', '--fixed-strings', '-i',
      '--max-count=8', '-e', query, '--',
    ];
    args.push(scope ?? '.');
    for (const directory of GENERATED_DIRECTORIES) {
      args.push(`:(exclude)${directory}/**`);
    }
    if (onBatch) {
      return runGitGrepStreaming(root.absolutePath, args, signal, mode, query, onBatch);
    }
    const output = await runGitGrep(root.absolutePath, args, signal);
    const matches: NavigationSearchMatch[] = [];
    let truncated = output.truncated;
    for (const line of output.lines) {
      throwIfAborted(signal);
      const parsed = parseGitGrepLine(line);
      if (!parsed) continue;
      if (mode === 'symbol' && !isSymbolDeclaration(parsed.preview)) continue;
      const match: NavigationSearchMatch = {
        path: canonicalRelativePath(parsed.path),
        line: parsed.line,
        column: Math.max(1, parsed.preview.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) + 1),
        preview: parsed.preview.slice(0, 500),
      };
      if (mode === 'symbol') {
        (match as NavigationSymbolMatch).name = symbolName(parsed.preview) ?? query;
      }
      matches.push(match);
      if (matches.length >= MAX_RESULTS) {
        truncated = true;
        break;
      }
    }
    return { matches, truncated };
  }

  private async walkSearch(
    root: NavigationRoot,
    query: string,
    mode: 'content' | 'symbol',
    scope: string | undefined,
    signal: AbortSignal,
    onBatch?: (matches: NavigationSearchMatch[]) => void,
  ): Promise<WalkResult> {
    const scopeAbsolute = scope
      ? path.resolve(root.absolutePath, ...scope.split('/'))
      : root.absolutePath;
    const result: WalkResult = { matches: [], truncated: false };
    const lowerQuery = query.toLocaleLowerCase();
    let batch: NavigationSearchMatch[] = [];
    const directoriesToVisit = [scopeAbsolute];
    const filePaths: string[] = [];
    let directories = 0;

    // Discover paths asynchronously without reading file contents. Content
    // reads are handled by a bounded worker pool below.
    while (directoriesToVisit.length > 0 && filePaths.length < MAX_FILES) {
      throwIfAborted(signal);
      const directory = directoriesToVisit.shift()!;
      if (++directories > MAX_DIRECTORIES) {
        result.truncated = true;
        break;
      }
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (directory === scopeAbsolute) {
          throw new NavigationServiceError(
            'SEARCH_SCOPE_UNREADABLE',
            `The requested search scope cannot be read: ${error instanceof Error ? error.message : 'unknown error'}.`,
            403,
          );
        }
        continue;
      }
      for (const entry of entries) {
        throwIfAborted(signal);
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!GENERATED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
            directoriesToVisit.push(fullPath);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        filePaths.push(fullPath);
        if (filePaths.length >= MAX_FILES) {
          result.truncated = true;
          break;
        }
      }
    }

    let cursor = 0;
    const processFile = async (): Promise<void> => {
      while (cursor < filePaths.length && result.matches.length < MAX_RESULTS) {
        throwIfAborted(signal);
        const fullPath = filePaths[cursor++];
        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }
        if (fileStat.size > MAX_SEARCH_FILE_BYTES) continue;
        let buffer: Buffer;
        try {
          buffer = await readFile(fullPath);
        } catch {
          continue;
        }
        if (isBinary(buffer)) continue;
        const relativePath = toPosixRelative(root.absolutePath, fullPath);
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index];
          if (!line.toLocaleLowerCase().includes(lowerQuery)) continue;
          if (mode === 'symbol' && !isSymbolDeclaration(line)) continue;
          const match: NavigationSearchMatch = {
            path: relativePath,
            line: index + 1,
            column: line.toLocaleLowerCase().indexOf(lowerQuery) + 1,
            preview: line.trim().slice(0, 500),
          };
          if (mode === 'symbol') (match as NavigationSymbolMatch).name = symbolName(line) ?? query;
          result.matches.push(match);
          if (onBatch) {
            batch.push(match);
            if (batch.length >= 20) {
              onBatch(batch);
              batch = [];
            }
          }
          if (result.matches.length >= MAX_RESULTS) {
            result.truncated = true;
            return;
          }
        }
      }
    };

    const workerCount = Math.min(12, filePaths.length);
    await Promise.all(Array.from({ length: workerCount }, () => processFile()));
    if (batch.length > 0) onBatch?.(batch);
    return result;
  }
}

function parseGitGrepLine(line: string): { path: string; line: number; preview: string } | null {
  const match = line.match(/^(.*):(\d+):(.*)$/);
  if (!match) return null;
  const lineNumber = Number.parseInt(match[2], 10);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  return { path: match[1], line: lineNumber, preview: match[3].trim() };
}

function runGitGrep(
  cwd: string,
  args: string[],
  signal: AbortSignal,
): Promise<{ lines: string[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const lines: string[] = [];
    let buffered = '';
    let outputBytes = 0;
    let stderr = '';
    let killedForLimit = false;
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 2 * 1024 * 1024) {
        killedForLimit = true;
        child.kill();
        return;
      }
      buffered += chunk.toString('utf8');
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        lines.push(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (lines.length > MAX_RESULTS * 12) {
          killedForLimit = true;
          child.kill();
          return;
        }
        newline = buffered.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', code => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return reject(abortError());
      if (buffered) lines.push(buffered);
      if (code === 0 || code === 1 || killedForLimit) {
        return resolve({ lines, truncated: killedForLimit });
      }
      reject(new NavigationServiceError('GIT_SEARCH_FAILED', stderr.trim() || 'git grep failed.', 500));
    });
  });
}

function runGitGrepStreaming(
  cwd: string,
  args: string[],
  signal: AbortSignal,
  mode: 'content' | 'symbol',
  query: string,
  onBatch: (matches: NavigationSearchMatch[]) => void,
): Promise<WalkResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const matches: NavigationSearchMatch[] = [];
    let batch: NavigationSearchMatch[] = [];
    let buffered = '';
    let stderr = '';
    let killedForLimit = false;
    let settled = false;
    const lowerQuery = query.toLocaleLowerCase();

    const flushBatch = () => {
      if (batch.length === 0) return;
      onBatch(batch);
      batch = [];
    };
    const consumeLine = (line: string) => {
      if (matches.length >= MAX_RESULTS) return;
      const parsed = parseGitGrepLine(line);
      if (!parsed || (mode === 'symbol' && !isSymbolDeclaration(parsed.preview))) return;
      let relativePath: string;
      try {
        relativePath = canonicalRelativePath(parsed.path);
      } catch {
        return;
      }
      const match: NavigationSearchMatch = {
        path: relativePath,
        line: parsed.line,
        column: Math.max(1, parsed.preview.toLocaleLowerCase().indexOf(lowerQuery) + 1),
        preview: parsed.preview.slice(0, 500),
        matchText: query,
      };
      if (mode === 'symbol') (match as NavigationSymbolMatch).name = symbolName(parsed.preview) ?? query;
      matches.push(match);
      batch.push(match);
      if (batch.length >= 20) flushBatch();
      if (matches.length >= MAX_RESULTS) {
        killedForLimit = true;
        child.kill();
      }
    };
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        consumeLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (killedForLimit) return;
        newline = buffered.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return reject(abortError());
      if (buffered && !killedForLimit) consumeLine(buffered);
      flushBatch();
      if (code === 0 || code === 1 || killedForLimit) {
        return resolve({ matches, truncated: killedForLimit });
      }
      reject(new NavigationServiceError('GIT_SEARCH_FAILED', stderr.trim() || 'git grep failed.', 500));
    });
  });
}

function parseDeveloperLink(raw: string): { path: string; range?: SourceRange } {
  let value = raw.replace(/^\[|\]$/g, '');
  if (value.startsWith('file://')) {
    try {
      const fileUrl = new URL(value);
      if (fileUrl.hostname && fileUrl.hostname !== 'localhost') {
        const pathname = decodeURIComponent(fileUrl.pathname);
        value = isWindows()
          ? `\\\\${fileUrl.hostname}${pathname.replace(/\//g, '\\')}`
          : `//${fileUrl.hostname}${pathname}`;
      } else {
        value = fileURLToPath(fileUrl);
      }
    } catch {
      throw new NavigationServiceError('INVALID_LINK', 'The file URL could not be parsed.');
    }
  }
  const pythonLocation = value.match(/^File\s+["']([^"']+)["'],\s+line\s+(\d+)(?:,\s+column\s+(\d+))?$/i);
  if (pythonLocation) {
    return {
      path: pythonLocation[1],
      range: { start: { line: Number(pythonLocation[2]), column: pythonLocation[3] ? Number(pythonLocation[3]) : undefined } },
    };
  }
  const parenthesizedPosition = value.match(/^(.*?)\((\d+)(?:(?:,|:)(\d+))?\)$/);
  if (parenthesizedPosition && parenthesizedPosition[1]) {
    return {
      path: parenthesizedPosition[1],
      range: {
        start: {
          line: Number(parenthesizedPosition[2]),
          column: parenthesizedPosition[3] ? Number(parenthesizedPosition[3]) : undefined,
        },
      },
    };
  }
  const hashRange = value.match(/#L(\d+)(?:-L?(\d+))?$/i);
  if (hashRange) {
    value = value.slice(0, hashRange.index);
    return {
      path: value,
      range: {
        start: { line: Number(hashRange[1]) },
        // GitHub-style #Lx-Ly terminal links use an inclusive end line, while
        // NavigationRequest follows the canonical exclusive SourceRange end.
        end: hashRange[2] ? { line: Number(hashRange[2]) + 1 } : undefined,
      },
    };
  }
  const position = value.match(/^(.*?):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/);
  if (position && position[1]) {
    const startLine = Number(position[2]);
    const startColumn = position[3] ? Number(position[3]) : undefined;
    const endLine = position[4] ? Number(position[4]) : undefined;
    const endColumn = position[5] ? Number(position[5]) : undefined;
    return {
      path: position[1],
      range: {
        start: { line: startLine, column: startColumn },
        end: endLine ? { line: endLine, column: endColumn } : undefined,
      },
    };
  }
  return { path: value };
}

function validateSourceRange(range: SourceRange | undefined): void {
  if (!range) return;
  if (!Number.isInteger(range.start.line) || range.start.line < 1) {
    throw new NavigationServiceError('INVALID_RANGE', 'Link start line must be a positive integer.');
  }
  if (range.start.column !== undefined && (!Number.isInteger(range.start.column) || range.start.column < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'Link start column must be a positive integer.');
  }
  if (range.end && (!Number.isInteger(range.end.line) || range.end.line < range.start.line)) {
    throw new NavigationServiceError('INVALID_RANGE', 'Link end line must not precede its start line.');
  }
  if (range.end?.column !== undefined && (!Number.isInteger(range.end.column) || range.end.column < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'Link end column must be a positive integer.');
  }
}

const globalService = globalThis as typeof globalThis & {
  __agentMatrixNavigationService?: NavigationService;
};

export function getNavigationService(): NavigationService {
  return globalService.__agentMatrixNavigationService
    ?? (globalService.__agentMatrixNavigationService = new NavigationService());
}

export function isNavigationAction(value: unknown): value is NavigationAction {
  return typeof value === 'string' && [
    'open_file', 'reveal_range', 'open_symbol', 'show_search_results', 'open_diff', 'open_review',
  ].includes(value);
}
