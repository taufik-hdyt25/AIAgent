# 📁 Projects Summary & Directory Index

Dokumen ini merangkum daftar seluruh proyek dan layanan yang dikelola di server.

---

## 🚀 Proyek Terdaftar

### 1. `th-blog`
- **Lokasi:** `./projects/th-blog`
- **Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Prisma / PostgreSQL
- **Port:**
  - Web App: `3000` (Container: `th-blogs-app`)
  - Database: `5433` (Container: `th-blogs-db` Postgres)
- **Deskripsi:** Website personal blog & showcase portofolio terintegrasi database PostgreSQL.

---

### 2. `wa-chat-bot`
- **Lokasi:** `./projects/wa-chat-bot`
- **Struktur:**
  - `whatsapp-bot/`: Service Bot WhatsApp (Baileys / Node.js)
  - `chat-dashboard/`: Web Dashboard Next.js untuk monitoring & blast
- **Port:**
  - Bot: `3001` (Container: `wa-bot`)
  - Dashboard: `3333` (Container: `wa-dashboard`)
- **Deskripsi:** Bot WhatsApp otomatis untuk auto-reply customer & broadcast pesan dengan manajemen dashboard.

---

### 3. `ai-podcast-live`
- **Lokasi Host:** `/home/ai-podcast-live` (Docker container)
- **Stack:** Node.js, AI Voice Generation, Live Stream
- **Port:** `3005` (Container: `ai-podcast-live`)
- **Deskripsi:** Layanan AI otomatis untuk pembuatan audio podcast dinamis dan live broadcast stream.

---

### 4. `AIAgent` (TH Agent)
- **Lokasi:** `/app` (Host: `/home/AIAgent`)
- **Stack:** Node.js v26, grammY Telegram Bot, Antigravity CLI (`agy`), Claude Code CLI (`claude`), Vanilla JS/CSS Dashboard
- **Port:**
  - Control Panel: `3030`
  - Internal Web: `3002`
- **Deskripsi:** Lead Autonomous AI Coding Assistant dengan kemampuan Multi-Agent Swarm, FIFO Task Queue, dan manajemen server otomatis via Telegram.
