'use client';

import {
  Children,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AlertTriangle, BookOpenText, Code2, ImageOff, RefreshCw } from 'lucide-react';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { NavigationRequest, NavigationTarget } from '@/lib/navigation/types';
import CodePreview from './CodePreview';
import type { ContextCanvasController } from './useContextCanvas';
import { useNavigationFile } from './useNavigationFile';

const MAX_AUTORENDER_BYTES = 512 * 1024;
const numberFormat = new Intl.NumberFormat();

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'input'])],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
    input: ['checked', 'disabled', ['type', 'checkbox']],
    li: [...(defaultSchema.attributes?.li ?? []), ['className', 'task-list-item']],
    ul: [...(defaultSchema.attributes?.ul ?? []), ['className', 'contains-task-list']],
  },
};

interface MarkdownPreviewProps {
  request: NavigationRequest;
  controller: ContextCanvasController;
}

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map(child => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (
        child
        && typeof child === 'object'
        && 'props' in child
        && child.props
        && typeof child.props === 'object'
        && 'children' in child.props
      ) {
        return textFromChildren(child.props.children as ReactNode);
      }
      return '';
    })
    .join('');
}

function headingId(children: ReactNode): string {
  const slug = textFromChildren(children)
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `cc-md-${slug || 'section'}`;
}

function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith('#')
    || /^https?:\/\//i.test(trimmed)
    || (!trimmed.startsWith('//') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed))
  ) {
    return trimmed;
  }
  return '';
}

function scrollToFragment(fragment: string): void {
  let normalized: string;
  try {
    normalized = decodeURIComponent(fragment).trim().toLocaleLowerCase();
  } catch {
    return;
  }
  const slug = normalized
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  document.getElementById(`cc-md-${slug}`)?.scrollIntoView({ block: 'start' });
}

export default function MarkdownPreview({ request, controller }: MarkdownPreviewProps) {
  const { file, loading, error, retry } = useNavigationFile(request);
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [renderLarge, setRenderLarge] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const documentPath = request.target?.path ?? '';
  const tooLarge = Boolean(file && file.size > MAX_AUTORENDER_BYTES);

  useEffect(() => {
    setView('preview');
    setRenderLarge(false);
    setLinkError(null);
  }, [documentPath]);

  useEffect(() => {
    const fragment = request.target?.fragment;
    if (!fragment || view !== 'preview' || !file) return;
    const frame = window.requestAnimationFrame(() => scrollToFragment(fragment));
    return () => window.cancelAnimationFrame(frame);
  }, [file, request.target?.fragment, view]);

  const resolveLink = useCallback(async (raw: string) => {
    setLinkError(null);
    const response = await fetch('/api/navigation/resolve-document-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: request.sessionId,
        documentPath,
        raw,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Document link failed (${response.status}).`);
    }
    return payload as
      | { kind: 'fragment'; fragment: string }
      | { kind: 'external'; url: string }
      | { kind: 'target'; path: string; fragment?: string };
  }, [documentPath, request.sessionId]);

  const handleInternalLink = useCallback(async (raw: string) => {
    try {
      const resolved = await resolveLink(raw);
      if (resolved.kind === 'fragment') {
        scrollToFragment(resolved.fragment);
        return;
      }
      if (resolved.kind === 'target') {
        const target: NavigationTarget = {
          path: resolved.path,
          fragment: resolved.fragment,
        };
        controller.openFile(target, `Open document link ${resolved.path}`);
      }
    } catch (reason) {
      setLinkError(reason instanceof Error ? reason.message : 'Could not open document link.');
    }
  }, [controller, resolveLink]);

  const components = useMemo<Components>(() => {
    const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      function MarkdownHeading({ children, ...props }: ComponentPropsWithoutRef<typeof Tag>) {
        return <Tag id={headingId(children)} {...props}>{children}</Tag>;
      };

    return {
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      h5: heading('h5'),
      h6: heading('h6'),
      a: ({ href = '', children, ...props }) => {
        const external = /^https?:\/\//i.test(href);
        if (external) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
              {children}
            </a>
          );
        }
        return (
          <a
            href={href || '#'}
            {...props}
            onClick={event => {
              event.preventDefault();
              if (href) void handleInternalLink(href);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ alt = '' }) => (
        <span className="cc-markdown-image-blocked" role="note">
          <ImageOff size={14} aria-hidden="true" />
          {alt ? `Image omitted: ${alt}` : 'Repository and remote images are disabled in preview.'}
        </span>
      ),
      input: props => (
        <input
          {...props}
          disabled
          aria-label={props.checked ? 'Completed task' : 'Incomplete task'}
        />
      ),
    };
  }, [handleInternalLink]);

  if (loading) {
    return (
      <div className="cc-loading" role="status">
        <span className="cc-loading-line cc-loading-line--wide" />
        <span className="cc-loading-line" />
        <span className="cc-loading-line cc-loading-line--short" />
        Loading document…
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="cc-error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <strong>Could Not Open Document</strong>
        <span>{error || 'The document is unavailable.'}</span>
        <button type="button" onClick={retry}>
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  const showPreview = view === 'preview' && (!tooLarge || renderLarge);

  return (
    <div className="cc-document">
      <div className="cc-document-toolbar" role="toolbar" aria-label="Document view">
        <div className="cc-document-segment">
          <button
            type="button"
            className={view === 'preview' ? 'is-active' : ''}
            onClick={() => setView('preview')}
          >
            <BookOpenText size={13} aria-hidden="true" /> Preview
          </button>
          <button
            type="button"
            className={view === 'source' ? 'is-active' : ''}
            onClick={() => setView('source')}
          >
            <Code2 size={13} aria-hidden="true" /> Source
          </button>
        </div>
        <span>{numberFormat.format(Math.max(1, Math.round(file.size / 1024)))}&nbsp;KB</span>
      </div>

      {linkError ? (
        <div className="cc-inline-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{linkError}</span>
        </div>
      ) : null}

      {view === 'source' ? (
        <div className="cc-document-source">
          <CodePreview request={request} />
        </div>
      ) : null}

      {view === 'preview' && tooLarge && !renderLarge ? (
        <div className="cc-empty">
          <BookOpenText size={23} aria-hidden="true" />
          <strong>Large Markdown Document</strong>
          <span>Documents over 512 KB open as source to avoid blocking the terminal renderer.</span>
          <button type="button" onClick={() => setRenderLarge(true)}>Render Anyway</button>
        </div>
      ) : null}

      {showPreview ? (
        <article className="cc-markdown" translate="no">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
            skipHtml
            urlTransform={safeUrlTransform as UrlTransform}
            components={components}
          >
            {file.content}
          </ReactMarkdown>
        </article>
      ) : null}
    </div>
  );
}
