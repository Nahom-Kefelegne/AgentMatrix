# Agent Matrix Setup Script (Windows PowerShell)
# Checks prerequisites, configures Claude hooks, and launches the app.

$ErrorActionPreference = "Stop"

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

# Check Claude CLI
try {
    $null = Get-Command claude -ErrorAction Stop
    Write-Host "  [OK] Claude CLI found" -ForegroundColor Green
} catch {
    Write-Host "  [X] Claude CLI not found" -ForegroundColor Red
    Write-Host "      Install from: https://docs.anthropic.com/en/docs/claude-code"
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

# Configure GitHub Copilot CLI hooks
# Copilot supports user-level hooks at ~/.copilot/hooks/*.json with native
# HTTP hook type. Built-in timeoutSec means they fail silently when Agent
# Matrix isn't running.
$copilotDir = Join-Path $env:USERPROFILE ".copilot"
$copilotHooksDir = Join-Path $copilotDir "hooks"
$copilotHooksFile = Join-Path $copilotHooksDir "agentmatrix.json"

$hasCopilot = $false
try { $null = Get-Command copilot -ErrorAction Stop; $hasCopilot = $true } catch { }
if (-not $hasCopilot -and (Test-Path $copilotDir)) { $hasCopilot = $true }

if ($hasCopilot) {
    Write-Host "Configuring GitHub Copilot CLI hooks..." -ForegroundColor Blue
    if (-not (Test-Path $copilotHooksDir)) {
        New-Item -ItemType Directory -Path $copilotHooksDir -Force | Out-Null
    }

    # PascalCase event names → snake_case payload fields matching Claude hooks
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
    "AgentStop":    [{ "type": "http", "url": "http://localhost:3000/api/hooks/stop",          "timeoutSec": 2 }]
  }
}
'@
    Set-Content -Path $copilotHooksFile -Value $copilotHooksJson -Encoding UTF8
    Write-Host "  [OK] Copilot hooks configured in $copilotHooksFile" -ForegroundColor Green
} else {
    Write-Host "  [!] Copilot CLI not detected — skipping Copilot hook setup" -ForegroundColor Yellow
}
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
npm install
Write-Host ""

# Rebuild node-pty for Electron
Write-Host "Rebuilding native modules for Electron..." -ForegroundColor Blue
try {
    npx electron-rebuild -m . -o node-pty 2>$null
    Write-Host "  [OK] Native modules rebuilt" -ForegroundColor Green
} catch {
    Write-Host "  [!] electron-rebuild failed. You may need: npm install --global windows-build-tools" -ForegroundColor Yellow
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
