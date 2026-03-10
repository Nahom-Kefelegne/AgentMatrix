Set up Agent Matrix — a desktop control center for Claude Code.

Run these steps in order. Do NOT ask questions. Just execute. Detect the OS first (macOS/Linux vs Windows) and use the appropriate commands.

Step 1 — Clone and install:

macOS/Linux:
```bash
cd ~/Desktop && git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git && cd AgentMatrix && npm install
```

Windows (PowerShell):
```powershell
cd $HOME\Desktop; git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git; cd AgentMatrix; npm install
```

Step 2 — Rebuild native modules for Electron:

macOS/Linux:
```bash
cd ~/Desktop/AgentMatrix && npx electron-rebuild -m . -o node-pty
```

Windows (PowerShell):
```powershell
cd $HOME\Desktop\AgentMatrix; npx electron-rebuild -m . -o node-pty
```

Note: On Windows, if electron-rebuild fails, the user may need to install Windows Build Tools: `npm install --global windows-build-tools`

Step 3 — Configure Claude Code hooks. Read the Claude settings file and MERGE (do not replace) the following hooks config into it. If the file doesn't exist, create it. If hooks already exist, merge these entries.

Settings file location:
- macOS/Linux: ~/.claude/settings.json
- Windows: %USERPROFILE%\.claude\settings.json

For macOS/Linux hooks, use `cat | curl`:
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

For Windows hooks, use PowerShell instead of `cat | curl`:
```json
{
  "hooks": {
    "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/session-start -Method POST -ContentType 'application/json'\""}]}],
    "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/session-end -Method POST -ContentType 'application/json'\""}]}],
    "PreToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/tool-use -Method POST -ContentType 'application/json'\""}]}],
    "PostToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/tool-complete -Method POST -ContentType 'application/json'\""}]}],
    "SubagentStart": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/agent-start -Method POST -ContentType 'application/json'\""}]}],
    "SubagentStop": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/agent-stop -Method POST -ContentType 'application/json'\""}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -Command \"$input | Invoke-RestMethod -Uri http://localhost:3000/api/hooks/stop -Method POST -ContentType 'application/json'\""}]}]
  }
}
```

Step 4 — Launch the app:

macOS/Linux:
```bash
cd ~/Desktop/AgentMatrix && npx electron .
```

Windows (PowerShell):
```powershell
cd $HOME\Desktop\AgentMatrix; npx electron .
```

When done, tell the user: "Agent Matrix is running! Open Claude Code sessions in any terminal and they'll appear in the app automatically."
