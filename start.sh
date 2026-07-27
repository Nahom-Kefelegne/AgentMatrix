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
                # If dependency manifests changed, a plain start may run against
                # stale node_modules — point the user at the full updater.
                if ! git diff --quiet "$before" "$after" -- package.json package-lock.json 2>/dev/null; then
                    echo "  ! Dependencies changed upstream — run ./update.sh to reinstall before starting."
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

# A second Electron launch only focuses the existing single-instance process.
# Stop the dev instance bound to this checkout first so running start.sh is a
# real restart and cannot leave an old renderer/dashboard on screen.
if command -v lsof >/dev/null 2>&1; then
    existing_pid="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"
    if [ -n "$existing_pid" ]; then
        existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
        if [ "$existing_cwd" = "$(pwd)" ]; then
            echo "Restarting existing Agent Matrix process (${existing_pid})..."
            kill "$existing_pid" 2>/dev/null || {
                echo "  ! Could not stop the existing process. Quit Agent Matrix and retry."
                exit 1
            }
            for _ in $(seq 1 30); do
                kill -0 "$existing_pid" 2>/dev/null || break
                sleep 1
            done
            if kill -0 "$existing_pid" 2>/dev/null; then
                echo "  ! Existing Agent Matrix process did not exit. Quit it and retry."
                exit 1
            fi
        else
            echo "  ! Port 3000 is already used by another process (${existing_pid})."
            echo "    Stop that process before starting Agent Matrix."
            exit 1
        fi
    fi
fi

npm run electron:dev
