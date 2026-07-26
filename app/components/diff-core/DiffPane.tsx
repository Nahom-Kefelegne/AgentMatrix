'use client';

import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import { AGENT_MATRIX_THEME } from '@/lib/monacoTheme';
import type { DiffMode, FileDiff } from './types';
import { monacoOpts } from './editorConfig';
import { LoadingSpinner, EditorLoading, EditorError } from './Spinners';

interface DiffPaneProps {
  hasSelection: boolean;
  diff: FileDiff | null;
  language: string;
  diffMode: DiffMode;
  loading: boolean;
  error?: string | null;
  onMount: DiffOnMount;
}

// The Monaco DiffEditor pane plus its empty/loading/error states. Keeps the
// @monaco-editor/react lazy-loading behavior and the AgentMatrix theme.
export function DiffPane({ hasSelection, diff, language, diffMode, loading, error, onMount }: DiffPaneProps) {
  if (!hasSelection) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, color: '#555' }}>Select a file to view changes</div>
        <div style={{ fontSize: 12, color: '#444' }}>Highlight code or click the gutter to add comments</div>
      </div>
    );
  }

  if (error) return <EditorError message={error} />;
  if (loading || !diff) return <LoadingSpinner />;

  return (
    <DiffEditor
      original={diff.original}
      modified={diff.current}
      language={language}
      theme={AGENT_MATRIX_THEME}
      onMount={onMount}
      options={{ ...monacoOpts, originalEditable: false, renderSideBySide: diffMode === 'split' }}
      loading={<EditorLoading />}
    />
  );
}
