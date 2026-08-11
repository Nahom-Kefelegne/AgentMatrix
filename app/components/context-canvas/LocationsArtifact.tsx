'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Code2,
  FileCode2,
  RefreshCw,
} from 'lucide-react';
import type {
  CanvasLocation,
  LocationsCanvasRequest,
} from '@/lib/canvas/types';
import {
  NAVIGATION_PROTOCOL_VERSION,
  type NavigationRequest,
  type NavigationTarget,
} from '@/lib/navigation/types';
import { useNavigationFile } from './useNavigationFile';

const MAX_VIEW_CACHE = 64;
const CONTEXT_LINES = 4;
const MAX_SNIPPET_ROWS = 80;
const COMPACTED_HEAD_ROWS = 38;
const COMPACTED_TAIL_ROWS = 38;

interface LocationEntry {
  key: string;
  location: CanvasLocation;
}

interface LocationGroup {
  path: string;
  entries: LocationEntry[];
}

export type LocationSnippetRow =
  | {
      type: 'line';
      line: number;
      source: string;
      selected: boolean;
    }
  | {
      type: 'omission';
      hiddenLines: number;
    };

interface LocationsViewState {
  expandedKey: string | null;
  scrollTop: number;
}

const viewStateCache = new Map<string, LocationsViewState>();

export interface LocationsArtifactProps {
  request: LocationsCanvasRequest;
  onOpenLocation: (target: NavigationTarget, summary: string) => void;
}

function rememberViewState(
  requestRef: string,
  state: LocationsViewState,
): void {
  viewStateCache.delete(requestRef);
  viewStateCache.set(requestRef, state);
  while (viewStateCache.size > MAX_VIEW_CACHE) {
    const oldest = viewStateCache.keys().next().value as string | undefined;
    if (!oldest) break;
    viewStateCache.delete(oldest);
  }
}

export function locationRangeLabel(location: CanvasLocation): string {
  const start = location.column
    ? `${location.line}:${location.column}`
    : String(location.line);
  if (!location.endLine) return start;
  const end = location.endColumn
    ? `${location.endLine}:${location.endColumn}`
    : String(location.endLine);
  return `${start}–${end}`;
}

export function locationLastSelectedLine(location: CanvasLocation): number {
  if (!location.endLine) return location.line;
  const exclusiveEndColumn = location.endColumn ?? 1;
  if (location.endLine > location.line && exclusiveEndColumn === 1) {
    return location.endLine - 1;
  }
  return location.endLine;
}

export function buildLocationSnippetRows(
  content: string,
  location: CanvasLocation,
): LocationSnippetRow[] {
  const lines = content.split(/\r\n|\r|\n/);
  const selectedEnd = Math.min(
    lines.length,
    Math.max(location.line, locationLastSelectedLine(location)),
  );
  const start = Math.max(1, location.line - CONTEXT_LINES);
  const end = Math.min(lines.length, selectedEnd + CONTEXT_LINES);
  const totalRows = Math.max(0, end - start + 1);

  const lineRow = (line: number): LocationSnippetRow => ({
    type: 'line',
    line,
    source: lines[line - 1] ?? '',
    selected: line >= location.line && line <= selectedEnd,
  });

  if (totalRows <= MAX_SNIPPET_ROWS) {
    return Array.from({ length: totalRows }, (_, index) => lineRow(start + index));
  }

  const headEnd = start + COMPACTED_HEAD_ROWS - 1;
  const tailStart = end - COMPACTED_TAIL_ROWS + 1;
  return [
    ...Array.from(
      { length: COMPACTED_HEAD_ROWS },
      (_, index) => lineRow(start + index),
    ),
    {
      type: 'omission' as const,
      hiddenLines: Math.max(1, tailStart - headEnd - 1),
    },
    ...Array.from(
      { length: COMPACTED_TAIL_ROWS },
      (_, index) => lineRow(tailStart + index),
    ),
  ];
}

export function groupCanvasLocations(
  locations: CanvasLocation[],
): LocationGroup[] {
  const groups = new Map<string, LocationEntry[]>();
  locations.forEach((location, index) => {
    const entries = groups.get(location.path) ?? [];
    entries.push({
      key: [
        location.path,
        location.line,
        location.column ?? 1,
        location.endLine ?? location.line,
        location.endColumn ?? 0,
        index,
      ].join(':'),
      location,
    });
    groups.set(location.path, entries);
  });
  return Array.from(groups, ([path, entries]) => ({ path, entries }));
}

function snippetRequest(
  request: LocationsCanvasRequest,
  path: string,
): NavigationRequest {
  return {
    protocolVersion: NAVIGATION_PROTOCOL_VERSION,
    requestRef: `${request.requestRef}:snippet:${path}`,
    sessionId: request.sessionId,
    repoRef: request.repoRef,
    action: 'open_file',
    source: 'mcp',
    target: { path },
    presentation: { disposition: 'preview', focus: 'preserve' },
    intent: {
      kind: 'agent_progress',
      summary: `Preview ${path}`,
    },
    createdAt: request.createdAt,
  };
}

function InlineLocationPreview({
  request,
  location,
  onOpenLocation,
}: {
  request: LocationsCanvasRequest;
  location: CanvasLocation;
  onOpenLocation: LocationsArtifactProps['onOpenLocation'];
}) {
  const navigationRequest = useMemo(
    () => snippetRequest(request, location.path),
    [location.path, request],
  );
  const { file, loading, error, retry } = useNavigationFile(navigationRequest);
  const rows = useMemo(() => {
    if (!file) return [];
    return buildLocationSnippetRows(file.content, location);
  }, [file, location]);

  const openFullCode = () => {
    onOpenLocation({
      path: location.path,
      range: {
        start: {
          line: location.line,
          column: location.column,
        },
        end: location.endLine
          ? {
              line: location.endLine,
              column: location.endColumn,
            }
          : undefined,
      },
    }, location.label || `Open ${location.path}:${location.line}`);
  };

  return (
    <div className="cc-location-preview">
      <div className="cc-location-preview-toolbar">
        <span title={`${location.path}:${locationRangeLabel(location)}`}>
          {locationRangeLabel(location)} · {file?.language || 'code'} preview
        </span>
        <button type="button" onClick={openFullCode}>
          <Code2 size={12} aria-hidden="true" />
          Open in Code
        </button>
      </div>

      {loading ? (
        <div className="cc-location-preview-state" role="status">
          Loading code preview…
        </div>
      ) : null}

      {error ? (
        <div className="cc-location-preview-state cc-location-preview-state--error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={retry} aria-label="Retry code preview">
            <RefreshCw size={12} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !error && file ? (
        <div
          className="cc-location-code-scroll"
          tabIndex={0}
          aria-label={`Scrollable code preview for ${location.path}, ${locationRangeLabel(location)}`}
        >
          <div className="cc-location-code" translate="no">
            {rows.map(row => (
              row.type === 'omission' ? (
                <div
                  key={`omission-${row.hiddenLines}`}
                  className="cc-location-code-omission"
                >
                  {row.hiddenLines.toLocaleString()} selected lines omitted from inline preview
                </div>
              ) : (
                <div
                  key={row.line}
                  className={`cc-location-code-line${row.selected ? ' is-selected' : ''}`}
                >
                  <span className="cc-location-code-number" aria-hidden="true">
                    {row.line}
                  </span>
                  <code>{row.source || ' '}</code>
                </div>
              )
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LocationsArtifact({
  request,
  onOpenLocation,
}: LocationsArtifactProps) {
  const groups = useMemo(
    () => groupCanvasLocations(request.payload.locations),
    [request.payload.locations],
  );
  const cachedState = viewStateCache.get(request.requestRef);
  const [expandedKey, setExpandedKey] = useState<string | null>(
    () => cachedState?.expandedKey ?? null,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef(expandedKey);
  const scrollTopRef = useRef(cachedState?.scrollTop ?? 0);
  expandedRef.current = expandedKey;

  useEffect(() => {
    const saved = viewStateCache.get(request.requestRef);
    setExpandedKey(saved?.expandedKey ?? null);
    scrollTopRef.current = saved?.scrollTop ?? 0;
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = scrollTopRef.current;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [request.requestRef]);

  useEffect(() => () => {
    rememberViewState(request.requestRef, {
      expandedKey: expandedRef.current,
      scrollTop: scrollTopRef.current,
    });
  }, [request.requestRef]);

  const toggleExpanded = (key: string) => {
    setExpandedKey(previous => {
      const next = previous === key ? null : key;
      rememberViewState(request.requestRef, {
        expandedKey: next,
        scrollTop: scrollTopRef.current,
      });
      return next;
    });
  };

  return (
    <div
      ref={listRef}
      className="cc-locations"
      onScroll={event => {
        scrollTopRef.current = event.currentTarget.scrollTop;
      }}
    >
      <div className="cc-locations-overview">
        <div>
          <strong>
            {groups.length} {groups.length === 1 ? 'file' : 'files'} ·{' '}
            {request.payload.locations.length}{' '}
            {request.payload.locations.length === 1 ? 'location' : 'locations'}
          </strong>
          <span>Verified repository locations selected by this session.</span>
        </div>
        <span className="cc-locations-verified">Verified</span>
      </div>

      <div className="cc-location-groups">
        {groups.map(group => {
          const headingId = `cc-locations-${request.requestRef}-${group.path}`
            .replace(/[^a-zA-Z0-9_-]/g, '-');
          return (
            <section
              key={group.path}
              className="cc-location-group"
              aria-labelledby={headingId}
            >
              <h2 id={headingId} className="cc-location-file">
                <FileCode2 size={13} aria-hidden="true" />
                <span title={group.path}>{group.path}</span>
              </h2>

              <div className="cc-location-list" role="list">
                {group.entries.map(({ key, location }) => {
                  const expanded = key === expandedKey;
                  const previewId = `cc-location-preview-${key}`
                    .replace(/[^a-zA-Z0-9_-]/g, '-');
                  const label = location.label || `Open ${location.path}:${location.line}`;
                  return (
                    <div
                      key={key}
                      className={`cc-location-item${expanded ? ' is-expanded' : ''}`}
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="cc-location-row"
                        aria-expanded={expanded}
                        aria-controls={previewId}
                        onClick={() => toggleExpanded(key)}
                      >
                        <span className="cc-location-range">
                          {locationRangeLabel(location)}
                        </span>
                        <span className="cc-location-copy">
                          <strong>{label}</strong>
                          <span>{expanded ? 'Hide code preview' : 'Preview code in place'}</span>
                        </span>
                        <ChevronRight
                          className="cc-location-chevron"
                          size={15}
                          aria-hidden="true"
                        />
                      </button>

                      <div id={previewId} hidden={!expanded}>
                        {expanded ? (
                          <InlineLocationPreview
                            request={request}
                            location={location}
                            onOpenLocation={onOpenLocation}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
