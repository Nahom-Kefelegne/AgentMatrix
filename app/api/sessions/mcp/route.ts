import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MCP_PATH = join(homedir(), '.claude', 'mcp_servers.json');

export async function GET() {
  try {
    if (!existsSync(MCP_PATH)) {
      return NextResponse.json({ servers: {}, path: MCP_PATH });
    }
    const content = readFileSync(MCP_PATH, 'utf-8');
    const data = JSON.parse(content);
    return NextResponse.json({ servers: data, path: MCP_PATH });
  } catch (error) {
    return NextResponse.json({ servers: {}, error: 'Failed to read MCP config' });
  }
}

export async function POST(request: Request) {
  try {
    const { servers } = await request.json();
    if (!servers) {
      return NextResponse.json({ error: 'Missing servers' }, { status: 400 });
    }
    writeFileSync(MCP_PATH, JSON.stringify(servers, null, 2));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to write MCP config' }, { status: 500 });
  }
}
