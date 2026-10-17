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
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🤖 Setup Otomatis: Telegram AI Coding Agent           ${NC}"
echo -e "${BLUE}   Mendukung Local Mac & Linux VPS (Sekali Install)   ${NC}"
echo -e "${BLUE}======================================================${NC}"

REPO_URL="https://github.com/taufik-hdyt25/AIAgent.git"
INSTALL_DIR="telegram-ai-agent"

OS="$(uname -s)"
ARCH="$(uname -m)"
echo -e "${CYAN}Sistem Terdeteksi: ${OS} (${ARCH})${NC}"

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
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
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
        # Tambahkan ke profil shell jika belum ada
        if [ -f "$HOME/.zshrc" ] && ! grep -q '\.local/bin' "$HOME/.zshrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ] && ! grep -q '\.local/bin' "$HOME/.bashrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
    fi
}

install_agy_cli() {
    echo -e "${BLUE}Memeriksa Antigravity CLI (agy)...${NC}"
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
    echo -e "${BLUE}Memeriksa Claude Code CLI...${NC}"
    if ! command -v claude &>/dev/null; then
        echo -e "${YELLOW}Claude Code CLI belum terpasang. Memasang via npm...${NC}"
        npm install -g @anthropic-ai/claude-code 2>/dev/null || npm install @anthropic-ai/claude-code || true
    else
        echo -e "${GREEN}✓ Claude Code CLI terdeteksi: $(command -v claude)${NC}"
    fi
}

setup_directories() {
    echo -e "\n${BLUE}[1/4] Menyiapkan direktori kerja...${NC}"
    mkdir -p data logs projects uploads gemini_auth claude_auth public
    chmod 755 data logs projects uploads 2>/dev/null || true
    echo -e "${GREEN}✓ Direktori siap.${NC}"
}

setup_env_file() {
    echo -e "\n${BLUE}[2/4] Menyiapkan file konfigurasi .env...${NC}"
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
        else
            touch .env
        fi
    fi

    # Deteksi path binary aktual di sistem ini
    ACTUAL_AGY_BIN="$(command -v agy || echo "$HOME/.local/bin/agy")"
    ACTUAL_CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"

    # Perbarui path binary di .env agar sesuai sistem host
    if grep -q "^AGY_BIN=" .env; then
        sed -i.bak "s|^AGY_BIN=.*|AGY_BIN=${ACTUAL_AGY_BIN}|" .env && rm -f .env.bak
    else
        echo "AGY_BIN=${ACTUAL_AGY_BIN}" >> .env
    fi

    if grep -q "^CLAUDE_BIN=" .env; then
        sed -i.bak "s|^CLAUDE_BIN=.*|CLAUDE_BIN=${ACTUAL_CLAUDE_BIN}|" .env && rm -f .env.bak
    else
        echo "CLAUDE_BIN=${ACTUAL_CLAUDE_BIN}" >> .env
    fi

    if ! grep -q "^AGY_AUTO_APPROVE_PERMISSIONS=" .env; then
        echo "AGY_AUTO_APPROVE_PERMISSIONS=true" >> .env
    fi

    if ! grep -q "^AGY_MODEL=" .env; then
        echo "AGY_MODEL=gemini-3.8-flash-medium" >> .env
    fi

    # Cek apakah BOT_TOKEN dan ALLOWED_TELEGRAM_IDS sudah terisi
    CURRENT_TOKEN="$(grep -E "^BOT_TOKEN=" .env | cut -d '=' -f2- | tr -d ' ' || true)"
    CURRENT_IDS="$(grep -E "^ALLOWED_TELEGRAM_IDS=" .env | cut -d '=' -f2- | tr -d ' ' || true)"

    if [ -z "$CURRENT_TOKEN" ]; then
        echo -e "${YELLOW}BOT_TOKEN masih kosong.${NC}"
        prompt_user "Masukkan BOT_TOKEN dari @BotFather (atau tekan Enter untuk isi nanti di Web UI): " input_token
        if [ -n "$input_token" ]; then
            sed -i.bak "s|^BOT_TOKEN=.*|BOT_TOKEN=${input_token}|" .env && rm -f .env.bak
        fi
    fi

    if [ -z "$CURRENT_IDS" ]; then
        echo -e "${YELLOW}ALLOWED_TELEGRAM_IDS belum diset.${NC}"
        prompt_user "Masukkan User ID Telegram Anda (atau tekan Enter untuk isi nanti di Web UI): " input_id
        if [ -n "$input_id" ]; then
            sed -i.bak "s|^ALLOWED_TELEGRAM_IDS=.*|ALLOWED_TELEGRAM_IDS=${input_id}|" .env && rm -f .env.bak
        fi
    fi

    chmod 600 .env 2>/dev/null || true
    echo -e "${GREEN}✓ Konfigurasi .env siap.${NC}"
}

# ==============================================================================
# ALUR INSTALASI
# ==============================================================================

if [ "$OS" = "Darwin" ]; then
    # --------------------------------------------------------------------------
    # MAC LOCAL INSTALLATION
    # --------------------------------------------------------------------------
    echo -e "\n${CYAN}>>> Mode Instalasi: Local macOS (Direct Native)${NC}"

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

    # 2. Pasang Antigravity CLI & Claude Code CLI
    install_agy_cli
    install_claude_cli

    # 3. Direktori & .env
    setup_directories
    setup_env_file

    # 4. Install dependensi Node.js
    echo -e "\n${BLUE}[3/4] Menginstall dependensi proyek (npm install)...${NC}"
    npm install

    # 5. Cek Autentikasi CLI
    echo -e "\n${BLUE}[4/4] Memeriksa status login model AI...${NC}"
    AGY_EXE="$(command -v agy || echo "$HOME/.local/bin/agy")"
    if [ -f "$HOME/.gemini/antigravity-cli/settings.json" ] || [ -d "$HOME/.gemini" ]; then
        echo -e "${GREEN}✓ Sesi Antigravity CLI ($HOME/.gemini) terdeteksi.${NC}"
    else
        echo -e "${YELLOW}Antigravity CLI belum login di Mac ini.${NC}"
        prompt_user "Apakah ingin melakukan login sekarang? (y/n, default: y): " do_auth
        if [ "$do_auth" != "n" ] && [ "$do_auth" != "N" ]; then
            "$AGY_EXE" || true
        fi
    fi

    echo -e "\n${GREEN}======================================================${NC}"
    echo -e "${GREEN}🎉 INSTALASI DI MAC BERHASIL SELESAI!                  ${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${CYAN}Web UI Control Panel siap di:${NC} ${BLUE}http://localhost:3000${NC}"
    echo -e "Anda dapat mengatur Token, ID, dan Model langsung lewat browser."
    echo ""
    echo -e "${YELLOW}Untuk menjalankan bot sekarang:${NC}"
    echo -e "   ${BLUE}npm start${NC}"
    echo ""
    echo -e "${YELLOW}Atau hanya menjalankan Web UI Settings:${NC}"
    echo -e "   ${BLUE}npm run ui${NC}"
    echo ""

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

        # Pasang dependensi sistem jika Debian/Ubuntu
        if command -v apt-get &>/dev/null; then
            echo -e "${BLUE}Memperbarui package dan menginstall dependensi dasar...${NC}"
            sudo apt-get update -y
            sudo apt-get install -y curl git build-essential procps
        fi

        # Cek Node.js 20+
        if ! command -v node &>/dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
            echo -e "${YELLOW}Menginstall Node.js 22 LTS...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
        echo -e "${GREEN}✓ Node.js terdeteksi: $(node -v)${NC}"

        # Pasang PM2 secara global
        if ! command -v pm2 &>/dev/null; then
            echo -e "${BLUE}Menginstall PM2 process manager...${NC}"
            sudo npm install -g pm2
        fi

        # Pasang agy & claude
        install_agy_cli
        install_claude_cli

        setup_directories
        setup_env_file

        echo -e "\n${BLUE}Menginstall dependensi proyek (npm install)...${NC}"
        npm install

        # Autentikasi agy
        AGY_EXE="$(command -v agy || echo "$HOME/.local/bin/agy")"
        if [ ! -f "$HOME/.gemini/antigravity-cli/settings.json" ] && [ ! -d "$HOME/.gemini" ]; then
            echo -e "\n${YELLOW}Silakan login Antigravity CLI sekarang:${NC}"
            "$AGY_EXE" || true
        fi

        # Jalankan di background dengan PM2
        echo -e "\n${BLUE}Menjalankan bot via PM2 di background...${NC}"
        pm2 start ecosystem.config.cjs
        pm2 save || true

        echo -e "\n${GREEN}======================================================${NC}"
        echo -e "${GREEN}🎉 INSTALASI VPS BERHASIL SELESAI!                    ${NC}"
        echo -e "${GREEN}======================================================${NC}"
        echo -e "Status Process:"
        pm2 status
        echo ""
        echo -e "${CYAN}Web UI Control Panel:${NC} ${BLUE}http://IP_VPS_ANDA:3000${NC}"
        echo -e "• Cek log live:   ${BLUE}pm2 logs telegram-coding-agent${NC}"
        echo -e "• Restart bot:    ${BLUE}pm2 restart telegram-coding-agent${NC}"
        echo -e "• Hentikan bot:   ${BLUE}pm2 stop telegram-coding-agent${NC}"
    fi
fi
