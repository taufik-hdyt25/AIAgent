# Telegram AI Coding Agent dengan Antigravity CLI (`agy`)

Bot Telegram cerdas berbasis Node.js & grammY untuk mengontrol Antigravity CLI (`agy`), memungkinkan Anda mendelegasikan tugas coding langsung dari chat Telegram ke repository di server/VPS.

---

## 📋 Fitur Utama

- **Otorisasi Ketat:** Hanya Telegram User ID yang terdaftar dalam `ALLOWED_TELEGRAM_IDS` yang dapat berinteraksi dengan bot.
- **Isolasi Branch Git:** Setiap tugas coding dieksekusi di branch terpisah (`agent/task-<timestamp>`), menjaga branch utama tetap bersih.
- **Pembersihan Lingkungan (Environment Sanitization):** Token bot Telegram dan secret tidak pernah diteruskan ke subprocess agent.
- **Manajemen Proses Aman:** Menjalankan `agy` dengan Process Group (`detached: true`) sehingga pembatalan (`/cancel`) atau timeout mematikan seluruh pohon proses (termasuk compiler, linter, atau subprocess lainnya).
- **Penanganan Otomatis `projects.json`:** Dibuat otomatis jika belum ada.

---

## ⚠️ Temuan Penting & Konfigurasi Permission Antigravity CLI

Saat dijalankan dalam mode non-interaktif/headless (`-p` / `--print`), Antigravity CLI **secara default menolak izin modifikasi file (`write_file`, `replace_file_content`, command shell, dll.)** karena tidak ada terminal interaktif untuk meminta konfirmasi:

```text
jetski: no output produced — a tool required the "write_file" permission that headless mode cannot prompt for, so it was auto-denied.
```

Tersedia dua opsi konfigurasi:

### Opsi 1: Allowlist Spesifik (Rekomendasi untuk VPS / Produksi)
Tambahkan izin eksplisit pada file konfigurasi `~/.gemini/antigravity-cli/settings.json` milik user Linux/VPS:

```json
{
  "permissions": {
    "allow": [
      "read_file",
      "list_dir",
      "grep_search",
      "write_file",
      "replace_file_content",
      "multi_replace_file_content",
      "command(regex:npm (test|run lint|run build))",
      "command(regex:git (status|diff|log))"
    ]
  }
}
```

### Opsi 2: Auto-Approve Flags (Development / Sandbox Terisolasi)
Set di file `.env`:
```dotenv
AGY_AUTO_APPROVE_PERMISSIONS=true
```
Ini akan otomatis menambahkan flag `--dangerously-skip-permissions` saat memanggil binary `agy`. Gunakan opsi ini hanya jika VPS/container sudah terisolasi dan tidak menjalankan service produksi sensitif.

---

## 🐳 Cara Termudah: Sekali Install dengan Docker (Rekomendasi untuk VPS)

Cukup jalankan satu perintah ini di folder project (di Ubuntu VPS maupun macOS):

```bash
./install.sh
```

Skrip ini akan secara otomatis:
1. Memeriksa dan menginstall Docker & Docker Compose (jika belum ada).
2. Menyiapkan folder data, logs, workspace projects, dan volume autentikasi.
3. Memandu pembuatan `.env`.
4. Mem-build image terisolasi (Node.js 22 + Antigravity CLI) dan menjalankannya di background.

### Autentikasi `agy` dalam Docker:
Cukup jalankan sekali:
```bash
./auth.sh
```
Sesi login Anda akan tersimpan secara persisten di host (`./gemini_auth`) sehingga tidak akan hilang meskipun container di-restart atau di-update.

---

## 🚀 Panduan Instalasi Manual (Tanpa Docker)

### 1. Prasyarat
- Node.js v20+ atau v22+
- Git
- Antigravity CLI (`agy`) terpasang dan sudah terautentikasi (`agy --version`)

### 2. Setup Project
```bash
# Clone atau masuk ke direktori
cd "agent AI"

# Install dependencies
npm install

# Buat konfigurasi .env
cp .env.example .env
```

Edit file `.env` dan isi token Anda:
```dotenv
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxyz
ALLOWED_TELEGRAM_IDS=987654321
AGY_BIN=/Users/intiva/.local/bin/agy  # Sesuaikan dengan `which agy`
```

### 3. Daftarkan Project
Anda bisa menambahkan project secara manual di `data/projects.json`:
```json
{
  "my-app": {
    "path": "/absolute/path/to/my-app",
    "description": "Aplikasi Web Utama"
  }
}
```
Atau gunakan perintah Telegram `/clone nama https://github.com/owner/repo.git`.

### 4. Jalankan Bot

#### Mode Development:
```bash
npm start
```

#### Mode Produksi dengan PM2:
```bash
# Install PM2 jika belum terpasang
npm install -g pm2

# Jalankan via ecosystem
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs telegram-coding-agent
```

---

## 💬 Daftar Perintah Telegram

| Perintah | Deskripsi |
| :--- | :--- |
| `/start` | Menampilkan pesan selamat datang dan ringkasan perintah |
| `/help` | Menampilkan panduan dan contoh pemakaian |
| `/projects` | Menampilkan daftar repository yang telah didaftarkan |
| `/code <project> <instruksi>` | Menjalankan task coding pada project yang dipilih |
| `/clone <nama> <URL-GitHub>` | Meng-clone repository publik GitHub ke folder project |
| `/status` | Melihat status task yang sedang berlangsung |
| `/cancel` | Menghentikan paksa task yang sedang berjalan |

---

## 🛡️ Alur Kerja Git Setelah Task Selesai
1. Bot akan mengirimkan ringkasan hasil task dan nama branch (`agent/task-<timestamp>`).
2. Masuk ke folder project di server/VPS:
   ```bash
   cd /path/to/project
   git diff main
   ```
3. Uji hasil perubahan:
   ```bash
   npm run test # atau build
   ```
4. Jika puas, gabungkan perubahan ke branch utama:
   ```bash
   git switch main
   git merge agent/task-...
   ```
