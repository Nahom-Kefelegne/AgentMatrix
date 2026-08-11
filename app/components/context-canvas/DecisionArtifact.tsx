'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  Check,
  GitBranch,
  Send,
} from 'lucide-react';
import type { DecisionCanvasRequest } from '@/lib/canvas/types';

const CUSTOM_ANSWER_MAX_LENGTH = 2_000;
const decisionTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

interface DecisionArtifactProps {
  request: DecisionCanvasRequest;
  onResolved: (request: DecisionCanvasRequest) => void;
}

type DecisionSelection =
  | { kind: 'option'; optionId: string }
  | { kind: 'custom' };

function responseTime(timestamp: number): string {
  return decisionTimeFormat.format(timestamp);
}

export default function DecisionArtifact({
  request,
  onResolved,
}: DecisionArtifactProps) {
  const groupName = useId();
  const [selection, setSelection] = useState<DecisionSelection | null>(null);
  const [customAnswer, setCustomAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const focusReceiptOnResolveRef = useRef(false);
  const resolution = request.payload.resolution;
  const customSelected = selection?.kind === 'custom';
  const canSubmit = !resolution
    && !submitting
    && (
      selection?.kind === 'option'
      || (customSelected && customAnswer.trim().length > 0)
    );

  useEffect(() => {
    if (!resolution || !focusReceiptOnResolveRef.current) return;
    focusReceiptOnResolveRef.current = false;
    receiptRef.current?.focus();
  }, [resolution]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !selection) return;

    setSubmitting(true);
    setError(null);
    focusReceiptOnResolveRef.current = true;
    try {
      const response = await fetch('/api/canvas/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: request.sessionId,
          requestRef: request.requestRef,
          ...(customSelected
            ? { customAnswer: customAnswer.trim() }
            : { optionId: selection.optionId }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.request?.kind !== 'decision') {
        throw new Error(
          payload?.error?.message
          || `Decision delivery failed (${response.status}).`,
        );
      }
      onResolved(payload.request as DecisionCanvasRequest);
    } catch (reason) {
      focusReceiptOnResolveRef.current = false;
      setError(
        reason instanceof Error
          ? reason.message
          : 'Decision delivery failed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="cc-decision" aria-labelledby={`${groupName}-question`}>
      <header className="cc-decision-question">
        <span>
          <GitBranch size={14} aria-hidden="true" />
          Human decision
        </span>
        <h3 id={`${groupName}-question`}>{request.payload.question}</h3>
      </header>

      {resolution ? (
        <div
          ref={receiptRef}
          className="cc-decision-receipt"
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          <span className="cc-decision-receipt-icon">
            <Check size={16} aria-hidden="true" />
          </span>
          <div>
            <span>Decision sent · {responseTime(resolution.respondedAt)}</span>
            <strong>{resolution.answer}</strong>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={submitting}>
            <legend className="sr-only">Choose one response</legend>
            <div className="cc-decision-branches">
              {request.payload.options.map(option => (
                <label
                  key={option.id}
                  className={`cc-decision-option ${selection?.kind === 'option' && selection.optionId === option.id ? 'cc-decision-option--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={option.id}
                    checked={selection?.kind === 'option' && selection.optionId === option.id}
                    onChange={() => {
                      setSelection({ kind: 'option', optionId: option.id });
                      setError(null);
                    }}
                  />
                  <span className="cc-decision-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <span>{option.description}</span> : null}
                  </span>
                </label>
              ))}

              {request.payload.allowCustom ? (
                <div
                  className={`cc-decision-option cc-decision-option--custom ${customSelected ? 'cc-decision-option--selected' : ''}`}
                >
                  <label>
                    <input
                      type="radio"
                      name={groupName}
                      value="custom"
                      checked={customSelected}
                      onChange={() => {
                        setSelection({ kind: 'custom' });
                        setError(null);
                      }}
                    />
                    <span className="cc-decision-option-copy">
                      <strong>Another answer</strong>
                      <span>Give the session a specific direction.</span>
                    </span>
                  </label>
                  <textarea
                    value={customAnswer}
                    maxLength={CUSTOM_ANSWER_MAX_LENGTH}
                    rows={4}
                    disabled={submitting}
                    aria-label="Custom decision response"
                    placeholder="Type your answer…"
                    onFocus={() => setSelection({ kind: 'custom' })}
                    onChange={event => {
                      setCustomAnswer(event.target.value);
                      setSelection({ kind: 'custom' });
                      setError(null);
                    }}
                  />
                  <span className="cc-decision-count">
                    {customAnswer.length.toLocaleString()} / {CUSTOM_ANSWER_MAX_LENGTH.toLocaleString()}
                  </span>
                </div>
              ) : null}
            </div>
          </fieldset>

          {error ? (
            <div className="cc-decision-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <footer className="cc-decision-actions">
            <span aria-live="polite">
              {submitting ? 'Sending response to session…' : 'The session will continue with this choice.'}
            </span>
            <button type="submit" disabled={!canSubmit}>
              <Send size={13} aria-hidden="true" />
              {submitting ? 'Sending…' : 'Send decision'}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
