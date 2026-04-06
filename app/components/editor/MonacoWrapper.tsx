'use client';

import { useRef, useCallback } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { defineAgentMatrixTheme, AGENT_MATRIX_THEME } from '@/lib/monacoTheme';

interface MonacoWrapperProps {
  value: string;
  language: string;
  path: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function MonacoWrapper({ value, language, path, onChange, onSave }: MonacoWrapperProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);

    // Cmd/Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Reserve Cmd/Ctrl+P for quick open (future)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      // TODO: Quick file open
    });

    editor.focus();
  }, [onSave]);

  const handleChange: OnChange = useCallback((val) => {
    if (val !== undefined) {
      onChange(val);
    }
  }, [onChange]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor
        value={value}
        language={language}
        path={path}
        theme={AGENT_MATRIX_THEME}
        onChange={handleChange}
        onMount={handleMount}
        loading={
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#888', fontSize: 14,
            background: '#0e0e1a',
          }}>
            Loading editor...
          </div>
        }
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          formatOnPaste: true,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontLigatures: true,
          padding: { top: 12 },
          automaticLayout: true,
          wordWrap: 'off',
          tabSize: 2,
          insertSpaces: true,
          folding: true,
          glyphMargin: false,
          contextmenu: true,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
        }}
      />
    </div>
  );
}
