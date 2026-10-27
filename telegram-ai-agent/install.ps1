# ==============================================================================
# 🤖 Universal One-Command Installer: Telegram AI Coding Agent (Windows)
# Mendukung: Windows 10, Windows 11 & Windows Server (PowerShell 5.1 & PS 7+)
# ==============================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Blue
Write-Host "🤖 Setup Otomatis: Telegram AI Coding Agent (Windows)  " -ForegroundColor Blue
Write-Host "   Mendukung Windows 10, Windows 11 & Windows Server   " -ForegroundColor Blue
Write-Host "======================================================" -ForegroundColor Blue

$RepoUrl = "https://github.com/taufik-hdyt25/AIAgent.git"
$InstallDir = "th-agent"

# 1. Cek Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "⚠️ Node.js belum terpasang di komputer ini." -ForegroundColor Yellow
    Write-Host "Mengunduh & memasang Node.js LTS via winget..." -ForegroundColor Cyan
    try {
        & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } catch {
        Write-Host "❌ Gagal menginstal Node.js otomatis. Silakan unduh manual dari: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

$nodeVer = & node -v
Write-Host "✓ Node.js terdeteksi: $nodeVer" -ForegroundColor Green

# 2. Cek Git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Host "⚠️ Git belum terpasang di komputer ini." -ForegroundColor Yellow
    Write-Host "Mengunduh & memasang Git via winget..." -ForegroundColor Cyan
    try {
        & winget install Git.Git --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } catch {
        Write-Host "❌ Gagal menginstal Git otomatis. Silakan unduh manual dari: https://git-scm.com" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✓ Git terdeteksi" -ForegroundColor Green

# 3. Lokasi Instalasi
$TargetFolder = Join-Path $env:USERPROFILE $InstallDir
if (-not (Test-Path (Join-Path $TargetFolder ".git"))) {
    Write-Host "📥 Mengunduh repository TH Agent ke $TargetFolder..." -ForegroundColor Cyan
    & git clone --depth 1 $RepoUrl $TargetFolder
} else {
    Write-Host "✓ Repository sudah ada di $TargetFolder. Memperbarui..." -ForegroundColor Green
    Set-Location $TargetFolder
    & git pull origin main 2>$null
}

Set-Location $TargetFolder
$AgentDir = Join-Path $TargetFolder "telegram-ai-agent"
if (-not (Test-Path $AgentDir)) {
    $AgentDir = $TargetFolder
}

# 4. Konfigurasi .env (Interaktif jika belum ada)
$EnvFile = Join-Path $AgentDir ".env"
$GlobalEnv = Join-Path $env:USERPROFILE ".th-agent\.env"

if (-not (Test-Path $EnvFile) -and (Test-Path $GlobalEnv)) {
    Copy-Item -Path $GlobalEnv -Destination $EnvFile -Force
}

if (-not (Test-Path $EnvFile)) {
    Write-Host ""
    Write-Host "📝 Konfigurasi Awal Telegram Bot:" -ForegroundColor Cyan
    $botToken = Read-Host "Masukkan BOT_TOKEN Telegram dari @BotFather"
    $allowedIds = Read-Host "Masukkan ID Telegram Anda (angka dari @userinfobot)"

    $envContent = @"
BOT_TOKEN=$($botToken.Trim())
ALLOWED_TELEGRAM_IDS=$($allowedIds.Trim())
CLI_ENGINE=agy
AGY_MODEL=gemini-3.8-flash-high
WEB_PORT=3030
NODE_ENV=production
"@
    Set-Content -Path $EnvFile -Value $envContent -Encoding ASCII
    Write-Host "✓ File .env berhasil dibuat!" -ForegroundColor Green
} else {
    Write-Host "✓ Konfigurasi .env sudah tersedia." -ForegroundColor Green
}

# 5. Jalankan Setup Windows Runner
Write-Host ""
Write-Host "🚀 Menjalankan setup background service Windows..." -ForegroundColor Cyan
$SetupScript = Join-Path $AgentDir "scripts\setup-windows.ps1"
if (Test-Path $SetupScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $SetupScript
} else {
    Write-Host "❌ Script setup-windows.ps1 tidak ditemukan di $SetupScript" -ForegroundColor Red
    exit 1
}
