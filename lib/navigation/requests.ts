import { randomUUID } from 'crypto';
import { emitToClients } from '@/lib/state/socketEmitter';
import type {
  NavigationAction,
  DiffRequest,
  NavigationPresentation,
  NavigationRequest,
  NavigationResult,
  NavigationSource,
  SourceRange,
} from './types';
import { getNavigationService, isNavigationAction, NavigationServiceError } from './NavigationService';

const VALID_SOURCES = new Set<NavigationSource>(['developer', 'terminal_link', 'mcp', 'session_event']);

function limitedString(value: unknown, field: string, maximum = 1_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NavigationServiceError('INVALID_REQUEST', `${field} is required.`);
  }
  if (value.length > maximum) {
    throw new NavigationServiceError('INVALID_REQUEST', `${field} must be ${maximum} characters or fewer.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maximum = 512): string | undefined {
  if (value === undefined) return undefined;
  return limitedString(value, field, maximum);
}

function readRange(value: unknown): SourceRange | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') {
    throw new NavigationServiceError('INVALID_RANGE', 'Range must be an object.');
  }
  const range = value as {
    start?: { line?: unknown; column?: unknown };
    end?: { line?: unknown; column?: unknown };
  };
  if (!range.start || !Number.isInteger(range.start.line) || (range.start.line as number) < 1) {
    throw new NavigationServiceError('INVALID_RANGE', 'Range start line must be a positive integer.');
  }
  if (range.start.column !== undefined && (!Number.isInteger(range.start.column) || (range.start.column as number) < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'Range start column must be a positive integer.');
  }
  if (range.end && (!Number.isInteger(range.end.line) || (range.end.line as number) < (range.start.line as number))) {
    throw new NavigationServiceError('INVALID_RANGE', 'Range end line must not precede its start line.');
  }
  if (range.end?.column !== undefined && (!Number.isInteger(range.end.column) || (range.end.column as number) < 1)) {
    throw new NavigationServiceError('INVALID_RANGE', 'Range end column must be a positive integer.');
  }
  return {
    start: { line: range.start.line as number, column: range.start.column as number | undefined },
    end: range.end
      ? { line: range.end.line as number, column: range.end.column as number | undefined }
      : undefined,
  };
}

function readTarget(value: unknown): { path: string; range?: SourceRange; symbol?: string } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') {
    throw new NavigationServiceError('INVALID_TARGET', 'Target must be an object.');
  }
  const target = value as { path?: unknown; range?: unknown; symbol?: unknown };
  if (typeof target.path !== 'string' || !target.path) {
    throw new NavigationServiceError('INVALID_TARGET', 'Target path is required.');
  }
  if (target.symbol !== undefined && (typeof target.symbol !== 'string' || target.symbol.length > 512)) {
    throw new NavigationServiceError('INVALID_TARGET', 'Target symbol must be a string of 512 characters or fewer.');
  }
  return { path: target.path, range: readRange(target.range), symbol: target.symbol as string | undefined };
}

export interface CreateNavigationRequestOptions {
  sessionId: string;
  source?: NavigationSource;
  forceSource?: NavigationSource;
  action: unknown;
  target?: unknown;
  query?: unknown;
  symbolKind?: unknown;
  diff?: unknown;
  presentation?: unknown;
  summary?: unknown;
  intentKind?: unknown;
  signal?: AbortSignal;
}

export async function createNavigationRequest(
  options: CreateNavigationRequestOptions,
): Promise<NavigationRequest> {
  if (!isNavigationAction(options.action)) {
    throw new NavigationServiceError('INVALID_ACTION', 'Unsupported navigation action.');
  }
  const action: NavigationAction = options.action;
  const source = options.forceSource
    ?? (VALID_SOURCES.has(options.source as NavigationSource) ? options.source as NavigationSource : 'developer');
  const service = getNavigationService();
  const root = await service.resolveRoot(options.sessionId, options.signal);
  const requestedTarget = readTarget(options.target);
  const target = requestedTarget
    ? await service.validateRequestTarget(options.sessionId, requestedTarget, options.signal)
    : undefined;

  if ((action === 'open_file' || action === 'reveal_range') && !target) {
    throw new NavigationServiceError('TARGET_REQUIRED', `${action} requires a target path.`);
  }
  if (action === 'open_symbol' && !target?.symbol && typeof options.query !== 'string') {
    throw new NavigationServiceError('SYMBOL_REQUIRED', 'open_symbol requires a target symbol or query.');
  }
  const query = options.query === undefined ? undefined : limitedString(options.query, 'query', 512);
  if (action === 'show_search_results' && !query) {
    throw new NavigationServiceError('QUERY_REQUIRED', 'show_search_results requires a query.');
  }
  if (options.symbolKind !== undefined && (typeof options.symbolKind !== 'string' || options.symbolKind.length > 100)) {
    throw new NavigationServiceError('INVALID_SYMBOL_KIND', 'symbolKind must be a string of 100 characters or fewer.');
  }
  if (options.diff !== undefined && (!options.diff || typeof options.diff !== 'object' || Array.isArray(options.diff))) {
    throw new NavigationServiceError('INVALID_DIFF', 'diff must be an object.');
  }
  let diff: DiffRequest | undefined;
  if (options.diff) {
    const rawDiff = options.diff as {
      source?: unknown;
      sessionId?: unknown;
      turnRef?: unknown;
      checkpointRef?: unknown;
      baseRef?: unknown;
      compareRef?: unknown;
      filterPaths?: unknown;
      view?: unknown;
    };
    if (!['turn', 'session', 'working_tree', 'branch', 'worktree', 'checkpoint'].includes(rawDiff.source as string)) {
      throw new NavigationServiceError('INVALID_DIFF', 'diff source is invalid.');
    }
    if (rawDiff.sessionId !== undefined && rawDiff.sessionId !== options.sessionId) {
      throw new NavigationServiceError('INVALID_DIFF', 'diff session identity must match the managed session.');
    }
    let filterPaths: string[] | undefined;
    if (rawDiff.filterPaths !== undefined) {
      if (!Array.isArray(rawDiff.filterPaths) || rawDiff.filterPaths.length > 100) {
        throw new NavigationServiceError('INVALID_DIFF', 'diff filterPaths must contain at most 100 repository paths.');
      }
      filterPaths = await Promise.all(rawDiff.filterPaths.map(async filterPath => {
        if (typeof filterPath !== 'string') {
          throw new NavigationServiceError('INVALID_DIFF', 'diff filter paths must be strings.');
        }
        const validated = await service.validateRequestTarget(options.sessionId, { path: filterPath }, options.signal);
        return validated!.path;
      }));
    }
    if (rawDiff.view !== undefined && rawDiff.view !== 'inline' && rawDiff.view !== 'split') {
      throw new NavigationServiceError('INVALID_DIFF', 'diff view is invalid.');
    }
    diff = {
      source: rawDiff.source as DiffRequest['source'],
      sessionId: rawDiff.sessionId === options.sessionId ? options.sessionId : undefined,
      turnRef: optionalString(rawDiff.turnRef, 'diff turnRef'),
      checkpointRef: optionalString(rawDiff.checkpointRef, 'diff checkpointRef'),
      baseRef: optionalString(rawDiff.baseRef, 'diff baseRef'),
      compareRef: optionalString(rawDiff.compareRef, 'diff compareRef'),
      filterPaths,
      view: rawDiff.view as DiffRequest['view'],
    };
    if (diff.source !== 'session') {
      throw new NavigationServiceError(
        'UNSUPPORTED_DIFF_SOURCE',
        'Context Canvas currently supports session-attributed diffs only.',
        422,
      );
    }
  }
  if (options.presentation !== undefined && (!options.presentation || typeof options.presentation !== 'object' || Array.isArray(options.presentation))) {
    throw new NavigationServiceError('INVALID_PRESENTATION', 'presentation must be an object.');
  }
  let presentation: NavigationPresentation | undefined;
  if (options.presentation) {
    const rawPresentation = options.presentation as { disposition?: unknown; focus?: unknown };
    if (rawPresentation.disposition !== undefined && !['queue', 'preview', 'pinned'].includes(rawPresentation.disposition as string)) {
      throw new NavigationServiceError('INVALID_PRESENTATION', 'presentation disposition is invalid.');
    }
    if (rawPresentation.focus !== undefined && !['preserve', 'canvas'].includes(rawPresentation.focus as string)) {
      throw new NavigationServiceError('INVALID_PRESENTATION', 'presentation focus is invalid.');
    }
    presentation = {
      disposition: rawPresentation.disposition as NavigationPresentation['disposition'],
      focus: rawPresentation.focus as NavigationPresentation['focus'],
    };
  }

  return {
    protocolVersion: 'agentmatrix.navigation/v1',
    requestRef: randomUUID(),
    sessionId: options.sessionId,
    repoRef: root.repoRef,
    action,
    source,
    target,
    query,
    symbolKind: options.symbolKind as string | undefined,
    diff,
    presentation,
    intent: {
      kind: options.intentKind === 'developer_link'
        ? 'developer_link'
        : options.intentKind === 'explicit_user_request'
          ? 'explicit_user_request'
          : 'agent_progress',
      summary: typeof options.summary === 'string' && options.summary.trim()
        ? limitedString(options.summary, 'summary', 1_000)
        : `Navigation request: ${action}`,
    },
    createdAt: Date.now(),
  };
}

export function emitNavigationRequested(request: NavigationRequest): NavigationResult {
  const result: NavigationResult = {
    requestRef: request.requestRef,
    sessionId: request.sessionId,
    status: 'queued',
    target: request.target,
    dispositionApplied: request.presentation?.disposition ?? 'queue',
    focusApplied: request.presentation?.focus ?? 'canvas',
  };
  emitToClients('navigation:requested', request);
  emitToClients('navigation:acknowledged', result);
  return result;
}

export function emitNavigationApplied(result: NavigationResult): void {
  emitToClients('navigation:applied', result);
}

export function emitNavigationFailed(result: NavigationResult): void {
  emitToClients('navigation:failed', result);
}
