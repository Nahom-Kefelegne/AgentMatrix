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

if [ -n "${AGENTMATRIX_SESSION_ID:-}" ]; then
    echo -e "  ${CROSS} Refusing to update Agent Matrix from a session it is hosting."
    echo -e "     Updating here could disconnect this conversation."
    echo -e "     Run ${REPO_DIR}/update.sh from a separate terminal instead."
    exit 1
fi

stop_existing_instance() {
    command -v lsof >/dev/null 2>&1 || return 0
    local existing_pid existing_cwd
    existing_pid="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"
    [ -n "$existing_pid" ] || return 0
    existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [ "$existing_cwd" != "$REPO_DIR" ]; then
        echo -e "  ${CROSS} Port 3000 is already used by another process (${existing_pid})."
        exit 1
    fi
    echo -e "  ${WARN} Stopping running Agent Matrix (${existing_pid}) before updating..."
    kill "$existing_pid" 2>/dev/null || {
        echo -e "  ${CROSS} Could not stop Agent Matrix. Quit it and retry."
        exit 1
    }
    local shutdown_wait
    shutdown_wait="${AGENTMATRIX_SHUTDOWN_WAIT_SECONDS:-15}"
    case "$shutdown_wait" in
        ''|*[!0-9]*|0) shutdown_wait=15 ;;
    esac
    for _ in $(seq 1 "$shutdown_wait"); do
        kill -0 "$existing_pid" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$existing_pid" 2>/dev/null; then
        echo -e "  ${WARN} Graceful shutdown timed out; force-stopping Agent Matrix (${existing_pid})..."
        kill -KILL "$existing_pid" 2>/dev/null || {
            echo -e "  ${CROSS} Could not force-stop Agent Matrix. Quit it and retry."
            exit 1
        }
        for _ in $(seq 1 5); do
            kill -0 "$existing_pid" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$existing_pid" 2>/dev/null && {
            echo -e "  ${CROSS} Agent Matrix is still alive. Quit it and retry."
            exit 1
        }
    fi
}

backup_generated_lockfile() {
    LOCKFILE_RESET=0
    git diff --quiet HEAD -- package-lock.json 2>/dev/null && return 0
    local backup_dir backup_file
    backup_dir="$HOME/.agentmatrix/update-backups"
    backup_file="$backup_dir/$(date +%Y%m%d-%H%M%S)-package-lock.patch"
    mkdir -p "$backup_dir"
    git diff --binary HEAD -- package-lock.json > "$backup_file"
    git restore --source=HEAD --staged --worktree -- package-lock.json || {
        echo -e "  ${CROSS} Could not restore generated package-lock.json."
        exit 1
    }
    LOCKFILE_RESET=1
    echo -e "  ${CHECK} Backed up generated package-lock changes to ${backup_file}"
}

install_dependencies() {
    echo -e "${BLUE}Installing dependencies from the Microsoft mirror...${NC}"
    npm --no-update-notifier ci \
        --registry="$NPM_CONFIG_REGISTRY" \
        --replace-registry-host=never \
        --prefer-offline \
        --fetch-timeout=30000 \
        --fetch-retry-maxtimeout=30000 \
        --fetch-retries=1 \
        --no-audit --no-fund --no-progress || {
        echo -e "  ${CROSS} Dependency install failed; Agent Matrix was not stopped."
        echo -e "     Revision: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
        echo -e "     Runtime: Node $(node --version 2>/dev/null || echo unknown), npm $(npm --version 2>/dev/null || echo unknown)"
        echo -e "     Registry: ${NPM_CONFIG_REGISTRY}"
        echo -e "     If npm reports an out-of-sync lockfile, fetch the latest main branch and retry."
        exit 1
    }
    node scripts/dependency-state.mjs check || {
        echo -e "  ${CROSS} Dependencies installed, but their state could not be verified."
        exit 1
    }
    echo -e "  ${CHECK} Dependencies installed"
}

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$branch" != "main" ]; then
    echo -e "  ${CROSS} Update must run from the main branch."
    echo -e "     Run: git switch main"
    exit 1
fi

before="$(git rev-parse HEAD 2>/dev/null)"
backup_generated_lockfile

echo -e "${BLUE}Pulling latest from main...${NC}"
git fetch --quiet origin main || {
    echo -e "  ${CROSS} Could not fetch origin/main. Check network access and retry."
    exit 1
}
git merge --ff-only origin/main || {
    echo -e "  ${CROSS} Could not fast-forward to origin/main."
    echo -e "     Commit or stash the local files shown by 'git status', then retry."
    exit 1
}
after="$(git rev-parse HEAD 2>/dev/null)"
echo -e "  ${CHECK} Code updated to $(git rev-parse --short HEAD)"
echo ""

dependencies_changed=0
[ -d node_modules ] || dependencies_changed=1
git diff --quiet "$before" "$after" -- package.json package-lock.json 2>/dev/null || dependencies_changed=1
if [ "$dependencies_changed" -eq 0 ] && ! node scripts/dependency-state.mjs check; then
    dependencies_changed=1
fi
if [ "$dependencies_changed" -eq 1 ]; then
    install_dependencies
else
    echo -e "  ${CHECK} Dependencies match package-lock.json"
fi
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
    run_bounded 180 npm --no-update-notifier exec -- electron-rebuild -f -w node-pty || \
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

stop_existing_instance

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

# The app refreshes the authoritative Copilot hook config before launching any
# managed session. Do not duplicate that template here: stale PreToolUse formats
# can put installer output back on Copilot's critical path.
echo -e "  ${CHECK} Copilot hooks will refresh on Agent Matrix startup"
echo ""

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Update complete!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "  Hooks now fail silently when Agent Matrix is not running."
echo -e "  Launch with: ${BLUE}$(pwd)/start.sh${NC}"
echo ""
