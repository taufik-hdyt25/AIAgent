# ==============================================================================
# 🪟 TH Agent - Windows Uninstaller & Power Settings Restore
# ==============================================================================

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🗑️  Menghapus Background Service TH Agent di Windows..." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Hentikan Task Scheduler
Write-Host "Menghentikan TH Agent background task..." -ForegroundColor Yellow
try {
    & schtasks /end /tn "THAgent" 2>$null
    & schtasks /delete /tn "THAgent" /f 2>$null
    Write-Host "✓ Task Scheduler 'THAgent' berhasil dihapus." -ForegroundColor Green
} catch {
    Write-Host "⚠️ Task Scheduler sudah tidak ada." -ForegroundColor DarkGray
}

# 2. Hentikan proses node bot.bundle.js yang sedang berjalan
Write-Host "Menghentikan proses bot yang sedang aktif..." -ForegroundColor Yellow
try {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*bot.bundle.js*" } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "✓ Proses bot berhasil dihentikan." -ForegroundColor Green
} catch {}

# 3. Kembalikan Pengaturan Daya Windows ke Default
Write-Host "Mengembalikan pengaturan daya Windows ke standar laptop..." -ForegroundColor Yellow
try {
    & powercfg -change -monitor-timeout-ac 10
    & powercfg -change -monitor-timeout-dc 5
    & powercfg -change -standby-timeout-ac 30
    & powercfg -change -standby-timeout-dc 15
    Write-Host "✓ Pengaturan powercfg berhasil dikembalikan ke standar normal." -ForegroundColor Green
} catch {
    Write-Host "⚠️ Gagal mereset powercfg: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "================================================================" -ForegroundColor Green
Write-Host "🎉 TH Agent di Windows berhasil dinonaktifkan sepenuhnya!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
