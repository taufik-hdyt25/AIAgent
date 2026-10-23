#!/usr/bin/env bash
#
# Helper Autentikasi / Login CLI (Antigravity & Claude Code)
# Mendukung: Native macOS, Native Linux, dan Docker Container
#
set -e

CHOICE="${1:-agy}"

# Periksa apakah Docker container sedang berjalan
IS_DOCKER_RUNNING=false
if command -v docker &>/dev/null; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "telegram-coding-agent"; then
        IS_DOCKER_RUNNING=true
    fi
fi

if [ "$IS_DOCKER_RUNNING" = true ]; then
    echo "============================================="
    echo "🔑 Autentikasi di dalam Docker Container"
    echo "============================================="
    if [ "$CHOICE" = "claude" ]; then
        echo "Menjalankan Claude Code CLI di container..."
        docker compose run --rm telegram-coding-agent claude
        echo "✅ Autentikasi selesai. Sesi disimpan di ./claude_auth"
    else
        echo "Menjalankan Antigravity CLI (agy) di container..."
        docker compose run --rm telegram-coding-agent agy
        echo "✅ Autentikasi selesai. Sesi disimpan di ./gemini_auth"
    fi
else
    echo "============================================="
    echo "🔑 Autentikasi Langsung di Komputer / Host"
    echo "============================================="
    if [ "$CHOICE" = "claude" ]; then
        CLAUDE_CMD="$(command -v claude || echo "$HOME/.local/bin/claude")"
        if ! command -v "$CLAUDE_CMD" &>/dev/null; then
            echo "Claude CLI belum terpasang. Menginstall via npm..."
            npm install -g @anthropic-ai/claude-code || npm install @anthropic-ai/claude-code
        fi
        echo "Menjalankan Claude Code CLI secara interaktif..."
        "$CLAUDE_CMD"
    else
        AGY_CMD="$(command -v agy || echo "$HOME/.local/bin/agy")"
        if ! command -v "$AGY_CMD" &>/dev/null; then
            echo "Antigravity CLI (agy) belum ditemukan. Menginstall..."
            mkdir -p "$HOME/.local/bin"
            curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- -d "$HOME/.local/bin"
            export PATH="$HOME/.local/bin:$PATH"
            AGY_CMD="$HOME/.local/bin/agy"
        fi
        echo "Menjalankan Antigravity CLI (agy) secara interaktif..."
        "$AGY_CMD"
    fi
    echo "✅ Autentikasi selesai!"
fi
