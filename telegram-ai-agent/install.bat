@echo off
title TH Agent - Windows Installer
echo ========================================================
echo   Menjalankan Installer Otomatis TH Agent di Windows...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create((irm 'https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/telegram-ai-agent/install.ps1')))"
pause
