'use client';

import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AGENT_MATRIX_THEME, defineAgentMatrixTheme } from '@/lib/monacoTheme';
import type { NavigationRequest } from '@/lib/navigation/types';
import { useNavigationFile } from './useNavigationFile';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then(module => module.default),
  { ssr: false },
);

export default function CodePreview({ request }: { request: NavigationRequest }) {
  const { file, loading, error, retry } = useNavigationFile(request);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);
    const range = request.target?.range;
    if (!range) return;
    const endLine = range.end?.line ?? range.start.line;
    const endColumn = range.end?.column
      ?? (range.end && endLine !== range.start.line
        ? 1
        : range.start.column ?? 1);
    const selection = new monaco.Range(
      range.start.line,
      range.start.column ?? 1,
      endLine,
      endColumn,
    );
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection, monaco.editor.ScrollType.Immediate);
  }, [request.target?.range]);

  if (loading) {
    return (
      <div className="cc-loading" role="status">
        <span className="cc-loading-line cc-loading-line--wide" />
        <span className="cc-loading-line" />
        <span className="cc-loading-line cc-loading-line--short" />
        Loading code…
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="cc-error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <strong>Could Not Open Code</strong>
        <span>{error || 'The file is unavailable.'}</span>
        <button type="button" onClick={retry}>
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  return (
    <MonacoEditor
      key={`${file.path}:${request.target?.range?.start.line ?? 0}:${request.target?.range?.start.column ?? 0}:${request.target?.range?.end?.line ?? 0}:${request.target?.range?.end?.column ?? 0}`}
      value={file.content}
      language={file.language}
      path={`${file.repoRef}/${file.path}`}
      theme={AGENT_MATRIX_THEME}
      onMount={handleMount}
      loading={<div className="cc-loading" role="status">Loading editor…</div>}
      options={{
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 15,
        lineHeight: 21,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        cursorBlinking: 'solid',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        fontLigatures: true,
        padding: { top: 10, bottom: 10 },
        wordWrap: 'off',
        folding: true,
        glyphMargin: false,
        contextmenu: true,
        stickyScroll: { enabled: false },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        renderLineHighlight: 'line',
      }}
    />
  );
}
