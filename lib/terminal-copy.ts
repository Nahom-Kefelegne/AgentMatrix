const RIGHT_RAIL_GLYPHS = new Set([
  '|', '│', '┃', '║', '╎', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '▐', '▕', '█',
]);

interface XtermSelectionPosition {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface XtermCopySource {
  cols: number;
  hasSelection?(): boolean;
  getSelection(): string;
  getSelectionPosition(): XtermSelectionPosition | undefined;
  __agentMatrixVirtualSelection?: string;
  buffer: {
    active: {
      getLine(y: number): {
        isWrapped: boolean;
        translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
        getCell(x: number): { getChars(): string } | undefined;
      } | undefined;
    };
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Copilot renders a vertical timeline rail in xterm's rightmost cell. A
 * multiline linear selection includes that cell on every intermediate row,
 * which pollutes clipboard text with a trailing "|" glyph. Only remove a glyph
 * when the selected buffer confirms the same right-edge rail on several rows.
 */
export function getPhysicalTerminalSelection(terminal: XtermCopySource): string {
  const selection = terminal.getSelection();
  const position = terminal.getSelectionPosition();
  if (!selection || !position || position.start.y === position.end.y || terminal.cols < 2) {
    return selection;
  }

  const startY = Math.min(position.start.y, position.end.y);
  const endY = Math.max(position.start.y, position.end.y);
  const originalLines = selection.split(/\r?\n/);
  if (originalLines.length === endY - startY + 1) {
    const startColumn = Math.min(position.start.x, position.end.x);
    const endColumn = Math.max(position.start.x, position.end.x);
    const columnLines: string[] = [];
    for (let y = startY; y <= endY; y++) {
      const line = terminal.buffer.active.getLine(y);
      if (!line) break;
      columnLines.push(
        line.translateToString(true, startColumn, endColumn).replace(/\u00a0/g, ' '),
      );
    }
    if (
      columnLines.length === originalLines.length
      && columnLines.every((line, index) => line === originalLines[index])
    ) {
      return selection;
    }
  }

  const counts = new Map<string, number>();
  const fullRows = new Set<number>();

  for (let y = startY; y <= endY; y++) {
    const includesRightEdge = y < endY || position.end.x >= terminal.cols;
    if (!includesRightEdge) continue;
    fullRows.add(y);
    const glyph = terminal.buffer.active.getLine(y)?.getCell(terminal.cols - 1)?.getChars();
    if (!glyph || !RIGHT_RAIL_GLYPHS.has(glyph)) continue;
    counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
  }

  let rail = '';
  let railRows = 0;
  for (const [glyph, count] of counts) {
    if (count > railRows) {
      rail = glyph;
      railRows = count;
    }
  }
  if (!rail || railRows < 2 || railRows < Math.ceil(fullRows.size / 2)) return selection;

  const output: string[] = [];
  const trailingRail = new RegExp(`${escapeRegExp(rail)}[\\t ]*$`);
  for (let y = startY; y <= endY; y++) {
    const line = terminal.buffer.active.getLine(y);
    if (!line) continue;
    const startColumn = y === startY ? position.start.x : 0;
    const endColumn = y === endY ? position.end.x : undefined;
    let text = line.translateToString(true, startColumn, endColumn);
    if (
      fullRows.has(y)
      && line.getCell(terminal.cols - 1)?.getChars() === rail
    ) {
      text = text.replace(trailingRail, '').replace(/[ \t]+$/, '');
    }
    text = text.replace(/\u00a0/g, ' ');
    if (line.isWrapped && output.length > 0) output[output.length - 1] += text;
    else output.push(text);
  }
  return output.join(selection.includes('\r\n') ? '\r\n' : '\n');
}

export function getCleanTerminalSelection(terminal: XtermCopySource): string {
  if (
    terminal.__agentMatrixVirtualSelection
    && (terminal.hasSelection?.() ?? Boolean(terminal.getSelection()))
  ) {
    return terminal.__agentMatrixVirtualSelection;
  }
  return getPhysicalTerminalSelection(terminal);
}
