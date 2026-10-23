<p align="center">
  <img src="public/logo.png" width="160" alt="TH Agent Logo" style="border-radius: 24px;" />
</p>

<h1 align="center">⚡ TH Agent</h1>

<p align="center">
  <strong>Autonomous AI Coding Assistant & Server Automation powered by Antigravity CLI, Claude Code CLI & Telegram</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v26-68a063?style=flat-square&logo=node.js" alt="Node.js 26" />
  <img src="https://img.shields.io/badge/Engine-Antigravity%20%7C%20Claude-8b5cf6?style=flat-square" alt="AI Engines" />
  <img src="https://img.shields.io/badge/Platform-Telegram%20Bot-229ED9?style=flat-square&logo=telegram" alt="Telegram" />
</p>

---

**TH Agent** adalah asisten AI coding & server automation cerdas berbasis Node.js & grammY untuk mengontrol Antigravity CLI (`agy`) dan Claude Code CLI (`claude`), memungkinkan Anda mendelegasikan tugas coding langsung dari chat Telegram ke repository di server/VPS.

---

## 📋 Fitur Utama

- **Web UI Settings Control Panel:** Dashboard web modern di `http://localhost:3030` untuk mengatur `BOT_TOKEN`, `ALLOWED_TELEGRAM_IDS`, pilihan default model AI, dan menguji token secara instan tanpa mengedit file secara manual.
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

---

## ⚡ Instalasi Cepat Sekali Jalan (One-Line Installer)

Cukup salin dan jalankan satu perintah ini di terminal **macOS** atau **Linux VPS**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/install.sh)"
```

Atau jika sudah melakukan git clone:
```bash
./install.sh
```

### Apa yang Dilakukan Installer Ini Secara Otomatis?
1. Mengunduh repository ke folder `telegram-ai-agent` (jika belum di-clone).
2. Memeriksa & memasang runtime **Node.js**, **Antigravity CLI (`agy`)**, **Claude Code CLI (`claude`)**, dan **PM2 Process Manager**.
3. Menyiapkan folder kerja, file `.env`, dan model AI default.
4. **Auto-Start & Background Service:** Mengonfigurasi bot agar langsung berjalan di latar belakang dan otomatis aktif kembali saat komputer/VPS menyala (*auto-start on boot*).
5. Di Linux VPS: Memberikan opsi instalasi **Native PM2** (ringan untuk VPS 1GB) atau **Docker Container**.
6. Mengaktifkan **Web UI Control Panel** di `http://localhost:3030` (atau IP VPS Anda).

### Autentikasi / Login CLI:
Cukup jalankan:
```bash
./auth.sh
```
Sesi login Anda akan tersimpan secara persisten sehingga tidak perlu login berulang kali.

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

#### Mode Development / Bot & Web UI:
```bash
npm start
```
Saat dijalankan, Web UI Control Panel otomatis dapat diakses di browser: `http://localhost:3030`.

#### Hanya Menjalankan Web UI Settings (Tanpa Bot):
```bash
npm run ui
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
| `/start` | Menampilkan pesan selamat datang, status engine, model, dan panduan fitur |
| `/files` | Melihat daftar file dan gambar yang pernah diunggah ke server (`uploads/`) |
| `/exec <cmd>` | Menjalankan perintah terminal langsung di server (misal: `/exec python3 uploads/...`) |
| `/queue` / `/antrean` | Melihat daftar antrean instruksi AI yang sedang menunggu giliran |
| `/clearqueue` | Mengosongkan seluruh antrean instruksi yang menunggu |
| `/engine` / `/cli` | Memilih engine CLI yang digunakan (**Antigravity CLI** `agy` atau **Claude Code CLI** `claude` / **Universal API**) |
| `/model` | Membuka menu pemilihan model AI (Claude, Gemini, DeepSeek, GPT) |
| `/status` | Melihat status task aktif, status antrean, engine, & model yang aktif |
| `/reset` / `/new` | Memulai sesi obrolan baru dari awal (reset memori percakapan) |
| `/cancel` | Menghentikan task yang sedang diproses / membatalkan antrean |

---

## 📂 Penerimaan File & Gambar Serta Eksekusi

Bot mendukung penerimaan file kode, skrip, data, dan gambar secara langsung dari chat Telegram:

### 1. Mengirim & Mengeksekusi File/Skrip
- Kirim file skrip seperti `.py`, `.js`, `.sh`, `.php`, `.json`, `.csv`, `.zip` dll. ke chat bot Telegram.
- **Dengan Caption:** Beri caption instruksi seperti:
  * _"jalankan script ini"_
  * _"eksekusi file ini dengan python3 dan cek outputnya"_
  * _"analisis file ini dan perbaiki bug di dalamnya"_
- File otomatis diunduh dan disimpan di folder `./uploads/`.
- Agent AI (`agy` / `claude`) akan menerima path file beserta cuplikan isinya, lalu mengeksekusi langsung di terminal server dan mengembalikan hasil outputnya ke Telegram!

### 2. Mengirim Gambar / Screenshot Error
- Kirim foto/screenshot terminal error, diagram alur, atau desain UI.
- Agent AI akan menganalisis gambar/teks error tersebut dan memberikan solusi atau perbaikan kode pada project terkait.

### 3. Eksekusi Cepat Shell (`/exec`)
- Jika ingin menjalankan perintah shell langsung tanpa melalui AI:
  ```bash
  /exec python3 uploads/nama_file.py
  /exec ls -la uploads
  /exec node uploads/app.js
  ```



---

## 🤖 Full Automation: GitHub Issue ke Server Deployment

TH Agent kini mendukung otomasi penuh end-to-end tanpa perlu membuka terminal atau IDE manual:

```
[Issue Baru GitHub] ──> [AI Auto-Analyze] ──> [Notifikasi & Analisis ke Tele]
                                                        │
[Deploy ke Server] <── [Review & Merge PR] <── [Auto-Fix & Draft PR di GitHub]
   (via Chat Tele)
```

### Alur Kerja 5 Langkah:
1. **Issue Baru Terdeteksi:** Background Watcher memantau repositori GitHub yang didaftarkan (misal: setiap 5 menit atau via `/checkissues`).
2. **Auto-Analyze:** Jika `autoAnalyze` aktif (default), AI otomatis mengambil detail issue, mendiagnosis akar masalah, dan mengirim laporan analisis ke Telegram lengkap dengan tombol aksi interaktif.
3. **Auto-Fix & Draft PR:**
   - Dijalankan otomatis jika opsi `autoFix` aktif, atau dengan 1-klik tombol `🛠️ Bikin Fix & Draft PR` / command `/autofix <url>`.
   - AI otomatis mengklon/memperbarui repo, membuat branch `fix/issue-<no>`, memperbaiki file kode yang bermasalah, memverifikasi, melakukan commit, push branch, dan membuka **Draft Pull Request** di GitHub.
4. **Review & Merge:** Anda menerima tautan Draft PR langsung di Telegram. Tinggal klik tautan untuk memeriksa diff kode di GitHub dan klik tombol **Merge Pull Request**.
5. **Deploy ke Server via Chat Telegram:**
   - Cukup ketik `/deploy` di chat Telegram atau klik tombol inline `🚀 Deploy ke Server`.
   - Bot akan menjalankan perintah deployment yang telah dikonfigurasi (misal: `git pull && npm install && pm2 reload all` atau `docker compose up -d`), lalu mengirimkan laporan status dan durasi deploy ke Telegram.

### Perintah Terkait Otomasi:
- `/watched` - Cek status repositori dan fitur otomasi aktif
- `/watchrepo <owner/repo>` - Daftarkan repositori baru untuk dipantau
- `/checkissues` - Pengecekan manual instan untuk mendeteksi issue baru
- `/autoanalyze [on|off]` - Mengaktifkan / menonaktifkan analisis AI otomatis
- `/autopr [on|off]` - Mengaktifkan / menonaktifkan pembuatan Draft PR otomatis
- `/autofix <url_issue>` - Menjalankan proses perbaikan dan pembukaan Draft PR untuk issue tertentu
- `/deploy [target]` - Menjalankan proses deployment ke server
- `/setdeploy <command>` - Mengubah perintah shell yang dijalankan saat deploy

---

## 🛡️ Alur Kerja Git Setelah Task Selesai
1. Bot akan mengirimkan ringkasan hasil task dan nama branch (`agent/task-<timestamp>` atau `fix/issue-<no>`).
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
   git merge fix/issue-...
   ```
