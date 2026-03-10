# /setup-agentmatrix

Set up Agent Matrix — a desktop control center for Claude Code.

## What this does

1. Clones the Agent Matrix repo
2. Installs dependencies
3. Rebuilds node-pty for Electron
4. Configures Claude Code hooks in ~/.claude/settings.json
5. Launches the app

## Instructions

Run the following steps in order. Do NOT skip any step. Do NOT ask questions.

### Step 1: Clone and install

```bash
cd ~/Desktop && git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git && cd AgentMatrix && npm install
```

### Step 2: Rebuild native modules

```bash
cd ~/Desktop/AgentMatrix && npx electron-rebuild -m . -o node-pty
```

### Step 3: Configure hooks

Read the current `~/.claude/settings.json`. Merge the following `hooks` config into it — do NOT replace existing settings, only add the `hooks` key if it doesn't exist, or merge into existing hooks:

```json
{
  "hooks": {
    "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/session-start -H 'Content-Type: application/json' -d @-"}]}],
    "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/session-end -H 'Content-Type: application/json' -d @-"}]}],
    "PreToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/tool-use -H 'Content-Type: application/json' -d @-"}]}],
    "PostToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H 'Content-Type: application/json' -d @-"}]}],
    "SubagentStart": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/agent-start -H 'Content-Type: application/json' -d @-"}]}],
    "SubagentStop": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H 'Content-Type: application/json' -d @-"}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/stop -H 'Content-Type: application/json' -d @-"}]}]
  }
}
```

### Step 4: Launch

```bash
cd ~/Desktop/AgentMatrix && npx electron .
```

Tell the user: "Agent Matrix is running! Open sessions in any terminal and they'll appear in the app."
