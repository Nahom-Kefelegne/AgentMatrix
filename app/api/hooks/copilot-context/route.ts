import { NextResponse } from 'next/server';
import { MCP_SYSTEM_PROMPT } from '@/lib/constants/mcpPrompt';

/**
 * Copilot SessionStart context hook. Copilot injects `additionalContext` into
 * the model-facing conversation for both new and resumed sessions.
 */
export async function POST() {
  return NextResponse.json({ additionalContext: MCP_SYSTEM_PROMPT });
}
