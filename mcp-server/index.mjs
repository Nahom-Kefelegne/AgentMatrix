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

const port = process.env.AGENTMATRIX_PORT || '3000';
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = process.env.AGENTMATRIX_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
const capability = process.env.AGENTMATRIX_NAVIGATION_CAPABILITY || '';

const server = new Server(
  { name: 'agentmatrix', version: '1.1.0' },
  { capabilities: { tools: {} } },
);

const rangeProperties = {
  startLine: { type: 'integer', minimum: 1, description: '1-based start line.' },
  startColumn: { type: 'integer', minimum: 1, description: '1-based start column.' },
  endLine: { type: 'integer', minimum: 1, description: '1-based exclusive end line.' },
  endColumn: { type: 'integer', minimum: 1, description: '1-based end column.' },
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
      name: 'open_file',
      description: 'Ask AgentMatrix Canvas to open a repository-relative POSIX file path. Returns UI status only.',
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
      name: 'open_symbol',
      description: 'Ask AgentMatrix Canvas to navigate to a symbol, optionally constrained to a repository-relative POSIX path.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', maxLength: 512 },
          path: { type: 'string', description: 'Optional repository-relative POSIX path.' },
          symbolKind: { type: 'string', maxLength: 100 },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
    {
      name: 'show_search_results',
      description: 'Ask AgentMatrix Canvas to show search results for a query. Returns UI status only.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 512 },
          mode: { type: 'string', enum: ['content', 'symbol'] },
        },
        required: ['query'],
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
  const effectiveAction = action === 'show_search_results' && args.mode === 'symbol'
    ? 'open_symbol'
    : action;
  const target = args.path
    ? { path: args.path, range: rangeFrom(args), symbol: args.symbol }
    : undefined;
  const diff = action === 'open_diff'
    ? { source: args.source, baseRef: args.baseRef, compareRef: args.compareRef }
    : undefined;
  const payload = await post('/api/navigation/request', {
    action: effectiveAction,
    target,
    query: effectiveAction === 'open_symbol'
      ? (args.symbol || args.query)
      : effectiveAction === 'show_search_results'
        ? args.query
        : undefined,
    symbolKind: args.symbolKind,
    diff,
    // The selected session may reveal context, but never take keyboard focus.
    // Pinned Canvas content is protected client-side and converts this to a queue.
    presentation: { disposition: 'preview', focus: 'preserve' },
    summary: `Agent requested ${effectiveAction.replace(/_/g, ' ')}`,
  });
  const requestRef = payload?.request?.requestRef;
  const status = payload?.result?.status || 'queued';
  return result(`AgentMatrix navigation ${status}${requestRef ? ` (request ${requestRef})` : ''}.`);
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
    if (['open_file', 'reveal_range', 'open_symbol', 'show_search_results', 'open_diff', 'open_review'].includes(name)) {
      return await requestNavigation(name, args);
    }
    return result(`Unknown AgentMatrix tool: ${name}`, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to contact AgentMatrix.';
    return result(`AgentMatrix request failed: ${message}`, true);
  }
});

await server.connect(new StdioServerTransport());
