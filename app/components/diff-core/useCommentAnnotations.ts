'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffOnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { defineAgentMatrixTheme, AGENT_MATRIX_THEME } from '@/lib/monacoTheme';
import type { FloatingPopover, ReviewComment } from './types';
import { useMousePosition } from './hooks';

type MonacoNs = Parameters<DiffOnMount>[1];

interface UseCommentAnnotationsOpts {
  // Bounding element used to clamp the popover inside the visible surface.
  containerRef: React.RefObject<HTMLElement | null>;
  // Absolute path of the file currently shown in the wired editor.
  activeFilePath: string | null;
  comments: ReviewComment[];
  // A value that changes whenever the editor's content/model is replaced
  // (e.g. the diff object or file content). Forces decorations to reapply.
  revision: unknown;
  onAddComment: (filePath: string, lineNumber: number, text: string) => void | Promise<void>;
  onDeleteComment: (commentId: string) => void | Promise<void>;
}

// Owns everything that ties review comments to a Monaco editor instance:
// glyph/line decorations, gutter-click + selection interactions, and the
// floating add/view popover state. Reusable across the diff and browse editors.
export function useCommentAnnotations(opts: UseCommentAnnotationsOpts) {
  const { containerRef, activeFilePath, comments, revision } = opts;

  const [popover, setPopover] = useState<FloatingPopover | null>(null);
  const [commentText, setCommentText] = useState('');

  const mousePos = useMousePosition();
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const decorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const floatingInputRef = useRef<HTMLTextAreaElement>(null);

  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const activeFileRef = useRef(activeFilePath);
  activeFileRef.current = activeFilePath;
  const onAddRef = useRef(opts.onAddComment);
  onAddRef.current = opts.onAddComment;
  const onDeleteRef = useRef(opts.onDeleteComment);
  onDeleteRef.current = opts.onDeleteComment;

  const clampPopover = useCallback((rawX: number, rawY: number, popW = 340, popH = 160) => {
    const container = containerRef.current;
    if (!container) return { x: rawX, y: rawY };
    const rect = container.getBoundingClientRect();
    const pad = 12;
    let x = rawX, y = rawY;
    if (x + popW + pad > rect.right) x = rect.right - popW - pad;
    if (x < rect.left + pad) x = rect.left + pad;
    if (y + popH + pad > rect.bottom) y = rawY - popH - 8;
    if (y < rect.top + pad) y = rect.top + pad;
    return { x, y };
  }, [containerRef]);

  // Rebuild decorations for the currently-wired editor from the active file's
  // comments. Ref-based so the callback identity stays stable.
  const refreshDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const fileComments = commentsRef.current.filter(c => c.filePath === activeFileRef.current);
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(
      fileComments.map(c => ({
        range: new monaco.Range(c.lineNumber, 1, c.lineNumber, 1),
        options: {
          glyphMarginClassName: c.resolved ? 'review-comment-glyph--resolved' : 'review-comment-glyph',
          isWholeLine: true,
          className: c.resolved ? 'review-comment-line--resolved' : 'review-comment-line',
          glyphMarginHoverMessage: { value: `${c.resolved ? '(resolved) ' : ''}${c.text}` },
        },
      }))
    );
  }, []);

  useEffect(() => {
    refreshDecorations();
  }, [comments, activeFilePath, revision, refreshDecorations]);

  // Wire gutter-glyph clicks (add/view) and text-selection (add on range).
  const wireEditor = useCallback((editor: monacoEditor.IStandaloneCodeEditor, monaco: MonacoNs) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);

    // When this editor is torn down (e.g. the browse editor unmounts on mode
    // switch), drop our references so a later decorations refresh can't touch a
    // disposed instance.
    editor.onDidDispose(() => {
      if (editorRef.current === editor) {
        editorRef.current = null;
        decorationsRef.current = null;
      }
    });

    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (!line) return;
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        const existing = commentsRef.current.find(
          c => c.filePath === activeFileRef.current && c.lineNumber === line
        );
        if (existing) {
          setPopover({ mode: 'view', line, endLine: line, x: pos.x, y: pos.y, comment: existing });
        } else {
          setPopover({ mode: 'add', line, endLine: line, x: pos.x, y: pos.y });
          setCommentText('');
        }
      }
    });
    editor.onMouseUp(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return;
      setTimeout(() => {
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        setPopover({ mode: 'add', line: sel.startLineNumber, endLine: sel.endLineNumber, x: pos.x, y: pos.y });
        setCommentText('');
      }, 50);
    });

    // Apply any existing decorations as soon as the editor is ready.
    refreshDecorations();
  }, [clampPopover, refreshDecorations]);

  // Mount handler for a Monaco DiffEditor — decorations live on the modified side.
  const handleDiffMount = useCallback<DiffOnMount>((editor, monaco) => {
    wireEditor(editor.getModifiedEditor(), monaco);
  }, [wireEditor]);

  // Mount handler for a standalone Monaco Editor (browse mode).
  const handleEditorMount = useCallback((editor: monacoEditor.IStandaloneCodeEditor, monaco: MonacoNs) => {
    wireEditor(editor, monaco);
  }, [wireEditor]);

  const dismissPopover = useCallback(() => { setPopover(null); setCommentText(''); }, []);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim() || !activeFileRef.current || !popover) return;
    const text = popover.line !== popover.endLine
      ? `[Lines ${popover.line}-${popover.endLine}] ${commentText.trim()}`
      : commentText.trim();
    await onAddRef.current(activeFileRef.current, popover.line, text);
    setCommentText('');
    setPopover(null);
  }, [commentText, popover]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    await onDeleteRef.current(commentId);
    setPopover(prev => (prev?.comment?.id === commentId ? null : prev));
  }, []);

  // Focus the composer textarea when it opens.
  useEffect(() => {
    if (popover?.mode === 'add') setTimeout(() => floatingInputRef.current?.focus(), 30);
  }, [popover]);

  return {
    popover,
    setPopover,
    commentText,
    setCommentText,
    floatingInputRef,
    handleDiffMount,
    handleEditorMount,
    dismissPopover,
    handleAddComment,
    handleDeleteComment,
    refreshDecorations,
  };
}

export type CommentAnnotations = ReturnType<typeof useCommentAnnotations>;
