#!/usr/bin/env bash
#
# Universal One-Command Installer: Telegram AI Coding Agent
# Mendukung: macOS (Apple Silicon & Intel) dan Linux VPS (Ubuntu / Debian / dll.)
#
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🤖 Setup Otomatis: Telegram AI Coding Agent           ${NC}"
echo -e "${BLUE}   Mendukung Mac, Linux VPS & Raspberry Pi            ${NC}"
echo -e "${BLUE}======================================================${NC}"

REPO_URL="https://github.com/taufik-hdyt25/AIAgent.git"
INSTALL_DIR="th-agent"

OS="$(uname -s)"
ARCH="$(uname -m)"

IS_PI=false
if [ -f "/proc/device-tree/model" ] && grep -qi "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    IS_PI=true
elif grep -qi "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    IS_PI=true
elif [ -f "/etc/rpi-issue" ]; then
    IS_PI=true
fi

if [ "$IS_PI" = true ]; then
    echo -e "${GREEN}🍓 Sistem Terdeteksi: Raspberry Pi (Linux ${ARCH})${NC}"
else
    echo -e "${CYAN}Sistem Terdeteksi: ${OS} (${ARCH})${NC}"
fi

# ==============================================================================
# Helper Fungsi
# ==============================================================================

# Helper input interaktif yang tetap bekerja meskipun dijalankan via 'curl | bash'
prompt_user() {
    local text="$1"
    local var_name="$2"
    local reply=""
    if [ -t 0 ]; then
        read -rp "$text" reply
    elif [ -e /dev/tty ]; then
        read -rp "$text" reply < /dev/tty || reply=""
    else
        reply=""
    fi
    eval "$var_name=\"\$reply\""
}

# Auto clone jika installer dipanggil di luar folder repo (misal via curl | bash)
if [ ! -d "projects" ] || [ ! -d "telegram-ai-agent" ]; then
    echo -e "\n${CYAN}>>> Mengunduh repository Telegram AI Agent dari GitHub...${NC}"
    if ! command -v git &>/dev/null; then
        echo -e "${YELLOW}Git belum terpasang. Memasang git...${NC}"
        if [ "$OS" = "Darwin" ]; then
            xcode-select --install 2>/dev/null || true
        elif [ "$OS" = "Linux" ] && command -v apt-get &>/dev/null; then
            sudo apt-get update -y && sudo apt-get install -y git
        fi
    fi
    if [ -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Direktori ${INSTALL_DIR} sudah ada. Menggunakan direktori tersebut...${NC}"
        cd "$INSTALL_DIR"
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    echo -e "${GREEN}✓ Direktori kerja: $(pwd)${NC}"
fi

ensure_local_bin_in_path() {
    mkdir -p "$HOME/.local/bin"
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        export PATH="$HOME/.local/bin:$PATH"
        if [ -f "$HOME/.zshrc" ] && ! grep -q '\.local/bin' "$HOME/.zshrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ] && ! grep -q '\.local/bin' "$HOME/.bashrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
    fi
}

# ==============================================================================
# 1. CHECKLIST ENGINE AI
# ==============================================================================
SELECTED_AGY=false
SELECTED_CLAUDE=false
SELECTED_UNIVERSAL=false
DEFAULT_ENGINE="agy"

choose_engines() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[1/3] CHECKLIST ENGINE / PROVIDER AI                  ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Pilih AI Engine yang ingin dipasang dan diaktifkan di bot:"
    echo -e "  ${CYAN}[1] Antigravity CLI (agy)${NC}  - Google Gemini 3.8 Flash, Thinking & Pro"
    echo -e "  ${CYAN}[2] Claude Code CLI (claude)${NC} - Anthropic Claude 3.7 Sonnet, Opus & Haiku"
    echo -e "  ${CYAN}[3] Universal API (Zero-CLI)${NC} - DeepSeek V3/R1, OpenRouter, OpenAI (Direct API)"
    echo -e "  ${GREEN}[A] Pilih Semua (Select All)${NC} - Pasang & aktifkan semua engine (Rekomendasi)"
    echo ""
    prompt_user "Pilihan Anda (contoh: 1,2 atau 1,3 atau A) [default: A]: " engine_choice
    engine_choice="${engine_choice:-A}"

    case "$engine_choice" in
        *[aA]*)
            SELECTED_AGY=true
            SELECTED_CLAUDE=true
            SELECTED_UNIVERSAL=true
            DEFAULT_ENGINE="agy"
            ;;
        *)
            if [[ "$engine_choice" == *"1"* ]]; then SELECTED_AGY=true; fi
            if [[ "$engine_choice" == *"2"* ]]; then SELECTED_CLAUDE=true; fi
            if [[ "$engine_choice" == *"3"* ]]; then SELECTED_UNIVERSAL=true; fi

            if [ "$SELECTED_AGY" = true ]; then
                DEFAULT_ENGINE="agy"
            elif [ "$SELECTED_CLAUDE" = true ]; then
                DEFAULT_ENGINE="claude"
            elif [ "$SELECTED_UNIVERSAL" = true ]; then
                DEFAULT_ENGINE="universal"
            else
                SELECTED_AGY=true
                SELECTED_CLAUDE=true
                SELECTED_UNIVERSAL=true
                DEFAULT_ENGINE="agy"
            fi
            ;;
    esac

    echo -e "${GREEN}✓ Engine aktif:${NC}"
    [ "$SELECTED_AGY" = true ] && echo -e "  • Antigravity CLI (agy)"
    [ "$SELECTED_CLAUDE" = true ] && echo -e "  • Claude Code CLI (claude)"
    [ "$SELECTED_UNIVERSAL" = true ] && echo -e "  • Universal API (Zero-CLI / DeepSeek)"
    echo -e "  • Default Engine Awal: ${YELLOW}${DEFAULT_ENGINE}${NC}"
}

# ==============================================================================
# 2. CHECKLIST MODEL AI
# ==============================================================================
choose_models() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[2/3] CHECKLIST MODEL AI                              ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Model AI dapat diceklis/dipilih sesuai kebutuhan Anda."
    echo -e "Model yang tidak dipilih akan disembunyikan dari bot Telegram & Web UI."
    echo -e "  ${GREEN}[A] Gunakan Semua Model Default (Select All - Rekomendasi)${NC}"
    echo -e "  ${YELLOW}[C] Kustomisasi / Pilih Ceklis Sendiri${NC}"
    prompt_user "Pilihan model [A/C, default: A]: " model_mode
    model_mode="${model_mode:-A}"

    mkdir -p data

    if [[ "$model_mode" =~ ^[cC]$ ]]; then
        # Tampilkan pilihan per engine
        local agy_sel="A"
        local claude_sel="A"
        local univ_sel="A"

        if [ "$SELECTED_AGY" = true ]; then
            echo -e "\n${CYAN}--- Model Antigravity (agy) ---${NC}"
            echo -e "  [1] Gemini 3.8 Flash Medium (gemini-3.8-flash-medium) - Rekomendasi"
            echo -e "  [2] Gemini 3.8 Flash High   (gemini-3.8-flash-high)"
            echo -e "  [3] Gemini 3.8 Flash Low    (gemini-3.8-flash-low)"
            echo -e "  [4] Claude Sonnet 4.6       (claude-sonnet-4-6)"
            echo -e "  [5] Claude Opus 4.6         (claude-opus-4-6-thinking)"
            echo -e "  [6] GPT-OSS 120B            (gpt-oss-120b-medium)"
            echo -e "  ${GREEN}[A] Pilih Semua (Select All)${NC} | ${RED}[H] Hapus Semua${NC}"
            prompt_user "Pilih nomor model agy (contoh: 1,4 atau A atau H) [default: A]: " agy_sel
            agy_sel="${agy_sel:-A}"
        fi

        if [ "$SELECTED_CLAUDE" = true ]; then
            echo -e "\n${CYAN}--- Model Claude Code (claude) ---${NC}"
            echo -e "  [1] Claude Sonnet      (sonnet - Default)"
            echo -e "  [2] Claude Opus        (opus - Penalaran Kompleks)"
            echo -e "  [3] Claude Haiku       (haiku - Cepat & Ringan)"
            echo -e "  [4] Claude 3.7 Sonnet  (claude-3-7-sonnet - Hybrid Reasoning)"
            echo -e "  [5] Claude 3.5 Sonnet  (claude-3-5-sonnet - Coding Specialist)"
            echo -e "  [6] Claude 3.5 Haiku   (claude-3-5-haiku - Hemat & Cepat)"
            echo -e "  ${GREEN}[A] Pilih Semua (Select All)${NC} | ${RED}[H] Hapus Semua${NC}"
            prompt_user "Pilih nomor model claude (contoh: 1,4 atau A atau H) [default: A]: " claude_sel
            claude_sel="${claude_sel:-A}"
        fi

        if [ "$SELECTED_UNIVERSAL" = true ]; then
            echo -e "\n${CYAN}--- Model Universal API (Zero-CLI / DeepSeek) ---${NC}"
            echo -e "  [1] DeepSeek Chat V3/V4  (deepseek-chat - Official)"
            echo -e "  [2] DeepSeek Reasoner R1 (deepseek-reasoner - Official)"
            echo -e "  [3] DeepSeek V4          (deepseek/deepseek-v4 - OpenRouter)"
            echo -e "  [4] DeepSeek V3          (deepseek/deepseek-chat - OpenRouter)"
            echo -e "  [5] DeepSeek R1          (deepseek/deepseek-r1 - OpenRouter)"
            echo -e "  [6] Claude 3.7 Sonnet    (anthropic/claude-3.7-sonnet - OpenRouter)"
            echo -e "  [7] GPT-4o               (openai/gpt-4o - OpenRouter)"
            echo -e "  ${GREEN}[A] Pilih Semua (Select All)${NC} | ${RED}[H] Hapus Semua${NC}"
            prompt_user "Pilih nomor model universal (contoh: 1,2 atau A atau H) [default: A]: " univ_sel
            univ_sel="${univ_sel:-A}"
        fi

        # Filter dan tulis ke data/models.json menggunakan Node.js
        node -e "
        const fs = require('fs');
        const path = require('path');

        const allAgy = [
          { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium Thinking)', badge: 'Rekomendasi' },
          { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High Thinking)', badge: 'Maksimal' },
          { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low Thinking)', badge: 'Cepat' },
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', badge: 'Populer' },
          { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', badge: 'Kuat' },
          { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', badge: 'Open' }
        ];

        const allClaude = [
          { id: 'sonnet', name: 'Claude Sonnet (Default - Cepat & Cerdas)', badge: 'Default' },
          { id: 'opus', name: 'Claude Opus (Penalaran Kompleks)', badge: 'Kuat' },
          { id: 'haiku', name: 'Claude Haiku (Ultra Cepat & Ringan)', badge: 'Cepat' },
          { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)', badge: 'Thinking' },
          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Coding Specialist)', badge: 'Populer' },
          { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku (Cost Efficient)', badge: 'Hemat' }
        ];

        const allUniv = [
          { id: 'deepseek-chat', name: 'DeepSeek Chat (V3 / V4 - Cepat & Cerdas)', badge: 'Official' },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1 - Penalaran Mendalam)', badge: 'Official' },
          { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4 (OpenRouter)', badge: 'Terbaru' },
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', badge: 'Rekomendasi' },
          { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (OpenRouter)', badge: 'Thinking' },
          { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet (OpenRouter)', badge: 'Thinking' },
          { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', badge: 'Flagship' }
        ];

        function filterList(list, input) {
          const val = (input || '').trim().toUpperCase();
          if (val === 'H' || val === 'NONE' || val === '0') return [];
          if (!val || val === 'A' || val === 'ALL') return list;
          const nums = val.split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
          if (nums.length === 0) return list;
          return nums.map(idx => list[idx - 1]).filter(Boolean);
        }

        const out = {
          agyModels: filterList(allAgy, '${agy_sel}'),
          claudeModels: filterList(allClaude, '${claude_sel}'),
          universalModels: filterList(allUniv, '${univ_sel}')
        };

        fs.writeFileSync(path.join('data', 'models.json'), JSON.stringify(out, null, 2));
        console.log('✓ Model pilihan kustom berhasil disimpan ke data/models.json');
        "
    else
        # Select All Default
        node -e "
        const fs = require('fs');
        const path = require('path');
        const out = {
          agyModels: [
            { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium Thinking)', badge: 'Rekomendasi' },
            { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High Thinking)', badge: 'Maksimal' },
            { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low Thinking)', badge: 'Cepat' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', badge: 'Populer' },
            { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', badge: 'Kuat' },
            { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', badge: 'Open' }
          ],
          claudeModels: [
            { id: 'sonnet', name: 'Claude Sonnet (Default - Cepat & Cerdas)', badge: 'Default' },
            { id: 'opus', name: 'Claude Opus (Penalaran Kompleks)', badge: 'Kuat' },
            { id: 'haiku', name: 'Claude Haiku (Ultra Cepat & Ringan)', badge: 'Cepat' },
            { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)', badge: 'Thinking' },
            { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Coding Specialist)', badge: 'Populer' },
            { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku (Cost Efficient)', badge: 'Hemat' }
          ],
          universalModels: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat (V3 / V4 - Cepat & Cerdas)', badge: 'Official' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1 - Penalaran Mendalam)', badge: 'Official' },
            { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4 (OpenRouter)', badge: 'Terbaru' },
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', badge: 'Rekomendasi' },
            { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (OpenRouter)', badge: 'Thinking' },
            { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet (OpenRouter)', badge: 'Thinking' },
            { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', badge: 'Flagship' }
          ]
        };
        fs.writeFileSync(path.join('data', 'models.json'), JSON.stringify(out, null, 2));
        "
        echo -e "${GREEN}✓ Semua model default telah aktif (Select All).${NC}"
    fi
}

# ==============================================================================
# 3. GITHUB CLI & AUTO-READ ISSUES
# ==============================================================================
install_gh_cli() {
    echo -e "${BLUE}Memeriksa GitHub CLI (gh)...${NC}"
    ensure_local_bin_in_path
    if command -v gh &>/dev/null; then
        echo -e "${GREEN}✓ GitHub CLI sudah terpasang: $(command -v gh)${NC}"
        return 0
    fi

    echo -e "${YELLOW}GitHub CLI belum terpasang. Memulai pemasangan GitHub CLI...${NC}"
    if [ "$OS" = "Darwin" ]; then
        if command -v brew &>/dev/null; then
            echo -e "${CYAN}Memasang via Homebrew...${NC}"
            brew install gh || true
        fi
        if ! command -v gh &>/dev/null; then
            echo -e "${CYAN}Mengunduh binary resmi GitHub CLI macOS...${NC}"
            local m_arch="arm64"
            [ "$ARCH" != "arm64" ] && m_arch="amd64"
            local tmp_dir
            tmp_dir="$(mktemp -d)"
            curl -fsSL "https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_macOS_${m_arch}.zip" -o "$tmp_dir/gh.zip"
            unzip -q "$tmp_dir/gh.zip" -d "$tmp_dir"
            mkdir -p "$HOME/.local/bin"
            cp "$tmp_dir"/gh_*/bin/gh "$HOME/.local/bin/gh"
            chmod +x "$HOME/.local/bin/gh"
            rm -rf "$tmp_dir"
            export PATH="$HOME/.local/bin:$PATH"
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v apt-get &>/dev/null; then
            echo -e "${CYAN}Memasang via APT repository resmi GitHub...${NC}"
            (sudo mkdir -p -m 755 /etc/apt/keyrings && \
             curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
             sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
             echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
             sudo apt-get update -y && sudo apt-get install -y gh) || true
        fi
        if ! command -v gh &>/dev/null; then
            echo -e "${CYAN}Mengunduh binary resmi GitHub CLI Linux...${NC}"
            local l_arch="amd64"
            if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
                l_arch="arm64"
            fi
            local tmp_dir
            tmp_dir="$(mktemp -d)"
            curl -fsSL "https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_${l_arch}.tar.gz" -o "$tmp_dir/gh.tar.gz"
            tar -xzf "$tmp_dir/gh.tar.gz" -C "$tmp_dir"
            mkdir -p "$HOME/.local/bin"
            cp "$tmp_dir"/gh_*/bin/gh "$HOME/.local/bin/gh"
            chmod +x "$HOME/.local/bin/gh"
            rm -rf "$tmp_dir"
            export PATH="$HOME/.local/bin:$PATH"
        fi
    fi

    if command -v gh &>/dev/null || [ -f "$HOME/.local/bin/gh" ]; then
        echo -e "${GREEN}✓ GitHub CLI berhasil dipasang: $(command -v gh || echo "$HOME/.local/bin/gh")${NC}"
    else
        echo -e "${YELLOW}⚠️ Pemasangan otomatis gh dilewati. Anda bisa memasangnya secara manual nanti.${NC}"
    fi
}

setup_github_cli() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[3/3] INTEGRASI GITHUB CLI & AUTO-READ ISSUES        ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Opsi ini memungkinkan TH Agent membaca issue, komentar, dan kode"
    echo -e "secara otomatis saat Anda mengirimkan link GitHub Issue di Telegram."
    prompt_user "Pasang & aktifkan GitHub CLI sekarang? (y/n, default: y): " enable_gh
    enable_gh="${enable_gh:-y}"

    if [ "$enable_gh" = "y" ] || [ "$enable_gh" = "Y" ]; then
        install_gh_cli

        echo -e "\n${CYAN}Autentikasi GitHub Personal Access Token (PAT):${NC}"
        echo -e "Buat token di: ${BLUE}https://github.com/settings/tokens${NC} (centang scope: ${YELLOW}'repo'${NC})"
        prompt_user "Masukkan GitHub Personal Access Token (PAT) [kosongkan jika belum punya]: " input_pat
        if [ -n "$input_pat" ]; then
            local gh_bin
            gh_bin="$(command -v gh || echo "$HOME/.local/bin/gh")"
            if [ -x "$gh_bin" ]; then
                echo "$input_pat" | "$gh_bin" auth login --with-token 2>/dev/null || true
                echo -e "${GREEN}✓ GitHub CLI berhasil login dengan token!${NC}"
            fi
            # Simpan token ke .env
            if [ ! -f ".env" ]; then touch .env; fi
            if grep -q "^GITHUB_TOKEN=" .env; then
                sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=${input_pat}|" .env && rm -f .env.bak
            else
                echo "GITHUB_TOKEN=${input_pat}" >> .env
            fi
            echo -e "${GREEN}✓ GITHUB_TOKEN tersimpan di konfigurasi .env${NC}"
        else
            echo -e "${YELLOW}Token dilewati. Anda dapat mengisinya nanti via .env atau Web Control Panel.${NC}"
        fi

        # Aktifkan watcher di .env
        if grep -q "^GITHUB_WATCHER_ENABLED=" .env; then
            sed -i.bak "s|^GITHUB_WATCHER_ENABLED=.*|GITHUB_WATCHER_ENABLED=true|" .env && rm -f .env.bak
        else
            echo "GITHUB_WATCHER_ENABLED=true" >> .env
        fi
    else
        echo -e "${CYAN}Integrasi GitHub CLI & Watcher dinonaktifkan.${NC}"
        if [ ! -f ".env" ]; then touch .env; fi
        if grep -q "^GITHUB_WATCHER_ENABLED=" .env; then
            sed -i.bak "s|^GITHUB_WATCHER_ENABLED=.*|GITHUB_WATCHER_ENABLED=false|" .env && rm -f .env.bak
        else
            echo "GITHUB_WATCHER_ENABLED=false" >> .env
        fi
    fi
}

# ==============================================================================
# INSTALLERS SPESIFIK
# ==============================================================================
install_agy_cli() {
    echo -e "\n${BLUE}Memeriksa Antigravity CLI (agy)...${NC}"
    ensure_local_bin_in_path
    if ! command -v agy &>/dev/null && [ ! -f "$HOME/.local/bin/agy" ]; then
        echo -e "${YELLOW}Antigravity CLI belum terpasang. Mengunduh installer resmi...${NC}"
        curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- -d "$HOME/.local/bin"
        export PATH="$HOME/.local/bin:$PATH"
        echo -e "${GREEN}✓ Antigravity CLI berhasil dipasang.${NC}"
    else
        echo -e "${GREEN}✓ Antigravity CLI terdeteksi: $(command -v agy || echo "$HOME/.local/bin/agy")${NC}"
    fi
}

install_claude_cli() {
    echo -e "\n${BLUE}Memeriksa Claude Code CLI...${NC}"
    if ! command -v claude &>/dev/null; then
        echo -e "${YELLOW}Claude Code CLI belum terpasang. Memasang via npm...${NC}"
        npm install -g @anthropic-ai/claude-code 2>/dev/null || sudo npm install -g @anthropic-ai/claude-code 2>/dev/null || npm install @anthropic-ai/claude-code || true
    else
        echo -e "${GREEN}✓ Claude Code CLI terdeteksi: $(command -v claude)${NC}"
    fi
}

setup_directories() {
    echo -e "\n${BLUE}Menyiapkan direktori kerja...${NC}"
    mkdir -p projects telegram-ai-agent/data telegram-ai-agent/logs telegram-ai-agent/uploads telegram-ai-agent/gemini_auth telegram-ai-agent/claude_auth telegram-ai-agent/public
    chmod 755 projects 2>/dev/null || true
    chmod -R u+rwX,g+rwX telegram-ai-agent/data telegram-ai-agent/logs telegram-ai-agent/uploads telegram-ai-agent/gemini_auth telegram-ai-agent/claude_auth 2>/dev/null || true
    local target_user="${SUDO_USER:-$USER}"
    if [ -n "$target_user" ]; then
        chown -R "$target_user" projects telegram-ai-agent/data telegram-ai-agent/logs telegram-ai-agent/uploads telegram-ai-agent/gemini_auth telegram-ai-agent/claude_auth 2>/dev/null || true
    fi

    # Bersihkan jika ada folder data/logs/uploads usang di root level
    for d in data logs uploads public; do
        if [ -d "$d" ] && [ ! -L "$d" ]; then
            cp -rn "$d"/* "telegram-ai-agent/$d/" 2>/dev/null || true
            rm -rf "$d" 2>/dev/null || true
        fi
    done
    echo -e "${GREEN}✓ Direktori siap (Hanya projects/ dan telegram-ai-agent/).${NC}"
}

setup_env_file() {
    echo -e "\n${BLUE}Menyiapkan file konfigurasi .env...${NC}"
    local env_file="telegram-ai-agent/.env"
    if [ ! -d "telegram-ai-agent" ]; then
        env_file=".env"
    fi

    if [ ! -f "$env_file" ]; then
        if [ -f "telegram-ai-agent/.env.example" ]; then
            cp telegram-ai-agent/.env.example "$env_file"
        elif [ -f ".env.example" ]; then
            cp .env.example "$env_file"
        else
            touch "$env_file"
        fi
    fi

    # Deteksi path binary aktual di sistem ini
    ACTUAL_AGY_BIN="$(command -v agy || echo "$HOME/.local/bin/agy")"
    ACTUAL_CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"

    # Perbarui path binary & default engine di .env
    if grep -q "^AGY_BIN=" "$env_file"; then
        sed -i.bak "s|^AGY_BIN=.*|AGY_BIN=${ACTUAL_AGY_BIN}|" "$env_file" && rm -f "$env_file.bak"
    else
        echo "AGY_BIN=${ACTUAL_AGY_BIN}" >> "$env_file"
    fi

    if grep -q "^CLAUDE_BIN=" "$env_file"; then
        sed -i.bak "s|^CLAUDE_BIN=.*|CLAUDE_BIN=${ACTUAL_CLAUDE_BIN}|" "$env_file" && rm -f "$env_file.bak"
    else
        echo "CLAUDE_BIN=${ACTUAL_CLAUDE_BIN}" >> "$env_file"
    fi

    if grep -q "^CLI_ENGINE=" "$env_file"; then
        sed -i.bak "s|^CLI_ENGINE=.*|CLI_ENGINE=${DEFAULT_ENGINE}|" "$env_file" && rm -f "$env_file.bak"
    else
        echo "CLI_ENGINE=${DEFAULT_ENGINE}" >> "$env_file"
    fi

    if ! grep -q "^AGY_AUTO_APPROVE_PERMISSIONS=" "$env_file"; then
        echo "AGY_AUTO_APPROVE_PERMISSIONS=true" >> "$env_file"
    fi

    if ! grep -q "^AGY_MODEL=" "$env_file"; then
        echo "AGY_MODEL=gemini-3.8-flash-medium" >> "$env_file"
    fi

    if ! grep -q "^UNIVERSAL_BASE_URL=" "$env_file"; then
        echo "UNIVERSAL_BASE_URL=https://api.deepseek.com/v1" >> "$env_file"
    fi

    if ! grep -q "^UNIVERSAL_MODEL=" "$env_file"; then
        echo "UNIVERSAL_MODEL=deepseek-chat" >> "$env_file"
    fi

    # Cek apakah BOT_TOKEN dan ALLOWED_TELEGRAM_IDS sudah terisi
    CURRENT_TOKEN="$(grep -E "^BOT_TOKEN=" "$env_file" | cut -d '=' -f2- | tr -d ' ' || true)"
    CURRENT_IDS="$(grep -E "^ALLOWED_TELEGRAM_IDS=" "$env_file" | cut -d '=' -f2- | tr -d ' ' || true)"

    if [ -z "$CURRENT_TOKEN" ]; then
        echo -e "${YELLOW}BOT_TOKEN masih kosong.${NC}"
        prompt_user "Masukkan BOT_TOKEN dari @BotFather (atau tekan Enter untuk isi nanti di Web UI): " input_token
        if [ -n "$input_token" ]; then
            sed -i.bak "s|^BOT_TOKEN=.*|BOT_TOKEN=${input_token}|" "$env_file" && rm -f "$env_file.bak"
        fi
    fi

    if [ -z "$CURRENT_IDS" ]; then
        echo -e "${YELLOW}ALLOWED_TELEGRAM_IDS belum diset.${NC}"
        prompt_user "Masukkan User ID Telegram Anda (atau tekan Enter untuk isi nanti di Web UI): " input_id
        if [ -n "$input_id" ]; then
            sed -i.bak "s|^ALLOWED_TELEGRAM_IDS=.*|ALLOWED_TELEGRAM_IDS=${input_id}|" "$env_file" && rm -f "$env_file.bak"
        fi
    fi

    chmod 600 "$env_file" 2>/dev/null || true

    # Bersihkan file .env di root jika ada agar tidak mengotori workspace
    if [ "$env_file" != ".env" ] && [ -f ".env" ]; then
        rm -f .env .env.bak 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ Konfigurasi .env siap.${NC}"
}

# ==============================================================================
# ALUR INSTALASI
# ==============================================================================

if [ "$OS" = "Darwin" ]; then
    # --------------------------------------------------------------------------
    # MAC LOCAL INSTALLATION (Clean Isolated Workspace)
    # --------------------------------------------------------------------------
    echo -e "\n${CYAN}>>> Mode Instalasi: Local macOS (Clean Isolated Workspace)${NC}"

    # 1. Cek Node.js & npm
    if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
        echo -e "${RED}Node.js belum terpasang.${NC}"
        if command -v brew &>/dev/null; then
            echo -e "${YELLOW}Memasang Node.js via Homebrew...${NC}"
            brew install node
        else
            echo -e "${RED}Harap pasang Node.js (v20+ atau v22+) dari https://nodejs.org terlebih dahulu.${NC}"
            exit 1
        fi
    fi
    echo -e "${GREEN}✓ Node.js terdeteksi: $(node -v) / npm: $(npm -v)${NC}"

    # 2. Interaktif: Checklist Engine, Model, dan GitHub CLI
    choose_engines
    choose_models
    setup_github_cli

    # 3. Pasang CLI yang dipilih
    if [ "$SELECTED_AGY" = true ]; then
        install_agy_cli
    fi
    if [ "$SELECTED_CLAUDE" = true ]; then
        install_claude_cli
    fi

    # 4. Direktori & .env
    setup_directories
    setup_env_file

    # 5. Cek Autentikasi CLI (khusus jika agy aktif)
    if [ "$SELECTED_AGY" = true ]; then
        echo -e "\n${BLUE}Memeriksa status login Antigravity CLI...${NC}"
        AGY_EXE="$(command -v agy || echo "$HOME/.local/bin/agy")"
        if [ -f "$HOME/.gemini/antigravity-cli/settings.json" ] || [ -d "$HOME/.gemini" ]; then
            echo -e "${GREEN}✓ Sesi Antigravity CLI ($HOME/.gemini) terdeteksi.${NC}"
        else
            echo -e "${YELLOW}Antigravity CLI belum login di Mac ini.${NC}"
            prompt_user "Apakah ingin melakukan login Antigravity sekarang? (y/n, default: y): " do_auth
            if [ "$do_auth" != "n" ] && [ "$do_auth" != "N" ]; then
                "$AGY_EXE" || true
            fi
        fi
    fi

    # 6. Bundle bot & LaunchAgent background service (Clean Isolated Workspace)
    echo -e "\n${BLUE}Menyiapkan single-file bundle & macOS LaunchAgent background service...${NC}"
    if [ -f "./telegram-ai-agent/scripts/setup-mac.sh" ]; then
        bash ./telegram-ai-agent/scripts/setup-mac.sh
    elif [ -f "./setup-mac.sh" ]; then
        bash ./setup-mac.sh
    elif [ -f "../setup-mac.sh" ]; then
        bash ../setup-mac.sh
    else
        echo -e "${RED}setup-mac.sh tidak ditemukan.${NC}"
        exit 1
    fi

elif [ "$OS" = "Linux" ]; then
    # --------------------------------------------------------------------------
    # LINUX VPS INSTALLATION
    # --------------------------------------------------------------------------
    echo -e "\n${CYAN}>>> Mode Instalasi: Linux VPS${NC}"
    echo -e "Pilih metode instalasi yang diinginkan:"
    echo -e "  ${BLUE}1)${NC} ${GREEN}Native Standalone (Node.js + PM2)${NC} - Direkomendasikan (Sangat ringan, hemat RAM 1GB-2GB)"
    echo -e "  ${BLUE}2)${NC} ${CYAN}Docker Container (Docker + Compose)${NC} - Isolasi penuh container"
    prompt_user "Pilihan Anda [1/2, default 1]: " vps_choice
    vps_choice="${vps_choice:-1}"

    if [ "$vps_choice" = "2" ]; then
        # Mode Docker
        echo -e "\n${CYAN}Memulai instalasi via Docker...${NC}"
        if ! command -v docker &>/dev/null; then
            echo -e "${YELLOW}Docker belum terpasang. Menginstall Docker...${NC}"
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker "$USER" 2>/dev/null || true
        fi

        if docker compose version &>/dev/null; then
            DOCKER_COMPOSE="docker compose"
        elif command -v docker-compose &>/dev/null; then
            DOCKER_COMPOSE="docker-compose"
        else
            sudo apt-get update && sudo apt-get install -y docker-compose-plugin || true
            DOCKER_COMPOSE="docker compose"
        fi

        choose_engines
        choose_models
        setup_github_cli

        setup_directories
        setup_env_file

        echo -e "\n${BLUE}Membangun dan menjalankan container Docker...${NC}"
        $DOCKER_COMPOSE build
        $DOCKER_COMPOSE up -d

        echo -e "\n${GREEN}✓ Container aktif!${NC}"
        echo -e "Lakukan login agy dengan menjalankan: ${BLUE}./auth.sh${NC}"
    else
        # Mode Native VPS (PM2)
        echo -e "\n${CYAN}Memulai instalasi Native Standalone (Node.js + PM2)...${NC}"

        if command -v apt-get &>/dev/null; then
            echo -e "${BLUE}Memperbarui package dan menginstall dependensi dasar...${NC}"
            sudo apt-get update -y
            sudo apt-get install -y curl git build-essential procps unzip
        fi

        if ! command -v node &>/dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
            echo -e "${YELLOW}Menginstall Node.js 22 LTS...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
        echo -e "${GREEN}✓ Node.js terdeteksi: $(node -v)${NC}"

        if ! command -v pm2 &>/dev/null; then
            echo -e "${BLUE}Menginstall PM2 process manager...${NC}"
            sudo npm install -g pm2
        fi

        choose_engines
        choose_models
        setup_github_cli

        if [ "$SELECTED_AGY" = true ]; then
            install_agy_cli
        fi
        if [ "$SELECTED_CLAUDE" = true ]; then
            install_claude_cli
        fi

        setup_directories
        setup_env_file

        echo -e "\n${BLUE}Menginstall dependensi proyek (npm install)...${NC}"
        if [ -d "telegram-ai-agent" ]; then
            cd telegram-ai-agent
        fi
        npm install

        if [ "$SELECTED_AGY" = true ]; then
            AGY_EXE="$(command -v agy || echo "$HOME/.local/bin/agy")"
            if [ ! -f "$HOME/.gemini/antigravity-cli/settings.json" ] && [ ! -d "$HOME/.gemini" ]; then
                echo -e "\n${YELLOW}Silakan login Antigravity CLI sekarang:${NC}"
                "$AGY_EXE" || true
            fi
        fi

        echo -e "\n${BLUE}Menjalankan bot via PM2 di background...${NC}"
        pm2 start ecosystem.config.cjs
        pm2 save || true

        echo -e "\n${GREEN}======================================================${NC}"
        if [ "$IS_PI" = true ]; then
            echo -e "${GREEN}🎉 INSTALASI RASPBERRY PI BERHASIL SELESAI!          ${NC}"
        else
            echo -e "${GREEN}🎉 INSTALASI VPS / LINUX BERHASIL SELESAI!            ${NC}"
        fi
        echo -e "${GREEN}======================================================${NC}"
        echo -e "Status Process:"
        pm2 status
        echo ""
        WEB_PORT_VAL="$(grep -E "^WEB_PORT=" .env | cut -d '=' -f2- | tr -d ' ' || echo "3030")"
        WEB_PORT_VAL="${WEB_PORT_VAL:-3030}"
        echo -e "${CYAN}Web UI Control Panel:${NC} ${BLUE}http://IP_SERVER_ANDA:${WEB_PORT_VAL}${NC}"
        echo -e "• Cek log live:   ${BLUE}pm2 logs telegram-coding-agent${NC}"
        echo -e "• Restart bot:    ${BLUE}pm2 restart telegram-coding-agent${NC}"
        echo -e "• Hentikan bot:   ${BLUE}pm2 stop telegram-coding-agent${NC}"
        if [ "$IS_PI" = true ]; then
            echo -e "\n${CYAN}🍓 Ingin bot aktif otomatis 24/7 via systemd saat Raspberry Pi dinyalakan?${NC}"
            if [ -f "scripts/setup-pi-autostart.sh" ]; then
            echo -e "   Cukup jalankan: ${BLUE}bash scripts/setup-pi-autostart.sh${NC}"
        else
            echo -e "   Cukup jalankan: ${BLUE}bash telegram-ai-agent/scripts/setup-pi-autostart.sh${NC}"
        fi
        fi
    fi
fi
