#!/bin/bash
# ==============================================================================
# 🛑 Uninstall TH Agent Background Service di macOS
# ==============================================================================

PLIST_NAME="com.taufik.th-agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "🛑 Menghentikan dan menghapus TH Agent macOS LaunchAgent..."

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "✓ Service $PLIST_NAME berhasil di-unload dan dihapus."
fi

# Kill sisa proses jika masih ada
pkill -f "bot.bundle.js" 2>/dev/null || true

echo "✅ Selesai! Background service TH Agent di Mac sudah dinonaktifkan."
