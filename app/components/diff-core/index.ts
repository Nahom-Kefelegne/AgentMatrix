export { default as SessionDiffCore } from './SessionDiffCore';
export type { SessionDiffCoreProps } from './SessionDiffCore';

export type {
  FileChange,
  FileDiff,
  DiffMode,
  DiffPresentation,
  ReviewSendMode,
  CommentAnchor,
  FloatingPopover,
  SessionDiffCoreCallbacks,
  CommentsController,
  ReviewComment,
} from './types';

export {
  useChangedFiles,
  useFileDiff,
  useComments,
  useMousePosition,
} from './hooks';
export { useCommentAnnotations } from './useCommentAnnotations';
export type { CommentAnnotations } from './useCommentAnnotations';

export { ChangedFilesList } from './ChangedFilesList';
export { DiffPane } from './DiffPane';
export { CommentsPanel } from './CommentsPanel';
export { CommentComposerPopover } from './CommentComposerPopover';
export { RevertControls } from './RevertControls';
export { ReviewActions } from './ReviewActions';
export { DiffCoreStyles, DIFF_CORE_STYLE_CSS } from './DiffCoreStyles';
export { LoadingSpinner, EditorLoading, EditorError } from './Spinners';
export {
  FileIcon,
  FileTreeNode,
  buildFileTree,
  FILE_COLORS,
  type TreeNode,
} from './FileTree';
export { detectLanguage, statusColors, monacoOpts } from './editorConfig';
