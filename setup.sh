#!/bin/bash
# Agent Matrix Setup Script (macOS/Linux)
# Checks prerequisites, configures Claude + Copilot hooks, installs dependencies,
# sets up native modules, and launches the app.

set -e

export NPM_CONFIG_REGISTRY="https://packagefeedproxy.microsoft.io/npm/"
export NPM_CONFIG_REPLACE_REGISTRY_HOST="npmjs"
export NPM_CONFIG_UPDATE_NOTIFIER="false"
export NPM_CONFIG_AUDIT="false"
export NPM_CONFIG_FUND="false"
export NO_UPDATE_NOTIFIER="1"

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

# Check GitHub Copilot CLI (primary) and Claude CLI — at least one is required.
HAVE_CLI=0
if command -v copilot &> /dev/null; then
    echo -e "  ${CHECK} GitHub Copilot CLI found (primary)"
    HAVE_CLI=1
else
    echo -e "  ${WARN} GitHub Copilot CLI not found (recommended primary)"
    echo -e "     Install from: https://github.com/github/copilot-cli"
fi

if command -v claude &> /dev/null; then
    echo -e "  ${CHECK} Claude CLI found"
    HAVE_CLI=1
else
    echo -e "  ${WARN} Claude CLI not found"
    echo -e "     Install from: https://docs.anthropic.com/en/docs/claude-code"
fi

if [ $HAVE_CLI -eq 0 ]; then
    echo -e "  ${CROSS} Neither GitHub Copilot CLI nor Claude CLI found — install at least one."
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

# The app owns ~/.copilot/hooks/agentmatrix.json and refreshes it before any
# managed Copilot session starts. Keeping one runtime-generated source of truth
# prevents installers from restoring stale or blocking PreToolUse handlers.
echo -e "  ${CHECK} Copilot hooks will be configured on Agent Matrix startup"
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
# Project .npmrc + the environment above force lockfile tarballs through the
# Microsoft package proxy from the first request. Never probe public npm first.
npm_install_resilient() {
    npm --no-update-notifier ci \
      --registry="$NPM_CONFIG_REGISTRY" \
      --replace-registry-host=npmjs \
      --prefer-offline \
      --fetch-timeout=30000 --fetch-retry-maxtimeout=30000 --fetch-retries=1 \
      --no-audit --no-fund --no-progress
}
if ! npm_install_resilient; then
    reg=$(npm --no-update-notifier config get registry 2>/dev/null)
    echo -e "  ${CROSS} Could not install dependencies."
    echo -e "     The Microsoft package proxy isn't usable. Fix the mirror auth:"
    echo -e "       • Registry: ${reg}"
    echo -e "       • Azure Artifacts (macOS/Linux): create a PAT with Packaging (Read),"
    echo -e "         then run:  npx ado-npm-auth --config ~/.npmrc   (or add the token to ~/.npmrc)"
    echo -e "       • Windows:   npx vsts-npm-auth -config .npmrc -F"
    echo -e "     Then re-run this script."
    exit 1
fi
if ! node scripts/dependency-state.mjs check; then
    echo -e "  ${CROSS} Dependencies installed, but their state could not be verified."
    exit 1
fi
echo ""

# ── Native modules (node-pty) ─────────────────────────────────────────────
# node-pty ships N-API prebuilt binaries (prebuilds/<platform>-<arch>/) that are
# ABI-stable across Node AND Electron, so NO compilation/electron-rebuild is
# needed — which matters because electron-rebuild downloads Electron C++ headers
# from the internet, and that download HANGS on networks where public downloads
# are blocked (e.g. corporate/Microsoft).
#
# The one catch: the prebuilt `spawn-helper` ships WITHOUT the execute bit
# (npm/git don't preserve it), so node-pty's fork() fails at runtime with the
# cryptic "posix_spawnp failed". Fix = chmod +x every spawn-helper. Only if the
# prebuilt binary still can't spawn do we fall back to a *time-bounded* rebuild.
echo -e "${BLUE}Setting up native modules (node-pty)...${NC}"

ELECTRON_BIN="node_modules/.bin/electron"

# Restore the execute bit on every shipped/compiled spawn-helper (prebuilds for
# the current arch + any build/Release from a prior compile).
find node_modules/node-pty/prebuilds -name spawn-helper -exec chmod +x {} \; 2>/dev/null || true
[ -f node_modules/node-pty/build/Release/spawn-helper ] && \
    chmod +x node_modules/node-pty/build/Release/spawn-helper 2>/dev/null || true

# Verify node-pty can actually spawn under Electron's runtime
# (ELECTRON_RUN_AS_NODE uses Electron's ABI, exactly like the app). If it works,
# we skip the (network-dependent, hang-prone) rebuild entirely.
pty_works() {
    [ -x "$ELECTRON_BIN" ] || return 1
    ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e \
      "const p=require('node-pty');const t=p.spawn(process.env.SHELL||'/bin/bash',['-c','exit 0'],{});t.kill();" \
      >/dev/null 2>&1
}

# Run a command with a hard timeout so a blocked network download can't hang the
# script forever (macOS has no `timeout`; use a background process + waiter).
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
        echo -e "  ${WARN} Xcode Command Line Tools missing — launching installer (accept the prompt),"
        echo -e "     then re-run this script."
        xcode-select --install 2>/dev/null || true
    fi
    # Bounded so a blocked Electron-header download fails fast instead of hanging.
    run_bounded 180 npm --no-update-notifier exec -- electron-rebuild -f -w node-pty || \
        run_bounded 180 npm rebuild node-pty || true
    find node_modules/node-pty/prebuilds -name spawn-helper -exec chmod +x {} \; 2>/dev/null || true
    [ -f node_modules/node-pty/build/Release/spawn-helper ] && \
        chmod +x node_modules/node-pty/build/Release/spawn-helper 2>/dev/null || true

    if pty_works; then
        echo -e "  ${CHECK} Native modules ready"
    else
        echo -e "  ${CROSS} node-pty still can't spawn. The prebuilt binary should work"
        echo -e "     without a rebuild — try restoring the helper's execute bit:"
        echo -e "       chmod +x node_modules/node-pty/prebuilds/*/spawn-helper"
        echo -e "     If you're on a network that blocks public downloads, do NOT run"
        echo -e "     electron-rebuild (it hangs fetching Electron headers) — the prebuilt"
        echo -e "     N-API binary is sufficient once spawn-helper is executable."
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
