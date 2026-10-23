<p align="center">
  <img src="telegram-ai-agent/public/logo.png" width="160" alt="TH Agent Logo" style="border-radius: 24px;" />
</p>

<h1 align="center">⚡ TH Agent (Workspace Architecture)</h1>

<p align="center">
  <strong>Autonomous AI Coding Assistant, Multi-Project Orchestrator & Server DevOps</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v26-68a063?style=flat-square&logo=node.js" alt="Node.js 26" />
  <img src="https://img.shields.io/badge/Engine-Antigravity%20%7C%20Claude%20%7C%20Universal-8b5cf6?style=flat-square" alt="AI Engines" />
  <img src="https://img.shields.io/badge/Platform-Telegram%20Bot-229ED9?style=flat-square&logo=telegram" alt="Telegram" />
</p>

---

## ⚡ Instalasi Cepat Sekali Jalan (Universal One-Line Installer)

Cukup salin dan jalankan satu baris perintah ini di terminal **macOS**, **Linux VPS / Server**, atau **Raspberry Pi**:

```bash
curl -fsSL https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/install.sh | bash
```

> 💡 **Smart Auto-Update:** Jika TH Agent sudah terpasang, perintah curl di atas otomatis mendeteksi instalasi lama dan beralih ke **Mode Update Cepat** (mengambil pembaruan terbaru dari GitHub, re-bundle, dan restart service) dalam hitungan detik tanpa mengulang setup dari awal dan tanpa mengubah konfigurasi `.env` atau folder `projects/` Anda.
> Bisa juga dipanggil langsung dengan:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/install.sh | bash -s -- --update
> ```

Installer otomatis mengompilasi dan mengaktifkan **Standalone Binary Runner 24/7** langsung di sistem Anda:
- 🍏 **Di macOS (Local):** Mem-bundle bot ke `~/.th-agent/th-agent-bin`, mendaftarkan background service macOS LaunchAgent 24/7 (anti-sleep `caffeinate -ims`), dan menjaga workspace `th-agent/projects/` **100% bersih tanpa `node_modules`**.
- 🐧 **Di Linux VPS / Server / Raspberry Pi:** Mem-bundle bot ke `~/.th-agent/th-agent-bin`, mendaftarkan systemd service 24/7 (on boot), tanpa Docker container dan tanpa PM2.
- ⚡ **CLI Binary Command:** Perintah `th-agent` otomatis tersedia di terminal (`th-agent logs`, `th-agent status`, `th-agent restart`, `th-agent stop`).

---

## 🏗️ Struktur Arsitektur Workspace

Workspace **TH Agent** disusun secara bersih dan modular agar alur kerja (*flow*) koding, isolasi proyek, dan pengoperasian bot mudah dibaca:

```text
th-agent/
├── projects/                  # 📂 Workspace Folder Seluruh Proyek Koding Anda
│   └── ...                    #    (Otomatis terisolasi & bersih dari file engine bot)
│
└── telegram-ai-agent/         # 🤖 Core Aplikasi TH Agent (Bot & Control Panel)
    ├── src/                   #    Source code bot (handlers, services, config)
    ├── public/                #    Web Dashboard Control Panel (Port 3030)
    ├── data/                  #    Penyimpanan status proyek & context JSON
    ├── scripts/               #    Skrip utilitas & autostart (Mac / Pi / Linux)
    ├── package.json           #    Dependencies Node.js
    └── .env                   #    Konfigurasi environment & API keys
```

---

## 🛠️ Perintah CLI `th-agent`

Setelah terpasang, perintah `th-agent` dapat dipanggil langsung dari terminal mana pun:

```bash
th-agent logs       # Pantau log aktivitas Telegram bot secara real-time
th-agent status     # Cek status service background 24/7
th-agent restart    # Mulai ulang service bot
th-agent stop       # Hentikan service bot
th-agent start      # Jalankan service bot
th-agent run        # Jalankan di foreground terminal untuk testing live
```

---

## 🎛️ Layanan & Port Server
- **Web UI Control Panel:** `http://localhost:3030`
- **Telegram Bot:** Terhubung langsung ke bot Telegram via Webhook / Polling
- **Folder Kerja Koding:** Seluruh eksekusi AI terkunci di dalam `./projects/`

Dokumentasi teknis lengkap mengenai bot dapat dibaca di [telegram-ai-agent/README.md](./telegram-ai-agent/README.md).
