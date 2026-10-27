# ==============================================================================
# 🪟 TH Agent - Windows Single-Command Setup (Clean Isolated Mode)
# Menyiapkan TH Agent di Windows agar berjalan 24/7 di background tanpa mengotori
# workspace kerja (Zero node_modules di folder projects!).
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$SkipPowerConfig
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🪟 Menyiapkan TH Agent di Windows (Isolated Clean Workspace)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Cek Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "❌ Node.js tidak ditemukan di sistem Windows Anda." -ForegroundColor Red
    Write-Host "💡 Silakan install Node.js via winget:" -ForegroundColor Yellow
    Write-Host "   winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    exit 1
}

$nodeVer = & node -v
Write-Host "✓ Node.js terdeteksi: $($nodeCmd.Source) ($nodeVer)" -ForegroundColor Green

# 2. Cek Git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Host "❌ Git tidak ditemukan di sistem Windows Anda." -ForegroundColor Red
    Write-Host "💡 Silakan install Git via winget:" -ForegroundColor Yellow
    Write-Host "   winget install Git.Git" -ForegroundColor Cyan
    exit 1
}

# 3. Tentukan Root Workspace & Folder Projects
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path "$ScriptDir\package.json") {
    $AgentDir = $ScriptDir
} elseif (Test-Path "$ScriptDir\..\package.json") {
    $AgentDir = (Resolve-Path "$ScriptDir\..").Path
} elseif (Test-Path "$ScriptDir\..\telegram-ai-agent\package.json") {
    $AgentDir = (Resolve-Path "$ScriptDir\..\telegram-ai-agent").Path
} else {
    $AgentDir = (Get-Location).Path
}

if (Test-Path "$AgentDir\..\projects") {
    $WorkspaceDir = (Resolve-Path "$AgentDir\..").Path
} elseif (Test-Path "$ScriptDir\..\..\projects") {
    $WorkspaceDir = (Resolve-Path "$ScriptDir\..\..").Path
} else {
    $WorkspaceDir = $AgentDir
}

$ProjectsDir = Join-Path $WorkspaceDir "projects"
if (-not (Test-Path $ProjectsDir)) {
    New-Item -ItemType Directory -Path $ProjectsDir -Force | Out-Null
}

Write-Host "✓ Workspace Root: $WorkspaceDir" -ForegroundColor Green
Write-Host "✓ Folder Projects: $ProjectsDir" -ForegroundColor Green

# 4. Direktori Terisolasi di User Profile ($env:USERPROFILE\.th-agent)
$GlobalAgentDir = Join-Path $env:USERPROFILE ".th-agent"
$LogsDir = Join-Path $GlobalAgentDir "logs"
$DataDir = Join-Path $GlobalAgentDir "data"
$UploadsDir = Join-Path $GlobalAgentDir "uploads"

New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $UploadsDir -Force | Out-Null

# 5. Build Single-File Bundle (Zero node_modules di workspace!)
Write-Host "📦 Mem-bundle engine TH Agent menjadi single-file bundle..." -ForegroundColor Blue
Set-Location $AgentDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Mengunduh dependensi sementara untuk bundling..." -ForegroundColor Blue
    & npm install --silent
}

$EntryFile = "src/bot.js"
if (-not (Test-Path $EntryFile)) {
    if (Test-Path "$WorkspaceDir\telegram-ai-agent\src\bot.js") {
        $EntryFile = "$WorkspaceDir\telegram-ai-agent\src\bot.js"
    } elseif (Test-Path "$WorkspaceDir\src\bot.js") {
        $EntryFile = "$WorkspaceDir\src\bot.js"
    }
}

$OutBundle = Join-Path $GlobalAgentDir "bot.bundle.js"
& npx -y esbuild "$EntryFile" --bundle --platform=node --format=esm `
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" `
  --target=node26 --outfile="$OutBundle"

# Bersihkan node_modules sementara di folder kerja
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
}

# Salin public dashboard & .env ke isolated dir
if (Test-Path "public") {
    Copy-Item -Path "public" -Destination $GlobalAgentDir -Recurse -Force -ErrorAction SilentlyContinue
} elseif (Test-Path "$WorkspaceDir\public") {
    Copy-Item -Path "$WorkspaceDir\public" -Destination $GlobalAgentDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path ".env") {
    Copy-Item -Path ".env" -Destination (Join-Path $GlobalAgentDir ".env") -Force -ErrorAction SilentlyContinue
} elseif (Test-Path "$WorkspaceDir\.env") {
    Copy-Item -Path "$WorkspaceDir\.env" -Destination (Join-Path $GlobalAgentDir ".env") -Force -ErrorAction SilentlyContinue
}

# 6. Mode Hemat Baterai & Daya (Layar Mati 5 Menit, Komputer Tetap ON 24/7)
if (-not $SkipPowerConfig) {
    Write-Host "🔋 Mengonfigurasi mode hemat daya (Layar mati 5 menit, bot tetap terjaga 24/7)..." -ForegroundColor Yellow
    try {
        & powercfg -change -monitor-timeout-ac 5
        & powercfg -change -monitor-timeout-dc 5
        & powercfg -change -standby-timeout-ac 0
        & powercfg -change -standby-timeout-dc 0
        Write-Host "✓ Powercfg disetel: Monitor padam setelah 5 menit, Sleep dinonaktifkan." -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Gagal menyetel powercfg secara otomatis: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 7. Daftarkan Silent Background Runner & Task Scheduler
Write-Host "⚙️  Mendaftarkan Background Task Scheduler Windows..." -ForegroundColor Blue

$VbsLauncher = Join-Path $GlobalAgentDir "run-agent-hidden.vbs"
$BatLauncher = Join-Path $GlobalAgentDir "run-agent.bat"

$BatContent = @"
@echo off
set PROJECTS_DIR=$ProjectsDir
set WORKSPACE_DIR=$WorkspaceDir
set WEB_PORT=3030
set NODE_ENV=production
cd /d "$GlobalAgentDir"
node "$OutBundle" >> "$LogsDir\windows-bot.log" 2>> "$LogsDir\windows-error.log"
"@
Set-Content -Path $BatLauncher -Value $BatContent -Encoding ASCII

$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$BatLauncher""", 0, False
"@
Set-Content -Path $VbsLauncher -Value $VbsContent -Encoding ASCII

# Stop old task if exists
try {
    & schtasks /end /tn "THAgent" 2>$null
    & schtasks /delete /tn "THAgent" /f 2>$null
} catch {}

# Register task to run on logon silently
try {
    & schtasks /create /tn "THAgent" /tr "wscript.exe `"$VbsLauncher`"" /sc onlogon /f | Out-Null
} catch {}

# Start immediately
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$VbsLauncher`""

Write-Host "================================================================" -ForegroundColor Green
Write-Host "🎉 SUKSES! TH Agent sudah terpasang rapi di Windows!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "📁 Workspace Anda: $WorkspaceDir" -ForegroundColor Cyan
Write-Host "   └── 📂 projects\ (Buka folder ini di VS Code / Cursor!)" -ForegroundColor Yellow
Write-Host ""
Write-Host "✨ Status Background Agent:" -ForegroundColor Cyan
Write-Host "   • Engine bot: Terisolasi di $GlobalAgentDir" -ForegroundColor Yellow
Write-Host "   • Auto-Start: Aktif via Windows Task Scheduler (On Logon)" -ForegroundColor Green
Write-Host "   • Anti-Sleep: Layar padam 5 menit, sistem terjaga 24/7" -ForegroundColor Green
Write-Host "   • Web Dashboard: http://localhost:3030" -ForegroundColor Cyan
Write-Host "   • Log Output: Get-Content -Wait `"$LogsDir\windows-bot.log`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 Untuk menghapus background service & reset daya kapan saja: .\scripts\uninstall-windows.ps1" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Green
