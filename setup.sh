#!/bin/bash
# Agent Matrix Setup Script (macOS/Linux)
# Checks prerequisites, configures Claude hooks, and launches the app.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
CROSS="${RED}✗${NC}"
WARN="${YELLOW}!${NC}"

echo ""
echo -e "${BLUE}╔══════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Agent Matrix Setup        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════╝${NC}"
echo ""

MISSING=0

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "  ${CHECK} Node.js ${NODE_VERSION}"
else
    echo -e "  ${CROSS} Node.js not found"
    echo -e "     Install from: https://nodejs.org/"
    MISSING=1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "  ${CHECK} npm ${NPM_VERSION}"
else
    echo -e "  ${CROSS} npm not found (comes with Node.js)"
    MISSING=1
fi

# Check Claude CLI
if command -v claude &> /dev/null; then
    echo -e "  ${CHECK} Claude CLI found"
else
    echo -e "  ${CROSS} Claude CLI not found"
    echo -e "     Install from: https://docs.anthropic.com/en/docs/claude-code"
    MISSING=1
fi

# Check git
if command -v git &> /dev/null; then
    echo -e "  ${CHECK} git found"
else
    echo -e "  ${CROSS} git not found"
    echo -e "     Install from: https://git-scm.com/"
    MISSING=1
fi

# Check az CLI (optional)
if command -v az &> /dev/null; then
    echo -e "  ${CHECK} Azure CLI found (ADO integration available)"
else
    echo -e "  ${WARN} Azure CLI not found (ADO integration won't be available)"
    echo -e "     Optional: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
fi

echo ""

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}Missing required tools. Install them and run this script again.${NC}"
    exit 1
fi

echo -e "${GREEN}All required tools found!${NC}"
echo ""

# Configure Claude hooks
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_DIR="$HOME/.claude"

echo -e "${BLUE}Configuring Claude Code hooks...${NC}"

mkdir -p "$CLAUDE_DIR"

if [ -f "$SETTINGS_FILE" ]; then
    # Merge hooks into existing settings
    node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}

const hooks = {
  SessionStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/session-start -H \"Content-Type: application/json\" -d @-'}]}],
  SessionEnd: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/session-end -H \"Content-Type: application/json\" -d @-'}]}],
  PreToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/tool-use -H \"Content-Type: application/json\" -d @-'}]}],
  PostToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H \"Content-Type: application/json\" -d @-'}]}],
  SubagentStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/agent-start -H \"Content-Type: application/json\" -d @-'}]}],
  SubagentStop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H \"Content-Type: application/json\" -d @-'}]}],
  Stop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/stop -H \"Content-Type: application/json\" -d @-'}]}]
};

settings.hooks = { ...settings.hooks, ...hooks };
fs.writeFileSync(path, JSON.stringify(settings, null, 2));
console.log('Hooks configured successfully');
"
else
    # Create new settings file
    node -e "
const fs = require('fs');
const settings = {
  hooks: {
    SessionStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/session-start -H \"Content-Type: application/json\" -d @-'}]}],
    SessionEnd: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/session-end -H \"Content-Type: application/json\" -d @-'}]}],
    PreToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/tool-use -H \"Content-Type: application/json\" -d @-'}]}],
    PostToolUse: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H \"Content-Type: application/json\" -d @-'}]}],
    SubagentStart: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/agent-start -H \"Content-Type: application/json\" -d @-'}]}],
    SubagentStop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H \"Content-Type: application/json\" -d @-'}]}],
    Stop: [{matcher: '', hooks: [{type: 'command', command: 'cat | curl -s -X POST http://localhost:3000/api/hooks/stop -H \"Content-Type: application/json\" -d @-'}]}]
  }
};
fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
console.log('Settings file created with hooks');
"
fi

echo -e "  ${CHECK} Hooks configured in ${SETTINGS_FILE}"
echo ""

# If not in repo, clone it
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$SCRIPT_DIR/electron/main.ts" ]; then
    REPO_DIR="$HOME/AgentMatrix"
    if [ -d "$REPO_DIR/.git" ]; then
        echo -e "${BLUE}Updating repo...${NC}"
        cd "$REPO_DIR" && git pull
    else
        echo -e "${BLUE}Cloning Agent Matrix...${NC}"
        git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git "$REPO_DIR"
        cd "$REPO_DIR"
    fi
    echo -e "  ${CHECK} Repo at ${REPO_DIR}"
    echo ""
else
    cd "$SCRIPT_DIR"
fi

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
npm install
echo ""

# Rebuild node-pty for Electron
echo -e "${BLUE}Rebuilding native modules for Electron...${NC}"
npx electron-rebuild -m . -o node-pty 2>/dev/null || {
    echo -e "  ${WARN} electron-rebuild failed, trying npm rebuild..."
    npm rebuild node-pty
}
echo -e "  ${CHECK} Native modules rebuilt"
echo ""

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Setup complete!            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "  Run: ${BLUE}npx electron .${NC}"
echo ""

# Ask to launch
read -p "Launch Agent Matrix now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx electron .
fi
