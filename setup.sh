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

# Hooks use --connect-timeout 1 + silent fail so Claude/Copilot commands run
# from terminal don't hang when Agent Matrix isn't running.
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
console.log('Hooks configured successfully (silent-fail when app not running)');
"

echo -e "  ${CHECK} Hooks configured in ${SETTINGS_FILE}"
echo ""

# Configure GitHub Copilot CLI hooks
# Copilot supports user-level hooks at ~/.copilot/hooks/*.json with native
# HTTP hook type — no curl shenanigans needed. Built-in timeoutSec means
# they fail silently when Agent Matrix isn't running.
COPILOT_DIR="$HOME/.copilot"
COPILOT_HOOKS_DIR="$COPILOT_DIR/hooks"
COPILOT_HOOKS_FILE="$COPILOT_HOOKS_DIR/agentmatrix.json"

if command -v copilot &> /dev/null || [ -d "$COPILOT_DIR" ]; then
    echo -e "${BLUE}Configuring GitHub Copilot CLI hooks...${NC}"
    mkdir -p "$COPILOT_HOOKS_DIR"

    # Use PascalCase event names so payload uses snake_case fields
    # (session_id, tool_name, tool_input) matching our Claude hook payloads
    # — our API routes work with both without modification.
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
    echo -e "  ${CHECK} Copilot hooks configured in ${COPILOT_HOOKS_FILE}"
else
    echo -e "  ${WARN} Copilot CLI not detected — skipping Copilot hook setup"
fi
echo ""

# If not in repo, clone it
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$SCRIPT_DIR/electron/main.ts" ]; then
    REPO_DIR="$(pwd)/AgentMatrix"
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
# package-lock.json pins tarball URLs on registry.npmjs.org. On networks where
# the public npm registry is blocked (e.g. corporate/Microsoft), npm honors
# those lockfile URLs and hangs. Fail fast (bounded fetch timeout/retries), then
# fall back to re-resolving every dependency through the registry configured in
# ~/.npmrc (e.g. an Azure Artifacts mirror) by dropping the lockfile.
npm_install_resilient() {
    npm install --fetch-timeout=60000 --fetch-retry-maxtimeout=60000 --fetch-retries=1 && return 0
    echo -e "  ${WARN} npm install failed — the registry in package-lock.json"
    echo -e "     (registry.npmjs.org) may be blocked on this network."
    local reg; reg=$(npm config get registry 2>/dev/null)
    echo -e "     Re-resolving dependencies through your configured registry:"
    echo -e "     ${reg}"
    rm -f package-lock.json
    npm install --fetch-timeout=120000 --fetch-retry-maxtimeout=120000 --fetch-retries=2 && return 0
    return 1
}
if ! npm_install_resilient; then
    reg=$(npm config get registry 2>/dev/null)
    echo -e "  ${CROSS} Could not install dependencies."
    echo -e "     Public npm appears blocked and your mirror isn't usable. Fix the mirror auth:"
    echo -e "       • Registry: ${reg}"
    echo -e "       • Azure Artifacts (macOS/Linux): create a PAT with Packaging (Read),"
    echo -e "         then run:  npx ado-npm-auth --config ~/.npmrc   (or add the token to ~/.npmrc)"
    echo -e "       • Windows:   npx vsts-npm-auth -config .npmrc -F"
    echo -e "     Then re-run this script."
    exit 1
fi
echo ""

# ── Native modules (node-pty) ─────────────────────────────────────────────
# node-pty ships a compiled addon (pty.node) + a helper binary (spawn-helper),
# both specific to this machine's CPU arch AND Electron's ABI. Copying
# node_modules between Macs (or Intel/Apple-Silicon) breaks them, and the copy
# usually strips spawn-helper's executable bit — surfacing at runtime as the
# cryptic "posix_spawnp failed". Restore the +x bit, verify node-pty can spawn
# under Electron, and only compile from source when we must (that build is what
# tends to hang, so we skip it whenever the binaries already work).
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

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Setup complete!            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "  To launch anytime, run: ${BLUE}$(pwd)/start.sh${NC}"
echo ""

read -p "Launch Agent Matrix now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    bash "$(pwd)/start.sh"
fi
