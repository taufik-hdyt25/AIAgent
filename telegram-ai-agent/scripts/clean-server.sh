#!/bin/bash
set -euo pipefail

# Script Otomatis Pembersihan Server (TH Agent)
echo "=========================================="
echo "🧹 Memulai pembersihan server: $(date)"
echo "=========================================="

# Disk sebelum pembersihan
echo "--- Status Disk Sebelum Pembersihan ---"
df -h /

# 1. Bersihkan Docker Build Cache
echo ""
echo "--- 1. Membersihkan Docker Build Cache ---"
docker builder prune -a -f || true

# 2. Bersihkan Docker Dangling Images
echo ""
echo "--- 2. Membersihkan Docker Dangling Images ---"
docker image prune -f || true

# 3. Bersihkan NPM Cache
echo ""
echo "--- 3. Membersihkan NPM Cache ---"
npm cache clean --force 2>/dev/null || true

# 4. Bersihkan /tmp
echo ""
echo "--- 4. Membersihkan /tmp ---"
rm -rf /tmp/* 2>/dev/null || true

# Disk sesudah pembersihan
echo ""
echo "--- Status Disk Sesudah Pembersihan ---"
df -h /

echo ""
echo "✅ Pembersihan server selesai pada $(date)"
echo "=========================================="
