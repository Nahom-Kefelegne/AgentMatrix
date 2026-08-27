import {
  isCanvasRenderedKind,
  type CanvasRequest,
  type CanvasRenderedRequest,
} from '@/lib/canvas/types';
import {
  NAVIGATION_PROTOCOL_VERSION,
  type CanvasMode,
  type NavigationDisposition,
  type NavigationRequest,
} from '@/lib/navigation/types';
import { isMarkdownPath } from './markdown';

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export type CanvasArtifact =
  | { type: 'navigation'; request: NavigationRequest }
  | { type: 'typed'; request: CanvasRequest };

export type CanvasRendererKind =
  | Exclude<CanvasMode, 'closed'>
  | 'locations'
  | 'decision'
  | 'plan'
  | 'unsupported';

function assertNever(value: never): never {
  throw new Error(`Unsupported Canvas artifact: ${JSON.stringify(value)}`);
}

export function artifactId(artifact: CanvasArtifact): string {
  return artifact.request.requestRef;
}

export function artifactSessionId(artifact: CanvasArtifact): string {
  return artifact.request.sessionId;
}

export function artifactCreatedAt(artifact: CanvasArtifact): number {
  return artifact.request.createdAt;
}

export function artifactCreatedLabel(artifact: CanvasArtifact | null): string {
  if (!artifact) return '';
  return timeFormat.format(artifact.request.createdAt);
}

export function artifactDisposition(artifact: CanvasArtifact): NavigationDisposition {
  return artifact.type === 'navigation'
    ? artifact.request.presentation?.disposition ?? 'preview'
    : 'preview';
}

export function artifactIsAgentOwned(artifact: CanvasArtifact): boolean {
  return artifact.type === 'typed'
    || artifact.request.source === 'mcp'
    || artifact.request.source === 'session_event';
}

export function artifactRenderer(artifact: CanvasArtifact): CanvasRendererKind {
  if (artifact.type === 'typed') {
    if (!isCanvasRenderedKind(artifact.request.kind)) return 'unsupported';
    const request = artifact.request as CanvasRenderedRequest;
    switch (request.kind) {
      case 'code':
        return isMarkdownPath(request.payload.target.path) ? 'document' : 'code';
      case 'locations':
        return 'locations';
      case 'changes':
        return 'review';
      case 'decision':
        return 'decision';
      case 'plan':
        return 'plan';
      default:
        return assertNever(request);
    }
  }

  const request = artifact.request;
  switch (request.action) {
    case 'reveal_range':
      return 'code';
    case 'show_search_results':
    case 'open_symbol':
      return 'unsupported';
    case 'open_diff':
      return 'diff';
    case 'open_review':
      return 'review';
    default:
      return isMarkdownPath(request.target?.path) ? 'document' : 'code';
  }
}

export function artifactIsRenderable(artifact: CanvasArtifact): boolean {
  return artifactRenderer(artifact) !== 'unsupported';
}

export function artifactTitle(artifact: CanvasArtifact | null): string {
  if (!artifact) return 'Context Canvas';
  if (artifact.type === 'typed') return artifact.request.title;
  const request = artifact.request;
  if (request.action === 'open_review' || request.action === 'open_diff') return 'Session Review';
  if (request.action === 'open_symbol' || request.action === 'show_search_results') {
    return 'Repository Search (Disabled)';
  }
  return request.target?.path ?? 'Code Preview';
}

export function artifactSummary(artifact: CanvasArtifact | null): string {
  if (!artifact) return 'Session-scoped preview';
  return artifact.type === 'typed'
    ? artifact.request.summary
    : artifact.request.intent.summary;
}

export function artifactSourceLabel(artifact: CanvasArtifact | null): string {
  if (!artifact) return 'Developer Opened';
  if (artifact.type === 'typed') return 'Opened by Session';
  switch (artifact.request.source) {
    case 'mcp':
      return 'Opened by Session';
    case 'session_event':
      return 'Auto-preview from Session';
    case 'terminal_link':
      return 'Terminal Link';
    default:
      return 'Developer Opened';
  }
}

export function navigationRequestForArtifact(
  artifact: CanvasArtifact | null,
): NavigationRequest | null {
  if (!artifact) return null;
  if (artifact.type === 'navigation') return artifact.request;

  const request = artifact.request;
  const base = {
    protocolVersion: NAVIGATION_PROTOCOL_VERSION,
    requestRef: request.requestRef,
    sessionId: request.sessionId,
    repoRef: request.repoRef,
    source: 'mcp' as const,
    presentation: { disposition: 'preview' as const, focus: 'preserve' as const },
    intent: {
      kind: 'agent_progress' as const,
      summary: request.summary,
    },
    createdAt: request.createdAt,
  };

  if (request.kind === 'code') {
    return {
      ...base,
      action: request.payload.target.range ? 'reveal_range' : 'open_file',
      target: request.payload.target,
    };
  }
  if (request.kind === 'changes') {
    return {
      ...base,
      action: 'open_review',
      diff: {
        source: 'session',
        sessionId: request.sessionId,
        view: 'inline',
      },
    };
  }
  return null;
}
