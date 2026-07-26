import { NAVIGATION_PROTOCOL_VERSION, type NavigationRequest } from '@/lib/navigation/types';

export interface TerminalLinkOptions {
  sessionId: string;
  onNavigate?: (request: NavigationRequest) => void;
}

export type TerminalLinkOptionsProvider = () => TerminalLinkOptions | undefined;

interface XtermDisposable {
  dispose(): void;
}

interface XtermBufferLine {
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

interface XtermTerminal {
  cols: number;
  buffer: {
    active: {
      getLine(y: number): XtermBufferLine | undefined;
    };
  };
  registerLinkProvider(provider: XtermLinkProvider): XtermDisposable;
}

interface XtermBufferRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface XtermLink {
  range: XtermBufferRange;
  text: string;
  decorations: { pointerCursor: boolean; underline: boolean };
  activate(event: MouseEvent, text: string): void;
}

interface XtermLinkProvider {
  provideLinks(bufferLineNumber: number, callback: (links: XtermLink[] | undefined) => void): void;
}

export interface XtermLinkHandler {
  allowNonHttpProtocols?: boolean;
  activate(event: MouseEvent, text: string, range: XtermBufferRange): void;
}

interface TerminalLinkMatch {
  kind: 'file' | 'url';
  raw: string;
  start: number;
  end: number;
}

const MAX_LINK_LINE_LENGTH = 4096;
const LINK_DECORATIONS = { pointerCursor: true, underline: true };
const LOG_PREFIX = '[terminal-link]';
const PREFIX_SOURCE = String.raw`(^|[\s([{<"'])`;
const PATH_WITH_SEPARATOR_SOURCE = String.raw`(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~?[\\/]|[A-Za-z0-9_.@+-]+[\\/])(?:[^\s<>"']*?)`;
const KNOWN_FILE_EXTENSIONS_SOURCE = String.raw`(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|cs|cpp|cxx|cc|c|h|hpp|hh|rb|php|swift|kt|kts|sh|bash|zsh|fish|ps1|yml|yaml|toml|json|jsonc|md|mdx|css|scss|sass|less|html|vue|svelte|sql|xml|gradle|lock)`;

const HTTP_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const PATH_COLON_RE = new RegExp(
  `${PREFIX_SOURCE}(${PATH_WITH_SEPARATOR_SOURCE}:\\d+(?::\\d+)?)`,
  'g',
);
const PATH_PAREN_RE = new RegExp(
  `${PREFIX_SOURCE}(${PATH_WITH_SEPARATOR_SOURCE}\\(\\d+(?:(?:,|:)\\d+)?\\))`,
  'g',
);
const BARE_COLON_RE = new RegExp(
  `${PREFIX_SOURCE}([A-Za-z0-9_.@+-]+\\.${KNOWN_FILE_EXTENSIONS_SOURCE}:\\d+(?::\\d+)?)`,
  'gi',
);
const BARE_PAREN_RE = new RegExp(
  `${PREFIX_SOURCE}([A-Za-z0-9_.@+-]+\\.${KNOWN_FILE_EXTENSIONS_SOURCE}\\(\\d+(?:(?:,|:)\\d+)?\\))`,
  'gi',
);
const PYTHON_FILE_RE = /\bFile\s+["']([^"'\r\n]+)["'],\s+line\s+\d+(?:,\s+column\s+\d+)?/g;
const BARE_FILE_NAME_RE = new RegExp(
  `^[A-Za-z0-9_.@+-]+\\.${KNOWN_FILE_EXTENSIONS_SOURCE}(?:(?::\\d+(?::\\d+)?)|(?:\\(\\d+(?:(?:,|:)\\d+)?\\)))?$`,
  'i',
);

export function createTerminalLinks(getOptions: TerminalLinkOptionsProvider): {
  linkHandler: XtermLinkHandler;
  register: (terminal: XtermTerminal) => XtermDisposable;
  dispose: () => void;
} {
  let disposed = false;
  let requestSeq = 0;
  let activeController: AbortController | null = null;

  const resolveFileLink = (raw: string) => {
    const startOptions = getOptions();
    if (!startOptions?.sessionId || !startOptions.onNavigate) {
      logWarning('Navigation link ignored because no navigation handler is mounted.', { raw });
      return;
    }

    requestSeq += 1;
    const seq = requestSeq;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    void (async () => {
      try {
        const response = await fetch('/api/navigation/resolve-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: startOptions.sessionId, raw }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const message = await readErrorMessage(response);
          if (!controller.signal.aborted && !disposed && seq === requestSeq) {
            logWarning(message || `Navigation link rejected (${response.status}).`, { raw });
          }
          return;
        }

        const request = await response.json();
        if (disposed || controller.signal.aborted || seq !== requestSeq) return;

        const latestOptions = getOptions();
        if (!latestOptions?.onNavigate || latestOptions.sessionId !== startOptions.sessionId) return;
        if (!isNavigationRequest(request, latestOptions.sessionId)) {
          logWarning('Navigation link resolver returned an invalid response.', { raw });
          return;
        }

        latestOptions.onNavigate(request);
      } catch (error) {
        if (controller.signal.aborted || disposed || seq !== requestSeq) return;
        logWarning('Navigation link could not be resolved.', { raw, error });
      } finally {
        if (activeController === controller) activeController = null;
      }
    })();
  };

  const activateRawLink = (event: MouseEvent, raw: string, fromOsc8: boolean, kind?: TerminalLinkMatch['kind']) => {
    event.preventDefault();
    const text = trimTrailingDelimiters(raw.trim());
    if (!text) return;

    if (kind === 'url') {
      openSafeHttpLink(text);
      return;
    }
    if (openSafeHttpLink(text)) return;
    if (kind === 'file' || isResolvableFileCandidate(text)) {
      resolveFileLink(text);
      return;
    }

    if (fromOsc8) {
      logWarning('Blocked unsupported terminal link scheme.', { raw: text });
    }
  };

  const linkHandler: XtermLinkHandler = {
    // Needed for file:// OSC-8 links; activateRawLink still blocks unknown schemes.
    allowNonHttpProtocols: true,
    activate: (event, text) => activateRawLink(event, text, true),
  };

  return {
    linkHandler,
    register: (terminal: XtermTerminal) => {
      const disposable = terminal.registerLinkProvider({
        provideLinks: (bufferLineNumber, callback) => {
          if (disposed) {
            callback(undefined);
            return;
          }

          const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
          if (!line) {
            callback(undefined);
            return;
          }

          const text = line.translateToString(true, 0, terminal.cols);
          if (!text || text.length > MAX_LINK_LINE_LENGTH) {
            callback(undefined);
            return;
          }

          const includeFileLinks = Boolean(getOptions()?.onNavigate);
          const matches = detectTerminalLinkMatches(text, includeFileLinks);
          if (matches.length === 0) {
            callback(undefined);
            return;
          }

          callback(matches.map(match => ({
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: Math.min(match.end, terminal.cols), y: bufferLineNumber },
            },
            text: match.raw,
            decorations: LINK_DECORATIONS,
            activate: event => activateRawLink(event, match.raw, false, match.kind),
          })));
        },
      });

      return {
        dispose: () => {
          try { disposable.dispose(); } catch {}
        },
      };
    },
    dispose: () => {
      disposed = true;
      activeController?.abort();
      activeController = null;
    },
  };
}

export function detectTerminalLinkMatches(line: string, includeFileLinks = true): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];

  for (const match of line.matchAll(HTTP_URL_RE)) {
    if (match.index === undefined) continue;
    addMatch(matches, {
      kind: 'url',
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (includeFileLinks) {
    collectPrefixedMatches(line, PATH_COLON_RE, matches);
    collectPrefixedMatches(line, PATH_PAREN_RE, matches);
    collectPrefixedMatches(line, BARE_COLON_RE, matches);
    collectPrefixedMatches(line, BARE_PAREN_RE, matches);

    for (const match of line.matchAll(PYTHON_FILE_RE)) {
      if (match.index === undefined) continue;
      addMatch(matches, {
        kind: 'file',
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}

function collectPrefixedMatches(line: string, regex: RegExp, matches: TerminalLinkMatch[]) {
  regex.lastIndex = 0;
  for (const match of line.matchAll(regex)) {
    if (match.index === undefined) continue;
    const prefix = match[1] ?? '';
    const raw = match[2] ?? '';
    addMatch(matches, {
      kind: 'file',
      raw,
      start: match.index + prefix.length,
      end: match.index + prefix.length + raw.length,
    });
  }
}

function addMatch(matches: TerminalLinkMatch[], match: TerminalLinkMatch) {
  const raw = trimTrailingDelimiters(match.raw);
  const end = match.end - (match.raw.length - raw.length);
  if (!raw || end <= match.start) return;

  const normalized = { ...match, raw, end };
  if (matches.some(existing => rangesOverlap(existing, normalized))) return;
  matches.push(normalized);
}

function rangesOverlap(a: TerminalLinkMatch, b: TerminalLinkMatch) {
  return a.start < b.end && b.start < a.end;
}

function trimTrailingDelimiters(value: string) {
  let text = value;
  while (text.length > 0) {
    const last = text[text.length - 1];
    if (/[.,;:!?]/.test(last)) {
      text = text.slice(0, -1);
      continue;
    }
    if ((last === ')' && countChar(text, ')') > countChar(text, '(')) ||
        (last === ']' && countChar(text, ']') > countChar(text, '[')) ||
        (last === '}' && countChar(text, '}') > countChar(text, '{')) ||
        last === '>') {
      text = text.slice(0, -1);
      continue;
    }
    break;
  }
  return text;
}

function countChar(value: string, char: string) {
  let count = 0;
  for (const c of value) if (c === char) count += 1;
  return count;
}

function openSafeHttpLink(raw: string) {
  const url = parseHttpUrl(raw);
  if (!url || typeof window === 'undefined') return false;

  const electronAPI = (window as any).electronAPI;
  if (typeof electronAPI?.openExternal === 'function') {
    try {
      const result = electronAPI.openExternal(url.href);
      if (typeof result?.catch === 'function') {
        result.catch((error: unknown) => logWarning('Electron could not open terminal link.', { url: url.href, error }));
      }
      return true;
    } catch (error) {
      logWarning('Electron could not open terminal link.', { url: url.href, error });
    }
  }

  if (electronAPI?.isElectron) {
    logWarning('Blocked terminal URL because the secure Electron external-link bridge is unavailable.', { url: url.href });
    return true;
  }

  const opened = window.open(url.href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    logWarning('Browser blocked opening terminal link.', { url: url.href });
    return true;
  }

  try { opened.opener = null; } catch {}
  return true;
}

function parseHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isResolvableFileCandidate(raw: string) {
  const text = raw.trim();
  if (!text) return false;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  if (/^file:/i.test(text)) return true;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) return false;
  return text.startsWith('/') ||
    text.startsWith('./') ||
    text.startsWith('../') ||
    text.startsWith('~/') ||
    text.includes('/') ||
    text.includes('\\') ||
    BARE_FILE_NAME_RE.test(text);
}

async function readErrorMessage(response: Response) {
  try {
    const data = await response.json();
    if (typeof data?.error?.message === 'string') return data.error.message;
    if (typeof data?.message === 'string') return data.message;
    if (typeof data?.error === 'string') return data.error;
  } catch {}
  return '';
}

function isNavigationRequest(value: unknown, sessionId: string): value is NavigationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<NavigationRequest>;
  return request.protocolVersion === NAVIGATION_PROTOCOL_VERSION &&
    request.sessionId === sessionId &&
    typeof request.requestRef === 'string' &&
    typeof request.action === 'string' &&
    request.source === 'terminal_link' &&
    typeof request.createdAt === 'number' &&
    Boolean(request.intent && typeof request.intent.summary === 'string');
}

function logWarning(message: string, details?: unknown) {
  if (details === undefined) console.warn(`${LOG_PREFIX} ${message}`);
  else console.warn(`${LOG_PREFIX} ${message}`, details);
}
