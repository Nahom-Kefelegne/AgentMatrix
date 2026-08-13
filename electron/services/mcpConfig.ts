import { execFileSync } from 'child_process';
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
 * Register AgentMatrix with Codex, which stores MCP servers in
 * `~/.codex/config.toml` under `[mcp_servers.<name>]`. We shell out to
 * `codex mcp add` rather than hand-write TOML: the CLI owns its own format,
 * the call is idempotent (re-adding replaces the entry), and it preserves the
 * rest of the user's config — none of which a blind TOML edit can guarantee.
 *
 * Best-effort: if Codex isn't installed the resolve/exec throws and we skip it,
 * exactly like the other providers are skipped when absent. Session identity and
 * capability are injected per-PTY at spawn (like Claude); only the port is
 * baked into the static config here. Codex forwards the launching process's
 * environment to stdio MCP servers, so those per-session vars reach the server.
 */
function configureCodexMcp(port: number, serverPath: string): boolean {
  let binary: string;
  try {
    const { getProvider } = require('../../lib/cli');
    binary = getProvider('codex').findBinary();
  } catch {
    return false; // Codex not installed — nothing to configure.
  }
  // Derive the launch command + env from the SAME serverDefinition every other
  // provider uses. This must NOT be a bare `node`: an app-spawned CLI child
  // cannot rely on `node` being on PATH (verified — codex reported the tools
  // absent when the MCP server was `node <path>`, because launching it failed).
  // In Electron the command is the app's own binary run as Node
  // (ELECTRON_RUN_AS_NODE=1), an absolute path that always resolves — exactly
  // what Claude and Kimi already use. `codex mcp add` takes env as repeated
  // `--env KEY=VALUE` and the command after `--`.
  const def = serverDefinition(port, serverPath);
  const command = def.command as string;
  const envPairs = Object.entries(def.env as Record<string, string>)
    .flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  try {
    execFileSync(
      binary,
      ['mcp', 'add', 'agentmatrix', ...envPairs, '--', command, serverPath],
      { stdio: ['ignore', 'ignore', 'ignore'], timeout: 15_000, windowsHide: true },
    );
    return true;
  } catch (error) {
    console.error('[mcp-config] codex mcp add failed:', error);
    return false;
  }
}

/**
 * Claude discovers MCP servers only from persistent configuration, so keep its
 * inheriting definition installed. Copilot is injected per managed process;
 * remove the legacy global entry so unmanaged Copilot sessions do not expose a
 * server that lacks AgentMatrix session credentials. Kimi reads the same
 * `mcpServers` JSON shape as Claude from `~/.kimi-code/mcp.json`. Codex uses its
 * own CLI to write TOML (see configureCodexMcp).
 */
export function ensureAgentMatrixMcpConfig(port: number): void {
  const serverPath = agentMatrixServerPath();
  const configured = [
    configureServer(join(homedir(), '.claude.json'), port, serverPath),
    configureServer(join(homedir(), '.kimi-code', 'mcp.json'), port, serverPath),
    configureCodexMcp(port, serverPath),
    removeServer(join(homedir(), '.copilot', 'mcp-config.json'), 'agentmatrix'),
  ];
  if (configured.some(Boolean)) console.log('[mcp-config] AgentMatrix MCP configuration refreshed');
}
