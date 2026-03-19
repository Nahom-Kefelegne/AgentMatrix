# Agent Matrix Update Script (Windows PowerShell)

$ErrorActionPreference = "Stop"

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
npm install
Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
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

Write-Host "  ================================" -ForegroundColor Green
Write-Host "       Update complete!           " -ForegroundColor Green
Write-Host "  ================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Run to launch: .\start.ps1" -ForegroundColor Blue
Write-Host ""
