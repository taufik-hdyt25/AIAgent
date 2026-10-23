#!/bin/bash
# ==============================================================================
# Script Otomasi TH Agent Raspberry Pi (systemd Auto-Start & Auto-Heal 24/7)
# Mendukung Raspberry Pi OS (Pi 3, 4, 5, Zero 2W) & Debian/Ubuntu Linux
# ==============================================================================

set -e

SERVICE_NAME="th-agent"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Cari binary node
NODE_BIN="$(which node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  if [ -f "/usr/bin/node" ]; then
    NODE_BIN="/usr/bin/node"
  elif [ -f "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  elif [ -f "$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin/node" ]; then
    NODE_BIN="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin/node"
  fi
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ Node.js tidak ditemukan di path standar Raspberry Pi. Pastikan Node.js sudah terinstal."
  echo "💡 Tips install di Pi: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi

CURRENT_USER="$(whoami)"
mkdir -p "$PROJECT_DIR/logs"

echo "🍓 Menyiapkan TH Agent sebagai Background Service di Raspberry Pi..."
echo "📂 Project Dir: $PROJECT_DIR"
echo "🟢 Node Binary: $NODE_BIN"
echo "👤 User: $CURRENT_USER"

# Cek apakah dijalankan dengan akses root/sudo untuk service level sistem
USE_SYSTEM_LEVEL=false
if [ "$EUID" -eq 0 ] || command -v sudo &>/dev/null; then
  USE_SYSTEM_LEVEL=true
fi

if [ "$USE_SYSTEM_LEVEL" = true ]; then
  SYSTEMD_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  echo "⚙️  Membuat systemd service di $SYSTEMD_FILE..."

  sudo bash -c "cat <<EOF > '$SYSTEMD_FILE'
[Unit]
Description=TH Agent - Telegram AI Autonomous Coding Assistant
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN $PROJECT_DIR/src/bot.js
Restart=always
RestartSec=5
StandardOutput=append:$PROJECT_DIR/logs/pi-service.log
StandardError=append:$PROJECT_DIR/logs/pi-error.log
Environment=NODE_ENV=production
Environment=IS_PI=true
Environment=DEVICE_MODEL=pi
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin

[Install]
WantedBy=multi-user.target
EOF"

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  # Aktifkan linger agar service tetap aktif saat SSH ditutup
  if command -v loginctl &>/dev/null; then
    sudo loginctl enable-linger "$CURRENT_USER" 2>/dev/null || true
  fi

  echo "----------------------------------------------------------------"
  echo "✅ SUKSES! TH Agent aktif 24/7 di Raspberry Pi via systemd."
  echo "📍 Service: $SYSTEMD_FILE"
  echo "📊 Cek status:  sudo systemctl status $SERVICE_NAME"
  echo "📜 Cek log:     tail -f $PROJECT_DIR/logs/pi-service.log"
  echo "🛑 Hentikan:    sudo systemctl stop $SERVICE_NAME"
  echo "🔄 Restart:     sudo systemctl restart $SERVICE_NAME"
  echo "----------------------------------------------------------------"
else
  # Mode user systemd (~/.config/systemd/user) jika tanpa sudo
  USER_SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$USER_SYSTEMD_DIR"
  USER_SYSTEMD_FILE="$USER_SYSTEMD_DIR/${SERVICE_NAME}.service"

  cat <<EOF > "$USER_SYSTEMD_FILE"
[Unit]
Description=TH Agent - Telegram AI Autonomous Coding Assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN $PROJECT_DIR/src/bot.js
Restart=always
RestartSec=5
StandardOutput=append:$PROJECT_DIR/logs/pi-service.log
StandardError=append:$PROJECT_DIR/logs/pi-error.log
Environment=NODE_ENV=production
Environment=IS_PI=true
Environment=DEVICE_MODEL=pi
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"

  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$CURRENT_USER" 2>/dev/null || true
  fi

  echo "----------------------------------------------------------------"
  echo "✅ SUKSES! TH Agent aktif di Raspberry Pi (User systemd mode)."
  echo "📍 Service: $USER_SYSTEMD_FILE"
  echo "📊 Cek status:  systemctl --user status $SERVICE_NAME"
  echo "📜 Cek log:     tail -f $PROJECT_DIR/logs/pi-service.log"
  echo "🛑 Hentikan:    systemctl --user stop $SERVICE_NAME"
  echo "----------------------------------------------------------------"
fi
