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
pkill -f "th-agent-bin" 2>/dev/null || true

# Reset pengaturan power management / sleep macOS ke default awal pabrik
echo "🔄 Mereset pengaturan daya/sleep macOS ke default pabrik (sudo pmset restoredefaults)..."
if sudo pmset restoredefaults 2>/dev/null; then
  echo "✓ Pengaturan sleep/daya macOS berhasil dikembalikan ke default pabrik."
else
  echo "ℹ️  Jalankan 'sudo pmset restoredefaults' jika ingin mereset pengaturan daya Mac secara manual."
fi

# Hapus symlink CLI
rm -f "$HOME/.local/bin/th-agent" 2>/dev/null || true

echo "✅ Selesai! Background service TH Agent di Mac sudah dinonaktifkan dan daya Mac di-reset ke default."
