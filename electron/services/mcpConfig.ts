import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ServerOptions {
  eagerTools?: boolean;
}

function agentMatrixServerPath(): string {
  return join(resolve(__dirname, '..', '..'), 'mcp-server', 'index.mjs');
}

function serverDefinition(
  port: number,
  serverPath: string,
  options: ServerOptions = {},
): Record<string, unknown> {
  return {
    ...(options.eagerTools
      ? {
          type: 'stdio',
          deferTools: 'never',
          tools: ['*'],
        }
      : {}),
    // Packaged Electron apps cannot assume an external `node` binary. The
    // Electron executable can run this stdio server as Node when requested.
    command: process.versions.electron ? process.execPath : 'node',
    args: [serverPath],
    env: {
      AGENTMATRIX_PORT: String(port),
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  };
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

function configureServer(
  configPath: string,
  port: number,
  serverPath: string,
  options: ServerOptions = {},
): boolean {
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
      agentmatrix: serverDefinition(port, serverPath, options),
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

function removeServer(configPath: string, serverName: string): boolean {
  const current = readConfig(configPath);
  if (!current) {
    console.warn(`[mcp-config] did not modify invalid JSON config at ${configPath}`);
    return false;
  }
  const mcpServers = current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers)
    ? current.mcpServers as Record<string, unknown>
    : {};
  if (!(serverName in mcpServers)) return false;

  const nextServers = { ...mcpServers };
  delete nextServers[serverName];
  const next: McpConfig = { ...current, mcpServers: nextServers };
  const serialized = JSON.stringify(next, null, 2) + '\n';
  try {
    writeFileSync(configPath, serialized, 'utf8');
    return true;
  } catch (error) {
    console.error(`[mcp-config] failed to write ${configPath}:`, error);
    return false;
  }
}

/**
 * Copilot receives AgentMatrix as a per-process additional config. This keeps
 * the server exclusive to managed sessions and avoids Agency rewriting the
 * user-level definition before Copilot sees its eager-tool setting.
 */
export function buildAgentMatrixCopilotMcpConfig(port: number): string {
  return JSON.stringify({
    mcpServers: {
      agentmatrix: serverDefinition(port, agentMatrixServerPath(), { eagerTools: true }),
    },
  });
}

/**
 * Claude discovers MCP servers only from persistent configuration, so keep its
 * inheriting definition installed. Copilot is injected per managed process;
 * remove the legacy global entry so unmanaged Copilot sessions do not expose a
 * server that lacks AgentMatrix session credentials.
 */
export function ensureAgentMatrixMcpConfig(port: number): void {
  const configured = [
    configureServer(join(homedir(), '.claude.json'), port, agentMatrixServerPath()),
    removeServer(join(homedir(), '.copilot', 'mcp-config.json'), 'agentmatrix'),
  ];
  if (configured.some(Boolean)) console.log('[mcp-config] AgentMatrix MCP configuration refreshed');
}
