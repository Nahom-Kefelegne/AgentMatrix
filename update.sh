#!/bin/bash
# Agent Matrix Update Script (macOS/Linux)
# Pulls latest code and re-configures hooks with silent-fail support.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'
CHECK="${GREEN}✓${NC}"

echo ""
echo -e "${BLUE}╔══════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Agent Matrix Update        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════╝${NC}"
echo ""

# Find the AgentMatrix directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/electron/main.ts" ]; then
    REPO_DIR="$SCRIPT_DIR"
elif [ -f "$(pwd)/AgentMatrix/electron/main.ts" ]; then
    REPO_DIR="$(pwd)/AgentMatrix"
elif [ -f "$(pwd)/electron/main.ts" ]; then
    REPO_DIR="$(pwd)"
else
    echo -e "${RED}Cannot find AgentMatrix repo. Run this from the repo or its parent directory.${NC}"
    exit 1
fi

cd "$REPO_DIR"
echo -e "  Repo: ${REPO_DIR}"
echo ""

# Pull latest
echo -e "${BLUE}Pulling latest from main...${NC}"
git pull origin main
echo -e "  ${CHECK} Code updated"
echo ""

# Install dependencies (in case they changed)
echo -e "${BLUE}Installing dependencies...${NC}"
npm install
echo -e "  ${CHECK} Dependencies installed"
echo ""

# Re-configure hooks with silent-fail support
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_DIR="$HOME/.claude"

echo -e "${BLUE}Updating Claude Code hooks (silent-fail when app not running)...${NC}"

mkdir -p "$CLAUDE_DIR"

node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}

const hooks = {
  SessionStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/session-start -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  SessionEnd: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/session-end -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  PreToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/tool-use -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  PostToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/tool-complete -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  SubagentStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/agent-start -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  SubagentStop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/agent-stop -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}],
  Stop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/stop -H \"Content-Type: application/json\" -d @- 2>/dev/null || true'}]}]
};

settings.hooks = { ...settings.hooks, ...hooks };
fs.writeFileSync(path, JSON.stringify(settings, null, 2));
console.log('Hooks updated successfully');
"

echo -e "  ${CHECK} Hooks updated in ${SETTINGS_FILE}"
echo ""

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Update complete!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "  Hooks now fail silently when Agent Matrix is not running."
echo -e "  Launch with: ${BLUE}$(pwd)/start.sh${NC}"
echo ""
