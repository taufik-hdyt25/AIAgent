#!/usr/bin/env bash
#
# Helper Autentikasi (Pi CLI + CLIProxyAPI)
# Pi CLI tidak memerlukan login interaktif: ia memakai PI_SERVER_URL +
# PI_SERVER_API_KEY. Login provider (Gemini/Claude/Codex) dilakukan di
# CLIProxyAPI, bukan di bot ini.
#
set -e

echo "============================================="
echo "🔑 Autentikasi TH Agent (Pi CLI)"
echo "============================================="
echo "Pi Coding Agent CLI terhubung ke endpoint OpenAI-compatible."
echo "Atur variabel berikut di .env atau Web UI:"
echo "  • PI_SERVER_URL     (default: http://127.0.0.1:8317/v1)"
echo "  • PI_SERVER_API_KEY (opsional)"
echo ""
echo "Login provider dilakukan di CLIProxyAPI:"
echo "  • Antigravity/Gemini/Claude/Codex -> login di CLIProxyAPI"
echo "  • Lalu pastikan endpoint /v1 CLIProxyAPI dapat diakses Pi CLI"
echo ""
echo "Cek koneksi endpoint:"
echo "  curl -s \"\${PI_SERVER_URL:-http://127.0.0.1:8317/v1}/models\""
echo ""
echo "Tidak ada langkah login interaktif yang diperlukan di host ini."
