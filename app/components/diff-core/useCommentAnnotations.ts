'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffOnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { defineAgentMatrixTheme, AGENT_MATRIX_THEME } from '@/lib/monacoTheme';
import type { FileDiff, FloatingPopover, ReviewComment } from './types';
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
  snapshotRef?: string;
  onAddComment: (
    filePath: string,
    lineNumber: number,
    text: string,
    anchor?: {
      snapshotRef?: string;
      side?: 'original' | 'current';
      startLine?: number;
      endLine?: number;
      contentHash?: string;
      contextExcerpt?: string;
    },
  ) => void | Promise<void>;
  onDeleteComment: (commentId: string) => void | Promise<void>;
}

// Owns everything that ties review comments to a Monaco editor instance:
// glyph/line decorations, gutter-click + selection interactions, and the
// floating add/view popover state. Reusable across the diff and browse editors.
export function useCommentAnnotations(opts: UseCommentAnnotationsOpts) {
  const { containerRef, activeFilePath, comments, revision, snapshotRef } = opts;

  const [popover, setPopover] = useState<FloatingPopover | null>(null);
  const [commentText, setCommentText] = useState('');

  const mousePos = useMousePosition();
  const editorRefs = useRef<Record<
    'original' | 'current',
    monacoEditor.IStandaloneCodeEditor | null
  >>({ original: null, current: null });
  const monacoRef = useRef<MonacoNs | null>(null);
  const decorationsRefs = useRef<Record<
    'original' | 'current',
    monacoEditor.IEditorDecorationsCollection | null
  >>({ original: null, current: null });
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
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const side of ['original', 'current'] as const) {
      const editor = editorRefs.current[side];
      if (!editor) continue;
      const fileComments = commentsRef.current.filter(comment =>
        comment.filePath === activeFileRef.current
        && (comment.side ?? 'current') === side);
      decorationsRefs.current[side]?.clear();
      decorationsRefs.current[side] = editor.createDecorationsCollection(
        fileComments.map(comment => ({
          range: new monaco.Range(
            comment.startLine ?? comment.lineNumber,
            1,
            comment.endLine ?? comment.lineNumber,
            1,
          ),
          options: {
            glyphMarginClassName: comment.resolved ? 'review-comment-glyph--resolved' : 'review-comment-glyph',
            isWholeLine: true,
            className: comment.resolved ? 'review-comment-line--resolved' : 'review-comment-line',
            glyphMarginHoverMessage: { value: `${comment.resolved ? '(resolved) ' : ''}${comment.text}` },
          },
        })),
      );
    }
  }, []);

  useEffect(() => {
    refreshDecorations();
  }, [comments, activeFilePath, revision, refreshDecorations]);

  // Wire gutter-glyph clicks (add/view) and text-selection (add on range).
  const wireEditor = useCallback((
    editor: monacoEditor.IStandaloneCodeEditor,
    monaco: MonacoNs,
    side: 'original' | 'current',
  ) => {
    editorRefs.current[side] = editor;
    monacoRef.current = monaco;
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);

    // When this editor is torn down (e.g. the browse editor unmounts on mode
    // switch), drop our references so a later decorations refresh can't touch a
    // disposed instance.
    editor.onDidDispose(() => {
      if (editorRefs.current[side] === editor) {
        editorRefs.current[side] = null;
        decorationsRefs.current[side] = null;
      }
    });

    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (!line) return;
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        const existing = commentsRef.current.find(
          comment =>
            comment.filePath === activeFileRef.current
            && (comment.side ?? 'current') === side
            && comment.lineNumber === line,
        );
        if (existing) {
          setPopover({ mode: 'view', side, line, endLine: line, x: pos.x, y: pos.y, comment: existing });
        } else {
          setPopover({ mode: 'add', side, line, endLine: line, x: pos.x, y: pos.y });
          setCommentText('');
        }
      }
    });
    editor.onMouseUp(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return;
      setTimeout(() => {
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        setPopover({
          mode: 'add',
          side,
          line: sel.startLineNumber,
          endLine: sel.endLineNumber,
          x: pos.x,
          y: pos.y,
        });
        setCommentText('');
      }, 50);
    });

    // Apply any existing decorations as soon as the editor is ready.
    refreshDecorations();
  }, [clampPopover, refreshDecorations]);

  // Mount handler for a Monaco DiffEditor — decorations live on the modified side.
  const handleDiffMount = useCallback<DiffOnMount>((editor, monaco) => {
    wireEditor(editor.getOriginalEditor(), monaco, 'original');
    wireEditor(editor.getModifiedEditor(), monaco, 'current');
  }, [wireEditor]);

  // Mount handler for a standalone Monaco Editor (browse mode).
  const handleEditorMount = useCallback((editor: monacoEditor.IStandaloneCodeEditor, monaco: MonacoNs) => {
    wireEditor(editor, monaco, 'current');
  }, [wireEditor]);

  const dismissPopover = useCallback(() => { setPopover(null); setCommentText(''); }, []);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim() || !activeFileRef.current || !popover) return;
    const text = popover.line !== popover.endLine
      ? `[Lines ${popover.line}-${popover.endLine}] ${commentText.trim()}`
      : commentText.trim();
    const fileDiff = revision
      && typeof revision === 'object'
      && 'current' in revision
      ? revision as FileDiff
      : null;
    const side = popover.side ?? 'current';
    const content = side === 'original'
      ? fileDiff?.original
      : fileDiff?.current;
    const contentHash = side === 'original'
      ? fileDiff?.originalHash
      : fileDiff?.currentHash;
    const lines = content?.replace(/\r\n|\r/g, '\n').split('\n') ?? [];
    const contextStart = Math.max(0, popover.line - 3);
    const contextEnd = Math.min(lines.length, popover.endLine + 2);
    await onAddRef.current(activeFileRef.current, popover.line, text, {
      snapshotRef,
      side,
      startLine: popover.line,
      endLine: popover.endLine,
      contentHash,
      contextExcerpt: lines.slice(contextStart, contextEnd).join('\n').slice(0, 2_000),
    });
    setCommentText('');
    setPopover(null);
  }, [commentText, popover, revision, snapshotRef]);

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
