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

## 🏗️ Struktur Arsitektur Workspace

Workspace **TH Agent** disusun secara bersih dan modular agar alur kerja (*flow*) koding, isolasi proyek, dan pengoperasian bot mudah dibaca:

```text
th-agent/
├── projects/                  # 📂 Seluruh Proyek Target yang Dikelola AI
│   ├── PROJECTS_SUMMARY.md    #    Peta ringkasan status & deskripsi proyek
│   ├── intiva/                #    Sandbox isolasi proyek (Raspberry Pi scope)
│   ├── th-blog/               #    Aplikasi blog Next.js & PostgreSQL
│   ├── wa-chat-bot/           #    WhatsApp Bot (Baileys + Dashboard)
│   └── ai-podcast-live/       #    AI Podcast Live Stream
│
└── telegram-ai-agent/         # 🤖 Core Aplikasi TH Agent (Bot & Control Panel)
    ├── src/                   #    Source code bot (handlers, services, config)
    ├── public/                #    Web Dashboard Control Panel (Port 3030)
    ├── data/                  #    Penyimpanan status proyek & context JSON
    ├── scripts/               #    Skrip utilitas & autostart (Mac / Pi / Linux)
    ├── Dockerfile             #    Spesifikasi container Docker (Node 26)
    ├── docker-compose.yml     #    Orkestrasi Docker standalone
    ├── package.json           #    Dependencies Node.js
    └── .env                   #    Konfigurasi environment & API keys
```

---

## 🚀 Cara Menjalankan

### Opsi A: Menggunakan Docker Compose (Direkomendasikan)
Dari root workspace `th-agent/`:
```bash
docker compose up -d
```
Atau dari dalam folder bot `telegram-ai-agent/`:
```bash
cd telegram-ai-agent
docker compose up -d
```

### Opsi B: Menjalankan Secara Native (Node.js 26)
```bash
cd telegram-ai-agent
npm install
npm start
```

---

## 🎛️ Layanan & Port Server
- **Web UI Control Panel:** `http://localhost:3030`
- **Telegram Bot:** Terhubung langsung ke bot Telegram via Webhook / Polling
- **Folder Kerja Koding:** Seluruh eksekusi AI terkunci di dalam `./projects/`

Dokumentasi teknis lengkap mengenai bot dapat dibaca di [telegram-ai-agent/README.md](./telegram-ai-agent/README.md).
