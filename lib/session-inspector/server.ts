import { existsSync, readFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { homedir } from 'os';
import { basename, join } from 'path';
import { getAllAppTasks } from '../state/appTaskStore';
import { getActiveSession } from '../state/activeSessionsCache';
import { getSession, isAppManaged } from '../state/sessionStore';
import { reconcileCopilotSessionName } from '../state/providerSessionName';
import type { CliType } from '../types';
import type {
  SessionInspectorData,
  SessionInspectorMcp,
  SessionInspectorMcpSource,
  SessionInspectorScope,
} from './types';

const MAX_CONFIG_BYTES = 1024 * 1024;

interface McpConfigSource extends SessionInspectorMcpSource {
  path: string;
  allowDirect?: boolean;
}

function readConfig(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_CONFIG_BYTES) return null;
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function serverEntries(
  config: Record<string, unknown>,
  allowDirect = false,
): Array<[string, Record<string, unknown>]> {
  const nested = (
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : config.servers && typeof config.servers === 'object' && !Array.isArray(config.servers)
        ? config.servers
        : allowDirect
          ? config
          : null
  ) as Record<string, unknown> | null;
  if (!nested) return [];
  return Object.entries(nested).flatMap(([name, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? [[name, value as Record<string, unknown>]]
      : []
  ));
}

function commandName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.replaceAll('\\', '/');
  return basename(normalized) || normalized;
}

function transportOf(config: Record<string, unknown>): SessionInspectorMcp['transport'] {
  if (config.type === 'sse') return 'sse';
  if (config.type === 'http' || typeof config.url === 'string') return 'http';
  if (config.type === 'stdio' || typeof config.command === 'string') return 'stdio';
  return 'unknown';
}

function sourceConfigs(cliType: CliType, cwd?: string): McpConfigSource[] {
  const home = homedir();
  if (cliType === 'copilot') {
    return [
      {
        label: 'Copilot user config',
        scope: 'user',
        path: join(home, '.copilot', 'mcp-config.json'),
      },
      ...(cwd ? [
        {
          label: 'Repository .vscode/mcp.json',
          scope: 'project' as const,
          path: join(cwd, '.vscode', 'mcp.json'),
        },
        {
          label: 'Repository .mcp.json',
          scope: 'project' as const,
          path: join(cwd, '.mcp.json'),
        },
        {
          label: 'Repository .github/mcp.json',
          scope: 'project' as const,
          path: join(cwd, '.github', 'mcp.json'),
        },
      ] : []),
    ];
  }

  return [
    {
      label: 'Claude legacy config',
      scope: 'user',
      path: join(home, '.claude', 'mcp_servers.json'),
      allowDirect: true,
    },
    {
      label: 'Claude user settings',
      scope: 'user',
      path: join(home, '.claude', 'settings.json'),
    },
    {
      label: 'Claude user config',
      scope: 'user',
      path: join(home, '.claude.json'),
    },
    ...(cwd ? [
      {
        label: 'Repository .claude/settings.json',
        scope: 'project' as const,
        path: join(cwd, '.claude', 'settings.json'),
      },
      {
        label: 'Repository .mcp.json',
        scope: 'project' as const,
        path: join(cwd, '.mcp.json'),
      },
    ] : []),
  ];
}

function processCommandLines(): string[] {
  const options = {
    encoding: 'utf8' as const,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  };
  if (process.platform !== 'win32') {
    const result = spawnSync('ps', ['-axww', '-o', 'command='], options);
    return result.status === 0 ? result.stdout.split('\n') : [];
  }

  const wmic = spawnSync(
    'wmic',
    ['process', 'get', 'CommandLine', '/format:list'],
    options,
  );
  if (wmic.status === 0) {
    return wmic.stdout
      .split(/\r?\n/)
      .map(line => line.replace(/^CommandLine=/, ''))
      .filter(Boolean);
  }
  const powershell = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }',
    ],
    options,
  );
  return powershell.status === 0 ? powershell.stdout.split(/\r?\n/) : [];
}

function runtimeMcpConfigs(sessionId: string): Record<string, unknown>[] {
  const commands = processCommandLines()
    .filter(line =>
      line.includes('copilot')
      && (
        line.includes(`--session-id ${sessionId}`)
        || line.includes(`--session-id=${sessionId}`)
        || line.includes(`--resume ${sessionId}`)
        || line.includes(`--resume=${sessionId}`)
      ));
  const command = commands.toSorted((left, right) =>
    (right.match(/--additional-mcp-config/g)?.length ?? 0)
    - (left.match(/--additional-mcp-config/g)?.length ?? 0))[0];
  if (!command) return [];

  const configs: Record<string, unknown>[] = [];
  const pattern = /--additional-mcp-config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  for (const match of command.matchAll(pattern)) {
    const value = match[1] || match[2] || match[3];
    if (!value) continue;
    if (value.startsWith('@')) {
      const config = readConfig(value.slice(1));
      if (config) configs.push(config);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        configs.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Runtime config is best-effort and may use unsupported shell quoting.
    }
  }
  return configs;
}

function mergeMcp(
  inventory: Map<string, SessionInspectorMcp>,
  name: string,
  config: Record<string, unknown>,
  source: SessionInspectorMcpSource,
): void {
  if (name === 'agentmatrix') return;
  const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env)
    ? Object.keys(config.env as Record<string, unknown>).toSorted()
    : [];
  const existing = inventory.get(name);
  const sources = existing
    ? [...existing.sources, source].filter((candidate, index, values) =>
        values.findIndex(value =>
          value.label === candidate.label && value.scope === candidate.scope) === index)
    : [source];
  inventory.set(name, {
    id: name,
    name,
    effectiveSource: source.label,
    scope: source.scope,
    sources,
    transport: transportOf(config),
    command: commandName(config.command),
    envKeys: env,
    managed: false,
  });
}

function collectMcps(
  sessionId: string,
  cliType: CliType,
  cwd?: string,
  managed = false,
): SessionInspectorMcp[] {
  const inventory = new Map<string, SessionInspectorMcp>();
  for (const source of sourceConfigs(cliType, cwd)) {
    const config = readConfig(source.path);
    if (!config) continue;
    for (const [name, server] of serverEntries(config, source.allowDirect)) {
      mergeMcp(inventory, name, server, {
        label: source.label,
        scope: source.scope,
      });
    }
    if (cliType === 'copilot') {
      for (const config of runtimeMcpConfigs(sessionId)) {
        for (const [name, server] of serverEntries(config)) {
          mergeMcp(inventory, name, server, {
            label: 'Session runtime injection',
            scope: 'runtime',
          });
        }
      }
    }
  }

  if (managed || isAppManaged(sessionId)) {
    inventory.set('agentmatrix', {
      id: 'agentmatrix',
      name: 'AgentMatrix',
      effectiveSource: 'Managed session',
      scope: 'managed',
      sources: [{ label: 'Managed session', scope: 'managed' }],
      transport: 'stdio',
      command: 'Electron',
      envKeys: [],
      managed: true,
    });
  }

  const scopeRank: Record<SessionInspectorScope, number> = {
    managed: 0,
    runtime: 1,
    project: 2,
    user: 3,
  };
  return Array.from(inventory.values()).toSorted((left, right) =>
    scopeRank[left.scope] - scopeRank[right.scope]
    || left.name.localeCompare(right.name));
}

export function getSessionInspectorData(sessionId: string): SessionInspectorData | null {
  const session = getSession(sessionId);
  if (!session) return null;
  if (session.cliType === 'copilot') reconcileCopilotSessionName(sessionId);
  const profile = getActiveSession(sessionId);
  return {
    profile: {
      permissionMode: profile?.permissionMode,
      model: profile?.model,
      effort: profile?.effort,
      allowedTools: profile?.allowedTools,
      copilotMode: profile?.copilotMode,
    },
    mcps: collectMcps(
      sessionId,
      session.cliType ?? 'claude',
      session.cwd,
      Boolean(profile),
    ),
    tasks: getAllAppTasks()
      .filter(task => task.assignedTo === sessionId)
      .map(task => ({
        id: task.id,
        subject: task.subject,
        description: task.description,
        status: task.status,
        source: task.source,
        type: task.type,
        priority: task.priority,
        adoId: task.adoId,
        assignedAt: task.assignedAt,
      })),
  };
}
