# Agent Matrix Setup Script (Windows PowerShell)
# Checks prerequisites, configures Claude + Copilot hooks, installs dependencies
# (resilient to blocked npm mirrors), sets up native modules, and launches the app.

$ErrorActionPreference = "Stop"

$env:NPM_CONFIG_REGISTRY = "https://packagefeedproxy.microsoft.io/npm/"
$env:NPM_CONFIG_REPLACE_REGISTRY_HOST = "npmjs"
$env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"
$env:NO_UPDATE_NOTIFIER = "1"

Write-Host ""
Write-Host "  ================================" -ForegroundColor Blue
Write-Host "       Agent Matrix Setup         " -ForegroundColor Blue
Write-Host "  ================================" -ForegroundColor Blue
Write-Host ""

$missing = 0

# Check Node.js
try {
    $nodeVersion = node -v 2>$null
    Write-Host "  [OK] Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [X] Node.js not found" -ForegroundColor Red
    Write-Host "      Install from: https://nodejs.org/"
    $missing = 1
}

# Check npm
try {
    $npmVersion = npm -v 2>$null
    Write-Host "  [OK] npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "  [X] npm not found (comes with Node.js)" -ForegroundColor Red
    $missing = 1
}

# Check GitHub Copilot CLI (primary) and Claude CLI — at least one is required.
$haveCli = $false
try {
    $null = Get-Command copilot -ErrorAction Stop
    Write-Host "  [OK] GitHub Copilot CLI found (primary)" -ForegroundColor Green
    $haveCli = $true
} catch {
    Write-Host "  [!] GitHub Copilot CLI not found (recommended primary)" -ForegroundColor Yellow
    Write-Host "      Install from: https://github.com/github/copilot-cli"
}

try {
    $null = Get-Command claude -ErrorAction Stop
    Write-Host "  [OK] Claude CLI found" -ForegroundColor Green
    $haveCli = $true
} catch {
    Write-Host "  [!] Claude CLI not found" -ForegroundColor Yellow
    Write-Host "      Install from: https://docs.anthropic.com/en/docs/claude-code"
}

if (-not $haveCli) {
    Write-Host "  [X] Neither GitHub Copilot CLI nor Claude CLI found — install at least one." -ForegroundColor Red
    $missing = 1
}

# Check git
try {
    $null = Get-Command git -ErrorAction Stop
    Write-Host "  [OK] git found" -ForegroundColor Green
} catch {
    Write-Host "  [X] git not found" -ForegroundColor Red
    Write-Host "      Install from: https://git-scm.com/"
    $missing = 1
}

# Check az CLI (optional)
try {
    $null = Get-Command az -ErrorAction Stop
    Write-Host "  [OK] Azure CLI found (ADO integration available)" -ForegroundColor Green
} catch {
    Write-Host "  [!] Azure CLI not found (ADO integration won't be available)" -ForegroundColor Yellow
    Write-Host "      Optional: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
}

Write-Host ""

if ($missing -eq 1) {
    Write-Host "Missing required tools. Install them and run this script again." -ForegroundColor Red
    exit 1
}

Write-Host "All required tools found!" -ForegroundColor Green
Write-Host ""

# Configure Claude hooks
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$settingsFile = Join-Path $claudeDir "settings.json"

Write-Host "Configuring Claude Code hooks..." -ForegroundColor Blue

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Use Node.js to merge hooks (avoids PowerShell ConvertFrom-Json immutability issues)
# Hooks use --connect-timeout 1 + silent fail so Claude/Copilot commands run
# from terminal don't hang when Agent Matrix isn't running.
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
console.log('Hooks configured successfully (silent-fail when app not running)');
"@
node -e $nodeScript

Write-Host "  [OK] Hooks configured in $settingsFile" -ForegroundColor Green
Write-Host ""

# The app owns the Copilot hook file and refreshes it before any managed
# session starts. Keeping one runtime-generated source of truth prevents setup
# from restoring stale or blocking PreToolUse handlers.
Write-Host "  [OK] Copilot hooks will be configured on Agent Matrix startup" -ForegroundColor Green
Write-Host ""

# If not in repo, clone it
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $scriptDir "electron\main.ts"))) {
    $repoDir = Join-Path (Get-Location) "AgentMatrix"
    if (Test-Path (Join-Path $repoDir ".git")) {
        Write-Host "Updating repo..." -ForegroundColor Blue
        Set-Location $repoDir
        git pull
    } else {
        Write-Host "Cloning Agent Matrix..." -ForegroundColor Blue
        git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git $repoDir
        Set-Location $repoDir
    }
    Write-Host "  [OK] Repo at $repoDir" -ForegroundColor Green
    Write-Host ""
} else {
    Set-Location $scriptDir
}

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Blue
# Project .npmrc + the environment above force lockfile tarballs through the
# Microsoft package proxy from the first request. Never probe public npm first.
function Invoke-NpmInstallResilient {
    npm --no-update-notifier ci `
        --registry="$env:NPM_CONFIG_REGISTRY" `
        --replace-registry-host=npmjs `
        --prefer-offline `
        --fetch-timeout=30000 `
        --fetch-retry-maxtimeout=30000 `
        --fetch-retries=1 `
        --no-audit --no-fund --no-progress
    return ($LASTEXITCODE -eq 0)
}
if (-not (Invoke-NpmInstallResilient)) {
    $reg = (npm --no-update-notifier config get registry 2>$null)
    Write-Host "  [X] Could not install dependencies." -ForegroundColor Red
    Write-Host "      The Microsoft package proxy isn't usable. Fix the mirror auth:"
    Write-Host "        - Registry: $reg"
    Write-Host "        - Azure Artifacts (Windows): npx vsts-npm-auth -config .npmrc -F"
    Write-Host "          (or add a Packaging-read PAT to your user .npmrc), then re-run this script."
    exit 1
}
& node scripts/dependency-state.mjs check
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [X] Dependencies installed, but their state could not be verified." -ForegroundColor Red
    exit 1
}
Write-Host ""

# ── Native modules (node-pty) ─────────────────────────────────────────────
# node-pty ships N-API prebuilt binaries (prebuilds/<platform>-<arch>/) that are
# ABI-stable across Node AND Electron, so NO electron-rebuild is needed — which
# matters because electron-rebuild downloads Electron C++ headers from the
# internet and HANGS on networks where public downloads are blocked (e.g.
# corporate/Microsoft). Verify the prebuilt binary can spawn under Electron's
# runtime; only if it can't do we attempt a (time-bounded) rebuild.
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
        Write-Host "  [!] Rebuild timed out (likely blocked network fetching Electron headers)." -ForegroundColor Yellow
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if (Test-PtyWorks) {
        Write-Host "  [OK] Native modules ready" -ForegroundColor Green
    } else {
        Write-Host "  [X] node-pty still can't spawn. On a network that blocks public downloads," -ForegroundColor Red
        Write-Host "      do NOT run electron-rebuild (it hangs fetching Electron headers) — the"
        Write-Host "      prebuilt N-API binary is sufficient. Try reinstalling node-pty, or run"
        Write-Host "      the app anyway; the terminal will report the exact spawn error if it fails."
    }
}
Write-Host ""

Write-Host "  ================================" -ForegroundColor Green
Write-Host "       Setup complete!            " -ForegroundColor Green
Write-Host "  ================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To launch anytime, run: $(Get-Location)\start.ps1" -ForegroundColor Blue
Write-Host ""

$launch = Read-Host "Launch Agent Matrix now? (y/n)"
if ($launch -eq "y") {
    & "$(Get-Location)\start.ps1"
}
