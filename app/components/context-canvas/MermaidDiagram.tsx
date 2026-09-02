'use client';

import {
  AlertTriangle,
  Code2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useThemeContext } from '../ThemeProvider';
import {
  MAX_MERMAID_SOURCE_CHARACTERS,
  prepareMermaidSource,
  sanitizeMermaidSvg,
} from './mermaidSecurity';

const RENDER_TIMEOUT_MS = 2_500;

type DiagramState = 'loading' | 'ready' | 'error';

let renderQueue: Promise<void> = Promise.resolve();

function queueRender<T>(task: () => Promise<T>): Promise<T> {
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let notified = false;
  const timeout = window.setTimeout(() => {
    notified = true;
    rejectResult(new Error('Diagram rendering timed out.'));
  }, RENDER_TIMEOUT_MS);
  const run = async () => {
    if (notified) return;
    try {
      const value = await task();
      if (!notified) resolveResult(value);
    } catch (error) {
      if (!notified) rejectResult(error);
    } finally {
      window.clearTimeout(timeout);
    }
  };
  renderQueue = renderQueue.then(run, run);
  return result;
}

function readableRenderError(reason: unknown): string {
  const message = reason instanceof Error
    ? reason.message
    : 'Mermaid could not render this diagram.';
  if (/parse error|expecting|lexical error|syntax error/i.test(message)) {
    return 'The Mermaid syntax could not be parsed. Open Source to inspect the diagram block.';
  }
  return message.length > 240
    ? `${message.slice(0, 237)}…`
    : message;
}

export default function MermaidDiagram({
  source,
  onViewSource,
}: {
  source: string;
  onViewSource: () => void;
}) {
  const { theme } = useThemeContext();
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DiagramState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setState('loading');
    setError(null);

    const prepared = prepareMermaidSource(source);
    if (prepared.error) {
      setState('error');
      setError(prepared.error);
      return;
    }

    const render = async () => {
      const imported = await import('mermaid');
      const mermaid = imported.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        htmlLabels: false,
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
        maxTextSize: MAX_MERMAID_SOURCE_CHARACTERS,
        suppressErrorRendering: true,
        secure: [
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'htmlLabels',
          'themeCSS',
        ],
      });
      const diagramId = `cc-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${theme}`;
      const result = await mermaid.render(diagramId, prepared.source);
      return sanitizeMermaidSvg(result.svg);
    };

    void queueRender(render).then(
      svg => {
        if (!active || !containerRef.current) return;
        containerRef.current.replaceChildren(document.importNode(svg, true));
        setState('ready');
      },
      reason => {
        if (!active) return;
        setState('error');
        setError(readableRenderError(reason));
      },
    );

    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [reactId, source, theme]);

  return (
    <figure className="cc-mermaid">
      {state === 'loading' ? (
        <div className="cc-mermaid-status" role="status">
          Rendering diagram…
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="cc-mermaid-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Diagram unavailable</strong>
            <span>{error || 'Mermaid could not render this diagram.'}</span>
          </div>
          <button type="button" onClick={onViewSource}>
            <Code2 size={13} aria-hidden="true" /> View source
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="cc-mermaid-canvas"
        hidden={state !== 'ready'}
      />
    </figure>
  );
}
