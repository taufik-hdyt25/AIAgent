# TH Agent Documentation

Dokumentasi TH Agent dikelompokkan berdasarkan fungsi agar lebih mudah ditemukan dan dipelihara.

## API

- [Universal AI API](./api/UNIVERSAL-AI-API.md) — endpoint bersama `POST /api/ai` untuk generate teks dan structured JSON dengan provider/model terhubung di TH Agent.
- [TH Admin Integration](./api/TH-ADMIN-INTEGRATION.md) — endpoint kompatibilitas `POST /api/ai-generate` untuk TH Admin.

> `TH-ADMIN-INTEGRATION.local.md` adalah salinan lokal yang berisi konfigurasi sensitif. File tersebut tidak boleh dipublikasikan atau dibagikan.

## Struktur repository

```text
AIAgent/
├── docs/
│   ├── api/                  # Kontrak dan panduan API
│   └── README.md             # Indeks dokumentasi
├── projects/                 # Project yang dikelola TH Agent
├── telegram-ai-agent/        # Source code aplikasi TH Agent
│   ├── src/                  # Bot, web server, config, dan services
│   ├── public/               # Web UI
│   ├── scripts/              # Setup/autostart/maintenance scripts
│   ├── test/                 # Test Node.js
│   ├── data/                 # Runtime data lokal
│   └── dist/                 # Hasil bundle, tidak diedit manual
├── browser-test/             # Test/browser tooling repository
├── README.md                 # Panduan tingkat repository
└── install.sh                # Installer utama
```

## Aturan penempatan file

- Dokumentasi API baru masuk ke `docs/api/`.
- Dokumentasi arsitektur masuk ke `docs/architecture/`.
- Source TH Agent tetap di `telegram-ai-agent/src/`.
- Test TH Agent tetap di `telegram-ai-agent/test/`.
- Project eksternal berada di `projects/<nama-project>/`.
- File `.env`, token, log, uploads, `node_modules`, dan runtime data tidak boleh di-commit.
- Jangan mengedit `telegram-ai-agent/dist/` secara manual; jalankan `npm run bundle` dari folder `telegram-ai-agent`.
