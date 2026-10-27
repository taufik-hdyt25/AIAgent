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

## ⚡ Quick Universal One-Line Installer

Simply copy and run this single command in your **macOS**, **Linux VPS / Server**, or **Raspberry Pi** terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/install.sh | bash
```

> 💡 **Smart Auto-Update:** If TH Agent is already installed, the curl command above automatically detects existing installations and switches to **Quick Update Mode** (pulls the latest updates from GitHub, re-bundles, and restarts the service) in seconds without repeating setup from scratch and without modifying your `.env` configuration or `projects/` directory.  
> You can also trigger it directly with:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/install.sh | bash -s -- --update
> ```

The installer automatically compiles and configures a **24/7 Standalone Binary Runner** directly on your system:
- 🍏 **On macOS (Local):** Bundles the bot to `~/.th-agent/th-agent-bin`, registers a 24/7 background LaunchAgent service (anti-sleep `caffeinate -dimsu`), and keeps the `th-agent/projects/` workspace **100% clean without `node_modules`**.
- 🐧 **On Linux VPS / Server / Raspberry Pi:** Bundles the bot to `~/.th-agent/th-agent-bin`, registers a 24/7 systemd service (auto-starts on boot), without Docker containers or PM2 overhead.
- ⚡ **CLI Binary Command:** The `th-agent` command is automatically available in your terminal (`th-agent logs`, `th-agent status`, `th-agent restart`, `th-agent stop`).

---

## 🏗️ Workspace Architecture

The **TH Agent** workspace is organized in a clean and modular structure for transparent coding workflows, project isolation, and seamless bot operations:

```text
th-agent/
├── projects/                  # 📂 Workspace directory for all your coding projects
│   └── ...                    #    (Automatically isolated & clean from bot engine files)
│
└── telegram-ai-agent/         # 🤖 Core TH Agent Application (Bot & Control Panel)
    ├── src/                   #    Bot source code (handlers, services, config)
    ├── public/                #    Web Dashboard Control Panel (Port 3030)
    ├── data/                  #    Project status storage & context JSON
    ├── scripts/               #    Utility & autostart scripts (macOS / Pi / Linux)
    ├── package.json           #    Node.js dependencies
    └── .env                   #    Environment configurations & API keys
```

---

## 🛠️ `th-agent` CLI Commands

Once installed, the `th-agent` command can be executed directly from any terminal:

```bash
th-agent logs       # Stream real-time Telegram bot activity logs
th-agent status     # Check 24/7 background service status
th-agent restart    # Restart the bot service
th-agent stop       # Stop the bot service
th-agent start      # Start the bot service
th-agent run        # Run in foreground terminal for live debugging
```

---

## 🎛️ Services & Server Ports
- **Web UI Control Panel:** `http://localhost:3030`
- **Telegram Bot:** Directly connected via Telegram Webhook / Long Polling
- **Coding Workspace:** All autonomous AI execution is strictly scoped within `./projects/`

Detailed technical documentation for the bot can be found in [telegram-ai-agent/README.md](./telegram-ai-agent/README.md).
