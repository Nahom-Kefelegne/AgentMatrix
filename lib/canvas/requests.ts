import { randomUUID } from 'crypto';
import {
  CANVAS_PROTOCOL_VERSION,
  type BrowserPreviewCanvasRequest,
  type CanvasDecisionOption,
  type CanvasLocation,
  type CanvasPlanItem,
  type CanvasRequest,
  type CanvasRequestDelivery,
  type CanvasRequestKind,
  type CanvasRequestResult,
  type CanvasRuntimeEvidence,
  type CanvasValidationFailure,
} from './types';
import { getNavigationService, NavigationServiceError } from '@/lib/navigation/NavigationService';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { retainCanvasRequest } from './requestStore';

const CANVAS_KINDS = new Set<CanvasRequestKind>([
  'code',
  'locations',
  'changes',
  'decision',
  'validation',
  'plan',
  'runtime_evidence',
  'browser_preview',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const globalClock = globalThis as typeof globalThis & {
  __agentMatrixCanvasAcceptedAt?: number;
};
const ARG_KEYS: Record<CanvasRequestKind, readonly string[]> = {
  code: ['path', 'startLine', 'startColumn', 'endLine', 'endColumn', 'title', 'summary'],
  locations: ['title', 'summary', 'locations'],
  changes: ['scope', 'title', 'summary'],
  decision: ['question', 'options', 'allowCustom', 'title', 'summary'],
  validation: ['title', 'status', 'summary', 'command', 'failures'],
  plan: ['title', 'summary', 'items'],
  runtime_evidence: ['title', 'summary', 'evidence'],
  browser_preview: ['url', 'title', 'summary'],
};

function nextAcceptedAt(): number {
  const timestamp = Math.max(
    Date.now(),
    (globalClock.__agentMatrixCanvasAcceptedAt ?? 0) + 1,
  );
  globalClock.__agentMatrixCanvasAcceptedAt = timestamp;
  return timestamp;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `${field} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    );
  }
}

function limitedString(
  value: unknown,
  field: string,
  maximum: number,
  options: { optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', `${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `${field} must be ${maximum} characters or fewer.`,
    );
  }
  return text;
}

function positiveInteger(value: unknown, field: string, optional = false): number | undefined {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', `${field} must be a positive integer.`);
  }
  return value as number;
}

function booleanValue(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', `${field} must be a boolean.`);
  }
  return value;
}

function uniqueIds(values: Array<{ id: string }>, field: string): void {
  const ids = new Set(values.map(value => value.id));
  if (ids.size !== values.length) {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', `${field} IDs must be unique.`);
  }
}

function titleAndSummary(
  args: Record<string, unknown>,
  defaultTitle: string,
  defaultSummary: string,
): { title: string; summary: string } {
  return {
    title: limitedString(args.title, 'title', 200, { optional: true }) ?? defaultTitle,
    summary: limitedString(args.summary, 'summary', 1_000, { optional: true }) ?? defaultSummary,
  };
}

function locationFrom(value: unknown, index: number): CanvasLocation {
  const item = record(value, `locations[${index}]`);
  assertKnownKeys(
    item,
    ['path', 'line', 'column', 'endLine', 'endColumn', 'label'],
    `locations[${index}]`,
  );
  const line = positiveInteger(item.line, `locations[${index}].line`)!;
  const endLine = positiveInteger(item.endLine, `locations[${index}].endLine`, true);
  if (item.endColumn !== undefined && endLine === undefined) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `locations[${index}].endColumn requires endLine.`,
    );
  }
  if (endLine === line && item.endColumn === undefined) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `locations[${index}].endColumn is required when endLine equals line.`,
    );
  }
  if (endLine !== undefined && endLine < line) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `locations[${index}].endLine must not precede line.`,
    );
  }
  const column = positiveInteger(item.column, `locations[${index}].column`, true);
  const endColumn = positiveInteger(item.endColumn, `locations[${index}].endColumn`, true);
  if (
    endLine === line
    && column !== undefined
    && endColumn !== undefined
    && endColumn < column
  ) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `locations[${index}].endColumn must not precede column on the same line.`,
    );
  }
  return {
    path: limitedString(item.path, `locations[${index}].path`, 1_024)!,
    line,
    column,
    endLine,
    endColumn,
    label: limitedString(item.label, `locations[${index}].label`, 300, { optional: true }),
  };
}

async function validatedLocation(
  sessionId: string,
  location: CanvasLocation,
  signal?: AbortSignal,
): Promise<CanvasLocation> {
  const target = await getNavigationService().validateFileTarget(sessionId, {
    path: location.path,
    range: {
      start: { line: location.line, column: location.column },
      end: location.endLine
        ? { line: location.endLine, column: location.endColumn }
        : undefined,
    },
  }, signal);
  return {
    ...location,
    path: target!.path,
  };
}

function decisionOption(value: unknown, index: number): CanvasDecisionOption {
  const item = record(value, `options[${index}]`);
  assertKnownKeys(item, ['id', 'label', 'description'], `options[${index}]`);
  return {
    id: limitedString(item.id, `options[${index}].id`, 100)!,
    label: limitedString(item.label, `options[${index}].label`, 300)!,
    description: limitedString(
      item.description,
      `options[${index}].description`,
      1_000,
      { optional: true },
    ),
  };
}

function planItem(value: unknown, index: number): CanvasPlanItem {
  const item = record(value, `items[${index}]`);
  assertKnownKeys(item, ['id', 'label', 'status', 'summary'], `items[${index}]`);
  if (!['pending', 'in_progress', 'done', 'blocked'].includes(item.status as string)) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `items[${index}].status is invalid.`,
    );
  }
  return {
    id: limitedString(item.id, `items[${index}].id`, 100)!,
    label: limitedString(item.label, `items[${index}].label`, 500)!,
    status: item.status as CanvasPlanItem['status'],
    summary: limitedString(
      item.summary,
      `items[${index}].summary`,
      1_000,
      { optional: true },
    ),
  };
}

async function validationFailure(
  sessionId: string,
  value: unknown,
  index: number,
  signal?: AbortSignal,
): Promise<CanvasValidationFailure> {
  const item = record(value, `failures[${index}]`);
  assertKnownKeys(item, ['label', 'path', 'line', 'column'], `failures[${index}]`);
  const failure: CanvasValidationFailure = {
    label: limitedString(item.label, `failures[${index}].label`, 1_000)!,
    path: limitedString(item.path, `failures[${index}].path`, 1_024, { optional: true }),
    line: positiveInteger(item.line, `failures[${index}].line`, true),
    column: positiveInteger(item.column, `failures[${index}].column`, true),
  };
  if (failure.column !== undefined && failure.line === undefined) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `failures[${index}].column requires line.`,
    );
  }
  if (!failure.path) return failure;
  const target = await getNavigationService().validateFileTarget(sessionId, {
    path: failure.path,
    range: failure.line
      ? { start: { line: failure.line, column: failure.column } }
      : undefined,
  }, signal);
  return { ...failure, path: target!.path };
}

async function runtimeEvidence(
  sessionId: string,
  value: unknown,
  index: number,
  signal?: AbortSignal,
): Promise<CanvasRuntimeEvidence> {
  const item = record(value, `evidence[${index}]`);
  assertKnownKeys(item, ['kind', 'label', 'text', 'path', 'line', 'column'], `evidence[${index}]`);
  if (!['log', 'error', 'request'].includes(item.kind as string)) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `evidence[${index}].kind is invalid.`,
    );
  }
  const evidence: CanvasRuntimeEvidence = {
    kind: item.kind as CanvasRuntimeEvidence['kind'],
    label: limitedString(item.label, `evidence[${index}].label`, 300)!,
    text: limitedString(item.text, `evidence[${index}].text`, 8_000)!,
    path: limitedString(item.path, `evidence[${index}].path`, 1_024, { optional: true }),
    line: positiveInteger(item.line, `evidence[${index}].line`, true),
    column: positiveInteger(item.column, `evidence[${index}].column`, true),
  };
  if (evidence.column !== undefined && evidence.line === undefined) {
    throw new NavigationServiceError(
      'INVALID_CANVAS_REQUEST',
      `evidence[${index}].column requires line.`,
    );
  }
  if (!evidence.path) return evidence;
  const target = await getNavigationService().validateFileTarget(sessionId, {
    path: evidence.path,
    range: evidence.line
      ? { start: { line: evidence.line, column: evidence.column } }
      : undefined,
  }, signal);
  return { ...evidence, path: target!.path };
}

function loopbackUrl(value: unknown): string {
  const raw = limitedString(value, 'url', 2_048)!;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NavigationServiceError('INVALID_CANVAS_REQUEST', 'url must be a valid URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username
    || url.password
  ) {
    throw new NavigationServiceError(
      'UNSAFE_BROWSER_PREVIEW',
      'Browser preview currently supports credential-free loopback HTTP(S) URLs only.',
      403,
    );
  }
  return url.href;
}

export interface CreateCanvasRequestOptions {
  sessionId: string;
  kind: unknown;
  args: unknown;
  signal?: AbortSignal;
}

export async function createCanvasRequest(
  options: CreateCanvasRequestOptions,
): Promise<CanvasRequest> {
  if (!CANVAS_KINDS.has(options.kind as CanvasRequestKind)) {
    throw new NavigationServiceError('INVALID_CANVAS_KIND', 'Unsupported Canvas request kind.');
  }
  const kind = options.kind as CanvasRequestKind;
  const args = record(options.args, 'args');
  assertKnownKeys(args, ARG_KEYS[kind], 'args');
  const service = getNavigationService();
  const root = await service.resolveRoot(options.sessionId, options.signal);
  const requestBase = () => ({
    protocolVersion: CANVAS_PROTOCOL_VERSION,
    requestRef: randomUUID(),
    sessionId: options.sessionId,
    repoRef: root.repoRef,
    source: 'mcp' as const,
    kind,
    createdAt: nextAcceptedAt(),
  });

  if (kind === 'code') {
    const path = limitedString(args.path, 'path', 1_024)!;
    const startLine = positiveInteger(args.startLine, 'startLine', true);
    const endLine = positiveInteger(args.endLine, 'endLine', true);
    if (args.startColumn !== undefined && startLine === undefined) {
      throw new NavigationServiceError('INVALID_CANVAS_REQUEST', 'startColumn requires startLine.');
    }
    if (endLine !== undefined && startLine === undefined) {
      throw new NavigationServiceError('INVALID_CANVAS_REQUEST', 'endLine requires startLine.');
    }
    if (endLine !== undefined && startLine !== undefined && endLine < startLine) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'endLine must not precede startLine.',
      );
    }
    if (args.endColumn !== undefined && endLine === undefined) {
      throw new NavigationServiceError('INVALID_CANVAS_REQUEST', 'endColumn requires endLine.');
    }
    if (
      endLine !== undefined
      && endLine === startLine
      && args.endColumn === undefined
    ) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'endColumn is required when endLine equals startLine.',
      );
    }
    const startColumn = positiveInteger(args.startColumn, 'startColumn', true);
    const endColumn = positiveInteger(args.endColumn, 'endColumn', true);
    if (
      endLine === startLine
      && startColumn !== undefined
      && endColumn !== undefined
      && endColumn < startColumn
    ) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'endColumn must not precede startColumn on the same line.',
      );
    }
    const target = await service.validateFileTarget(options.sessionId, {
      path,
      range: startLine
        ? {
            start: {
              line: startLine,
              column: startColumn,
            },
            end: endLine
              ? {
                  line: endLine,
                  column: endColumn,
                }
              : undefined,
          }
        : undefined,
    }, options.signal);
    const copy = titleAndSummary(args, target!.path, `Show ${target!.path}`);
    return { ...requestBase(), kind, ...copy, payload: { target: target! } };
  }

  if (kind === 'locations') {
    if (!Array.isArray(args.locations) || args.locations.length < 1 || args.locations.length > 30) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'locations must contain between 1 and 30 entries.',
      );
    }
    const locations = await Promise.all(
      args.locations.map((value, index) =>
        validatedLocation(options.sessionId, locationFrom(value, index), options.signal)),
    );
    const copy = titleAndSummary(
      args,
      'Relevant Locations',
      `Show ${locations.length} relevant repository location${locations.length === 1 ? '' : 's'}`,
    );
    return { ...requestBase(), kind, ...copy, payload: { locations } };
  }

  if (kind === 'changes') {
    if (args.scope !== 'session') {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'present_changes currently supports scope "session" only.',
      );
    }
    const copy = titleAndSummary(args, 'Session Changes', 'Review this session’s changes');
    return { ...requestBase(), kind, ...copy, payload: { scope: 'session' } };
  }

  if (kind === 'decision') {
    const question = limitedString(args.question, 'question', 1_000)!;
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 6) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'options must contain between 2 and 6 choices.',
      );
    }
    const options = args.options.map(decisionOption);
    uniqueIds(options, 'Decision option');
    const copy = titleAndSummary(args, 'Decision Required', question);
    return {
      ...requestBase(),
      kind,
      ...copy,
      payload: {
        question,
        options,
        allowCustom: booleanValue(args.allowCustom, 'allowCustom', true),
      },
    };
  }

  if (kind === 'validation') {
    if (!['passed', 'failed', 'warning'].includes(args.status as string)) {
      throw new NavigationServiceError('INVALID_CANVAS_REQUEST', 'status is invalid.');
    }
    const summary = limitedString(args.summary, 'summary', 1_000)!;
    const rawFailures = args.failures === undefined ? [] : args.failures;
    if (!Array.isArray(rawFailures) || rawFailures.length > 50) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'failures must contain at most 50 entries.',
      );
    }
    const failures = await Promise.all(
      rawFailures.map((value, index) =>
        validationFailure(options.sessionId, value, index, options.signal)),
    );
    const copy = {
      title: limitedString(args.title, 'title', 200)!,
      summary,
    };
    return {
      ...requestBase(),
      kind,
      ...copy,
      payload: {
        status: args.status as 'passed' | 'failed' | 'warning',
        authority: 'session_reported',
        command: limitedString(args.command, 'command', 2_000, { optional: true }),
        failures,
      },
    };
  }

  if (kind === 'plan') {
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 100) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'items must contain between 1 and 100 plan entries.',
      );
    }
    const items = args.items.map(planItem);
    uniqueIds(items, 'Plan item');
    const copy = titleAndSummary(args, 'Session Plan', 'Update the session plan');
    return { ...requestBase(), kind, ...copy, payload: { items } };
  }

  if (kind === 'runtime_evidence') {
    if (!Array.isArray(args.evidence) || args.evidence.length < 1 || args.evidence.length > 50) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'evidence must contain between 1 and 50 entries.',
      );
    }
    const summary = limitedString(args.summary, 'summary', 1_000)!;
    const evidence = await Promise.all(
      args.evidence.map((value, index) =>
        runtimeEvidence(options.sessionId, value, index, options.signal)),
    );
    if (evidence.reduce((total, item) => total + item.text.length, 0) > 64_000) {
      throw new NavigationServiceError(
        'INVALID_CANVAS_REQUEST',
        'Runtime evidence text must total 64,000 characters or fewer.',
      );
    }
    return {
      ...requestBase(),
      kind,
      title: limitedString(args.title, 'title', 200)!,
      summary,
      payload: { evidence },
    };
  }

  const browserRequest: BrowserPreviewCanvasRequest = {
    ...requestBase(),
    kind: 'browser_preview',
    ...titleAndSummary(args, 'Browser Preview', 'Preview the running local application'),
    payload: { url: loopbackUrl(args.url) },
  };
  return browserRequest;
}

export function emitCanvasRequested(
  request: CanvasRequest,
  delivery: CanvasRequestDelivery,
): CanvasRequestResult {
  const result: CanvasRequestResult = {
    requestRef: request.requestRef,
    sessionId: request.sessionId,
    kind: request.kind,
    status: 'accepted',
    delivery,
  };
  retainCanvasRequest(request);
  emitToClients('canvas:requested', request);
  emitToClients('canvas:acknowledged', result);

  if (request.kind === 'decision') {
    const session = getSession(request.sessionId);
    if (session) {
      const changes = {
        status: 'attention' as const,
        statusReason: request.payload.question,
        lastActivity: Date.now(),
      };
      updateSession(request.sessionId, changes);
      emitToClients('session:update', { sessionId: request.sessionId, changes });
    }
  }
  return result;
}
