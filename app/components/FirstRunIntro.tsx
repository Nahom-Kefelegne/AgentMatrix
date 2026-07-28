'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  BookOpenText,
  CircleDot,
  Code2,
  FileCode2,
  FileText,
  GitCompareArrows,
  Maximize2,
  MessageSquareText,
  Pin,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { IntroBriefingVariant } from '@/lib/onboarding/releaseBriefing';

interface FirstRunIntroProps {
  onComplete: () => void;
  variant?: IntroBriefingVariant;
  initialPage?: number;
  releaseTitle?: string;
}

interface TourPage {
  eyebrow: string;
  title: string;
  accent: string;
  body: string;
  features: ReadonlyArray<{
    number: string;
    title: string;
    body: string;
  }>;
}

const TOUR_PAGES: ReadonlyArray<TourPage> = [
  {
    eyebrow: '01 · Control Center',
    title: 'Run every agent.',
    accent: 'Use one session list.',
    body: 'Keep multiple Copilot and Claude sessions moving at once. One compact list shows every session and makes the ones needing you impossible to miss.',
    features: [
      {
        number: '01',
        title: 'Needs-you state stays red',
        body: 'A session remains red and queued until you actually respond—not merely because you opened it.',
      },
      {
        number: '02',
        title: 'Every session in one place',
        body: 'Working, idle, complete, review-ready, and interaction-required sessions all live in the left list.',
      },
      {
        number: '03',
        title: 'The CLI remains central',
        body: 'Select any session instantly or expand the existing terminal workspace into fullscreen and multi-pane layouts.',
      },
    ],
  },
  {
    eyebrow: '02 · Context Canvas',
    title: 'Ask. Find. Open.',
    accent: 'Stay in the conversation.',
    body: 'A session can find repository code and reveal the exact file, symbol, range, or search results beside its live CLI.',
    features: [
      {
        number: '01',
        title: 'Conversation becomes navigation',
        body: 'Ask “where is auth handled?” and the session can open the most relevant source range automatically.',
      },
      {
        number: '02',
        title: 'Search without blocking',
        body: 'Repository and symbol search stream results asynchronously while terminal input and output remain responsive.',
      },
      {
        number: '03',
        title: 'Preview without losing focus',
        body: 'Pin code, move through per-session history, then return to the exact conversation without leaving the dashboard.',
      },
    ],
  },
  {
    eyebrow: '03 · Markdown Preview',
    title: 'Write the design.',
    accent: 'See the document.',
    body: 'When a session creates or updates a Markdown design doc, Context Canvas renders it beside the live CLI—without another app or a context switch.',
    features: [
      {
        number: '01',
        title: 'Design docs appear automatically',
        body: 'Successful changes under docs/design open as a rendered document after a short quiet period.',
      },
      {
        number: '02',
        title: 'Preview or inspect source',
        body: 'Read tables, tasks, links, and code blocks naturally, then switch to source when exact Markdown matters.',
      },
      {
        number: '03',
        title: 'Your current context stays protected',
        body: 'Pinned, background, and developer-opened Canvas work queues the preview instead of replacing what you are reviewing.',
      },
    ],
  },
  {
    eyebrow: '04 · Session Review',
    title: 'Review one agent.',
    accent: 'Send the work back.',
    body: 'Inspect the code attributed to a single session, comment on exact lines, and return structured feedback to the agent that made it.',
    features: [
      {
        number: '01',
        title: 'Session-attributed changes',
        body: 'Review transcript-native changes without unrelated working-tree edits from other sessions or developers.',
      },
      {
        number: '02',
        title: 'Comment, discuss, or fix',
        body: 'Select lines in Monaco, leave comments, and ask the owning session to discuss or apply the requested changes.',
      },
      {
        number: '03',
        title: 'Safe by construction',
        body: 'Navigation tools are capability-bound, root-scoped, read-only, and validated against traversal and symlink escapes.',
      },
    ],
  },
] as const;

function MissionControlDemo() {
  return (
    <div className="fre-demo fre-demo--mission" aria-label="Control Center session overview">
      <div className="fre-demo-header">
        <span><CircleDot size={12} aria-hidden="true" /> Control Center</span>
        <span>4 Sessions</span>
      </div>
      <div className="fre-mission-body">
        <div className="fre-attention-preview">
          <span className="fre-pane-label"><BellRing size={13} aria-hidden="true" /> Sessions</span>
          <div className="fre-attention-item fre-attention-item--critical">
            <span />
            <div>
              <strong>auth-api</strong>
              <p>Choose a token refresh strategy</p>
            </div>
            <em>4m</em>
          </div>
          <div className="fre-attention-item fre-attention-item--review">
            <span />
            <div>
              <strong>search-index</strong>
              <p>7 files ready to review</p>
            </div>
            <em>now</em>
          </div>
          <div className="fre-attention-item fre-attention-item--working">
            <span />
            <div>
              <strong>tests</strong>
              <p>Running targeted test suite</p>
            </div>
            <em>work</em>
          </div>
          <div className="fre-attention-item fre-attention-item--idle">
            <span />
            <div>
              <strong>docs</strong>
              <p>Idle</p>
            </div>
            <em>idle</em>
          </div>
        </div>
        <div className="fre-session-preview">
          <div className="fre-session-heading">
            <div>
              <span>GitHub Copilot</span>
              <strong>auth-api</strong>
            </div>
            <span className="fre-demo-icon" aria-hidden="true"><Maximize2 size={15} /></span>
          </div>
          <div className="fre-session-terminal">
            <span>›</span>
            <p>Which token refresh strategy should I use?</p>
            <div className="fre-terminal-cursor" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextCanvasDemo() {
  return (
    <div className="fre-demo" aria-label="Conversation opens code in Context Canvas">
      <div className="fre-demo-header">
        <span><CircleDot size={12} aria-hidden="true" /> Live Session</span>
        <span>Context Canvas</span>
      </div>
      <div className="fre-demo-body">
        <div className="fre-terminal">
          <div className="fre-pane-label">
            <Terminal size={13} aria-hidden="true" />
            CLI
          </div>
          <div className="fre-prompt">
            <span>›</span>
            <p>Show me where authentication tokens are validated.</p>
          </div>
          <div className="fre-agent-answer">
            <span className="fre-agent-dot" aria-hidden="true" />
            <p>
              Validation happens in <strong>src/auth/token.ts</strong>.
              I opened the relevant range.
            </p>
          </div>
          <div className="fre-tool-row">
            <span><Search size={12} aria-hidden="true" /> Streamed search</span>
            <span><Pin size={12} aria-hidden="true" /> Pin preview</span>
          </div>
        </div>

        <div className="fre-signal" aria-hidden="true">
          <span />
          <ArrowRight size={14} />
        </div>

        <div className="fre-code">
          <div className="fre-pane-label">
            <FileCode2 size={13} aria-hidden="true" />
            token.ts · lines 48–61
          </div>
          <pre aria-label="Example code preview"><code>
            <span className="fre-ln">48</span><span className="fre-key">export async function</span> validateToken(token) {'{'}{'\n'}
            <span className="fre-ln">49</span>  <span className="fre-key">const</span> payload = <span className="fre-key">await</span> verify(token);{'\n'}
            <span className="fre-ln">50</span>  <span className="fre-key">if</span> (!payload.expiresAt) {'{'}{'\n'}
            <span className="fre-ln">51</span>    <span className="fre-key">throw new</span> AuthError(<span className="fre-str">'Invalid token'</span>);{'\n'}
            <span className="fre-ln">52</span>  {'}'}{'\n'}
            <span className="fre-ln">53</span>  <span className="fre-key">return</span> payload;{'\n'}
            <span className="fre-ln">54</span>{'}'}
          </code></pre>
          <div className="fre-code-footer">
            <span>Read-only preview</span>
            <span>Terminal focus preserved</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkdownDemo() {
  return (
    <div className="fre-demo fre-demo--markdown" aria-label="Automatic rendered Markdown design preview">
      <div className="fre-demo-header">
        <span><BookOpenText size={12} aria-hidden="true" /> Design Document Updated</span>
        <span>docs/design/auth-flow.md</span>
      </div>
      <div className="fre-markdown-body">
        <div className="fre-markdown-event">
          <div className="fre-pane-label">
            <Terminal size={13} aria-hidden="true" />
            Live CLI
          </div>
          <div className="fre-doc-event">
            <span className="fre-agent-dot" aria-hidden="true" />
            <div>
              <strong>Created auth-flow.md</strong>
              <p>I documented the token refresh design and rollout plan.</p>
            </div>
          </div>
          <div className="fre-doc-route" aria-hidden="true">
            <span />
            <ArrowRight size={14} />
          </div>
          <div className="fre-doc-status">
            <span><BookOpenText size={12} aria-hidden="true" /> Auto-preview</span>
            <span><Pin size={12} aria-hidden="true" /> Queue if protected</span>
          </div>
        </div>

        <div className="fre-document-preview">
          <div className="fre-document-toolbar">
            <span><FileText size={12} aria-hidden="true" /> auth-flow.md</span>
            <div className="fre-document-toggle" aria-label="Document view options">
              <span className="fre-document-toggle--active">
                <BookOpenText size={11} aria-hidden="true" /> Preview
              </span>
              <span><Code2 size={11} aria-hidden="true" /> Source</span>
            </div>
          </div>
          <article className="fre-document-page">
            <span className="fre-doc-kicker">Architecture decision</span>
            <h2>Token refresh flow</h2>
            <p>Rotate refresh tokens once, preserve the existing error contract, and ship behind a compatibility gate.</p>
            <h3>Implementation</h3>
            <div className="fre-doc-check"><span aria-hidden="true">✓</span> Validate the current refresh token</div>
            <div className="fre-doc-check"><span aria-hidden="true">✓</span> Issue a new token pair atomically</div>
            <div className="fre-doc-check"><span aria-hidden="true">✓</span> Revoke the previous token after success</div>
            <pre><code>POST /auth/refresh{'\n'}→ 200 {'{'} accessToken, refreshToken {'}'}</code></pre>
            <div className="fre-doc-safe">
              <ShieldCheck size={12} aria-hidden="true" />
              Sanitized preview · repository links stay root-scoped
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

function ReviewDemo() {
  return (
    <div className="fre-demo fre-demo--review" aria-label="Session-attributed diff and review feedback">
      <div className="fre-demo-header">
        <span><GitCompareArrows size={12} aria-hidden="true" /> This Session</span>
        <span>3 Files · +84 −19</span>
      </div>
      <div className="fre-review-body">
        <div className="fre-file-list">
          <span className="fre-pane-label">Changed Files</span>
          <div className="fre-file fre-file--active">
            <span>M</span><strong>token.ts</strong><em>+32 −8</em>
          </div>
          <div className="fre-file">
            <span>M</span><strong>refresh.ts</strong><em>+41 −11</em>
          </div>
          <div className="fre-file">
            <span>N</span><strong>token.test.ts</strong><em>+11</em>
          </div>
        </div>
        <div className="fre-diff-preview">
          <div className="fre-pane-label">token.ts · Session Diff</div>
          <pre><code>
            <span className="fre-diff-old"><b>−</b> throw new Error('invalid');</span>{'\n'}
            <span className="fre-diff-new"><b>+</b> throw new AuthError('expired token');</span>{'\n'}
            <span className="fre-diff-new"><b>+</b> telemetry.track('token_expired');</span>
          </code></pre>
          <div className="fre-comment">
            <MessageSquareText size={13} aria-hidden="true" />
            <div>
              <strong>Review comment · line 51</strong>
              <p>Keep the existing expired-state error code for compatibility.</p>
            </div>
          </div>
          <div className="fre-review-actions">
            <span>Discuss with session</span>
            <span>Ask session to fix</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TourDemo({ page }: { page: number }) {
  if (page === 0) return <MissionControlDemo />;
  if (page === 1) return <ContextCanvasDemo />;
  if (page === 2) return <MarkdownDemo />;
  return <ReviewDemo />;
}

export default function FirstRunIntro({
  onComplete,
  variant = 'welcome',
  initialPage = 0,
  releaseTitle,
}: FirstRunIntroProps) {
  const [page, setPage] = useState(() => Math.max(0, Math.min(TOUR_PAGES.length - 1, initialPage)));
  const current = TOUR_PAGES[page];
  const isLast = page === TOUR_PAGES.length - 1;
  const isReleaseBriefing = variant === 'release';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onComplete();
      if (event.key === 'ArrowRight') setPage(value => Math.min(TOUR_PAGES.length - 1, value + 1));
      if (event.key === 'ArrowLeft') setPage(value => Math.max(0, value - 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onComplete]);

  return (
    <div className="fre-shell" role="dialog" aria-modal="true" aria-labelledby="fre-title">
      <header className="fre-nav">
        <div className="fre-brand">
          <span className="fre-brand-mark" aria-hidden="true">AM</span>
          <span>AgentMatrix</span>
          {isReleaseBriefing ? (
            <span className="fre-release-tag">Release briefing · {releaseTitle}</span>
          ) : null}
        </div>
        <div className="fre-nav-end">
          <span className="fre-page-count">{page + 1} / {TOUR_PAGES.length}</span>
          <button type="button" className="fre-skip" onClick={onComplete}>
            {isReleaseBriefing ? 'Skip Briefing' : 'Skip Tour'}
          </button>
        </div>
      </header>

      <main className="fre-main">
        <section className="fre-hero" aria-live="polite">
          <div className="fre-copy">
            <span className="fre-eyebrow">{current.eyebrow}</span>
            <h1 id="fre-title">
              {current.title}
              <span>{current.accent}</span>
            </h1>
            <p>{current.body}</p>

            <div className="fre-controls">
              <button
                type="button"
                className="fre-back"
                onClick={() => setPage(value => Math.max(0, value - 1))}
                disabled={page === 0}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                className="fre-primary"
                onClick={() => {
                  if (isLast) onComplete();
                  else setPage(value => value + 1);
                }}
              >
                {isLast
                  ? isReleaseBriefing ? 'Return to Control Center' : 'Enter Control Center'
                  : 'Continue'}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="fre-dots" aria-label="Tour pages">
              {TOUR_PAGES.map((tourPage, index) => (
                <button
                  key={tourPage.eyebrow}
                  type="button"
                  className={`fre-dot ${page === index ? 'fre-dot--active' : ''}`}
                  onClick={() => setPage(index)}
                  aria-label={`Open tour page ${index + 1}: ${tourPage.title}`}
                  aria-current={page === index ? 'step' : undefined}
                />
              ))}
            </div>

            <span className="fre-replay-note">
              {isReleaseBriefing
                ? 'Use ← and → to navigate. This release briefing appears once.'
                : 'Use ← and → to navigate. Replay anytime from Settings.'}
            </span>
          </div>

          <TourDemo page={page} />
        </section>

        <section className="fre-capabilities" aria-label={`${current.title} details`}>
          {current.features.map(feature => (
            <article key={feature.number} className="fre-capability">
              <span>{feature.number}</span>
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
