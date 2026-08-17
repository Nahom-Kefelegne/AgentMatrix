# Context Canvas Markdown Preview

Status: **Implemented**

## 1. Purpose

Context Canvas renders repository Markdown as a document artifact instead of
forcing developers to read design docs as source. The terminal remains the
primary workspace; Markdown preview is session-scoped supporting evidence.

Primary flow:

```text
Session creates/updates docs/design/*.md
  -> successful file-change hook emits validated path metadata
  -> selected session debounces the change
  -> Context Canvas previews the rendered document without taking focus
  -> pinned, background, or developer-owned Canvas content queues the request
```

Manual `open_file`, terminal links, navigation history, and repository links use
the same document mode.

## 2. Product Rules

1. `.md` and `.markdown` targets render in Preview mode by default.
2. Source mode reuses the existing lazy Monaco `CodePreview`.
3. Automatic previews are limited to `docs/design/*.md`.
4. Automatic requests never switch the selected session or focus Canvas.
5. Pinned content is never replaced.
6. Developer-, terminal-link-, and MCP-opened artifacts have higher replacement
   priority than automatic file events.
7. Updating the currently visible document refreshes it in place without adding
   navigation history.
8. Rapid changes coalesce for 800 ms so a turn surfaces one coherent document,
   not every intermediate write.
9. Background-session changes queue in that session.
10. Large documents over 512 KB require an explicit **Render Anyway** action.

## 3. Component Contract

### Canvas mode

`CanvasMode` includes:

```ts
type CanvasMode =
  | 'closed'
  | 'code'
  | 'document'
  | 'search'
  | 'diff'
  | 'review';
```

`useContextCanvas.modeForRequest()` selects `document` for Markdown file targets.
History continues to store the original `NavigationRequest`, so Preview/Source
is presentation state rather than a new navigation entry.

### MarkdownPreview

`MarkdownPreview` receives:

```ts
interface MarkdownPreviewProps {
  request: NavigationRequest;
  controller: ContextCanvasController;
}
```

It:

- Reads through shared `useNavigationFile`.
- Dynamically loads with the Context Canvas document chunk.
- Renders with `react-markdown`, `remark-gfm`, and `rehype-sanitize`.
- Offers Preview/Source without mounting Monaco until Source is selected.
- Resolves internal links through the root-scoped NavigationService.
- Blocks images in the initial release.
- Preserves the terminal’s keyboard focus.

### Shared file state

`useNavigationFile` owns:

- Session/path cache keys.
- 30-second bounded LRU caching.
- Abortable reads.
- Loading/error/retry state.
- Path-specific invalidation from `session:files-changed`.

Both code and Markdown views use this hook, preventing duplicate file-fetch
implementations.

## 4. File-Change Event Contract

The backward-compatible socket event is:

```ts
interface SessionFilesChangedEvent {
  sessionId: string;
  completedAt: number;
  changes?: SessionFileChange[];
}

interface SessionFileChange {
  path: string;
  op: 'create' | 'update' | 'delete' | 'unknown';
  detectedBy: 'hook' | 'transcript' | 'watcher';
  toolName?: string;
  toolCallRef?: string;
}
```

`changes` remains optional so older session-level invalidation listeners continue
to work.

For successful Write/Edit/Create/MultiEdit/apply_patch calls:

1. Tool arguments are accepted in Claude snake_case or Copilot camelCase shape.
2. `apply_patch` paths are parsed from the patch envelope.
3. Absolute or cwd-relative paths are converted to repository-relative POSIX.
4. NavigationService canonicalizes the path and verifies it remains under the
   registered session root.
5. PascalCase `Edit` hooks are inspected for an `apply_patch` envelope before
   relying on the compatible tool name.
6. Rename patches emit the deleted source and updated destination.
7. Deleted paths receive lexical root validation even though the target no
   longer exists.
8. If any extracted path cannot be validated, `changes` is omitted so clients
   perform broad invalidation rather than trust a partial list.
9. The event is emitted after the change service cache is invalidated.

Bash-generated files remain a future observation path. Agents can still
explicitly call `open_file` for those documents.

## 5. Automatic Preview Priority

Automatic requests use:

```ts
{
  source: 'session_event',
  action: 'open_file',
  presentation: { disposition: 'preview', focus: 'preserve' },
  intent: {
    kind: 'agent_progress',
    summary: 'Created/Updated design document ...'
  }
}
```

Disposition is decided by the existing Canvas controller:

| State | Result |
|---|---|
| Selected session, Canvas closed | Preview |
| Selected session, previous automatic preview | Replace after debounce |
| Same visible Markdown path | Refresh in place |
| Developer/MCP/terminal-link artifact visible | Queue |
| Canvas pinned | Queue |
| Background session | Queue in that session; reveal the oldest request when selected |

Queued automatic requests deduplicate by session and path.

## 6. Markdown Security

Repository Markdown is treated as untrusted content.

- Raw HTML is disabled with `skipHtml`.
- `rehype-sanitize` runs with an explicit GFM-compatible schema.
- Script, iframe, object, form, SVG, MathML, style, event attributes, `file:`,
  `data:`, `javascript:`, protocol-relative, and unknown URL schemes are blocked.
- External links are limited to HTTP(S), open through the Electron window policy,
  and use `noopener noreferrer`.
- Internal links are resolved relative to the containing document, then
  canonicalized and root-validated server-side.
- Parent references are allowed only during relative resolution; the final
  canonical target must remain inside the session repository.
- Images are replaced with a noninteractive placeholder. A validated raster asset
  route is intentionally deferred.
- Code blocks render as escaped text and are never executed.
- Mermaid is treated as an ordinary code block.

The renderer never gains filesystem, Git, shell, or write access.

## 7. Relative Link Contract

`POST /api/navigation/resolve-document-link` accepts:

```ts
{
  sessionId: string;
  documentPath: string;
  raw: string;
}
```

It returns one of:

```ts
{ kind: 'fragment'; fragment: string }
{ kind: 'external'; url: string }
{ kind: 'target'; path: string; fragment?: string; repoRef: string }
```

The route requires the trusted Electron renderer token. Repository targets open
through `ContextCanvasController.openFile`, so linked Markdown remains rendered
and linked source files use Monaco.

`NavigationTarget.fragment` carries an optional Markdown heading fragment through
history and document navigation.

## 8. Performance and RDP

- The Markdown parser stack is a dynamic Canvas chunk.
- Monaco stays out of the rendered-document path.
- Parsing occurs only when file content changes.
- The preview uses static CSS and no ambient animation.
- File reads remain bounded by the existing 2 MB navigation limit.
- Automatic rendering requires confirmation above 512 KB.
- Code blocks use plain escaped text; syntax-highlighting bundles are deferred.
- Relative images and Mermaid are deferred to avoid network, decode, and layout
  costs over remote desktop.

## 9. Current Limitations

- Bash-generated Markdown is not automatically attributed.
- Images are not rendered.
- Mermaid and math are not rendered.
- Cross-document heading fragments open the target document and then scroll when
  the matching heading is available.
- Duplicate Markdown headings share the same generated fragment ID.
- Auto-preview preferences are not yet exposed; the current policy is fixed to
  selected-session `docs/design/*.md`.

## 10. Future Extensions

1. Preference: Off / Queue / Auto design docs / Auto all Markdown.
2. Validated raster asset endpoint with ETags and byte/dimension limits.
3. Turn-level transcript reconciliation for multi-file changes.
4. Narrow file observation for Bash-generated Markdown.
5. Sandboxed, lazy Mermaid rendering:
   - detect fenced code blocks whose language is `mermaid`
   - keep the original source available through Preview/Source
   - dynamically import Mermaid only when a document contains a diagram
   - use strict security mode with no HTML labels, click handlers, external
     links, scripts, or runtime configuration from document content
   - render into an isolated, noninteractive container after sanitizing the
     generated SVG
   - show a bounded error state with **View source** when parsing fails
   - cap diagram source length, node/edge count, generated SVG size, and render
     time before falling back to source
   - use static rendering only; no continuous layout animation
   - re-render on theme change and document content change
   - never fetch remote resources
6. Optional wide-screen Preview/Source split.
7. Explicit MCP `open_document` with `rendered | source | split` intent.
