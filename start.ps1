# Agent Matrix — Start (Windows)
# Pull the latest code (fast-forward only) before launching so start.ps1 always
# runs the newest version. Offline starts remain available, but if the remote is
# reachable and local state blocks the update, stop instead of silently serving
# an old checkout.
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Keep npm on Microsoft's approved proxy and suppress npm's launch-time update
# check, which otherwise triggers the corporate NPM URL block notification.
$env:NPM_CONFIG_REGISTRY = "https://packagefeedproxy.microsoft.io/npm/"
$env:NPM_CONFIG_REPLACE_REGISTRY_HOST = "never"
$env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"
$env:NO_UPDATE_NOTIFIER = "1"

if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path .git)) {
    Write-Host "Pulling latest from git..." -ForegroundColor Blue
    $before = (git rev-parse HEAD 2>$null)
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    $defaultBranchRef = (git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null)
    $defaultBranch = if ($defaultBranchRef) { $defaultBranchRef -replace '^origin/', '' } else { 'main' }
    if ($branch -ne $defaultBranch) {
        Write-Host "  Agent Matrix must start from $defaultBranch; current branch is $branch." -ForegroundColor Red
        Write-Host "  Run: git switch $defaultBranch; git pull --ff-only" -ForegroundColor Yellow
        exit 1
    }

    # fetch + merge --ff-only rather than `git pull`: it ignores the user's
    # pull.rebase config, never rewrites history or creates a merge commit, and
    # a dirty working tree only blocks the fast-forward if it would overwrite a
    # locally-modified file.
    git fetch --quiet origin $branch 2>$null
    $fetchOk = ($LASTEXITCODE -eq 0)
    if ($fetchOk) {
        git merge --ff-only --quiet "origin/$branch" 2>$null
        $mergeOk = ($LASTEXITCODE -eq 0)
    } else {
        $mergeOk = $false
    }
    if ($fetchOk -and $mergeOk) {
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
    } elseif ($fetchOk) {
        Write-Host "  The remote is reachable, but local changes or history blocked the update." -ForegroundColor Red
        Write-Host "  Refusing to launch an outdated dashboard. Commit/stash changes, then run git pull --ff-only." -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "  Remote unavailable - launching the local checkout." -ForegroundColor Yellow
    }
    $revision = (git rev-parse --short HEAD 2>$null)
    Write-Host "  Revision: $revision" -ForegroundColor DarkGray
}

# Electron's single-instance lock focuses an existing process and exits the new
# launch. Detect that case so start.ps1 cannot appear to restart while leaving
# an old dashboard running.
$existingListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($existingListener) {
    Write-Host "  Agent Matrix is already running (PID $($existingListener.OwningProcess))." -ForegroundColor Red
    Write-Host "  Quit it completely from the tray, then run .\start.ps1 again." -ForegroundColor Yellow
    exit 1
}

npm run electron:dev
