#!/usr/bin/env node

/**
 * AgentMatrix MCP Server
 *
 * Exposes tools that Claude sessions call to signal status changes:
 *   - request_attention: session needs user input (question, decision, approval)
 *   - work_complete: session finished its assigned task
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const AGENTMATRIX_PORT = process.env.AGENTMATRIX_PORT || '3000';
const BASE_URL = `http://localhost:${AGENTMATRIX_PORT}`;

const server = new Server(
  { name: 'agentmatrix', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'request_attention',
      description:
        'Call this when you need the user to answer a question, make a decision, provide approval, or give input before you can continue. This notifies the user in Agent Matrix that this session requires their attention.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief description of what you need from the user (e.g. "Need approval to delete files", "Question about database schema")',
          },
        },
        required: ['reason'],
      },
    },
    {
      name: 'work_complete',
      description:
        'Call this when you have finished the task or work that the user assigned to you. This notifies the user in Agent Matrix that your work is done and ready for review.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was accomplished (e.g. "Implemented login page with OAuth", "Fixed the memory leak in worker thread")',
          },
        },
        required: ['summary'],
      },
    },
  ],
}));

// ── Tool execution ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Extract session ID from environment — Claude sets this when spawned with --session-id
  const sessionId = process.env.CLAUDE_SESSION_ID || null;

  try {
    const res = await fetch(`${BASE_URL}/api/hooks/mcp-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: name,
        sessionId,
        reason: args?.reason || undefined,
        summary: args?.summary || undefined,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { content: [{ type: 'text', text: `Agent Matrix notification failed: ${text}` }] };
    }

    if (name === 'request_attention') {
      return {
        content: [{ type: 'text', text: 'User has been notified that you need their attention. Wait for their response.' }],
      };
    }

    if (name === 'work_complete') {
      return {
        content: [{ type: 'text', text: 'User has been notified that your work is complete.' }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to notify Agent Matrix: ${err.message}. The app may not be running.` }],
    };
  }
});

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
