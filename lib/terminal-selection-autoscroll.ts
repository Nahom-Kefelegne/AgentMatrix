import { getPhysicalTerminalSelection } from './terminal-copy';

export type SelectionScrollDirection = -1 | 1;

interface SelectionPosition {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface BufferCell {
  getChars(): string;
}

interface BufferLine {
  isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
  getCell(column: number): BufferCell | undefined;
}

interface SelectionScrollTerminal {
  element?: HTMLElement;
  cols: number;
  rows: number;
  hasSelection(): boolean;
  getSelection(): string;
  getSelectionPosition(): SelectionPosition | undefined;
  buffer: {
    active: {
      type: 'normal' | 'alternate';
      baseY: number;
      getLine(y: number): BufferLine | undefined;
    };
  };
  __agentMatrixVirtualSelection?: string;
}

interface SelectionAutoScrollOptions {
  terminal: SelectionScrollTerminal;
  scroll: (direction: SelectionScrollDirection) => void;
  expectedShift?: number | (() => number | undefined);
  settleMs?: number;
}

export interface ViewportTransition {
  shift: number;
  regionStart: number;
  regionEnd: number;
  introducedStart: number;
  introducedEnd: number;
  overlapLength: number;
}

export interface ViewportRow {
  raw: string;
  text: string;
  isWrapped: boolean;
  rightEdge: boolean;
  rightGlyph?: string;
}

export interface SelectionScrollRegion {
  start: number;
  end: number;
}

interface ViewportSnapshot {
  rows: ViewportRow[];
}

interface SelectedRow extends ViewportRow {
  y: number;
}

export interface SelectionSegment {
  direction: SelectionScrollDirection;
  rows: ViewportRow[];
}

interface VirtualSelection {
  initialDirection: SelectionScrollDirection;
  prefix: ViewportRow[];
  timeline: ViewportRow[];
  suffix: ViewportRow[];
  segments: SelectionSegment[];
  separator: string;
}

const MIN_SCROLL_INTERVAL_MS = 75;
const MAX_SCROLL_INTERVAL_MS = 150;
const MAX_EDGE_DISTANCE_PX = 72;
const MIN_TRANSITION_OVERLAP_ROWS = 3;
const RIGHT_RAIL_GLYPHS = new Set([
  '|', '│', '┃', '║', '╎', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '▐', '▕', '█',
]);

export function selectionEdgeDirection(
  clientY: number,
  bounds: Pick<DOMRect, 'top' | 'bottom'>,
): SelectionScrollDirection | 0 {
  if (clientY < bounds.top) return -1;
  if (clientY > bounds.bottom) return 1;
  return 0;
}

export function needsApplicationSelectionScroll(
  buffer: Pick<SelectionScrollTerminal['buffer']['active'], 'type' | 'baseY'>,
): boolean {
  return buffer.type === 'alternate' || buffer.baseY === 0;
}

function intervalForEdgeDistance(distance: number): number {
  const ratio = Math.min(Math.max(distance, 0), MAX_EDGE_DISTANCE_PX) / MAX_EDGE_DISTANCE_PX;
  return Math.round(MAX_SCROLL_INTERVAL_MS - ratio * (MAX_SCROLL_INTERVAL_MS - MIN_SCROLL_INTERVAL_MS));
}

function longestContiguousMatch(
  before: string[],
  after: string[],
  shift: number,
  direction: SelectionScrollDirection,
): { beforeStart: number; afterStart: number; length: number; informativeRows: number } {
  let best = { beforeStart: 0, afterStart: 0, length: 0, informativeRows: 0 };
  let currentBeforeStart = 0;
  let currentAfterStart = 0;
  let currentLength = 0;
  const maximum = before.length - shift;

  for (let index = 0; index < maximum; index += 1) {
    const beforeIndex = direction < 0 ? index : index + shift;
    const afterIndex = direction < 0 ? index + shift : index;
    if (before[beforeIndex] === after[afterIndex]) {
      if (currentLength === 0) {
        currentBeforeStart = beforeIndex;
        currentAfterStart = afterIndex;
      }
      currentLength += 1;
      if (currentLength > best.length) {
        const informativeRows = new Set(
          before
            .slice(currentBeforeStart, currentBeforeStart + currentLength)
            .map(row => row.replace(/[|│┃║╎▏▎▍▌▋▊▉▐▕█\s]+$/g, '').trim())
            .filter(Boolean),
        ).size;
        best = {
          beforeStart: currentBeforeStart,
          afterStart: currentAfterStart,
          length: currentLength,
          informativeRows,
        };
      }
    } else {
      currentLength = 0;
    }
  }
  return best;
}

function trailingRailGlyph(row: string): string | undefined {
  const trimmed = row.trimEnd();
  const glyph = Array.from(trimmed).at(-1);
  return glyph && RIGHT_RAIL_GLYPHS.has(glyph) ? glyph : undefined;
}

export function detectRailBoundedRegion(
  rightGlyphs: Array<string | undefined>,
): SelectionScrollRegion | null {
  let best: SelectionScrollRegion | null = null;
  let currentStart = -1;
  for (let index = 0; index <= rightGlyphs.length; index += 1) {
    const hasRail = index < rightGlyphs.length
      && Boolean(rightGlyphs[index] && RIGHT_RAIL_GLYPHS.has(rightGlyphs[index]!));
    if (hasRail && currentStart < 0) currentStart = index;
    if ((!hasRail || index === rightGlyphs.length) && currentStart >= 0) {
      const end = index - 1;
      if (!best || end - currentStart > best.end - best.start) {
        best = { start: currentStart, end };
      }
      currentStart = -1;
    }
  }
  return best && best.end - best.start + 1 >= MIN_TRANSITION_OVERLAP_ROWS
    ? best
    : null;
}

function scrollRegionBoundary(before: string[], after: string[]): { start: number; end: number } | null {
  const beforeRegion = detectRailBoundedRegion(before.map(trailingRailGlyph));
  const afterRegion = detectRailBoundedRegion(after.map(trailingRailGlyph));
  if (
    beforeRegion
    && afterRegion
    && beforeRegion.start === afterRegion.start
    && beforeRegion.end === afterRegion.end
  ) {
    return beforeRegion;
  }

  const changed = before
    .map((row, index) => row === after[index] ? -1 : index)
    .filter(index => index >= 0);
  if (changed.length === 0) return null;
  // Without a continuous timeline rail, require exact changed boundaries. This
  // intentionally fails closed when unchanged boundary rows make the region
  // ambiguous.
  return { start: changed[0], end: changed[changed.length - 1] };
}

function currentSelectionScrollRegion(terminal: SelectionScrollTerminal): SelectionScrollRegion | null {
  const rightGlyphs: Array<string | undefined> = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    rightGlyphs.push(terminal.buffer.active.getLine(y)?.getCell(terminal.cols - 1)?.getChars());
  }
  return detectRailBoundedRegion(rightGlyphs);
}

export function regionBounds(
  screenBounds: Pick<DOMRect, 'top' | 'bottom' | 'height'>,
  rowCount: number,
  region: SelectionScrollRegion | null,
): { top: number; bottom: number } {
  if (!region || rowCount <= 0) return {
    top: screenBounds.top,
    bottom: screenBounds.bottom,
  };
  const rowHeight = screenBounds.height / rowCount;
  return {
    top: screenBounds.top + region.start * rowHeight,
    bottom: screenBounds.top + (region.end + 1) * rowHeight,
  };
}

/**
 * Detect the scrollable subregion and exact row shift between two complete
 * alternate-buffer snapshots. Static TUI chrome remains at the same indices,
 * while timeline rows form a long contiguous match at +/- shift.
 */
export function detectViewportTransition(
  before: string[],
  after: string[],
  direction: SelectionScrollDirection,
  expectedShift?: number,
): ViewportTransition | null {
  if (before.length !== after.length || before.length < 2) return null;
  if (before.every((row, index) => row === after[index])) return null;
  const candidates: Array<{
    transition: ViewportTransition;
    overlapLength: number;
  }> = [];

  for (let shift = 1; shift < before.length; shift += 1) {
    const match = longestContiguousMatch(before, after, shift, direction);
    if (match.length < MIN_TRANSITION_OVERLAP_ROWS || match.informativeRows < 2) continue;
    const afterEnd = match.afterStart + match.length - 1;
    let transition: ViewportTransition;
    if (direction < 0) {
      const introducedStart = match.afterStart - shift;
      if (introducedStart < 0) continue;
      const introducedEnd = match.afterStart - 1;
      transition = {
        shift,
        regionStart: introducedStart,
        regionEnd: afterEnd,
        introducedStart,
        introducedEnd,
        overlapLength: match.length,
      };
    } else {
      const introducedEnd = afterEnd + shift;
      if (introducedEnd >= after.length) continue;
      const introducedStart = afterEnd + 1;
      transition = {
        shift,
        regionStart: match.afterStart,
        regionEnd: introducedEnd,
        introducedStart,
        introducedEnd,
        overlapLength: match.length,
      };
    }
    if (
      after
        .slice(transition.introducedStart, transition.introducedEnd + 1)
        .every((row, index) => row === before[transition.introducedStart + index])
    ) {
      continue;
    }
    candidates.push({ transition, overlapLength: match.length });
  }
  if (candidates.length === 0) return null;

  const boundary = scrollRegionBoundary(before, after);
  if (!boundary) return null;
  const dominant = candidates.filter(
    candidate =>
      candidate.transition.regionStart === boundary.start
      && candidate.transition.regionEnd === boundary.end,
  );
  if (dominant.length === 0) return null;
  if (expectedShift && Number.isFinite(expectedShift) && expectedShift > 0) {
    dominant.sort((left, right) => (
      Math.abs(left.transition.shift - expectedShift) - Math.abs(right.transition.shift - expectedShift)
      || right.overlapLength - left.overlapLength
    ));
    return dominant[0].transition;
  }

  // Repeated/periodic screens can support several equally plausible shifts.
  // Without a host-known scroll quantum, failing closed avoids corrupting copy.
  if (dominant.length !== 1) return null;
  return dominant[0].transition;
}

export function cleanRightEdgeRails<T extends ViewportRow>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  let rightEdgeRows = 0;
  for (const row of rows) {
    if (!row.rightEdge) continue;
    rightEdgeRows += 1;
    if (row.rightGlyph && RIGHT_RAIL_GLYPHS.has(row.rightGlyph)) {
      counts.set(row.rightGlyph, (counts.get(row.rightGlyph) ?? 0) + 1);
    }
  }
  let rail = '';
  let railRows = 0;
  for (const [glyph, count] of counts) {
    if (count > railRows) {
      rail = glyph;
      railRows = count;
    }
  }
  const confirmed = rail
    && railRows >= 2
    && railRows >= Math.ceil(rightEdgeRows / 2);
  if (!confirmed) return rows;

  return rows.map(row => {
    if (row.rightGlyph !== rail) return row;
    const index = row.text.lastIndexOf(rail);
    if (index < 0 || row.text.slice(index + rail.length).trim()) return row;
    return { ...row, text: row.text.slice(0, index).replace(/[ \t]+$/, '') };
  });
}

function captureViewport(terminal: SelectionScrollTerminal): ViewportSnapshot {
  const rows: ViewportRow[] = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    const line = terminal.buffer.active.getLine(y);
    rows.push({
      raw: line?.translateToString(false, 0, terminal.cols) ?? '',
      text: line?.translateToString(true, 0, terminal.cols).replace(/\u00a0/g, ' ') ?? '',
      isWrapped: line?.isWrapped ?? false,
      rightEdge: true,
      rightGlyph: line?.getCell(terminal.cols - 1)?.getChars(),
    });
  }
  return { rows };
}

function captureSelectedRows(terminal: SelectionScrollTerminal): SelectedRow[] {
  const position = terminal.getSelectionPosition();
  if (!position) return [];
  const startY = Math.min(position.start.y, position.end.y);
  const endY = Math.max(position.start.y, position.end.y);
  const rows: SelectedRow[] = [];

  for (let y = startY; y <= endY; y += 1) {
    const line = terminal.buffer.active.getLine(y);
    if (!line) continue;
    const start = y === startY ? position.start.x : 0;
    const end = y === endY ? position.end.x : terminal.cols;
    rows.push({
      y,
      raw: line.translateToString(false, start, end),
      text: line.translateToString(true, start, end).replace(/\u00a0/g, ' '),
      isWrapped: line.isWrapped,
      rightEdge: end >= terminal.cols,
      rightGlyph: end >= terminal.cols
        ? line.getCell(terminal.cols - 1)?.getChars()
        : undefined,
    });
  }
  return cleanRightEdgeRails(rows);
}

function rowsToText(rows: ViewportRow[], separator: string): string {
  const output: string[] = [];
  for (const row of rows) {
    if (row.isWrapped && output.length > 0) output[output.length - 1] += row.text;
    else output.push(row.text);
  }
  return output.join(separator);
}

function renderVirtualSelection(selection: VirtualSelection): string {
  let timeline = [...selection.timeline];
  for (const segment of selection.segments) {
    timeline = segment.direction < 0
      ? [...segment.rows, ...timeline]
      : [...timeline, ...segment.rows];
  }
  return rowsToText(
    [...selection.prefix, ...timeline, ...selection.suffix],
    selection.separator,
  );
}

function createVirtualSelection(
  terminal: SelectionScrollTerminal,
  transition: ViewportTransition,
  direction: SelectionScrollDirection,
): VirtualSelection | null {
  const selected = captureSelectedRows(terminal);
  if (selected.length === 0) return null;
  const timeline = selected.filter(row => row.y >= transition.regionStart && row.y <= transition.regionEnd);
  if (timeline.length === 0) return null;
  return {
    initialDirection: direction,
    // Copilot's top tabs and bottom composer are fixed chrome. Virtual copy is
    // intentionally clamped to the rail-bounded conversation region.
    prefix: [],
    timeline,
    suffix: [],
    segments: [],
    separator: terminal.getSelection().includes('\r\n') ? '\r\n' : '\n',
  };
}

export function reconcileSelectionSegments(
  segments: SelectionSegment[],
  rows: ViewportRow[],
  direction: SelectionScrollDirection,
): SelectionSegment[] {
  const next = segments.map(segment => ({
    direction: segment.direction,
    rows: [...segment.rows],
  }));
  let remaining = rows.length;

  while (remaining > 0) {
    const last = next.at(-1);
    if (!last || last.direction === direction) break;
    const consumed = Math.min(remaining, last.rows.length);
    last.rows = last.direction < 0
      ? last.rows.slice(consumed)
      : last.rows.slice(0, last.rows.length - consumed);
    remaining -= consumed;
    if (last.rows.length === 0) next.pop();
  }

  if (remaining > 0) {
    const residual = direction < 0
      ? rows.slice(0, remaining)
      : rows.slice(rows.length - remaining);
    next.push({ direction, rows: residual });
  }
  return next;
}

function applyScrollSegment(
  selection: VirtualSelection,
  rows: ViewportRow[],
  direction: SelectionScrollDirection,
): void {
  selection.segments = reconcileSelectionSegments(selection.segments, rows, direction);
}

/**
 * xterm's built-in drag selection scrolls its own viewport. Copilot owns its
 * timeline and has no xterm scrollback; resumed sessions may repaint into
 * either the alternate buffer or a normal buffer with baseY=0. This bridge
 * snapshots the full TUI before/after one application scroll, derives every
 * newly introduced timeline row, and builds a virtual clipboard selection
 * while preserving xterm's visible selection.
 */
export function installAlternateScreenSelectionAutoScroll(
  options: SelectionAutoScrollOptions,
): () => void {
  const { terminal, scroll } = options;
  const element = terminal.element;
  if (!element) return () => {};
  const document = element.ownerDocument;
  const window = document.defaultView;
  if (!window) return () => {};

  let dragging = false;
  let direction: SelectionScrollDirection | 0 = 0;
  let edgeDistance = 0;
  let scrollTimer: number | undefined;
  let settleTimer: number | undefined;
  let beforeViewport: ViewportSnapshot | null = null;
  let beforeSelectionRows: SelectedRow[] = [];
  let virtualSelection: VirtualSelection | null = null;
  let virtualSelectionInvalid = false;
  let edgeScrollStarted = false;

  const screen = () => element.querySelector<HTMLElement>('.xterm-screen') ?? element;

  const clearScrollTimer = () => {
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = undefined;
  };

  const clearAllTimers = () => {
    clearScrollTimer();
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const schedule = () => {
    if (!dragging || direction === 0 || scrollTimer !== undefined) return;
    scrollTimer = window.setTimeout(() => {
      scrollTimer = undefined;
      if (
        !dragging
        || direction === 0
        || !needsApplicationSelectionScroll(terminal.buffer.active)
        || !terminal.hasSelection()
      ) {
        schedule();
        return;
      }

      const activeDirection = direction;
      beforeViewport = captureViewport(terminal);
      beforeSelectionRows = captureSelectedRows(terminal);
      edgeScrollStarted = true;
      scroll(activeDirection);

      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        if (!beforeViewport) {
          schedule();
          return;
        }
        const afterViewport = captureViewport(terminal);
        const viewportChanged = beforeViewport.rows.some(
          (row, index) => row.raw !== afterViewport.rows[index]?.raw,
        );
        const transition = detectViewportTransition(
          beforeViewport.rows.map(row => row.raw),
          afterViewport.rows.map(row => row.raw),
          activeDirection,
          typeof options.expectedShift === 'function'
            ? options.expectedShift()
            : options.expectedShift,
        );
        if (!transition && viewportChanged) {
          virtualSelectionInvalid = true;
          virtualSelection = null;
          terminal.__agentMatrixVirtualSelection = undefined;
        } else if (transition && !virtualSelectionInvalid) {
          if (!virtualSelection || (
            virtualSelection.segments.length === 0
            && virtualSelection.initialDirection !== activeDirection
          )) {
            // Recreate from the pre-scroll selection so partial anchor columns
            // are preserved exactly.
            const currentRows = captureSelectedRows(terminal);
            virtualSelection = createVirtualSelection(terminal, transition, activeDirection);
            if (virtualSelection && beforeSelectionRows.length > 0) {
              virtualSelection.timeline = beforeSelectionRows.filter(
                row => row.y >= transition.regionStart && row.y <= transition.regionEnd,
              );
              if (virtualSelection.timeline.length === 0 && currentRows.length > 0) {
                virtualSelection = null;
              }
            }
          }
          if (virtualSelection) {
            const introduced = cleanRightEdgeRails(afterViewport.rows.slice(
              transition.introducedStart,
              transition.introducedEnd + 1,
            ));
            applyScrollSegment(virtualSelection, introduced, activeDirection);
            terminal.__agentMatrixVirtualSelection = renderVirtualSelection(virtualSelection);
          }
        }
        beforeViewport = null;
        beforeSelectionRows = [];
        schedule();
      }, options.settleMs ?? 70);
    }, intervalForEdgeDistance(edgeDistance));
  };

  const stop = (cancelPending = false) => {
    if (!dragging) return;
    dragging = false;
    direction = 0;
    edgeDistance = 0;
    clearScrollTimer();
    if (cancelPending) clearAllTimers();
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    window.removeEventListener('blur', handleBlur);
  };

  const handleBlur = () => stop(false);

  const handleMouseMove = (event: MouseEvent) => {
    if (!dragging || (event.buttons & 1) === 0) {
      stop();
      return;
    }
    if (!needsApplicationSelectionScroll(terminal.buffer.active)) {
      direction = 0;
      clearScrollTimer();
      return;
    }
    const screenBounds = screen().getBoundingClientRect();
    const bounds = regionBounds(
      screenBounds,
      terminal.rows,
      currentSelectionScrollRegion(terminal),
    );
    const nextDirection = selectionEdgeDirection(event.clientY, bounds);
    if (nextDirection === 0) {
      direction = 0;
      edgeDistance = 0;
      if (edgeScrollStarted) {
        clearAllTimers();
        beforeViewport = null;
        beforeSelectionRows = [];
        virtualSelectionInvalid = true;
        virtualSelection = null;
        terminal.__agentMatrixVirtualSelection = undefined;
      } else {
        clearScrollTimer();
      }
      return;
    }
    direction = nextDirection;
    edgeDistance = nextDirection < 0
      ? bounds.top - event.clientY
      : event.clientY - bounds.bottom;
    schedule();
  };

  const handleMouseUp = () => stop(false);

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !needsApplicationSelectionScroll(terminal.buffer.active)) return;
    stop(true);
    clearAllTimers();
    dragging = true;
    direction = 0;
    edgeDistance = 0;
    beforeViewport = null;
    beforeSelectionRows = [];
    virtualSelection = null;
    virtualSelectionInvalid = false;
    edgeScrollStarted = false;
    terminal.__agentMatrixVirtualSelection = undefined;
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('blur', handleBlur);
  };

  element.addEventListener('mousedown', handleMouseDown, true);
  return () => {
    stop(true);
    clearAllTimers();
    element.removeEventListener('mousedown', handleMouseDown, true);
    terminal.__agentMatrixVirtualSelection = undefined;
  };
}
