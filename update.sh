#!/usr/bin/env bash
#
# Script Update Instan AIAgent (TH Agent)
# Memperbarui kode ke versi terbaru dari GitHub tanpa instal ulang
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🔄 Update Instan: Telegram AI Coding Agent (TH Agent) ${NC}"
echo -e "${BLUE}======================================================${NC}"

echo -e "${CYAN}Mengambil info pembaruan dari GitHub (origin/main)...${NC}"
git fetch origin main

LOCAL_COMMIT=$(git rev-parse --short HEAD)
REMOTE_COMMIT=$(git rev-parse --short origin/main)

echo -e "Commit Lokal  : ${YELLOW}${LOCAL_COMMIT}${NC}"
echo -e "Commit Remote : ${GREEN}${REMOTE_COMMIT}${NC}"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ] && [ "$1" != "--force" ]; then
    echo -e "\n${GREEN}✅ TH Agent sudah berada di versi paling mutakhir! Tidak perlu update.${NC}"
    echo -e "Gunakan './update.sh --force' jika ingin memaksa restart & sinkronisasi ulang."
    exit 0
fi

echo -e "\n${CYAN}📦 Mengunduh pembaruan (${LOCAL_COMMIT} -> ${REMOTE_COMMIT})...${NC}"
git pull origin main

echo -e "\n${CYAN}🔄 Memulai ulang container telegram-coding-agent...${NC}"
docker compose restart telegram-coding-agent

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}🎉 Sukses! TH Agent telah diperbarui ke ${REMOTE_COMMIT} & aktif!${NC}"
echo -e "${GREEN}======================================================${NC}"
