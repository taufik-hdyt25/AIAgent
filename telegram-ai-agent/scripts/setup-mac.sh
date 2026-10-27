#!/bin/bash
# ==============================================================================
# 🍎 TH Agent - macOS Single-Command Setup (Clean Isolated Mode)
# Menyiapkan TH Agent di Mac agar berjalan 24/7 di background tanpa mengotori
# workspace kerja (Zero node_modules di folder projects!).
# ==============================================================================

set -e

# Warna terminal
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}🍎 Menyiapkan TH Agent di macOS (Isolated Clean Workspace)${NC}"
echo -e "${CYAN}================================================================${NC}"

# 1. Cek Sistem Operasi
if [ "$(uname -s)" != "Darwin" ]; then
  echo -e "${YELLOW}⚠️ Script ini dirancang khusus untuk macOS. Gunakan docker-compose untuk Linux/VPS.${NC}"
  exit 1
fi

# 2. Cari Node.js Binary di Mac
NODE_BIN="$(which node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  if [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
  elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  echo -e "❌ Node.js tidak ditemukan di Mac. Silakan install via Homebrew: brew install node"
  exit 1
fi

NODE_VER=$("$NODE_BIN" -v)
echo -e "${GREEN}✓ Node.js terdeteksi:${NC} $NODE_BIN ($NODE_VER)"

# 3. Tentukan Root Workspace & Folder Projects secara dinamis
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  AGENT_DIR="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../package.json" ]; then
  AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$SCRIPT_DIR/../telegram-ai-agent/package.json" ]; then
  AGENT_DIR="$(cd "$SCRIPT_DIR/../telegram-ai-agent" && pwd)"
elif [ -f "$(pwd)/telegram-ai-agent/package.json" ]; then
  AGENT_DIR="$(pwd)/telegram-ai-agent"
elif [ -f "$(pwd)/package.json" ]; then
  AGENT_DIR="$(pwd)"
else
  AGENT_DIR="$(find "$(pwd)" -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || pwd)"
fi

if [ -d "$AGENT_DIR/../projects" ]; then
  WORKSPACE_DIR="$(cd "$AGENT_DIR/.." && pwd)"
elif [ -d "$SCRIPT_DIR/../../projects" ]; then
  WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
elif [ -d "$(pwd)/projects" ]; then
  WORKSPACE_DIR="$(pwd)"
else
  WORKSPACE_DIR="$AGENT_DIR"
fi

PROJECTS_DIR="$WORKSPACE_DIR/projects"
mkdir -p "$PROJECTS_DIR"

echo -e "${GREEN}✓ Workspace Root:${NC} $WORKSPACE_DIR"
echo -e "${GREEN}✓ Folder Projects:${NC} $PROJECTS_DIR"

# 4. Direktori Terisolasi di Home User (~/.th-agent)
GLOBAL_AGENT_DIR="$HOME/.th-agent"
mkdir -p "$GLOBAL_AGENT_DIR/logs"
mkdir -p "$GLOBAL_AGENT_DIR/data"
mkdir -p "$GLOBAL_AGENT_DIR/uploads"

# 5. Build Single-File Bundle (Zero node_modules di workspace!)
echo -e "${BLUE}📦 Mem-bundle engine TH Agent menjadi single-file bundle...${NC}"
cd "$AGENT_DIR"
if [ ! -f "package.json" ] && [ -f "$WORKSPACE_DIR/package.json" ]; then
  AGENT_DIR="$WORKSPACE_DIR"
  cd "$AGENT_DIR"
fi
if [ ! -d "node_modules" ]; then
  echo -e "${BLUE}Mengunduh dependensi sementara untuk bundling...${NC}"
  npm install --silent 2>/dev/null || npm install
fi

ENTRY_FILE="src/bot.js"
if [ ! -f "$ENTRY_FILE" ] && [ -f "$WORKSPACE_DIR/telegram-ai-agent/src/bot.js" ]; then
  ENTRY_FILE="$WORKSPACE_DIR/telegram-ai-agent/src/bot.js"
elif [ ! -f "$ENTRY_FILE" ] && [ -f "$WORKSPACE_DIR/src/bot.js" ]; then
  ENTRY_FILE="$WORKSPACE_DIR/src/bot.js"
fi

npx -y esbuild "$ENTRY_FILE" --bundle --platform=node --format=esm \
  --banner:js="import { createRequire } from \x27module\x27; const require = createRequire(import.meta.url);" \
  --target=node26 --outfile="$GLOBAL_AGENT_DIR/bot.bundle.js"

# Bersihkan node_modules di folder kerja agar tetap bersih total
rm -rf node_modules package-lock.json 2>/dev/null || true

# Salin public dashboard & .env ke isolated dir
if [ -d "public" ]; then
  cp -r public "$GLOBAL_AGENT_DIR/public" 2>/dev/null || true
elif [ -d "$WORKSPACE_DIR/public" ]; then
  cp -r "$WORKSPACE_DIR/public" "$GLOBAL_AGENT_DIR/public" 2>/dev/null || true
fi
if [ -f "$AGENT_DIR/.env" ]; then
  cp "$AGENT_DIR/.env" "$GLOBAL_AGENT_DIR/.env"
elif [ -f "$WORKSPACE_DIR/.env" ]; then
  cp "$WORKSPACE_DIR/.env" "$GLOBAL_AGENT_DIR/.env"
fi

# 6. Daftarkan macOS LaunchAgent (com.taufik.th-agent.plist)
PLIST_NAME="com.taufik.th-agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
mkdir -p "$HOME/Library/LaunchAgents"

echo -e "${BLUE}⚙️  Mendaftarkan macOS LaunchAgent Service...${NC}"

SAFE_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH"

cat << EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.taufik.th-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-dimsu</string>
        <string>$NODE_BIN</string>
        <string>$GLOBAL_AGENT_DIR/bot.bundle.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$GLOBAL_AGENT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>$GLOBAL_AGENT_DIR/logs/mac-bot.log</string>
    <key>StandardErrorPath</key>
    <string>$GLOBAL_AGENT_DIR/logs/mac-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PROJECTS_DIR</key>
        <string>$PROJECTS_DIR</string>
        <key>WORKSPACE_DIR</key>
        <string>$WORKSPACE_DIR</string>
        <key>WEB_PORT</key>
        <string>3030</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>$SAFE_PATH</string>
    </dict>
</dict>
</plist>
EOF

# Reload LaunchAgent
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}🎉 SUKSES! TH Agent sudah terpasang rapi di macOS!${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e "📁 ${CYAN}Workspace Anda:${NC} $WORKSPACE_DIR"
echo -e "   └── 📂 ${YELLOW}projects/${NC} (Buka folder ini di VS Code / Cursor!)"
echo -e ""
echo -e "✨ ${CYAN}Status Background Agent:${NC}"
echo -e "   • Engine bot: Terisolasi di ${YELLOW}~/.th-agent/${NC} (Zero node_modules di workspace!)"
echo -e "   • LaunchAgent: ${GREEN}Aktif & Auto-Start on Boot${NC}"
echo -e "   • Anti-Sleep: ${GREEN}Tahan tidur (caffeinate -dimsu)${NC}"
echo -e "   • Web Dashboard: ${CYAN}http://localhost:3030${NC}"
echo -e "   • Log Output: ${YELLOW}tail -f ~/.th-agent/logs/mac-bot.log${NC}"
echo -e ""
echo -e "${YELLOW}🔋 PENTING (Mode Baterai / Layar Terbuka):${NC}"
echo -e "   Agar Mac tidak sleep saat layar terbuka tanpa charger, jalankan:"
echo -e "   ${CYAN}sudo pmset -b sleep 0 displaysleep 0${NC}"
echo -e "   (Pengaturan ini akan otomatis di-reset saat menjalankan ./uninstall-mac.sh)"
echo ""
echo -e "💡 ${CYAN}Untuk menghapus background service & reset daya kapan saja:${NC} ./uninstall-mac.sh"
echo -e "${GREEN}================================================================${NC}"
