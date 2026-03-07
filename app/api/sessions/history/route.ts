import { NextResponse } from 'next/server';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function findTranscriptPath(sessionId: string): string | undefined {
  try {
    const output = execSync(
      `find "${CLAUDE_PROJECTS_DIR}" -name "${sessionId}.jsonl" -type f 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    return output.split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const count = parseInt(searchParams.get('count') || '6', 10);

    if (!sessionId) {
      return NextResponse.json({ messages: [] });
    }

    const transcriptPath = findTranscriptPath(sessionId);
    if (!transcriptPath) {
      return NextResponse.json({ messages: [] });
    }

    // Read last 200KB of transcript to find recent messages
    const stat = statSync(transcriptPath);
    const readSize = Math.min(200_000, stat.size);
    const offset = Math.max(0, stat.size - readSize);
    const buffer = Buffer.alloc(readSize);
    const fd = openSync(transcriptPath, 'r');
    readSync(fd, buffer, 0, readSize, offset);
    closeSync(fd);

    const content = buffer.toString('utf-8');
    const lines = content.split('\n').filter(Boolean);

    const messages: HistoryMessage[] = [];

    // Parse from end, collect user/assistant messages
    for (let i = lines.length - 1; i >= 0 && messages.length < count * 2; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'user' && entry.message?.role === 'user') {
          const textBlocks = entry.message.content?.filter?.(
            (b: { type: string }) => b.type === 'text'
          ) || [];
          const text = textBlocks.map((b: { text: string }) => b.text).join('\n');
          if (text.trim()) {
            messages.unshift({ role: 'user', text: text.slice(0, 500), timestamp: entry.timestamp });
          }
        } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
          const textBlocks = entry.message.content?.filter?.(
            (b: { type: string }) => b.type === 'text'
          ) || [];
          const text = textBlocks.map((b: { text: string }) => b.text).join('\n');
          if (text.trim()) {
            messages.unshift({ role: 'assistant', text: text.slice(0, 1000), timestamp: entry.timestamp });
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    // Return last N messages
    return NextResponse.json({ messages: messages.slice(-count) });
  } catch (error) {
    console.error('[sessions/history]', error);
    return NextResponse.json({ messages: [] });
  }
}
