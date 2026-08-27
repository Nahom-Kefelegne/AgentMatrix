import type { NavigationTarget } from '@/lib/navigation/types';

export const CANVAS_PROTOCOL_VERSION = 'agentmatrix.canvas/v1' as const;

export type CanvasRequestKind =
  | 'code'
  | 'locations'
  | 'changes'
  | 'decision'
  | 'validation'
  | 'plan'
  | 'runtime_evidence'
  | 'browser_preview';

export const CANVAS_RENDERED_KINDS = ['code', 'locations', 'changes', 'decision', 'plan'] as const;
export type CanvasRenderedKind = typeof CANVAS_RENDERED_KINDS[number];

export function isCanvasRenderedKind(
  kind: CanvasRequestKind,
): kind is CanvasRenderedKind {
  return (CANVAS_RENDERED_KINDS as readonly CanvasRequestKind[]).includes(kind);
}

export interface CanvasLocation {
  path: string;
  line: number;
  column?: number;
  /** Exclusive range end. When endColumn is omitted, the endpoint is column 1. */
  endLine?: number;
  endColumn?: number;
  label?: string;
}

export interface CanvasDecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface CanvasDecisionResolution {
  kind: 'option' | 'custom';
  optionId?: string;
  answer: string;
  respondedAt: number;
}

export interface CanvasValidationFailure {
  label: string;
  path?: string;
  line?: number;
  column?: number;
}

export interface CanvasPlanItem {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  summary?: string;
}

export interface CanvasRuntimeEvidence {
  kind: 'log' | 'error' | 'request';
  label: string;
  text: string;
  path?: string;
  line?: number;
  column?: number;
}

interface CanvasRequestBase {
  protocolVersion: typeof CANVAS_PROTOCOL_VERSION;
  requestRef: string;
  sessionId: string;
  repoRef: string;
  source: 'mcp';
  kind: CanvasRequestKind;
  title: string;
  summary: string;
  createdAt: number;
}

export interface CodeCanvasRequest extends CanvasRequestBase {
  kind: 'code';
  payload: {
    target: NavigationTarget;
  };
}

export interface LocationsCanvasRequest extends CanvasRequestBase {
  kind: 'locations';
  payload: {
    locations: CanvasLocation[];
  };
}

export interface ChangesCanvasRequest extends CanvasRequestBase {
  kind: 'changes';
  payload: {
    scope: 'session';
  };
}

export interface DecisionCanvasRequest extends CanvasRequestBase {
  kind: 'decision';
  payload: {
    question: string;
    options: CanvasDecisionOption[];
    allowCustom: boolean;
    /** Host-authored response. MCP inputs can never supply this field. */
    resolution?: CanvasDecisionResolution;
  };
}

export interface ValidationCanvasRequest extends CanvasRequestBase {
  kind: 'validation';
  payload: {
    status: 'passed' | 'failed' | 'warning';
    authority: 'session_reported';
    command?: string;
    failures: CanvasValidationFailure[];
  };
}

export interface PlanCanvasRequest extends CanvasRequestBase {
  kind: 'plan';
  payload: {
    items: CanvasPlanItem[];
  };
}

export interface RuntimeEvidenceCanvasRequest extends CanvasRequestBase {
  kind: 'runtime_evidence';
  payload: {
    evidence: CanvasRuntimeEvidence[];
  };
}

export interface BrowserPreviewCanvasRequest extends CanvasRequestBase {
  kind: 'browser_preview';
  payload: {
    url: string;
  };
}

export type CanvasRequest =
  | CodeCanvasRequest
  | LocationsCanvasRequest
  | ChangesCanvasRequest
  | DecisionCanvasRequest
  | ValidationCanvasRequest
  | PlanCanvasRequest
  | RuntimeEvidenceCanvasRequest
  | BrowserPreviewCanvasRequest;

export type CanvasRenderedRequest = Extract<
  CanvasRequest,
  { kind: CanvasRenderedKind }
>;

export type CanvasRequestDelivery = 'canvas_renderer' | 'event_only';

export interface CanvasRequestResult {
  requestRef: string;
  sessionId: string;
  kind: CanvasRequestKind;
  status: 'accepted';
  delivery: CanvasRequestDelivery;
}
