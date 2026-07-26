import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readConfig(configPath: string): McpConfig | null {
  if (!existsSync(configPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as McpConfig;
  } catch {
    return null;
  }
}

function configureServer(configPath: string, port: number, serverPath: string): boolean {
  const current = readConfig(configPath);
  if (!current) {
    console.warn(`[mcp-config] did not modify invalid JSON config at ${configPath}`);
    return false;
  }
  const mcpServers = current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers)
    ? current.mcpServers as Record<string, unknown>
    : {};
  const next: McpConfig = {
    ...current,
    mcpServers: {
      ...mcpServers,
      // Session identity and capability deliberately are not written here. Each
      // managed PTY injects them into its child environment at spawn time.
      agentmatrix: {
        // Packaged Electron apps cannot assume an external `node` binary. The
        // Electron executable can run this stdio server as Node when requested.
        command: process.versions.electron ? process.execPath : 'node',
        args: [serverPath],
        env: {
          AGENTMATRIX_PORT: String(port),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      },
    },
  };
  const serialized = JSON.stringify(next, null, 2) + '\n';
  try {
    if (existsSync(configPath) && readFileSync(configPath, 'utf8') === serialized) return false;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, serialized, 'utf8');
    return true;
  } catch (error) {
    console.error(`[mcp-config] failed to write ${configPath}:`, error);
    return false;
  }
}

/**
 * Installs an inheriting stdio MCP definition for both supported CLIs without
 * replacing unrelated user server definitions. Session credentials stay only in
 * the spawned CLI environment, not in these persistent config files.
 */
export function ensureAgentMatrixMcpConfig(port: number): void {
  const appRoot = resolve(__dirname, '..', '..');
  const serverPath = join(appRoot, 'mcp-server', 'index.mjs');
  const configured = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.copilot', 'mcp-config.json'),
  ].map(configPath => configureServer(configPath, port, serverPath));
  if (configured.some(Boolean)) console.log('[mcp-config] AgentMatrix MCP server configured');
}
