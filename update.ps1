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

# Pull latest
Write-Host "Pulling latest..." -ForegroundColor Blue
git pull
Write-Host "  [OK] Code updated" -ForegroundColor Green
Write-Host ""

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Blue
# See setup.ps1: use the Microsoft package proxy from the first request.
function Invoke-NpmInstallResilient {
    npm install --replace-registry-host=never --fetch-timeout=120000 --fetch-retry-maxtimeout=120000 --fetch-retries=2 2>&1 | Out-Host
    return ($LASTEXITCODE -eq 0)
}
if (-not (Invoke-NpmInstallResilient)) {
    $reg = (npm config get registry 2>$null)
    Write-Host "  [X] Could not install dependencies through $reg." -ForegroundColor Red
    Write-Host "      Authenticate the Microsoft mirror, then re-run."
    exit 1
}
Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
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
    $job = Start-Job -ScriptBlock { param($d) Set-Location $d; npx electron-rebuild -f -w node-pty } -ArgumentList $repoDir
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

# Refresh Copilot CLI hooks (user-level, HTTP-type with built-in timeout)
$copilotDir = Join-Path $env:USERPROFILE ".copilot"
$copilotHooksDir = Join-Path $copilotDir "hooks"
$copilotHooksFile = Join-Path $copilotHooksDir "agentmatrix.json"

$hasCopilot = $false
try { $null = Get-Command copilot -ErrorAction Stop; $hasCopilot = $true } catch { }
if (-not $hasCopilot -and (Test-Path $copilotDir)) { $hasCopilot = $true }

if ($hasCopilot) {
    Write-Host "Updating GitHub Copilot CLI hooks..." -ForegroundColor Blue
    if (-not (Test-Path $copilotHooksDir)) {
        New-Item -ItemType Directory -Path $copilotHooksDir -Force | Out-Null
    }
    $copilotHooksJson = @'
{
  "version": 1,
  "hooks": {
    "SessionStart": [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-start", "timeoutSec": 2 }],
    "SessionEnd":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-end",   "timeoutSec": 2 }],
    "PreToolUse":   [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-use",      "timeoutSec": 2 }],
    "PostToolUse":  [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-complete", "timeoutSec": 2 }],
    "SubagentStart":[{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-start",   "timeoutSec": 2 }],
    "SubagentStop": [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-stop",    "timeoutSec": 2 }],
    "Stop":          [{ "type": "http", "url": "http://localhost:3000/api/hooks/stop",          "timeoutSec": 2 }]
  }
}
'@
    Set-Content -Path $copilotHooksFile -Value $copilotHooksJson -Encoding UTF8
    Write-Host "  [OK] Copilot hooks updated in $copilotHooksFile" -ForegroundColor Green
    Write-Host ""
}

Write-Host "  ================================" -ForegroundColor Green
Write-Host "       Update complete!           " -ForegroundColor Green
Write-Host "  ================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Run to launch: .\start.ps1" -ForegroundColor Blue
Write-Host ""
