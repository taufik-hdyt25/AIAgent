#!/usr/bin/env bash
#
# One-Command Installer: Telegram AI Coding Agent dengan Docker
# Mendukung: Ubuntu, Debian, dan macOS
#
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🤖 Setup Otomatis: Telegram AI Coding Agent (Docker)  ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Cek / Install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker belum terpasang. Menginstall Docker...${NC}"
    if [ "$(uname)" = "Linux" ]; then
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker "$USER" || true
        echo -e "${GREEN}Docker berhasil diinstall!${NC}"
    else
        echo -e "${RED}Harap install Docker Desktop terlebih dahulu untuk macOS.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Docker terdeteksi: $(docker --version)${NC}"
fi

# Cek Docker Compose
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED}Docker Compose tidak ditemukan. Harap install plugin docker-compose.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose terdeteksi.${NC}"

# 2. Persiapan Folder
echo -e "\n${BLUE}[1/4] Mempersiapkan direktori...${NC}"
mkdir -p data logs projects gemini_auth

# Jika di host sudah ada login ~/.gemini, salin ke ./gemini_auth agar langsung bisa dipakai
if [ -d "$HOME/.gemini" ] && [ ! -f "gemini_auth/settings.json" ]; then
    echo -e "${GREEN}Menyalin sesi autentikasi agy dari $HOME/.gemini ke ./gemini_auth...${NC}"
    cp -rn "$HOME/.gemini/"* gemini_auth/ 2>/dev/null || true
fi

# Pastikan permission aman
chmod 777 data logs projects gemini_auth 2>/dev/null || true

# 3. Konfigurasi .env
echo -e "\n${BLUE}[2/4] Memeriksa konfigurasi .env...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}File .env belum ditemukan. Membuat dari template...${NC}"
    cp .env.example .env

    read -rp "Masukkan BOT_TOKEN dari @BotFather: " input_token
    read -rp "Masukkan ALLOWED_TELEGRAM_IDS (User ID Anda): " input_id

    if [ -n "$input_token" ]; then
        sed -i.bak "s|BOT_TOKEN=.*|BOT_TOKEN=${input_token}|" .env && rm -f .env.bak
    fi
    if [ -n "$input_id" ]; then
        sed -i.bak "s|ALLOWED_TELEGRAM_IDS=.*|ALLOWED_TELEGRAM_IDS=${input_id}|" .env && rm -f .env.bak
    fi
    # Set default permission di Docker container
    sed -i.bak "s|AGY_AUTO_APPROVE_PERMISSIONS=.*|AGY_AUTO_APPROVE_PERMISSIONS=true|" .env && rm -f .env.bak
    sed -i.bak "s|AGY_BIN=.*|AGY_BIN=/home/coder/.local/bin/agy|" .env && rm -f .env.bak
fi

chmod 600 .env
echo -e "${GREEN}✓ File .env siap.${NC}"

# 4. Build dan Jalankan Container
echo -e "\n${BLUE}[3/4] Melakukan build image Docker (Node.js 22 + Antigravity CLI)...${NC}"
$DOCKER_COMPOSE build

echo -e "\n${BLUE}[4/4] Menjalankan Telegram Coding Agent di background...${NC}"
$DOCKER_COMPOSE up -d

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}🎉 Telegram AI Coding Agent BERHASIL DIJALANKAN!      ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "Status Container:"
$DOCKER_COMPOSE ps

echo -e "\n${YELLOW}📌 Langkah Penting (Autentikasi Antigravity CLI):${NC}"
echo -e "Jika belum pernah login Antigravity CLI di VPS ini, jalankan:"
echo -e "   ${BLUE}./auth.sh${NC}"
echo -e "untuk menyelesaikan login secara interaktif di dalam container."

echo -e "\n${YELLOW}📜 Perintah Praktis:${NC}"
echo -e "• Lihat live log:   ${BLUE}$DOCKER_COMPOSE logs -f${NC}"
echo -e "• Restart bot:      ${BLUE}$DOCKER_COMPOSE restart${NC}"
echo -e "• Hentikan bot:     ${BLUE}$DOCKER_COMPOSE down${NC}"
echo ""
