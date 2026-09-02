import type { editor as monacoEditor } from 'monaco-editor';

// Map a file path to a Monaco language id.
export function detectLanguage(filePath: string): string {
  const ext = ('.' + (filePath.split('.').pop() || '')).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
  };
  const basename = filePath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return map[ext] || 'plaintext';
}

// Per-status accent colors for the changed-files list.
export const statusColors: Record<string, string> = {
  modified: '#f59e0b',
  new: '#51cf66',
  added: '#51cf66',
  deleted: '#ff6b6b',
  renamed: '#60a5fa',
  unchanged: '#71717a',
  unavailable: '#a78bfa',
  untracked: '#a78bfa',
};

// Shared, read-only Monaco editor options used by both the diff and browse
// editors so decorations/glyphs line up identically.
export const monacoOpts: monacoEditor.IStandaloneEditorConstructionOptions &
  monacoEditor.IDiffEditorConstructionOptions = {
  readOnly: true,
  glyphMargin: true,
  minimap: { enabled: false },
  fontSize: 15,
  lineNumbers: 'on' as const,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
  fontLigatures: true,
  padding: { top: 8 },
  automaticLayout: true,
  folding: true,
  renderOverviewRuler: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
};
