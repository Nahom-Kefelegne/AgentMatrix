#!/bin/bash
# Agent Matrix — Start (macOS / Linux)
# Pull the latest code (fast-forward only) before launching so start.sh always
# runs the newest version. Offline starts remain available, but if the remote is
# reachable and local state blocks the update, stop instead of silently serving
# an old checkout.
cd "$(dirname "$0")" || exit 1

# Corporate-safe npm policy. `npm run` can perform its own update check even
# when no install is requested, which triggers Microsoft Defender's NPM URL
# block. Keep every npm request on the Microsoft proxy and disable background
# registry checks.
export NPM_CONFIG_REGISTRY="https://packagefeedproxy.microsoft.io/npm/"
export NPM_CONFIG_REPLACE_REGISTRY_HOST="never"
export NPM_CONFIG_UPDATE_NOTIFIER="false"
export NPM_CONFIG_AUDIT="false"
export NPM_CONFIG_FUND="false"
export NO_UPDATE_NOTIFIER="1"

if [ -n "${AGENTMATRIX_SESSION_ID:-}" ]; then
    echo "  ! Refusing to restart Agent Matrix from a session it is hosting."
    echo "    Restarting here would disconnect this conversation."
    echo "    Run $(pwd)/start.sh from a separate terminal instead."
    exit 1
fi

stop_existing_instance() {
    command -v lsof >/dev/null 2>&1 || return 0
    local existing_pid existing_cwd
    existing_pid="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"
    [ -n "$existing_pid" ] || return 0
    existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [ "$existing_cwd" != "$(pwd)" ]; then
        echo "  ! Port 3000 is already used by another process (${existing_pid})."
        echo "    Stop that process before starting Agent Matrix."
        exit 1
    fi

    echo "Restarting existing Agent Matrix process (${existing_pid})..."
    kill "$existing_pid" 2>/dev/null || {
        echo "  ! Could not stop the existing process. Quit Agent Matrix and retry."
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
        echo "  ! Graceful shutdown timed out; force-stopping Agent Matrix (${existing_pid})..."
        kill -KILL "$existing_pid" 2>/dev/null || {
            echo "    Could not force-stop the existing process. Quit Agent Matrix and retry."
            exit 1
        }
        for _ in $(seq 1 5); do
            kill -0 "$existing_pid" 2>/dev/null || break
            sleep 1
        done
        if kill -0 "$existing_pid" 2>/dev/null; then
            echo "  ! Existing Agent Matrix process is still alive. Quit it and retry."
            exit 1
        fi
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
        echo "  ! Could not restore generated package-lock.json."
        exit 1
    }
    LOCKFILE_RESET=1
    echo "  ✓ Backed up generated package-lock changes to $backup_file"
}

install_dependencies() {
    echo "Installing dependencies from the Microsoft mirror..."
    npm --no-update-notifier ci \
        --registry="$NPM_CONFIG_REGISTRY" \
        --replace-registry-host=never \
        --prefer-offline \
        --fetch-timeout=30000 \
        --fetch-retry-maxtimeout=30000 \
        --fetch-retries=1 \
        --no-audit --no-fund --no-progress || {
        echo "  ! Dependency install failed; Agent Matrix was not stopped."
        echo "    Revision: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
        echo "    Runtime: Node $(node --version 2>/dev/null || echo unknown), npm $(npm --version 2>/dev/null || echo unknown)"
        echo "    Registry: $NPM_CONFIG_REGISTRY"
        echo "    If npm reports an out-of-sync lockfile, run ./update.sh from a separate terminal."
        exit 1
    }
    node scripts/dependency-state.mjs check || {
        echo "  ! Dependencies installed, but their state could not be verified."
        exit 1
    }
}

needs_dependencies=0
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    echo "Pulling latest from git..."
    before="$(git rev-parse HEAD 2>/dev/null)"
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
    [ -n "$default_branch" ] || default_branch="main"

    if [ "$branch" != "$default_branch" ]; then
        echo "  ! Agent Matrix must start from ${default_branch}; current branch is ${branch}."
        echo "    Run: git switch ${default_branch} && git pull --ff-only"
        exit 1
    fi

    backup_generated_lockfile

    # fetch + merge --ff-only rather than `git pull`: it ignores the user's
    # pull.rebase config, never rewrites history or creates a merge commit, and
    # a dirty working tree only blocks the fast-forward if it would overwrite a
    # locally-modified file.
    if git fetch --quiet origin "$branch" 2>/dev/null; then
        if git merge --ff-only --quiet "origin/$branch" 2>/dev/null; then
            after="$(git rev-parse HEAD 2>/dev/null)"
            if [ "$before" = "$after" ]; then
                echo "  ✓ Already up to date"
            else
                echo "  ✓ Updated to latest"
                if ! git diff --quiet "$before" "$after" -- package.json package-lock.json 2>/dev/null; then
                    needs_dependencies=1
                fi
            fi
        else
            echo "  ! The remote is reachable, but local changes or history blocked the update."
            echo "    Refusing to launch an outdated dashboard. Commit/stash your changes, then run:"
            echo "      git pull --ff-only"
            exit 1
        fi
    else
        echo "  ! Remote unavailable — launching the local checkout."
    fi

    echo "  Revision: $(git rev-parse --short HEAD 2>/dev/null)"
fi

[ -d node_modules ] || needs_dependencies=1
if [ "$needs_dependencies" -eq 0 ] && ! node scripts/dependency-state.mjs repair; then
    needs_dependencies=1
fi
if [ "$needs_dependencies" -eq 0 ] && ! node scripts/dependency-state.mjs check; then
    needs_dependencies=1
fi
if [ "$needs_dependencies" -eq 1 ]; then
    install_dependencies
else
    echo "  ✓ Dependencies match package-lock.json"
fi
stop_existing_instance

npm --no-update-notifier run electron:dev
