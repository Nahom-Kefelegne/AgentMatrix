#!/bin/bash
# Agent Matrix — Start (macOS / Linux)
# Pull the latest code (fast-forward only) before launching so start.sh always
# runs the newest version. A failed pull (offline, unpushed local commits, or a
# blocked network) is non-fatal — the app still launches on the current code.
cd "$(dirname "$0")" || exit 1

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    echo "Pulling latest from git..."
    before="$(git rev-parse HEAD 2>/dev/null)"
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    # fetch + merge --ff-only rather than `git pull`: it ignores the user's
    # pull.rebase config, never rewrites history or creates a merge commit, and
    # a dirty working tree only blocks the fast-forward if it would overwrite a
    # locally-modified file.
    if git fetch --quiet origin "$branch" 2>/dev/null && git merge --ff-only --quiet "origin/$branch" 2>/dev/null; then
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
        echo "  ! Could not fast-forward (offline, unpushed local commits, or local edits) — launching current version."
        echo "    Run ./update.sh to reconcile if needed."
    fi
fi

npm run electron:dev
