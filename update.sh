#!/bin/bash
# Agent Matrix Update Script (macOS/Linux)
# Pulls latest code and re-configures hooks with silent-fail support.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
CHECK="${GREEN}✓${NC}"
WARN="${YELLOW}!${NC}"
CROSS="${RED}✗${NC}"

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

# ── Native modules (node-pty) ─────────────────────────────────────────────
# npm install can re-fetch node-pty with a plain-Node build; make sure its
# native binaries match this machine's CPU arch AND Electron's ABI. Copying
# node_modules between Macs also strips spawn-helper's executable bit, which
# surfaces as the cryptic "posix_spawnp failed". Restore the +x bit, verify
# node-pty can spawn under Electron, and only compile from source when we must
# (that build is what tends to hang, so we skip it when the binaries work).
echo -e "${BLUE}Setting up native modules (node-pty)...${NC}"

HELPER="node_modules/node-pty/build/Release/spawn-helper"
ELECTRON_BIN="node_modules/.bin/electron"

# Cheap fix first: restore the helper's executable bit.
[ -f "$HELPER" ] && chmod +x "$HELPER" 2>/dev/null || true

# Verify node-pty can spawn under Electron's runtime (ELECTRON_RUN_AS_NODE uses
# Electron's ABI, exactly like the app), so we skip a needless — and sometimes
# hanging — rebuild when it already works.
pty_works() {
    [ -x "$ELECTRON_BIN" ] || return 1
    ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e \
      "const p=require('node-pty');const t=p.spawn(process.env.SHELL||'/bin/bash',['-c','exit 0'],{});t.kill();" \
      >/dev/null 2>&1
}

if pty_works; then
    echo -e "  ${CHECK} node-pty works — no rebuild needed"
else
    echo -e "  ${WARN} node-pty can't spawn — rebuilding for Electron..."

    # Missing Xcode Command Line Tools is the #1 cause of a build that hangs.
    if ! xcode-select -p &>/dev/null; then
        echo -e "  ${WARN} Xcode Command Line Tools missing — launching installer (accept the prompt),"
        echo -e "     then re-run this script once it finishes."
        xcode-select --install 2>/dev/null || true
    fi

    # Visible output (not silenced, so a stall is diagnosable). Fall back through
    # the public npm registry — a private/ADO mirror with an expired token stalls
    # header/prebuild downloads — then a plain npm rebuild.
    if npx electron-rebuild -f -w node-pty \
        || npm_config_registry=https://registry.npmjs.org/ npx electron-rebuild -f -w node-pty \
        || npm rebuild node-pty; then
        [ -f "$HELPER" ] && chmod +x "$HELPER" 2>/dev/null || true
    fi

    if pty_works; then
        echo -e "  ${CHECK} Native modules rebuilt"
    else
        echo -e "  ${CROSS} node-pty still can't spawn. Fix manually:"
        echo -e "       chmod +x $HELPER      # if the file exists"
        echo -e "       npm run rebuild:native"
        echo -e "     If the rebuild hangs, install Xcode CLT (xcode-select --install)"
        echo -e "     and check your npm registry (npm config get registry)."
    fi
fi
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

# Refresh Copilot CLI hooks (user-level, HTTP-type with built-in timeout)
COPILOT_DIR="$HOME/.copilot"
COPILOT_HOOKS_DIR="$COPILOT_DIR/hooks"
COPILOT_HOOKS_FILE="$COPILOT_HOOKS_DIR/agentmatrix.json"

if command -v copilot &> /dev/null || [ -d "$COPILOT_DIR" ]; then
    echo -e "${BLUE}Updating GitHub Copilot CLI hooks...${NC}"
    mkdir -p "$COPILOT_HOOKS_DIR"
    cat > "$COPILOT_HOOKS_FILE" <<'COPILOT_HOOKS_EOF'
{
  "version": 1,
  "hooks": {
    "SessionStart": [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-start", "timeoutSec": 2 }],
    "SessionEnd":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-end",   "timeoutSec": 2 }],
    "PreToolUse":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-use",      "timeoutSec": 2 }],
    "PostToolUse":  [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-complete", "timeoutSec": 2 }],
    "SubagentStart":[{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-start",   "timeoutSec": 2 }],
    "SubagentStop": [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-stop",    "timeoutSec": 2 }],
    "Stop":          [{ "type": "http", "url": "http://localhost:3000/api/hooks/stop",          "timeoutSec": 2 }]
  }
}
COPILOT_HOOKS_EOF
    echo -e "  ${CHECK} Copilot hooks updated in ${COPILOT_HOOKS_FILE}"
    echo ""
fi

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Update complete!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "  Hooks now fail silently when Agent Matrix is not running."
echo -e "  Launch with: ${BLUE}$(pwd)/start.sh${NC}"
echo ""
