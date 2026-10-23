#!/bin/bash
# ==============================================================================
# Script Menghapus TH Agent dari systemd Raspberry Pi
# ==============================================================================

SERVICE_NAME="th-agent"

if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  echo "✅ TH Agent systemd service berhasil dihapus dari sistem."
elif [ -f "$HOME/.config/systemd/user/${SERVICE_NAME}.service" ]; then
  systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/${SERVICE_NAME}.service"
  systemctl --user daemon-reload
  echo "✅ TH Agent user systemd service berhasil dihapus."
else
  echo "ℹ️  Tidak ditemukan service $SERVICE_NAME di sistem."
fi
