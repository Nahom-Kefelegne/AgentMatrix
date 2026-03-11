'use client';

import { useRef, useCallback } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';

const AGENT_MATRIX_THEME = 'agent-matrix-dark';

interface MonacoWrapperProps {
  value: string;
  language: string;
  path: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

function defineTheme(monaco: Parameters<OnMount>[1]) {
  monaco.editor.defineTheme(AGENT_MATRIX_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a6a8a', fontStyle: 'italic' },
      { token: 'string', foreground: '51cf66' },
      { token: 'keyword', foreground: 'cc5de8' },
      { token: 'number', foreground: 'ff922b' },
      { token: 'type', foreground: '20c997' },
      { token: 'type.identifier', foreground: '20c997' },
      { token: 'function', foreground: '4a9eff' },
      { token: 'variable', foreground: 'e0e0e0' },
      { token: 'constant', foreground: 'ff922b' },
      { token: 'operator', foreground: 'c8c8d8' },
      { token: 'delimiter', foreground: 'c8c8d8' },
      { token: 'tag', foreground: 'cc5de8' },
      { token: 'attribute.name', foreground: '4a9eff' },
      { token: 'attribute.value', foreground: '51cf66' },
      { token: 'regexp', foreground: 'ff922b' },
    ],
    colors: {
      'editor.background': '#0e0e1a',
      'editor.foreground': '#e0e0e0',
      'editor.lineHighlightBackground': '#ffffff0a',
      'editor.selectionBackground': '#4a9eff4d',
      'editor.inactiveSelectionBackground': '#4a9eff26',
      'editorLineNumber.foreground': '#555555',
      'editorLineNumber.activeForeground': '#888888',
      'editorCursor.foreground': '#4a9eff',
      'editor.wordHighlightBackground': '#4a9eff1a',
      'editorBracketMatch.background': '#4a9eff33',
      'editorBracketMatch.border': '#4a9eff66',
      'editorIndentGuide.background': '#2a2a3a',
      'editorIndentGuide.activeBackground': '#3a3a4e',
      'editorWidget.background': '#12121e',
      'editorWidget.border': '#2a2a3a',
      'editorSuggestWidget.background': '#12121e',
      'editorSuggestWidget.border': '#2a2a3a',
      'editorSuggestWidget.selectedBackground': '#4a9eff33',
      'editorHoverWidget.background': '#12121e',
      'editorHoverWidget.border': '#2a2a3a',
      'input.background': '#0e0e1a',
      'input.border': '#2a2a3a',
      'input.foreground': '#e0e0e0',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#ffffff15',
      'scrollbarSlider.hoverBackground': '#ffffff25',
      'scrollbarSlider.activeBackground': '#ffffff35',
      'minimap.background': '#0a0a14',
    },
  });
}

export default function MonacoWrapper({ value, language, path, onChange, onSave }: MonacoWrapperProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    defineTheme(monaco);
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
