# Agent Matrix — Start (Windows)
# Pull the latest code (fast-forward only) before launching so start.ps1 always
# runs the newest version. A failed pull (offline, unpushed local commits, or a
# blocked network) is non-fatal — the app still launches on the current code.
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path .git)) {
    Write-Host "Pulling latest from git..." -ForegroundColor Blue
    $before = (git rev-parse HEAD 2>$null)
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    # fetch + merge --ff-only rather than `git pull`: it ignores the user's
    # pull.rebase config, never rewrites history or creates a merge commit, and
    # a dirty working tree only blocks the fast-forward if it would overwrite a
    # locally-modified file.
    git fetch --quiet origin $branch 2>$null
    $fetchOk = ($LASTEXITCODE -eq 0)
    if ($fetchOk) { git merge --ff-only --quiet "origin/$branch" 2>$null }
    if ($fetchOk -and $LASTEXITCODE -eq 0) {
        $after = (git rev-parse HEAD 2>$null)
        if ($before -eq $after) {
            Write-Host "  Already up to date" -ForegroundColor Green
        } else {
            Write-Host "  Updated to latest" -ForegroundColor Green
            # If dependency manifests changed, a plain start may run against
            # stale node_modules — point the user at the full updater.
            git diff --quiet $before $after -- package.json package-lock.json 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  Dependencies changed upstream - run .\update.ps1 to reinstall before starting." -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  Could not fast-forward (offline, unpushed local commits, or local edits) - launching current version." -ForegroundColor Yellow
        Write-Host "  Run .\update.ps1 to reconcile if needed." -ForegroundColor Yellow
    }
}

npm run electron:dev
