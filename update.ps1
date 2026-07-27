# Agent Matrix Update Script (Windows PowerShell)

$ErrorActionPreference = "Stop"

$env:NPM_CONFIG_REGISTRY = "https://packagefeedproxy.microsoft.io/npm/"
$env:NPM_CONFIG_REPLACE_REGISTRY_HOST = "never"
$env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"
$env:NO_UPDATE_NOTIFIER = "1"

Write-Host ""
Write-Host "  ================================" -ForegroundColor Blue
Write-Host "       Agent Matrix Update        " -ForegroundColor Blue
Write-Host "  ================================" -ForegroundColor Blue
Write-Host ""

# Find the AgentMatrix directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $scriptDir "electron\main.ts")) {
    $repoDir = $scriptDir
} elseif (Test-Path (Join-Path (Get-Location) "AgentMatrix\electron\main.ts")) {
    $repoDir = Join-Path (Get-Location) "AgentMatrix"
} elseif (Test-Path (Join-Path (Get-Location) "electron\main.ts")) {
    $repoDir = (Get-Location).Path
} else {
    Write-Host "Cannot find AgentMatrix repo. Run this from the repo or its parent directory." -ForegroundColor Red
    exit 1
}

Set-Location $repoDir
Write-Host "  Repo: $repoDir"
Write-Host ""

# Updating node_modules while Electron is running is unreliable on Windows
# because native binaries may be locked.
$existingListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($existingListener) {
    Write-Host "  Agent Matrix is running (PID $($existingListener.OwningProcess))." -ForegroundColor Red
    Write-Host "  Quit it completely from the tray, then run .\update.ps1 again." -ForegroundColor Yellow
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
        Write-Host "  [X] Could not restore generated package-lock.json." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Backed up generated package-lock changes to $backupFile" -ForegroundColor Green
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
        Write-Host "  [X] Could not install dependencies through $env:NPM_CONFIG_REGISTRY." -ForegroundColor Red
        Write-Host "      Authenticate the Microsoft mirror, then re-run." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
}

$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
    Write-Host "  [X] Update must run from the main branch." -ForegroundColor Red
    Write-Host "      Run: git switch main" -ForegroundColor Yellow
    exit 1
}

$before = (git rev-parse HEAD 2>$null)
$null = Backup-GeneratedLockfile

Write-Host "Pulling latest..." -ForegroundColor Blue
git fetch --quiet origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [X] Could not fetch origin/main. Check network access and try again." -ForegroundColor Red
    exit 1
}
git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [X] Could not fast-forward to origin/main." -ForegroundColor Red
    Write-Host "      Commit or stash the local files shown by 'git status', then retry." -ForegroundColor Yellow
    exit 1
}
$after = (git rev-parse HEAD 2>$null)
Write-Host "  [OK] Code updated to $($after.Substring(0, 7))" -ForegroundColor Green
Write-Host ""

$dependenciesChanged = -not (Test-Path node_modules)
git diff --quiet $before $after -- package.json package-lock.json 2>$null
if ($LASTEXITCODE -ne 0) { $dependenciesChanged = $true }

if ($dependenciesChanged) {
    Install-AgentMatrixDependencies
} else {
    Write-Host "Dependencies unchanged - keeping existing node_modules." -ForegroundColor DarkGray
}
Write-Host ""

# ── Native modules (node-pty) ─────────────────────────────────────────────
# node-pty ships N-API prebuilt binaries that work under both Node and Electron,
# so no electron-rebuild is needed (it downloads headers and hangs on blocked
# networks). Verify the prebuilt can spawn under Electron; only rebuild (bounded)
# if it can't. See setup.ps1 for detail.
Write-Host "Setting up native modules (node-pty)..." -ForegroundColor Blue

function Test-PtyWorks {
    $electron = Join-Path (Get-Location) "node_modules\.bin\electron.cmd"
    if (-not (Test-Path $electron)) { return $false }
    $env:ELECTRON_RUN_AS_NODE = "1"
    try {
        & $electron -e "const p=require('node-pty');const t=p.spawn(process.env.ComSpec||'cmd.exe',['/c','exit'],{});t.kill();" *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
}

if (Test-PtyWorks) {
    Write-Host "  [OK] node-pty prebuilt binary works under Electron — no rebuild needed" -ForegroundColor Green
} else {
    Write-Host "  [!] Prebuilt node-pty can't spawn — attempting a time-bounded rebuild..." -ForegroundColor Yellow
    $repoDir = (Get-Location).Path
    $job = Start-Job -ScriptBlock {
        param($d)
        Set-Location $d
        npm --no-update-notifier exec -- electron-rebuild -f -w node-pty
    } -ArgumentList $repoDir
    if (Wait-Job $job -Timeout 180) { Receive-Job $job | Out-Host } else {
        Stop-Job $job
        Write-Host "  [!] Rebuild timed out (likely blocked network) — the prebuilt binary should still work." -ForegroundColor Yellow
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if (Test-PtyWorks) { Write-Host "  [OK] Native modules ready" -ForegroundColor Green }
    else { Write-Host "  [!] node-pty still can't spawn — the app will report the exact error if the terminal fails." -ForegroundColor Yellow }
}
Write-Host ""

# Re-configure hooks
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$settingsFile = Join-Path $claudeDir "settings.json"

Write-Host "Configuring hooks..." -ForegroundColor Blue

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

$nodeScript = @"
const fs = require('fs');
const path = '$($settingsFile -replace '\\','\\\\')';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
const hooks = {
  SessionStart: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/session-start -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  SessionEnd: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/session-end -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  PreToolUse: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/tool-use -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  PostToolUse: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/tool-complete -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  SubagentStart: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/agent-start -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  SubagentStop: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/agent-stop -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}],
  Stop: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s --connect-timeout 1 -X POST http://localhost:3000/api/hooks/stop -H "Content-Type: application/json" -d @- 2>nul || ver>nul'}]}]
};
settings.hooks = { ...settings.hooks, ...hooks };
fs.writeFileSync(path, JSON.stringify(settings, null, 2));
console.log('Hooks configured');
"@
node -e $nodeScript

Write-Host "  [OK] Hooks configured" -ForegroundColor Green
Write-Host ""

# The running app refreshes the authoritative Copilot hook configuration before
# it launches managed sessions, so updates cannot restore a stale handler.
Write-Host "  [OK] Copilot hooks will refresh on Agent Matrix startup" -ForegroundColor Green
Write-Host ""

Write-Host "  ================================" -ForegroundColor Green
Write-Host "       Update complete!           " -ForegroundColor Green
Write-Host "  ================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Run to launch: .\start.ps1" -ForegroundColor Blue
Write-Host ""
