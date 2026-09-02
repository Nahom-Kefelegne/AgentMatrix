#!/usr/bin/env node

/**
 * AgentMatrix MCP server.
 *
 * The managed CLI process supplies session identity and a one-time capability
 * through its environment. Tool inputs never contain a session identifier, and
 * this server never returns repository content to the model.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AGENTMATRIX_MCP_INSTRUCTIONS } from './instructions.mjs';

const port = process.env.AGENTMATRIX_PORT || '3000';
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = process.env.AGENTMATRIX_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
const capability = process.env.AGENTMATRIX_NAVIGATION_CAPABILITY || '';

const server = new Server(
  { name: 'agentmatrix', version: '1.6.0' },
  {
    capabilities: { tools: {} },
    instructions: AGENTMATRIX_MCP_INSTRUCTIONS,
  },
);

const rangeProperties = {
  startLine: { type: 'integer', minimum: 1, description: '1-based start line.' },
  startColumn: { type: 'integer', minimum: 1, description: '1-based start column.' },
  endLine: { type: 'integer', minimum: 1, description: '1-based exclusive end line.' },
  endColumn: { type: 'integer', minimum: 1, description: '1-based exclusive end column. Required when endLine equals startLine.' },
};

const locationProperties = {
  path: {
    type: 'string',
    maxLength: 1024,
    description: 'Verified repository-relative POSIX path.',
  },
  line: { type: 'integer', minimum: 1, description: '1-based line.' },
  column: { type: 'integer', minimum: 1, description: 'Optional 1-based column.' },
  endLine: { type: 'integer', minimum: 1, description: 'Optional 1-based exclusive end line.' },
  endColumn: { type: 'integer', minimum: 1, description: 'Optional 1-based exclusive end column. Required when endLine equals line; otherwise defaults to column 1.' },
  label: {
    type: 'string',
    maxLength: 300,
    description: 'Short explanation of why this location matters.',
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'request_attention',
      description: 'Notify AgentMatrix that this managed session needs user input.',
      inputSchema: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 1000 } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
    {
      name: 'work_complete',
      description: 'Notify AgentMatrix that this managed session has completed its work.',
      inputSchema: {
        type: 'object',
        properties: { summary: { type: 'string', maxLength: 1000 } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_code',
      description: 'Present an exact repository file or range when seeing it materially helps the user understand the result. Markdown renders as a document. Do not use for routine internal exploration or duplicate an automatic design-doc preview.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            maxLength: 1024,
            description: 'Repository-relative POSIX path. Absolute paths and parent traversal are forbidden.',
          },
          ...rangeProperties,
          title: { type: 'string', maxLength: 200 },
          summary: {
            type: 'string',
            maxLength: 1000,
            description: 'Why this code or document is useful to the user now.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_locations',
      description: 'Present several verified repository locations when the user benefits from comparing callers, implementations, references, or candidates. Supply exact locations already discovered; do not guess or use this as an internal search tool.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          summary: {
            type: 'string',
            maxLength: 1000,
            description: 'What connects these locations and why they matter.',
          },
          locations: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              properties: locationProperties,
              required: ['path', 'line'],
              additionalProperties: false,
            },
          },
        },
        required: ['locations'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_changes',
      description: 'Present a coherent change set for review. Use scope "selection" with exact verified files when the session knows what the user should review; AgentMatrix captures authoritative frozen diffs from the session worktree. Use at milestones, not after every edit.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['session', 'selection'],
            description: 'Use "selection" for exact session-selected files, or "session" for legacy transcript-attributed changes.',
          },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            description: 'Exact verified files to review. Required only with scope "selection".',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  maxLength: 1024,
                  description: 'Repository-relative POSIX path. Absolute paths, backslashes, drive letters, and parent traversal are forbidden.',
                },
                reason: {
                  type: 'string',
                  maxLength: 300,
                  description: 'Why this file belongs in the review set.',
                },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
          baseRef: {
            type: 'string',
            maxLength: 200,
            description: 'Optional Git commit-ish to compare against in selection mode. AgentMatrix resolves it to a commit before use.',
          },
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 1000 },
        },
        required: ['scope'],
        additionalProperties: false,
      },
    },
    {
      name: 'request_decision',
      description: 'Request a structured user decision only when human judgment genuinely blocks progress. After calling, provide one concise text fallback and stop until the user responds. Use request_attention instead for questions that cannot be expressed as choices.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', maxLength: 1000 },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', maxLength: 100 },
                label: { type: 'string', maxLength: 300 },
                description: { type: 'string', maxLength: 1000 },
              },
              required: ['id', 'label'],
              additionalProperties: false,
            },
          },
          allowCustom: { type: 'boolean', description: 'Allow a freeform user response. Defaults to true.' },
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 1000 },
        },
        required: ['question', 'options'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_validation',
      description: 'Present test, build, lint, or check results only after the validation actually ran. Never infer, predict, or fabricate a result. Include only the failures that help the user act.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          status: { type: 'string', enum: ['passed', 'failed', 'warning'] },
          summary: { type: 'string', maxLength: 1000 },
          command: { type: 'string', maxLength: 2000 },
          failures: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', maxLength: 1000 },
                path: { type: 'string', maxLength: 1024 },
                line: { type: 'integer', minimum: 1 },
                column: { type: 'integer', minimum: 1 },
              },
              required: ['label'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'status', 'summary'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_plan',
      description: 'Create or replace the retained session plan when the work enters a meaningful new phase. Do not update it for every tool call or trivial step.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 1000 },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', maxLength: 100 },
                label: { type: 'string', maxLength: 500 },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'done', 'blocked'],
                },
                summary: {
                  type: 'string',
                  maxLength: 1000,
                  description: 'Optional concise context for this step, such as completed work, current intent, or a blocker.',
                },
              },
              required: ['id', 'label', 'status'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_runtime_evidence',
      description: 'Present concise observed runtime evidence—logs, errors, or requests—when it proves or disproves a user-relevant hypothesis. Never include secrets or speculative evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 1000 },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['log', 'error', 'request'] },
                label: { type: 'string', maxLength: 300 },
                text: { type: 'string', maxLength: 8000 },
                path: { type: 'string', maxLength: 1024 },
                line: { type: 'integer', minimum: 1 },
                column: { type: 'integer', minimum: 1 },
              },
              required: ['kind', 'label', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'summary', 'evidence'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_browser_preview',
      description: 'Request a preview of a known running local web application when visual inspection would help the user. The initial contract accepts credential-free loopback HTTP(S) URLs only; never guess that a server is running.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', maxLength: 2048 },
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 1000 },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
    // Compatibility tools. New sessions should prefer the present_*/request_*
    // tools above; these stay available until their callers are migrated.
    {
      name: 'open_file',
      description: 'Ask AgentMatrix Canvas to open a repository-relative POSIX file path. Markdown renders as a document with Source available. Returns UI status only.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative POSIX path. Absolute paths and .. are forbidden.' },
          ...rangeProperties,
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'reveal_range',
      description: 'Ask AgentMatrix Canvas to reveal a range in a repository-relative POSIX file. Returns UI status only.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative POSIX path.' },
          ...rangeProperties,
        },
        required: ['path', 'startLine'],
        additionalProperties: false,
      },
    },
    {
      name: 'open_diff',
      description: 'Ask AgentMatrix Canvas to open a diff view. Does not return diff content.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['session'], description: 'Session-attributed transcript diff.' },
          baseRef: { type: 'string', maxLength: 512 },
          compareRef: { type: 'string', maxLength: 512 },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    {
      name: 'open_review',
      description: 'Ask AgentMatrix Canvas to open review for an optional repository-relative POSIX file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional repository-relative POSIX path.' },
          ...rangeProperties,
        },
        additionalProperties: false,
      },
    },
  ],
}));

function result(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function rangeFrom(args) {
  if (!args.startLine) return undefined;
  return {
    start: { line: args.startLine, column: args.startColumn },
    end: args.endLine ? { line: args.endLine, column: args.endColumn } : undefined,
  };
}

async function post(path, body) {
  if (!sessionId || !capability) {
    throw new Error('This MCP server was not started by a managed AgentMatrix session.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agentmatrix-session-id': sessionId,
        'x-agentmatrix-capability': capability,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || `AgentMatrix returned HTTP ${response.status}.`;
      throw new Error(String(message));
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestNavigation(action, args) {
  const target = args.path
    ? { path: args.path, range: rangeFrom(args) }
    : undefined;
  const diff = action === 'open_diff'
    ? { source: args.source, baseRef: args.baseRef, compareRef: args.compareRef }
    : undefined;
  const payload = await post('/api/navigation/request', {
    action,
    target,
    diff,
    // The selected session may reveal context, but never take keyboard focus.
    // Pinned Canvas content is protected client-side and converts this to a queue.
    presentation: { disposition: 'preview', focus: 'preserve' },
    summary: `Agent requested ${action.replace(/_/g, ' ')}`,
  });
  const requestRef = payload?.request?.requestRef;
  const status = payload?.result?.status || 'queued';
  return result(`AgentMatrix navigation ${status}${requestRef ? ` (request ${requestRef})` : ''}.`);
}

async function requestCanvas(kind, args) {
  const payload = await post('/api/canvas/request', { kind, args });
  const requestRef = payload?.result?.requestRef;
  const delivery = payload?.result?.delivery || 'event_only';
  if (kind === 'decision') {
    return result(
      `AgentMatrix accepted the decision request${requestRef ? ` (${requestRef})` : ''}. `
      + 'Provide one concise text fallback for the decision, then stop and wait for the user.',
    );
  }
  if (delivery === 'canvas_renderer') {
    return result(
      `AgentMatrix queued ${kind.replace(/_/g, ' ')} for the session Canvas`
      + `${requestRef ? ` (${requestRef})` : ''}. Include a concise text fallback in your response.`,
    );
  }
  return result(
    `AgentMatrix accepted the typed ${kind.replace(/_/g, ' ')} request`
    + `${requestRef ? ` (${requestRef})` : ''}. The dedicated renderer may not be connected yet; `
    + 'include a concise text fallback in your response.',
  );
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === 'request_attention' || name === 'work_complete') {
      const payload = await post('/api/hooks/mcp-status', {
        tool: name,
        reason: args.reason,
        summary: args.summary,
      });
      return result(name === 'request_attention'
        ? 'AgentMatrix notified the user that this session needs attention.'
        : 'AgentMatrix recorded that this session is complete.');
    }
    if (['open_file', 'reveal_range', 'open_diff', 'open_review'].includes(name)) {
      return await requestNavigation(name, args);
    }
    const canvasTools = {
      present_code: 'code',
      present_locations: 'locations',
      present_changes: 'changes',
      request_decision: 'decision',
      present_validation: 'validation',
      update_plan: 'plan',
      present_runtime_evidence: 'runtime_evidence',
      present_browser_preview: 'browser_preview',
    };
    if (name in canvasTools) {
      return await requestCanvas(canvasTools[name], args);
    }
    return result(`Unknown AgentMatrix tool: ${name}`, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to contact AgentMatrix.';
    return result(`AgentMatrix request failed: ${message}`, true);
  }
});

await server.connect(new StdioServerTransport());
