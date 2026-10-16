#!/usr/bin/env bash
set -e

CHOICE="${1:-agy}"

if [ "$CHOICE" = "claude" ]; then
    echo "============================================="
    echo "🔑 Login / Autentikasi Claude Code CLI"
    echo "============================================="
    echo "Menjalankan Claude CLI secara interaktif di container..."
    echo ""
    docker compose run --rm telegram-coding-agent claude
    echo ""
    echo "✅ Autentikasi selesai. Sesi disimpan di folder ./claude_auth"
else
    echo "============================================="
    echo "🔑 Login / Autentikasi Antigravity CLI"
    echo "============================================="
    echo "Menjalankan agy CLI secara interaktif di container..."
    echo ""
    docker compose run --rm telegram-coding-agent agy
    echo ""
    echo "✅ Autentikasi selesai. Sesi disimpan di folder ./gemini_auth"
fi

