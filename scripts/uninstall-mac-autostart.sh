#!/bin/bash
# ==============================================================================
# Script Menghapus TH Agent dari macOS LaunchAgent
# ==============================================================================

PLIST_NAME="com.taufik.th-agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "✅ TH Agent LaunchAgent berhasil dihapus dari sistem macOS."
else
  echo "ℹ️  Tidak ditemukan file LaunchAgent di $PLIST_PATH"
fi
