#!/usr/bin/env bash
set -e

echo "============================================="
echo "🔑 Login / Autentikasi Antigravity CLI"
echo "============================================="
echo "Menjalankan agy CLI secara interaktif di container..."
echo ""

docker compose run --rm telegram-coding-agent agy

echo ""
echo "✅ Autentikasi selesai. Sesi disimpan di folder ./gemini_auth"
