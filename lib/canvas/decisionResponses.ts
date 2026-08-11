import type {
  CanvasDecisionResolution,
  DecisionCanvasRequest,
} from './types';
import {
  getCanvasRequest,
  retainCanvasRequest,
} from './requestStore';
import { NavigationServiceError } from '../navigation/NavigationService';
import { getSession, updateSession } from '../state/sessionStore';
import { emitToClients } from '../state/socketEmitter';

const CUSTOM_ANSWER_MAX_LENGTH = 2_000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const IDENTIFIER_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

type DecisionDeliveryHandler = (sessionId: string, prompt: string) => Promise<void>;

interface PendingDecisionSubmission {
  selection: CanvasDecisionSelection;
  promise: Promise<CanvasDecisionResponseResult>;
}

const globalDelivery = globalThis as typeof globalThis & {
  __agentMatrixDecisionDelivery?: DecisionDeliveryHandler;
  __agentMatrixPendingDecisionSubmissions?: Map<string, PendingDecisionSubmission>;
};

const pendingSubmissions =
  globalDelivery.__agentMatrixPendingDecisionSubmissions
  ?? (globalDelivery.__agentMatrixPendingDecisionSubmissions = new Map());

export interface CanvasDecisionResponseInput {
  sessionId: string;
  requestRef: string;
  optionId?: string;
  customAnswer?: string;
}

export interface CanvasDecisionResponseResult {
  request: DecisionCanvasRequest;
  duplicate: boolean;
}

export function setCanvasDecisionDeliveryHandler(
  handler: DecisionDeliveryHandler,
): void {
  globalDelivery.__agentMatrixDecisionDelivery = handler;
}

function requiredIdentifier(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NavigationServiceError(
      'INVALID_DECISION_RESPONSE',
      `${field} is required.`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length > maximum
    || IDENTIFIER_CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new NavigationServiceError(
      'INVALID_DECISION_RESPONSE',
      `${field} is invalid.`,
    );
  }
  return normalized;
}

function optionalIdentifier(
  value: unknown,
  field: string,
  maximum: number,
): string | undefined {
  return value === undefined
    ? undefined
    : requiredIdentifier(value, field, maximum);
}

function customAnswer(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new NavigationServiceError(
      'INVALID_DECISION_RESPONSE',
      'customAnswer must be a non-empty string.',
    );
  }
  const answer = value.trim();
  if (
    answer.length > CUSTOM_ANSWER_MAX_LENGTH
    || CONTROL_CHARACTERS.test(answer)
  ) {
    throw new NavigationServiceError(
      'INVALID_DECISION_RESPONSE',
      `customAnswer must be ${CUSTOM_ANSWER_MAX_LENGTH} characters or fewer and contain no control characters.`,
    );
  }
  return answer;
}

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sameResolution(
  left: Pick<CanvasDecisionResolution, 'kind' | 'optionId' | 'answer'>,
  right: Pick<CanvasDecisionResolution, 'kind' | 'optionId' | 'answer'>,
): boolean {
  return left.kind === right.kind
    && left.optionId === right.optionId
    && left.answer === right.answer;
}

type CanvasDecisionSelection = Omit<CanvasDecisionResolution, 'respondedAt'>;

function requestedSelection(
  request: DecisionCanvasRequest,
  optionId: string | undefined,
  answer: string | undefined,
): CanvasDecisionSelection {
  if ((optionId === undefined) === (answer === undefined)) {
    throw new NavigationServiceError(
      'INVALID_DECISION_RESPONSE',
      'Provide exactly one of optionId or customAnswer.',
    );
  }

  if (optionId !== undefined) {
    const option = request.payload.options.find(candidate => candidate.id === optionId);
    if (!option) {
      throw new NavigationServiceError(
        'DECISION_OPTION_NOT_FOUND',
        'The selected decision option is no longer available.',
        404,
      );
    }
    return {
      kind: 'option',
      optionId: option.id,
      answer: option.label,
    };
  }

  if (!request.payload.allowCustom) {
    throw new NavigationServiceError(
      'CUSTOM_DECISION_FORBIDDEN',
      'This decision does not accept a custom answer.',
      403,
    );
  }
  return {
    kind: 'custom',
    answer: answer!,
  };
}

function deliveryPrompt(
  request: DecisionCanvasRequest,
  resolution: CanvasDecisionResolution,
): string {
  return [
    `The user answered the pending decision "${inline(request.payload.question)}":`,
    inline(resolution.answer),
    'Continue based on this decision.',
  ].join(' ');
}

export async function submitCanvasDecisionResponse(
  input: CanvasDecisionResponseInput,
): Promise<CanvasDecisionResponseResult> {
  const sessionId = requiredIdentifier(input.sessionId, 'sessionId', 200);
  const requestRef = requiredIdentifier(input.requestRef, 'requestRef', 200);
  const optionId = optionalIdentifier(input.optionId, 'optionId', 100);
  const answer = customAnswer(input.customAnswer);
  const retained = getCanvasRequest(sessionId, requestRef);

  if (!retained) {
    throw new NavigationServiceError(
      'DECISION_NOT_FOUND',
      'The decision is no longer pending.',
      404,
    );
  }
  if (retained.kind !== 'decision') {
    throw new NavigationServiceError(
      'INVALID_DECISION_REQUEST',
      'The requested Canvas artifact is not a decision.',
    );
  }
  const session = getSession(sessionId);
  if (!session) {
    throw new NavigationServiceError(
      'SESSION_NOT_FOUND',
      'The originating session is no longer active.',
      410,
    );
  }

  const selection = requestedSelection(retained, optionId, answer);
  const existing = retained.payload.resolution;
  if (existing) {
    if (sameResolution(existing, selection)) {
      return { request: retained, duplicate: true };
    }
    throw new NavigationServiceError(
      'DECISION_ALREADY_RESOLVED',
      'This decision already has a different response.',
      409,
    );
  }

  const submissionKey = `${sessionId}:${requestRef}`;
  const pending = pendingSubmissions.get(submissionKey);
  if (pending) {
    if (sameResolution(pending.selection, selection)) {
      return pending.promise.then((result: CanvasDecisionResponseResult) => ({
        ...result,
        duplicate: true,
      }));
    }
    throw new NavigationServiceError(
      'DECISION_RESPONSE_IN_PROGRESS',
      'A different response is already being delivered for this decision.',
      409,
    );
  }

  const deliver = globalDelivery.__agentMatrixDecisionDelivery;
  if (!deliver) {
    throw new NavigationServiceError(
      'DECISION_DELIVERY_UNAVAILABLE',
      'The session delivery bridge is unavailable.',
      503,
    );
  }

  const promise = (async (): Promise<CanvasDecisionResponseResult> => {
    try {
      await deliver(
        sessionId,
        deliveryPrompt(retained, { ...selection, respondedAt: 0 }),
      );
    } catch (error) {
      throw new NavigationServiceError(
        'DECISION_DELIVERY_FAILED',
        error instanceof Error
          ? error.message
          : 'The session could not receive the decision response.',
        409,
      );
    }

    const resolution: CanvasDecisionResolution = {
      ...selection,
      respondedAt: Date.now(),
    };
    const resolvedRequest: DecisionCanvasRequest = {
      ...retained,
      payload: {
        ...retained.payload,
        resolution,
      },
    };
    retainCanvasRequest(resolvedRequest);

    const changes = {
      status: 'working' as const,
      statusReason: undefined,
      lastActivity: resolution.respondedAt,
    };
    updateSession(sessionId, changes);
    emitToClients('session:update', { sessionId, changes });
    emitToClients('canvas:decision-resolved', resolvedRequest);

    return { request: resolvedRequest, duplicate: false };
  })().finally(() => {
    pendingSubmissions.delete(submissionKey);
  });

  pendingSubmissions.set(submissionKey, { selection, promise });
  return promise;
}
