#!/bin/bash
# ==============================================================================
# Script Otomasi TH Agent macOS LaunchAgent (Auto-Start saat Login & Auto-Heal)
# Layar Mac boleh mati / lock screen, TH Agent tetap berjalan 24/7 di background.
# ==============================================================================

set -e

PLIST_NAME="com.taufik.th-agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Cari path binary node di macOS
NODE_BIN="$(which node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  if [ -f "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
  elif [ -f "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  elif [ -f "$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin/node" ]; then
    NODE_BIN="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin/node"
  fi
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ Node.js tidak ditemukan di path standar. Pastikan Node.js sudah terinstal."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$PROJECT_DIR/logs"

echo "⚙️  Mendaftarkan TH Agent ke macOS LaunchAgent..."
echo "📂 Project Dir: $PROJECT_DIR"
echo "🟢 Node Binary: $NODE_BIN"

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.taufik.th-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/src/bot.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/logs/mac-service.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/logs/mac-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

# Unload jika sebelumnya sudah pernah didaftarkan
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "----------------------------------------------------------------"
echo "✅ SUKSES! TH Agent sudah terdaftar sebagai macOS Background Service."
echo "📍 Plist: $PLIST_PATH"
echo "✨ Status: TH Agent sekarang OTOMATIS berjalan setiap Mac dinyalakan."
echo "💤 Layar boleh mati/lock, TH Agent tetap hidup dan langsung reconnect saat Mac dibuka!"
echo "----------------------------------------------------------------"
