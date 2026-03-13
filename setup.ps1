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
$nodeScript = @"
const fs = require('fs');
const path = '$($settingsFile -replace '\\','\\\\')';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
const hooks = {
  SessionStart: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/session-start -H "Content-Type: application/json" -d @-'}]}],
  SessionEnd: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/session-end -H "Content-Type: application/json" -d @-'}]}],
  PreToolUse: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/tool-use -H "Content-Type: application/json" -d @-'}]}],
  PostToolUse: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/tool-complete -H "Content-Type: application/json" -d @-'}]}],
  SubagentStart: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/agent-start -H "Content-Type: application/json" -d @-'}]}],
  SubagentStop: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/agent-stop -H "Content-Type: application/json" -d @-'}]}],
  Stop: [{matcher: '', hooks: [{type: 'command', command: 'curl.exe -s -X POST http://localhost:3000/api/hooks/stop -H "Content-Type: application/json" -d @-'}]}]
};
settings.hooks = { ...settings.hooks, ...hooks };
fs.writeFileSync(path, JSON.stringify(settings, null, 2));
console.log('Hooks configured successfully');
"@
node -e $nodeScript

Write-Host "  [OK] Hooks configured in $settingsFile" -ForegroundColor Green
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
