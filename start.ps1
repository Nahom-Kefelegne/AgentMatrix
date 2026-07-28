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

if ($env:AGENTMATRIX_SESSION_ID) {
    Write-Host "  Refusing to restart Agent Matrix from a session it is hosting." -ForegroundColor Red
    Write-Host "  Restarting here would disconnect this conversation." -ForegroundColor Yellow
    Write-Host "  Run $((Get-Location).Path)\start.ps1 from a separate terminal instead." -ForegroundColor Yellow
    exit 1
}

# Electron's single-instance lock would otherwise focus an old process and make
# this command look like a successful restart.
$existingListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($existingListener) {
    Write-Host "  Agent Matrix is already running (PID $($existingListener.OwningProcess))." -ForegroundColor Red
    Write-Host "  Quit it completely from the tray, then run .\start.ps1 again." -ForegroundColor Yellow
    exit 1
}

function Backup-GeneratedLockfile {
    git diff --quiet HEAD -- package-lock.json 2>$null
    if ($LASTEXITCODE -eq 0) { return $false }

    $backupDir = Join-Path $env:USERPROFILE ".agentmatrix\update-backups"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backupFile = Join-Path $backupDir "$(Get-Date -Format 'yyyyMMdd-HHmmss')-package-lock.patch"
    $patch = (git diff --binary HEAD -- package-lock.json | Out-String)
    [System.IO.File]::WriteAllText($backupFile, $patch, [System.Text.UTF8Encoding]::new($false))
    git restore --source=HEAD --staged --worktree -- package-lock.json
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Could not restore generated package-lock.json." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Backed up generated package-lock changes to $backupFile" -ForegroundColor Green
    return $true
}

function Install-AgentMatrixDependencies {
    Write-Host "Installing dependencies from the Microsoft mirror..." -ForegroundColor Blue
    & npm --no-update-notifier ci `
        --registry="$env:NPM_CONFIG_REGISTRY" `
        --replace-registry-host=never `
        --prefer-offline `
        --fetch-timeout=30000 `
        --fetch-retry-maxtimeout=30000 `
        --fetch-retries=1 `
        --no-audit --no-fund --no-progress
    if ($LASTEXITCODE -ne 0) {
        $revision = (git rev-parse --short HEAD 2>$null)
        $nodeVersion = (& node --version 2>$null)
        $npmVersion = (& npm --version 2>$null)
        Write-Host "  Dependency install failed." -ForegroundColor Red
        Write-Host "  Revision: $revision" -ForegroundColor Yellow
        Write-Host "  Runtime: Node $nodeVersion, npm $npmVersion" -ForegroundColor Yellow
        Write-Host "  Registry: $env:NPM_CONFIG_REGISTRY" -ForegroundColor Yellow
        Write-Host "  If npm reports an out-of-sync lockfile, run .\update.ps1 and retry." -ForegroundColor Yellow
        exit 1
    }
    & node scripts/dependency-state.mjs check
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Dependencies installed, but their state could not be verified." -ForegroundColor Red
        exit 1
    }
}

$needsDependencies = -not (Test-Path node_modules)
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

    $null = Backup-GeneratedLockfile

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
            git diff --quiet $before $after -- package.json package-lock.json 2>$null
            if ($LASTEXITCODE -ne 0) {
                $needsDependencies = $true
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

if (-not $needsDependencies) {
    & node scripts/dependency-state.mjs check
    if ($LASTEXITCODE -ne 0) { $needsDependencies = $true }
}

if ($needsDependencies) {
    Install-AgentMatrixDependencies
} else {
    Write-Host "  Dependencies match package-lock.json" -ForegroundColor Green
}

npm --no-update-notifier run electron:dev
