#!/bin/bash
# Agent Matrix Update Script (macOS/Linux)
# Pulls latest code and re-configures hooks with silent-fail support.

set -e

export NPM_CONFIG_REGISTRY="https://packagefeedproxy.microsoft.io/npm/"
export NPM_CONFIG_REPLACE_REGISTRY_HOST="never"
export NPM_CONFIG_UPDATE_NOTIFIER="false"
export NPM_CONFIG_AUDIT="false"
export NPM_CONFIG_FUND="false"
export NO_UPDATE_NOTIFIER="1"

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
# See setup.sh: use the Microsoft proxy from the first request.
if ! npm install --replace-registry-host=never --fetch-timeout=120000 --fetch-retry-maxtimeout=120000 --fetch-retries=2; then
    reg=$(npm config get registry 2>/dev/null)
    echo -e "  ${CROSS} Could not install dependencies through ${reg}."
    echo -e "     Authenticate the Microsoft mirror, then re-run this script."
    exit 1
fi
echo -e "  ${CHECK} Dependencies installed"
echo ""

# ── Native modules (node-pty) ─────────────────────────────────────────────
# node-pty ships N-API prebuilt binaries (prebuilds/<platform>-<arch>/) that work
# under both Node and Electron, so NO electron-rebuild is needed — which matters
# because that rebuild downloads Electron headers from the internet and HANGS on
# networks that block public downloads (e.g. corporate/Microsoft). The prebuilt
# `spawn-helper` just ships without its execute bit (npm/git drop it), which
# surfaces as "posix_spawnp failed"; chmod +x fixes it. See setup.sh for detail.
echo -e "${BLUE}Setting up native modules (node-pty)...${NC}"

ELECTRON_BIN="node_modules/.bin/electron"

# Restore the execute bit on every shipped/compiled spawn-helper.
find node_modules/node-pty/prebuilds -name spawn-helper -exec chmod +x {} \; 2>/dev/null || true
[ -f node_modules/node-pty/build/Release/spawn-helper ] && \
    chmod +x node_modules/node-pty/build/Release/spawn-helper 2>/dev/null || true

# Verify node-pty can spawn under Electron's ABI; skip the hang-prone rebuild if so.
pty_works() {
    [ -x "$ELECTRON_BIN" ] || return 1
    ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e \
      "const p=require('node-pty');const t=p.spawn(process.env.SHELL||'/bin/bash',['-c','exit 0'],{});t.kill();" \
      >/dev/null 2>&1
}

# Hard-timeout wrapper so a blocked download can't hang the script (macOS has no `timeout`).
run_bounded() {
    local secs="$1"; shift
    "$@" &
    local cmd_pid=$!
    ( sleep "$secs"; kill "$cmd_pid" 2>/dev/null ) &
    local killer_pid=$!
    disown "$killer_pid" 2>/dev/null
    wait "$cmd_pid" 2>/dev/null
    local rc=$?
    kill "$killer_pid" 2>/dev/null
    return $rc
}

if pty_works; then
    echo -e "  ${CHECK} node-pty prebuilt binary works under Electron — no rebuild needed"
else
    echo -e "  ${WARN} Prebuilt node-pty can't spawn — attempting a bounded rebuild..."
    if ! xcode-select -p &>/dev/null; then
        echo -e "  ${WARN} Xcode Command Line Tools missing — launching installer, then re-run."
        xcode-select --install 2>/dev/null || true
    fi
    run_bounded 180 npx electron-rebuild -f -w node-pty || \
        run_bounded 180 npm rebuild node-pty || true
    find node_modules/node-pty/prebuilds -name spawn-helper -exec chmod +x {} \; 2>/dev/null || true
    [ -f node_modules/node-pty/build/Release/spawn-helper ] && \
        chmod +x node_modules/node-pty/build/Release/spawn-helper 2>/dev/null || true

    if pty_works; then
        echo -e "  ${CHECK} Native modules ready"
    else
        echo -e "  ${CROSS} node-pty still can't spawn. Try:"
        echo -e "       chmod +x node_modules/node-pty/prebuilds/*/spawn-helper"
        echo -e "     Don't run electron-rebuild on a download-blocked network — the"
        echo -e "     prebuilt N-API binary is enough once spawn-helper is executable."
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
