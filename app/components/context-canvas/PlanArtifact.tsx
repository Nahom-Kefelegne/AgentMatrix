'use client';

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CanvasPlanItem,
  PlanCanvasRequest,
} from '@/lib/canvas/types';

const MAX_VIEW_CACHE = 64;

interface PlanViewState {
  expandedId: string | null;
  expansionTouched: boolean;
  anchorId: string | null;
  anchorOffset: number;
  scrollTop: number;
}

export interface PlanProgress {
  total: number;
  done: number;
  active: number;
  blocked: number;
  percent: number;
}

const viewStateCache = new Map<string, PlanViewState>();

const STATUS_LABEL: Record<CanvasPlanItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'Now',
  done: 'Done',
  blocked: 'Blocked',
};

function rememberViewState(sessionId: string, state: PlanViewState): void {
  viewStateCache.delete(sessionId);
  viewStateCache.set(sessionId, state);
  while (viewStateCache.size > MAX_VIEW_CACHE) {
    const oldest = viewStateCache.keys().next().value as string | undefined;
    if (!oldest) break;
    viewStateCache.delete(oldest);
  }
}

export function summarizePlan(items: readonly CanvasPlanItem[]): PlanProgress {
  const done = items.filter(item => item.status === 'done').length;
  const active = items.filter(item => item.status === 'in_progress').length;
  const blocked = items.filter(item => item.status === 'blocked').length;
  return {
    total: items.length,
    done,
    active,
    blocked,
    percent: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
  };
}

export function defaultExpandedPlanItem(
  items: readonly CanvasPlanItem[],
): string | null {
  return items.find(item => item.status === 'in_progress' && item.summary)?.id
    ?? null;
}

function StatusIcon({ status }: { status: CanvasPlanItem['status'] }) {
  switch (status) {
    case 'done':
      return <Check size={13} aria-hidden="true" />;
    case 'in_progress':
      return <CircleDot size={13} aria-hidden="true" />;
    case 'blocked':
      return <AlertTriangle size={13} aria-hidden="true" />;
    default:
      return <Circle size={12} aria-hidden="true" />;
  }
}

export default function PlanArtifact({ request }: { request: PlanCanvasRequest }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const savedState = viewStateCache.get(request.sessionId);
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    if (savedState) {
      if (
        savedState.expandedId
        && request.payload.items.some(item =>
          item.id === savedState.expandedId && item.summary)
      ) {
        return savedState.expandedId;
      }
      if (savedState.expandedId === null && savedState.expansionTouched) {
        return null;
      }
    }
    return defaultExpandedPlanItem(request.payload.items);
  });
  const expandedRef = useRef(expandedId);
  const viewRef = useRef<PlanViewState>(savedState ?? {
    expandedId,
    expansionTouched: false,
    anchorId: null,
    anchorOffset: 0,
    scrollTop: 0,
  });
  expandedRef.current = expandedId;

  const progress = useMemo(
    () => summarizePlan(request.payload.items),
    [request.payload.items],
  );

  useEffect(() => {
    const expandableIds = new Set(
      request.payload.items.filter(item => item.summary).map(item => item.id),
    );
    setExpandedId(previous => {
      const next = previous && expandableIds.has(previous)
        ? previous
        : previous === null && viewRef.current.expansionTouched
          ? null
          : defaultExpandedPlanItem(request.payload.items);
      viewRef.current = { ...viewRef.current, expandedId: next };
      rememberViewState(request.sessionId, viewRef.current);
      return next;
    });
  }, [request.payload.items, request.sessionId]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const saved = viewStateCache.get(request.sessionId) ?? viewRef.current;
    const frame = window.requestAnimationFrame(() => {
      const anchor = saved.anchorId
        ? Array.from(
            container.querySelectorAll<HTMLElement>('[data-plan-item-id]'),
          ).find(item => item.dataset.planItemId === saved.anchorId) ?? null
        : null;
      if (anchor) {
        const containerTop = container.getBoundingClientRect().top;
        const currentOffset = anchor.getBoundingClientRect().top - containerTop;
        container.scrollTop += currentOffset - saved.anchorOffset;
      } else {
        container.scrollTop = saved.scrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [request.requestRef, request.sessionId]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    rememberViewState(request.sessionId, {
      ...viewRef.current,
      expandedId: expandedRef.current,
      scrollTop: containerRef.current?.scrollTop ?? viewRef.current.scrollTop,
    });
  }, [request.sessionId]);

  const captureAnchorNow = () => {
    scrollFrameRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[data-plan-item-id]'),
    );
    const anchor = items.find(item => item.getBoundingClientRect().bottom > containerTop);
    viewRef.current = {
      expandedId: expandedRef.current,
      expansionTouched: viewRef.current.expansionTouched,
      anchorId: anchor?.dataset.planItemId ?? null,
      anchorOffset: anchor
        ? anchor.getBoundingClientRect().top - containerTop
        : 0,
      scrollTop: container.scrollTop,
    };
    rememberViewState(request.sessionId, viewRef.current);
  };

  const captureAnchor = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(captureAnchorNow);
  };

  const toggleExpanded = (item: CanvasPlanItem) => {
    if (!item.summary) return;
    setExpandedId(previous => {
      const next = previous === item.id ? null : item.id;
      expandedRef.current = next;
      viewRef.current = {
        ...viewRef.current,
        expandedId: next,
        expansionTouched: true,
      };
      rememberViewState(request.sessionId, viewRef.current);
      return next;
    });
  };

  if (request.payload.items.length === 0) {
    return (
      <div className="cc-empty">
        <AlertTriangle size={24} aria-hidden="true" />
        <strong>Plan unavailable</strong>
        <span>The session did not provide any plan items.</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="cc-plan"
      onScroll={captureAnchor}
    >
      <section className="cc-plan-progress" aria-label="Plan progress">
        <div className="cc-plan-progress-copy">
          <div>
            <strong>{progress.done} of {progress.total} complete</strong>
            <span>
              {progress.active > 0 ? `${progress.active} active` : 'No active step'}
              {progress.blocked > 0 ? ` · ${progress.blocked} blocked` : ''}
            </span>
          </div>
          <span>{progress.percent}%</span>
        </div>
        <div
          className="cc-plan-progress-track"
          role="progressbar"
          aria-label="Completed plan steps"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      </section>

      <ol className="cc-plan-rail">
        {request.payload.items.map((item, index) => {
          const expanded = expandedId === item.id;
          const summaryId = `cc-plan-summary-${request.sessionId}-${index}-${item.id}`
            .replace(/[^a-zA-Z0-9_-]/g, '-');
          const rowContent = (
            <>
              <span className={`cc-plan-node cc-plan-node--${item.status}`}>
                <StatusIcon status={item.status} />
              </span>
              <span className="cc-plan-item-copy">
                <strong>{item.label}</strong>
                <span className={`cc-plan-status cc-plan-status--${item.status}`}>
                  {STATUS_LABEL[item.status]}
                </span>
              </span>
              {item.summary ? (
                <ChevronRight
                  className="cc-plan-chevron"
                  size={14}
                  aria-hidden="true"
                />
              ) : null}
            </>
          );

          return (
            <li
              key={item.id}
              data-plan-item-id={item.id}
              className={`cc-plan-item cc-plan-item--${item.status}${expanded ? ' is-expanded' : ''}`}
              aria-current={
                progress.active === 1 && item.status === 'in_progress'
                  ? 'step'
                  : undefined
              }
            >
              {item.summary ? (
                <button
                  type="button"
                  className="cc-plan-row"
                  aria-expanded={expanded}
                  aria-controls={summaryId}
                  onClick={() => toggleExpanded(item)}
                >
                  {rowContent}
                </button>
              ) : (
                <div className="cc-plan-row">{rowContent}</div>
              )}
              {item.summary ? (
                <div
                  id={summaryId}
                  className="cc-plan-summary"
                  hidden={!expanded}
                >
                  {expanded ? item.summary : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
