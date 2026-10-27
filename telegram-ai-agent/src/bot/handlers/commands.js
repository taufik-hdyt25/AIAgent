import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR, MAX_OUTPUT, PROJECTS_DIR, IS_PI } from "../../config/env.js";
import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
  fetchRemoteModels,
  normalizePiUrl,
} from "../../config/models.js";
import {
  getUserEngine,
  setUserEngine,
  getUserAgyModel,
  getUserClaudeModel,
  getUserUniversalModel,
  setUserUniversalModel,
  resetUserConversation,
} from "../../services/context-store.js";
import {
  readEnvFile,
  updateEnvFile,
  maskSecret,
} from "../../services/env-service.js";
import { syncPiModelDirectly } from "../../services/pi-service.js";
import {
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  killProcessTree,
  getActiveWorkers,
  killAllWorkers,
} from "../../services/cli-runner.js";
import { executeSwarm } from "../../services/swarm-service.js";
import {
  getQueue,
  getQueueLength,
  getDeferredProjects,
  clearQueue,
  isQueuePaused,
  pauseQueue,
  resumeQueue,
  processNextQueue,
} from "../../services/queue-service.js";
import { formatBytes, truncate } from "../../services/telegram-files.js";
import { sendToAgent } from "../dispatcher.js";
import { InlineKeyboard } from "grammy";
import {
  isGhAvailable,
  loadWatchConfig,
  addWatchedRepo,
  removeWatchedRepo,
  toggleWatcher,
  toggleAutoAnalyze,
  toggleAutoFix,
  GITHUB_ISSUE_REGEX,
} from "../../services/github-service.js";
import { triggerManualCheck } from "../../services/github-watcher.js";
import { runAutoFixAndCreatePr, runIssueAnalysis } from "../../services/autofix-service.js";
import {
  executeDeployment,
  getDeployConfig,
  setProjectDeployCommand,
} from "../../services/deploy-service.js";
import {
  executeServerCleanup,
  formatCleanupReport,
  getMsUntilNextMidnight,
  getCleanupTimezone,
} from "../../services/cleanup-service.js";
import {
  ensureProjectsIndexed,
  syncProjectsSummary,
} from "../../services/project-indexer.js";
import {
  loadMemories,
  addMemory,
  deleteMemory,
} from "../../services/memory-service.js";
import {
  loadAllSkills,
  saveSkill,
  deleteSkill,
} from "../../services/skill-service.js";
import {
  checkForUpdates,
  performSelfUpdate,
  getCurrentCommit,
} from "../../services/update-service.js";
import {
  setWhisperApiKey,
  getVoiceConfig,
} from "../../services/voice-service.js";
import {
  getSentryConfig,
  checkServerHealth,
  formatSentryStatus,
  toggleSentry,
  toggleAutoHeal,
  addWatchedContainer,
  removeWatchedContainer,
  getDockerContainers,
} from "../../services/sentry-service.js";
import {
  getSandboxConfig,
  togglePiSandbox,
  setEngineAccessRole,
  getAllowedFolders,
} from "../../services/sandbox-service.js";
import {
  getNotionConfig,
  saveNotionConfig,
} from "../../services/notion-service.js";
import { getUsageReport } from "../../services/usage-service.js";
import { checkNotionTasks } from "../../services/notion-watcher.js";

export function registerBasicCommands(bot) {
  // /start, /help
  bot.command(["start", "help", "bantuan"], async (ctx) => {
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    const activeEngineLabel = isClaude
      ? "Claude Code CLI (`claude`)"
      : isUniversal
      ? "Universal API (`Zero-CLI`)"
      : "Antigravity CLI (`agy`)";

    let activeModelDisplay = "";
    if (isClaude) {
      const claudeModel = await getUserClaudeModel(userId);
      const matched = AVAILABLE_CLAUDE_MODELS.find((m) => m.id === claudeModel);
      activeModelDisplay = `*${matched?.name || claudeModel}* (\`${claudeModel}\`)`;
    } else if (isUniversal) {
      const univModel = await getUserUniversalModel(userId);
      const matched = AVAILABLE_UNIVERSAL_MODELS.find((m) => m.id === univModel);
      activeModelDisplay = univModel
        ? `*${matched?.name || univModel}* (\`${univModel}\`)`
        : "*⚡ Auto-Detect (Dynamic)* (`auto`)";
    } else {
      const agyModel = await getUserAgyModel(userId);
      const matched = AVAILABLE_AGY_MODELS.find((m) => m.id === agyModel);
      activeModelDisplay = `*${matched?.name || agyModel}* (\`${agyModel}\`)`;
    }

    await ctx.reply(
      "👋 *Halo! Saya TH Agent (AI Coding Agent).*\n\n" +
        "Saya terhubung langsung dengan Anda di Telegram ini. Anda bisa langsung mengobrol, mengirim file koding/skrip, mengirim screenshot error/gambar, atau memberikan perintah kerja apa pun.\n\n" +
        `⚙️ Engine aktif: *${activeEngineLabel}*\n` +
        `🤖 Model aktif: ${activeModelDisplay}\n\n` +
        "📁 *Fitur File, Gambar & Suara:*\n" +
        "• *Kirim Pesan Suara / Voice Note:* Bicara langsung di Telegram, AI otomatis transkripsi & kerjakan tugas!\n" +
        "• *Kirim Dokumen / Skrip:* Kirim file `.py`, `.js`, `.sh`, `.json`, `.zip` dll. dengan caption instruksi.\n" +
        "• *Kirim Gambar / Foto:* Kirim screenshot error terminal, mockup UI, atau diagram untuk dianalisis AI.\n\n" +
        "Perintah bantuan:\n" +
        "• `/menu` - Quick-Action Dashboard interaktif (tombol 1-klik)\n" +
        "• `/settings` - Panel pengaturan Agent interaktif langsung via chat\n" +
        "• `/sentry [check|on|off]` - Pantau kesehatan container & auto-healing 24/7\n" +
        "• `/setwhisper <key> [provider]` - Konfigurasi API Whisper untuk voice note\n" +
        "• `/deploy` - Deploy aplikasi ke server langsung via chat\n" +
        "• `/setdeploy <cmd>` - Atur perintah shell untuk deployment server\n" +
        "• `/autofix <issue_url>` - Otomatis buat branch fix, perbaiki kode & buat Draft PR\n" +
        "• `/issue <url>` - Baca & analisis GitHub Issue secara mendalam\n" +
        "• `/watcher [on|off]` - Nyalakan/matikan GitHub Watcher (cek issue berkala)\n" +
        "• `/autoanalyze [on|off]` - Toggle analisis AI otomatis saat issue baru muncul\n" +
        "• `/autopr [on|off]` - Toggle pembuatan Draft PR otomatis saat issue baru muncul\n" +
        "• `/checkissues` - Cek issue baru di GitHub sekarang (manual trigger)\n" +
        "• `/watched` - Lihat status otomasi & repo yang dipantau\n" +
        "• `/watchrepo <repo>` - Pantau repo baru (contoh: owner/repo)\n" +
        "• `/files` - Lihat daftar file dan gambar yang telah diunggah\n" +
        "• `/exec <cmd>` - Eksekusi perintah terminal langsung di server\n" +
        "• `/swarm <t1> | <t2> | <t3>` - Eksekusi banyak tugas paralel dengan Sub-Agent Swarm\n" +
        "• `/projects` - Lihat daftar proyek coding di ./projects\n" +
        "• `/memories` - Lihat daftar fakta & preferensi jangka panjang AI\n" +
        "• `/remember <teks>` - Simpan fakta/preferensi baru ke memori permanen\n" +
        "• `/forget <id>` - Hapus memori AI berdasarkan ID\n" +
        "• `/skills` - Lihat daftar skill & SOP yang dikuasai AI\n" +
        "• `/learn <id> | <desc> | <sop>` - Ajarkan skill atau alur kerja baru ke AI\n" +
        "• `/delskill <id>` - Hapus skill AI yang dipelajari\n" +
        "• `/queue` - Cek daftar antrean instruksi AI\n" +
        "• `/clearqueue` - Kosongkan seluruh antrean tugas\n" +
        "• `/engine` - Ganti engine (Antigravity / Claude Code / Universal API)\n" +
        "• `/model` - Pilih atau ganti model AI\n" +
        "• `/detectmodels` - Pindai & deteksi otomatis daftar model di server\n" +
        "• `/getpi` - Ambil dan aktifkan langsung model asli dari server Pi\n" +
        "• `/setpi <key>` - Setup instan model Pi via OpenRouter / OpenAI URL\n" +
        "• `/pisandbox` - Toggle mode sandbox folder projects/intiva\n" +
        "• `/compact` - Padatkan konteks obrolan agar token input hemat\n" +
        "• `/backup` - Backup semua database Postgres & kirim bundle ke Telegram\n" +
        "• `/clean` - Bersihkan build cache Docker & temporary files\n" +
        "• `/update` - Perbarui TH Agent langsung dari GitHub tanpa instal ulang\n" +
        "• `/cekupdate` - Cek apakah ada rilis/commit baru di GitHub\n" +
        "• `/reset` - Mulai sesi obrolan baru dari awal\n" +
        "• `/status` - Cek status bot, antrean, engine & model aktif\n" +
        "• `/cancel` - Hentikan tugas aktif / antrean",
      { parse_mode: "Markdown" }
    );
  });

  // /status
  bot.command("status", async (ctx) => {
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    const engineLabel = isClaude
      ? "Claude Code CLI (`claude`)"
      : isUniversal
      ? "Universal API (`Zero-CLI`)"
      : "Antigravity CLI (`agy`)";

    let activeModelDisplay = "";
    if (isClaude) {
      const claudeModel = await getUserClaudeModel(userId);
      const matched = AVAILABLE_CLAUDE_MODELS.find((m) => m.id === claudeModel);
      activeModelDisplay = `*${matched?.name || claudeModel}* (\`${claudeModel}\`)`;
    } else if (isUniversal) {
      const univModel = await getUserUniversalModel(userId);
      const matched = AVAILABLE_UNIVERSAL_MODELS.find((m) => m.id === univModel);
      activeModelDisplay = univModel
        ? `*${matched?.name || univModel}* (\`${univModel}\`)`
        : "*⚡ Auto-Detect (Dynamic)* (`auto`)";
    } else {
      const agyModel = await getUserAgyModel(userId);
      const matched = AVAILABLE_AGY_MODELS.find((m) => m.id === agyModel);
      activeModelDisplay = `*${matched?.name || agyModel}* (\`${agyModel}\`)`;
    }

    const queueLen = getQueueLength();
    const queueStatus =
      queueLen > 0
        ? `*${queueLen} instruksi menunggu* (\`/queue\`)`
        : "Kosong (tidak ada antrean)";

    const activeTask = getActiveTask();
    if (!activeTask) {
      await ctx.reply(
        `🟢 *Status TH Agent: Idle (Siap menerima instruksi)*\n\n` +
        `⚙️ Engine aktif: *${engineLabel}*\n` +
        `🤖 Model aktif: ${activeModelDisplay}\n` +
        `📋 Status Antrean: ${queueStatus}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const elapsed = Math.floor((Date.now() - activeTask.startedAt) / 1000);
    const taskPreview = activeTask.preview ? `\n💬 Tugas: _“${truncate(activeTask.preview, 80)}”_` : "";

    const activeWorkers = getActiveWorkers();
    let swarmSection = "";
    if (activeWorkers.length > 0) {
      swarmSection = `\n\n🐝 *Sub-Agents Paralel Aktif (${activeWorkers.length} Worker):*\n` +
        activeWorkers.map((w) => `• *[${w.name} ${w.emoji || ""}]* _"${truncate(w.title, 45)}"_${w.targetProject ? ` (\`projects/${w.targetProject}\`)` : ""}`).join("\n");
    }

    await ctx.reply(
      `⏳ *TH Agent Sedang Menjalankan Tugas*\n\n` +
      `🆔 Task ID: \`${activeTask.id}\`\n` +
      `⏱ Durasi: *${elapsed} detik*${taskPreview}${swarmSection}\n\n` +
      `⚙️ Engine: *${engineLabel}*\n` +
      `🤖 Model: ${activeModelDisplay}\n` +
      `📋 Status Antrean: ${queueStatus}\n\n` +
      `💡 _Kirim /cancel untuk membatalkan atau /queue untuk melihat daftar antrean._`,
      { parse_mode: "Markdown" }
    );
  });

  // /usage, /token, /tokens, /kuota
  bot.command(["usage", "token", "tokens", "kuota"], async (ctx) => {
    const userId = ctx.from?.id;
    const currentEngine = (userId ? await getUserEngine(userId) : null) || process.env.CLI_ENGINE || "agy";
    let activeModel = "default";
    let convId = null;

    if (currentEngine === "agy") {
      activeModel = (userId ? await getUserAgyModel(userId) : null) || "gemini-3.8-flash-high";
      convId = userId ? await getUserAgyConversationId(userId) : null;
    } else if (currentEngine === "claude") {
      activeModel = (userId ? await getUserClaudeModel(userId) : null) || "claude-sonnet";
    } else {
      activeModel = (userId ? await getUserUniversalModel(userId) : null) || "default";
    }

    const report = await getUsageReport({ activeEngine: currentEngine, activeModel, convId });
    await ctx.reply(report, { parse_mode: "Markdown" }).catch(() => ctx.reply(report));
  });

  // /queue, /antrean, /q
  bot.command(["queue", "antrean", "q"], async (ctx) => {
    const activeTask = getActiveTask();
    const queue = getQueue();
    const isPaused = isQueuePaused();

    let text = `📋 *Status Antrean Instruksi TH Agent*\n\n`;

    const activeWorkers = getActiveWorkers();
    if (activeWorkers.length > 0) {
      text += `⚡ *Subagent Paralel Sedang Berjalan (${activeWorkers.length}):*\n`;
      for (const w of activeWorkers) {
        const wElapsed = Math.floor((Date.now() - w.startedAt) / 1000);
        text += `• *[${w.name} ${w.emoji || ""}]* ${w.targetProject ? `(\`projects/${w.targetProject}\`) ` : ""}(${wElapsed}s)\n`;
        text += `  💬 _“${truncate(w.title, 60)}”_\n`;
      }
      text += "\n";
    }

    if (activeTask) {
      const elapsed = Math.floor((Date.now() - activeTask.startedAt) / 1000);
      text += `⚡ *Tugas Utama Sedang Berjalan:*\n`;
      text += `• ID: \`${activeTask.id}\`${activeTask.targetProject ? ` (\`projects/${activeTask.targetProject}\`)` : ""}\n`;
      text += `• Durasi: ${elapsed} detik\n`;
      if (activeTask.preview) {
        text += `• Instruksi: _“${truncate(activeTask.preview, 80)}”_\n`;
      }
      text += "\n";
    } else if (activeWorkers.length === 0) {
      text += `🟢 *Status AI:* Idle (siap menerima instruksi)\n\n`;
    }

    const deferredList = getDeferredProjects();
    if (deferredList.length > 0) {
      text += `📦 *Proyek Menunggu Build & Deploy:* ${deferredList.map((p) => `\`${p}\``).join(", ")}\n_(Akan otomatis dibuild & deploy saat antrean kosong)_\n\n`;
    }

    if (queue.length === 0) {
      text += `_Antrean instruksi saat ini kosong._\nSemua pesan yang Anda kirim saat AI sedang bekerja akan otomatis masuk antrean di sini.`;
      const keyboard = new InlineKeyboard();
      if (activeTask) {
        keyboard.text("🛑 Batalkan Tugas Aktif", "queue_cancel_active");
      }
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
      });
      return;
    }

    text += `⏳ *Instruksi Menunggu Giliran (${queue.length}):*\n`;
    const previewItems = queue.slice(0, 8);
    for (const item of previewItems) {
      const waitSec = Math.floor((Date.now() - item.enqueuedAt) / 1000);
      const waitStr = waitSec >= 60 ? `${Math.floor(waitSec / 60)}m ${waitSec % 60}s` : `${waitSec}s`;
      text += `*#${item.position}* [\`${item.id}\`] (@${item.username}) _(${waitStr} lalu)_\n`;
      text += `  💬 _"${truncate(item.userMessage, 70)}"_\n`;
      if (item.targetProject) {
        text += `  📁 _Proyek: \`projects/${item.targetProject}\`_\n`;
      }
      if (item.hasFile) {
        text += `  📎 _File: \`${item.fileName}\`_\n`;
      }
    }

    if (queue.length > 8) {
      text += `\n_...dan ${queue.length - 8} instruksi lainnya dalam antrean._\n`;
    }

    if (isPaused) {
      text += `\n⚠️ *Perhatian:* Antrean sedang di-pause sementara.\n`;
    }

    text += `\n💡 _Gunakan \`/clearqueue\` untuk menghapus antrean atau \`/cancel\` untuk menghentikan tugas aktif._`;

    const keyboard = new InlineKeyboard();
    if (isPaused) {
      keyboard.text("▶️ Lanjutkan Antrean", "queue_resume").row();
    }
    keyboard.text("🗑️ Kosongkan Antrean", "queue_clear");
    if (activeTask) {
      keyboard.text("🛑 Batalkan Tugas Aktif", "queue_cancel_active");
    }

    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  });

  // /clearqueue, /cancelqueue, /hapusantrean
  bot.command(["clearqueue", "cancelqueue", "hapusantrean"], async (ctx) => {
    const count = clearQueue();
    if (count === 0) {
      await ctx.reply("ℹ️ Antrean instruksi sudah kosong.");
      return;
    }
    await ctx.reply(
      `🗑️ *Antrean Dikosongkan:*\nBerhasil membatalkan *${count} instruksi* yang ada di dalam antrean.`,
      { parse_mode: "Markdown" }
    );
  });

  // /new, /reset
  bot.command(["new", "reset"], async (ctx) => {
    await resetUserConversation(ctx.from?.id);
    await ctx.reply(
      "🔄 *Sesi percakapan baru dimulai!*\nKonteks percakapan sebelumnya telah di-reset. Ada yang ingin kita kerjakan hari ini?",
      { parse_mode: "Markdown" }
    );
  });

  // /projects, /proyek
  bot.command(["projects", "proyek"], async (ctx) => {
    try {
      await ensureProjectsIndexed().catch(() => {});
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
      if (dirs.length === 0) {
        await ctx.reply("📁 Belum ada project di folder `./projects`.");
        return;
      }

      const sandboxCfg = await getSandboxConfig();
      const isCustomScope = sandboxCfg.role === "custom" || sandboxCfg.piSandbox;
      const scopeNotice = isCustomScope
        ? `🔒 *Scope Akses (Custom):* Dibatasi ke \`${sandboxCfg.customFolders || "Folder Tertentu"}\`.`
        : `🌐 *Scope Akses (Root):* Akses penuh ke seluruh subfolder di \`./projects/\`.`;

      const displayList = dirs.map((d) => `• \`./projects/${d}\``);
      const list = displayList.join("\n");
      await ctx.reply(
        `📁 *Daftar Proyek di \`./projects\` (${dirs.length}):*\n\n${list}\n\n${scopeNotice}\n💡 *Tip:* Gunakan \`/syncprojects\` untuk memperbarui peta proyek.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal membaca folder projects: ${err.message}`);
    }
  });

  // /syncprojects, /reindex
  bot.command(["syncprojects", "reindex"], async (ctx) => {
    const statusMsg = await ctx.reply("🔄 *Mensinkronisasi peta arsitektur semua project...*", {
      parse_mode: "Markdown",
    });

    try {
      const results = await syncProjectsSummary();
      const projectList = results.map((p) => `• *${p.name}* (\`${p.stack.slice(0, 2).join(", ") || "Standard App"}\`)`).join("\n");
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `✅ *Sinkronisasi Project Selesai!*\n\n${projectList}\n\n📄 File registry diperbarui: \`./projects/PROJECTS_SUMMARY.md\`\nAI akan membaca peta ini agar tidak membaca file dari awal.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal sinkronisasi project: ${err.message}`);
    }
  });

  // /cancel [all]
  bot.command("cancel", async (ctx) => {
    const activeTask = getActiveTask();
    const queueLen = getQueueLength();
    const arg = ctx.match?.trim().toLowerCase();

    // Jika user mengirim /cancel all
    if (arg === "all" || arg === "semua") {
      killAllWorkers("SIGTERM");
      if (activeTask?.process) {
        activeTask.cancelled = true;
        killProcessTree(activeTask.process, "SIGTERM");
      } else if (activeTask) {
        activeTask.cancelled = true;
      }
      if (activeTask?.abortController?.abort) {
        activeTask.abortController.abort();
      }
      const cleared = clearQueue();
      await ctx.reply(
        `🛑 *Semua Dibatalkan:*\nTugas aktif & sub-agent dihentikan, serta *${cleared} instruksi di antrean* telah dibatalkan.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (!activeTask) {
      const workersKilled = killAllWorkers("SIGTERM");
      if (workersKilled > 0) {
        await ctx.reply(`🛑 Berhasil menghentikan *${workersKilled} sub-agent worker* yang sedang aktif.`);
        return;
      }

      if (queueLen > 0) {
        const keyboard = new InlineKeyboard()
          .text("▶️ Jalankan Antrean", "queue_resume")
          .text("🗑️ Kosongkan Antrean", "queue_clear");

        await ctx.reply(
          `ℹ️ Tidak ada tugas yang sedang aktif berjalan, tetapi ada *${queueLen} instruksi di antrean*.\n\nApakah Anda ingin menjalankan antrean atau mengosongkannya?`,
          { parse_mode: "Markdown", reply_markup: keyboard }
        );
        return;
      }
      await ctx.reply("Tidak ada proses agent atau antrean yang sedang aktif.");
      return;
    }

    const workersKilled = killAllWorkers("SIGTERM");
    const workerNotice = workersKilled > 0 ? ` serta *${workersKilled} sub-agent worker*` : "";

    // Jika antrean kosong, langsung batalkan tugas aktif
    if (queueLen === 0) {
      activeTask.cancelled = true;
      if (activeTask.process) killProcessTree(activeTask.process, "SIGTERM");
      if (activeTask.abortController?.abort) activeTask.abortController.abort();
      await ctx.reply(`🛑 Permintaan pembatalan tugas aktif (\`${activeTask.id}\`)${workerNotice} telah dikirim.`);
      return;
    }

    // Jika ada antrean tersisa, pause antrean dan tanyakan konfirmasi lewat tombol interaktif
    pauseQueue();
    activeTask.cancelled = true;
    if (activeTask.process) killProcessTree(activeTask.process, "SIGTERM");
    if (activeTask.abortController?.abort) activeTask.abortController.abort();

    const queueList = getQueue()
      .slice(0, 3)
      .map((it, idx) => `${idx + 1}. _"${truncate(it.userMessage, 50)}"_`)
      .join("\n");

    const keyboard = new InlineKeyboard()
      .text("▶️ Lanjut Kerjakan Antrean", "queue_resume")
      .row()
      .text("🗑️ Batalkan Semua Antrean", "queue_clear");

    await ctx.reply(
      `🛑 *Tugas aktif (\`${activeTask.id}\`) dibatalkan.*\n\n` +
      `📋 *Masih ada ${queueLen} instruksi di antrean:*\n${queueList}\n` +
      (queueLen > 3 ? `_...dan ${queueLen - 3} instruksi lainnya_\n\n` : "\n") +
      `Pilih tindakan untuk antrean yang tersisa:`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // /files
  bot.command("files", async (ctx) => {
    try {
      const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile());
      if (files.length === 0) {
        await ctx.reply(
          "📁 Belum ada file atau gambar yang diunggah di folder `uploads/`.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const fileList = await Promise.all(
        files.map(async (f) => {
          const fullPath = path.join(UPLOADS_DIR, f.name);
          const st = await stat(fullPath).catch(() => null);
          return {
            name: f.name,
            size: st ? formatBytes(st.size) : "-",
            mtime: st ? st.mtimeMs : 0,
          };
        })
      );

      fileList.sort((a, b) => b.mtime - a.mtime);
      const recent = fileList.slice(0, 15);

      let text = `📁 *Daftar File di \`uploads/\` (Total: ${fileList.length})*\n\n`;
      for (const item of recent) {
        text += `• \`${item.name}\` (${item.size})\n  _Path:_ \`uploads/${item.name}\`\n`;
      }
      if (fileList.length > 15) {
        text += `\n_...dan ${fileList.length - 15} file lainnya._\n`;
      }
      text += `\n💡 _Kirim file/foto baru kapan saja atau gunakan \`/exec\` untuk menjalankan script._`;

      await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`❌ Gagal membaca folder uploads: ${err.message}`);
    }
  });

  // /exec, /run, /sh
  bot.command(["exec", "run", "sh"], async (ctx) => {
    const cmd = ctx.match?.trim();
    if (!cmd) {
      await ctx.reply(
        "ℹ️ *Cara penggunaan /exec:*\n\nKetik `/exec <perintah_shell>`\n\nContoh:\n• `/exec ls -la uploads`\n• `/exec python3 uploads/nama_file.py`\n• `/exec node uploads/nama_file.js`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (getActiveTask()) {
      await ctx.reply(
        `⏳ Ada proses lain yang sedang berjalan (${getActiveTask().id}). Tunggu selesai atau kirim /cancel.`
      );
      return;
    }

    const taskId = randomUUID().slice(0, 8);
    const task = {
      id: taskId,
      startedAt: Date.now(),
      process: null,
      cancelled: false,
      preview: `/exec ${truncate(cmd, 60)}`,
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
    };
    setActiveTask(task);

    await ctx.reply(`⚡ *Menjalankan perintah:*\n\`${truncate(cmd, 250)}\`...`, {
      parse_mode: "Markdown",
    });

    const sanitizedEnv = { ...process.env };
    delete sanitizedEnv.BOT_TOKEN;
    delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;
    delete sanitizedEnv.GEMINI_API_KEY;

    const child = spawn(cmd, {
      cwd: process.cwd(),
      shell: true,
      detached: true,
      env: sanitizedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    task.process = child;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishExec = async (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearActiveTask(taskId);

      if (task.cancelled) {
        await ctx.reply("⚠️ Eksekusi dibatalkan.");
        processNextQueue().catch(() => {});
        return;
      }

      const output = stdout.trim();
      const errOutput = stderr.trim();
      let msg = "";

      if (code === 0 && !error) {
        msg = `✅ *Eksekusi Selesai (Exit 0):*\n\`\`\`\n${truncate(output || "(Tidak ada output)", 3500)}\n\`\`\``;
      } else {
        const detail = errOutput || output || error?.message || `Exit code ${code}`;
        msg = `❌ *Eksekusi Gagal (Exit ${code ?? "err"}):*\n\`\`\`\n${truncate(detail, 3500)}\n\`\`\``;
      }

      try {
        await ctx.reply(msg, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(truncate(msg.replace(/[`*]/g, ""), 3500));
      }

      processNextQueue().catch(() => {});
    };

    const timer = setTimeout(() => {
      task.cancelled = true;
      killProcessTree(child, "SIGTERM");
      setTimeout(() => {
        if (getActiveTask()?.id === taskId) killProcessTree(child, "SIGKILL");
      }, 3000).unref();
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(-MAX_OUTPUT);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finishExec(null, null, err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finishExec(code, signal, null);
    });
  });

  // /issue, /issues
  bot.command(["issue", "issues"], async (ctx) => {
    const arg = ctx.match?.trim();
    if (!arg) {
      const ghReady = await isGhAvailable();
      const ghStatus = ghReady
        ? "✅ GitHub CLI (`gh`) aktif & terhubung."
        : "⚠️ GitHub CLI (`gh`) belum terpasang atau belum login.";

      await ctx.reply(
        "🐙 *Fitur Auto Read & Solve GitHub Issues*\n\n" +
          `${ghStatus}\n\n` +
          "Ketik `/issue <url_issue>` untuk menyuruh AI membaca dan menganalisis/memperbaiki issue tersebut.\n\n" +
          "*Contoh:*\n" +
          "• `/issue https://github.com/owner/repo/issues/42`\n" +
          "• Atau Anda cukup mengirim link GitHub issue langsung di obrolan chat biasa!\n",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Teruskan ke sendToAgent dengan instruksi perbaikan/analisis
    await sendToAgent(
      `Tolong pelajari GitHub issue ini secara mendalam, jelaskan masalahnya, dan berikan solusi atau lakukan perbaikan kode jika diperlukan:\n${arg}`,
      ctx
    );
  });

  // /checkissues, /cekissue (Manual Trigger)
  bot.command(["checkissues", "cekissue"], async (ctx) => {
    await triggerManualCheck(bot, ctx);
  });

  // /watchrepo <owner/repo>
  bot.command("watchrepo", async (ctx) => {
    const repo = ctx.match?.trim();
    if (!repo) {
      await ctx.reply(
        "ℹ️ *Cara penggunaan /watchrepo:*\n\nKetik `/watchrepo <owner/repo>`\n\n*Contoh:*\n• `/watchrepo taufik-hdyt25/AIAgent`\n• `/watchrepo https://github.com/facebook/react`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      const cfg = await addWatchedRepo(repo);
      await ctx.reply(
        `✅ *Repositori Berhasil Ditambahkan ke Pantauan!*\n\n` +
          `📦 Repo: \`${repo}\`\n` +
          `⏱ Interval cek: setiap ${cfg.pollIntervalMinutes} menit\n\n` +
          `Bot akan otomatis mengirim notifikasi setiap ada issue baru yang terbuka. Ketik \`/checkissues\` untuk cek manual sekarang.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal menambahkan repo: ${err.message}`);
    }
  });

  // /unwatchrepo <owner/repo>
  bot.command("unwatchrepo", async (ctx) => {
    const repo = ctx.match?.trim();
    if (!repo) {
      await ctx.reply(
        "ℹ️ Ketik `/unwatchrepo <owner/repo>` untuk berhenti memantau repositori tersebut.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      await removeWatchedRepo(repo);
      await ctx.reply(`✅ Berhasil menghapus \`${repo}\` dari daftar pantauan.`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal menghapus repo: ${err.message}`);
    }
  });

  // /watched, /watchlist
  bot.command(["watched", "watchlist"], async (ctx) => {
    try {
      const cfg = await loadWatchConfig();
      const repos = cfg.watchedRepos || [];
      const ghReady = await isGhAvailable();

      let text = `🐙 *Status GitHub Issue Automation*\n\n`;
      text += `• Status GitHub CLI: ${ghReady ? "✅ Aktif" : "⚠️ Belum siap / belum login"}\n`;
      text += `• Interval Pengecekan: *setiap ${cfg.pollIntervalMinutes} menit*\n`;
      text += `• Terakhir dicek: ${cfg.lastChecked ? new Date(cfg.lastChecked).toLocaleTimeString("id-ID") : "Belum pernah"}\n\n`;

      if (repos.length === 0) {
        text += `_Belum ada repository yang dipantau._\nTambahkan dengan: \`/watchrepo <owner/repo>\``;
      } else {
        text += `📦 *Repositori yang Dipantau (${repos.length}):*\n`;
        for (const r of repos) {
          const seenCount = (cfg.seenIssues?.[r] || []).length;
          text += `• \`${r}\` (${seenCount} issue tercatat)\n`;
        }
        text += `\n💡 _Gunakan \`/checkissues\` untuk cek manual sekarang juga._`;
      }

      text += `\n\n⚙️ *Fitur Otomasi:*\n`;
      text += `• GitHub Watcher: ${cfg.enabled ? "🟢 Aktif" : "⚪ Nonaktif"} (\`/watcher\`)\n`;
      text += `• Auto-Analyze Issue: ${cfg.autoAnalyze !== false ? "🟢 Aktif" : "⚪ Nonaktif"} (\`/autoanalyze\`)\n`;
      text += `• Auto-Fix & Draft PR: ${cfg.autoFix ? "🟢 Aktif" : "⚪ Nonaktif"} (\`/autopr\`)\n`;

      await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`❌ Gagal membaca status pantauan: ${err.message}`);
    }
  });

  // /watcher [on|off]
  bot.command("watcher", async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    let targetState = null;
    if (arg === "on" || arg === "aktif" || arg === "enable" || arg === "true") targetState = true;
    if (arg === "off" || arg === "nonaktif" || arg === "disable" || arg === "false") targetState = false;

    const newState = await toggleWatcher(targetState);
    await ctx.reply(
      `🐙 *GitHub Watcher:* ${newState ? "🟢 AKTIF" : "⚪ NONAKTIF"}\n\n` +
      (newState
        ? "Bot akan mengecek issue baru di repo yang dipantau secara berkala."
        : "Pengecekan berkala dihentikan (termasuk Auto-Analyze & Auto-PR). Anda tetap bisa cek manual dengan `/checkissues`."),
      { parse_mode: "Markdown" }
    );
  });

  // /autoanalyze [on|off]
  bot.command("autoanalyze", async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    let targetState = null;
    if (arg === "on" || arg === "aktif" || arg === "enable" || arg === "true") targetState = true;
    if (arg === "off" || arg === "nonaktif" || arg === "disable" || arg === "false") targetState = false;

    const newState = await toggleAutoAnalyze(targetState);
    await ctx.reply(
      `⚙️ *Auto-Analyze Issue:* ${newState ? "🟢 AKTIF" : "⚪ NONAKTIF"}\n\n` +
      (newState
        ? "AI akan otomatis menganalisis setiap GitHub Issue baru yang terdeteksi dan mengirim detailnya ke Telegram."
        : "AI tidak akan otomatis menganalisis issue. Anda tetap bisa menganalisisnya secara manual dengan klik tombol atau `/issue <url>`."),
      { parse_mode: "Markdown" }
    );
  });

  // /autopr [on|off] atau /autofixmode
  bot.command(["autopr", "autofixmode"], async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    let targetState = null;
    if (arg === "on" || arg === "aktif" || arg === "enable" || arg === "true") targetState = true;
    if (arg === "off" || arg === "nonaktif" || arg === "disable" || arg === "false") targetState = false;

    const newState = await toggleAutoFix(targetState);
    await ctx.reply(
      `🤖 *Auto-Fix & Draft PR:* ${newState ? "🟢 AKTIF" : "⚪ NONAKTIF"}\n\n` +
      (newState
        ? "AI akan otomatis membuat branch `fix/issue-<no>`, memperbaiki kode, dan langsung membuka Draft PR setiap ada issue baru!"
        : "AI tidak akan langsung membuat PR otomatis. AI akan mengirim tombol `[🛠️ Bikin Fix & Draft PR]` agar Anda bisa menjalankannya dengan 1-klik."),
      { parse_mode: "Markdown" }
    );
  });

  // /autofix <repo/url> [issue_no]
  bot.command("autofix", async (ctx) => {
    const raw = ctx.match?.trim();
    if (!raw) {
      await ctx.reply(
        "🛠️ *Cara Penggunaan /autofix:*\n\n" +
        "• `/autofix <url_issue>`\n  _Contoh:_ `/autofix https://github.com/owner/repo/issues/42`\n\n" +
        "• `/autofix <owner/repo> <issue_number>`\n  _Contoh:_ `/autofix taufik-hdyt25/AIAgent 1`\n\n" +
        "AI akan otomatis:\n1. Mempersiapkan repo di `./projects`\n2. Membuat branch `fix/issue-<no>`\n3. Memperbaiki kode yang relevan\n4. Push branch & membuka Draft PR di GitHub untuk Anda review!",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let repo = null;
    let issueNumber = null;

    const urlMatch = raw.match(GITHUB_ISSUE_REGEX);
    if (urlMatch) {
      repo = `${urlMatch[1]}/${urlMatch[2]}`;
      issueNumber = Number(urlMatch[3]);
    } else {
      const parts = raw.split(/\s+/);
      if (parts.length >= 2 && !isNaN(Number(parts[1]))) {
        repo = parts[0];
        issueNumber = Number(parts[1]);
      }
    }

    if (!repo || !issueNumber) {
      await ctx.reply(
        "⚠️ Format tidak dikenali. Silakan masukkan URL issue lengkap, contoh:\n`/autofix https://github.com/owner/repo/issues/1`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply(
      `🚀 *Permintaan Auto-Fix Diterima!*\nMenjalankan proses perbaikan untuk issue #${issueNumber} di \`${repo}\`...`,
      { parse_mode: "Markdown" }
    );

    runAutoFixAndCreatePr({
      repo,
      issueNumber,
      bot,
      notifyChatId: ctx.chat.id,
    }).catch((err) => {
      ctx.reply(`❌ Auto-Fix gagal: ${err.message}`).catch(() => {});
    });
  });

  // /deploy [target]
  bot.command(["deploy", "deployment"], async (ctx) => {
    const arg = ctx.match?.trim();
    const config = await getDeployConfig();

    if (arg) {
      // Jalankan deploy langsung untuk target / command tsb
      await ctx.reply(`🚀 *Memulai deployment untuk target:*\n\`${arg}\`...`, {
        parse_mode: "Markdown",
      });

      const res = await executeDeployment({
        target: arg,
        triggeredBy: ctx.from?.username ? `@${ctx.from.username}` : `User ID ${ctx.from?.id}`,
      });

      if (res.success) {
        const msg =
          `✅ *DEPLOYMENT BERHASIL! (Exit 0)*\n\n` +
          `⏱ Durasi: ${res.durationSec} detik\n` +
          `📂 Direktori: \`${res.workDir}\`\n` +
          `⚡ Perintah: \`${res.command}\`\n\n` +
          `Output:\n\`\`\`\n${truncate(res.output, 3200)}\n\`\`\``;
        await ctx.reply(msg, { parse_mode: "Markdown" });
      } else {
        const msg =
          `❌ *DEPLOYMENT GAGAL (Exit ${res.code})*\n\n` +
          `⏱ Durasi: ${res.durationSec} detik\n` +
          `⚡ Perintah: \`${res.command}\`\n\n` +
          `Detail Error:\n\`\`\`\n${truncate(res.output, 3200)}\n\`\`\``;
        await ctx.reply(msg, { parse_mode: "Markdown" });
      }
      return;
    }

    // Jika tanpa argumen, tampilkan menu interaktif
    const watchConfig = await loadWatchConfig().catch(() => ({ watchedRepos: [] }));
    const repos = watchConfig.watchedRepos || [];

    const keyboard = new InlineKeyboard()
      .text("🚀 Deploy Server Utama (Default)", "deploy_run:default")
      .row();

    for (const r of repos.slice(0, 4)) {
      keyboard.text(`📦 Deploy Repo: ${r}`, `deploy_prompt:${r}`).row();
    }

    keyboard.text("⚙️ Cek Status / Riwayat Deploy", "deploy_status");

    await ctx.reply(
      `🚀 *Server Deployment Control Center*\n\n` +
      `⚡ *Perintah Default Aktif:*\n\`${config.defaultCommand}\`\n\n` +
      `Silakan pilih target deployment di bawah, atau ketik:\n` +
      `• \`/deploy <target/repo>\` untuk deploy langsung\n` +
      `• \`/setdeploy <command>\` untuk mengganti perintah deployment`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  });

  // /setdeploy <command>
  bot.command("setdeploy", async (ctx) => {
    const cmd = ctx.match?.trim();
    if (!cmd) {
      const config = await getDeployConfig();
      await ctx.reply(
        `⚙️ *Pengaturan Perintah Deployment Server*\n\n` +
        `Perintah saat ini:\n\`${config.defaultCommand}\`\n\n` +
        `Untuk mengubahnya, ketik:\n\`/setdeploy <perintah_shell>\`\n\n` +
        `*Contoh:*\n` +
        `• \`/setdeploy git pull && npm install && pm2 reload all\`\n` +
        `• \`/setdeploy docker compose pull && docker compose up -d\`\n` +
        `• \`/setdeploy ./deploy.sh\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await setProjectDeployCommand("default", cmd);
    await ctx.reply(
      `✅ *Perintah Deployment Berhasil Diperbarui!*\n\nPerintah baru:\n\`${cmd}\`\n\nSekarang Anda dapat menjalankan \`/deploy\` kapan saja via Telegram.`,
      { parse_mode: "Markdown" }
    );
  });

  // ==================== CALLBACK QUERIES ====================

  // Callback: Auto-Fix Trigger
  bot.callbackQuery(/^autofix:(.+):(\d+)$/, async (ctx) => {
    const repo = ctx.match[1];
    const issueNumber = Number(ctx.match[2]);

    await ctx.answerCallbackQuery({
      text: `🛠️ Memulai Auto-Fix & Draft PR untuk issue #${issueNumber}...`,
    });

    await ctx.reply(
      `⚡ *Menerima instruksi Auto-Fix untuk Issue #${issueNumber}* di \`${repo}\`...\nAI sedang memulai proses pembuatan branch & perbaikan kode.`,
      { parse_mode: "Markdown" }
    );

    runAutoFixAndCreatePr({
      repo,
      issueNumber,
      bot,
      notifyChatId: ctx.chat?.id,
    }).catch((err) => {
      ctx.reply(`❌ Auto-Fix gagal: ${err.message}`).catch(() => {});
    });
  });

  // Callback: Prompt Deploy
  bot.callbackQuery(/^deploy_prompt:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    const keyboard = new InlineKeyboard()
      .text(`✅ Ya, Jalankan Deploy Sekarang`, `deploy_run:${target}`)
      .row()
      .text(`❌ Batalkan`, `deploy_cancel`);

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `❓ *Konfirmasi Deployment Server*\n\nTarget: \`${target}\`\nApakah Anda yakin ingin memulai proses deployment ke server sekarang?`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  });

  // Callback: Batalkan Deploy
  bot.callbackQuery("deploy_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Deployment dibatalkan." });
    try {
      await ctx.editMessageText("❌ Deployment dibatalkan.");
    } catch (_) {}
  });

  // Callback: Status Deploy
  bot.callbackQuery("deploy_status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const config = await getDeployConfig();
    const history = config.history || [];

    if (history.length === 0) {
      await ctx.reply("ℹ️ Belum ada riwayat deployment.");
      return;
    }

    let text = `📋 *Riwayat Deployment Terakhir (Total: ${history.length})*\n\n`;
    for (const h of history.slice(0, 5)) {
      const dateStr = new Date(h.timestamp).toLocaleString("id-ID");
      const icon = h.success ? "✅" : "❌";
      text += `${icon} *${h.target || "default"}* (${h.durationSec}s) - ${dateStr}\n`;
      text += `  _Oleh:_ ${h.triggeredBy || "User"}\n`;
      text += `  _Cmd:_ \`${truncate(h.command, 60)}\`\n\n`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // Callback: Eksekusi Deploy
  bot.callbackQuery(/^deploy_run:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "🚀 Menjalankan deployment..." });

    const statusMsg = await ctx.reply(
      `⏳ *Sedang Menjalankan Deployment Server...*\nTarget: \`${target}\`\nMohon tunggu proses selesai...`,
      { parse_mode: "Markdown" }
    );

    const res = await executeDeployment({
      target,
      triggeredBy: ctx.from?.username ? `@${ctx.from.username}` : `User ID ${ctx.from?.id}`,
    });

    if (res.success) {
      const msg =
        `✅ *DEPLOYMENT BERHASIL! (Exit 0)*\n\n` +
        `⏱ Durasi: ${res.durationSec} detik\n` +
        `📂 Direktori: \`${res.workDir}\`\n` +
        `⚡ Perintah: \`${res.command}\`\n\n` +
        `Output:\n\`\`\`\n${truncate(res.output, 3200)}\n\`\`\``;

      try {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
          parse_mode: "Markdown",
        });
      } catch {
        await ctx.reply(msg, { parse_mode: "Markdown" });
      }
    } else {
      const msg =
        `❌ *DEPLOYMENT GAGAL (Exit ${res.code})*\n\n` +
        `⏱ Durasi: ${res.durationSec} detik\n` +
        `⚡ Perintah: \`${res.command}\`\n\n` +
        `Detail Error:\n\`\`\`\n${truncate(res.output, 3200)}\n\`\`\``;

      try {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
          parse_mode: "Markdown",
        });
      } catch {
        await ctx.reply(msg, { parse_mode: "Markdown" });
      }
    }
  });

  // /clean, /cleanserver, /bersihkan
  bot.command(["clean", "cleanserver", "bersihkan"], async (ctx) => {
    const statusMsg = await ctx.reply(
      "🧹 *Memulai pembersihan server...*\nSedang membersihkan Docker build cache, dangling images, NPM cache & file temporary...",
      { parse_mode: "Markdown" }
    );

    try {
      const result = await executeServerCleanup();
      const report = formatCleanupReport(result);
      try {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, report, {
          parse_mode: "Markdown",
        });
      } catch {
        await ctx.reply(report, { parse_mode: "Markdown" });
      }
    } catch (err) {
      await ctx.reply(`❌ Gagal membersihkan server: ${err.message}`);
    }
  });

  // /compact, /padatkan
  bot.command(["compact", "padatkan"], async (ctx) => {
    await ctx.reply(
      "✂️ *Memadatkan riwayat obrolan & konteks sesi...*\nMenyaring intisari pekerjaan dan membersihkan log usang agar token tetap hemat...",
      { parse_mode: "Markdown" }
    );

    await sendToAgent(
      "/compact\n\n(Tolong rangkum dan padatkan konteks sesi percakapan ini. Buang log terminal usang atau output build yang panjang, pertahankan rangkuman pekerjaan terakhir agar input token hemat).",
      ctx
    );
  });

  // /backup, /backupdb
  bot.command(["backup", "backupdb"], async (ctx) => {
    const statusMsg = await ctx.reply(
      "⏳ *Sedang memeriksa dan memproses backup semua database...*",
      { parse_mode: "Markdown" }
    );

    try {
      const { execSync } = await import("child_process");
      execSync("/usr/local/bin/th-backup-db --force");
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    } catch (err) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `❌ *Gagal membuat backup database:* ${err.message}`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    }
  });

  // /id, /chatid
  bot.command(["id", "chatid"], async (ctx) => {
    const chatType = ctx.chat.type;
    const isGroup = chatType === "group" || chatType === "supergroup";
    const title = ctx.chat.title || ctx.from?.first_name || "Chat";
    await ctx.reply(
      `🆔 *Informasi Chat Telegram:*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• *Nama/Judul:* ${title}\n` +
      `• *Tipe:* \`${chatType}\`\n` +
      `• *Chat ID:* \`${ctx.chat.id}\`\n` +
      `• *User ID Anda:* \`${ctx.from?.id}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      (isGroup ? `_Gunakan Chat ID di atas untuk target channel/grup backup._` : ""),
      { parse_mode: "Markdown" }
    );
  });

  // ==================== PERSISTENT MEMORY & SKILL COMMANDS ====================

  // /memories, /memory
  bot.command(["memories", "memory"], async (ctx) => {
    const list = await loadMemories();
    if (!list || list.length === 0) {
      await ctx.reply(
        "🧠 *Memori Jangka Panjang Masih Kosong*\n\n" +
        "Belum ada fakta atau preferensi yang tersimpan.\n" +
        "Gunakan `/remember <teks>` untuk menyimpan memori baru secara manual.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let text = `🧠 *Persistent Vector Memory (${list.length} Item Tersimpan)*\n\n`;
    text += `Memori ini tersimpan permanen dan di-recall otomatis menggunakan cosine similarity saat relevan:\n\n`;

    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const categoryBadge = `[${(m.category || "GENERAL").toUpperCase()}]`;
      const recallInfo = m.recallCount ? `_(di-recall ${m.recallCount}x)_` : `_(baru)_`;
      const tags = m.tags && m.tags.length > 0 ? `\n   🏷️ \`${m.tags.join("`, `")}\`` : "";
      text += `*${i + 1}.* \`${m.id}\` *${categoryBadge}* ${recallInfo}\n   "${m.content}"${tags}\n\n`;
      if (text.length > 3400) {
        text += `_...dan ${list.length - (i + 1)} memori lainnya._\n\n`;
        break;
      }
    }

    text += `💡 *Perintah Memori:*\n`;
    text += `• \`/remember <teks>\` - Tambah memori baru\n`;
    text += `• \`/forget <id>\` - Hapus memori berdasarkan ID`;

    await ctx.reply(truncate(text, 3800), { parse_mode: "Markdown" });
  });

  // /remember
  bot.command("remember", async (ctx) => {
    const text = ctx.message?.text?.replace(/^\/remember(@\w+)?\s*/i, "").trim();
    if (!text) {
      await ctx.reply(
        "ℹ️ *Format Perintah /remember:*\n\n" +
        "`/remember <fakta atau preferensi>`\n\n" +
        "Contoh:\n" +
        "`/remember Jangan pernah hapus folder .git saat deployment`\n" +
        "`/remember Gunakan Tailwind v3 untuk project blog`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    const tags = Array.from(new Set(words.slice(0, 5)));

    const saved = await addMemory({
      content: text,
      category: "preference",
      tags,
      importance: 4,
    });

    await ctx.reply(
      `✅ *Fakta Berhasil Disimpan ke Persistent Vector Memory!*\n\n` +
      `🆔 ID: \`${saved.id}\`\n` +
      `📂 Kategori: \`${saved.category}\`\n` +
      `🏷️ Tags: \`${(saved.tags || []).join(", ") || "-"}\`\n\n` +
      `📝 *Isi:*\n"${saved.content}"\n\n` +
      `_Memori ini akan otomatis disuntikkan saat Anda memberikan instruksi yang relevan di masa mendatang._`,
      { parse_mode: "Markdown" }
    );
  });

  // /forget, /delmemory
  bot.command(["forget", "delmemory", "hapusmemori"], async (ctx) => {
    const id = ctx.message?.text?.replace(/^\/(forget|delmemory|hapusmemori)(@\w+)?\s*/i, "").trim();
    if (!id) {
      await ctx.reply(
        "ℹ️ *Format Perintah /forget:*\n\n" +
        "`/forget <id_memori>`\n\n" +
        "Contoh: `/forget mem-seed-1`\n" +
        "Cek daftar ID dengan perintah `/memories`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const ok = await deleteMemory(id);
    if (ok) {
      await ctx.reply(`🗑️ *Memori \`${id}\` berhasil dihapus.*`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`⚠️ Memori dengan ID \`${id}\` tidak ditemukan. Cek daftar di \`/memories\`.`, { parse_mode: "Markdown" });
    }
  });

  // /skills, /skill
  bot.command(["skills", "skill"], async (ctx) => {
    const list = await loadAllSkills();
    if (!list || list.length === 0) {
      await ctx.reply(
        "⚡ *Dynamic Skills Masih Kosong*\n\n" +
        "Belum ada skill yang terdaftar.\n" +
        "Gunakan `/learn <id> | <deskripsi> | <instruksi>` untuk menambahkan skill baru secara manual.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let text = `⚡ *Daftar Skill & SOP AI (${list.length} Skill Aktif)*\n\n`;
    text += `Skill ini dicocokkan otomatis berdasarkan semantic similarity & trigger keywords:\n\n`;

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const sourceBadge = s.source === "system" ? "🛠️ [SYSTEM]" : "🎓 [LEARNED]";
      const triggerStr = s.triggers?.length ? s.triggers.join(", ") : s.id;
      text += `*${i + 1}. ${s.name}* (\`${s.id}\`) ${sourceBadge}\n`;
      if (s.description) text += `   📖 _${s.description}_\n`;
      text += `   🎯 Triggers: \`${triggerStr}\`\n\n`;

      if (text.length > 3400) {
        text += `_...dan ${list.length - (i + 1)} skill lainnya._\n\n`;
        break;
      }
    }

    text += `💡 *Perintah Skill:*\n`;
    text += `• \`/learn <id> | <deskripsi> | <instruksi>\` - Ajarkan skill baru\n`;
    text += `• \`/delskill <id>\` - Hapus skill berdasarkan ID`;

    await ctx.reply(truncate(text, 3800), { parse_mode: "Markdown" });
  });

  // /learn, /addskill
  bot.command(["learn", "addskill"], async (ctx) => {
    const raw = ctx.message?.text?.replace(/^\/(learn|addskill)(@\w+)?\s*/i, "").trim();
    if (!raw || !raw.includes("|")) {
      await ctx.reply(
        "ℹ️ *Format Perintah /learn (Tambah Skill/SOP Manual):*\n\n" +
        "`/learn <id> | <deskripsi singkat> | <langkah-langkah instruksi>`\n\n" +
        "Contoh:\n" +
        "`/learn restart-podcast | Restart service AI podcast | 1. Masuk ke projects/ai-podcast-live\\n2. Jalankan docker compose restart\\n3. Periksa status via curl http://localhost:3005`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const parts = raw.split("|").map((p) => p.trim());
    const id = parts[0];
    const description = parts[1] || "";
    const instructions = parts.slice(2).join("|").trim();

    if (!id || !instructions) {
      await ctx.reply("⚠️ Mohon isi minimal ID dan Langkah-langkah instruksi yang dipisahkan tanda pipa (`|`).", { parse_mode: "Markdown" });
      return;
    }

    const triggers = [id, ...description.toLowerCase().split(/\s+/).filter((w) => w.length > 3)];

    await saveSkill({
      id,
      name: id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description,
      triggers,
      instructions,
      source: "learned",
    });

    await ctx.reply(
      `🎓 *Skill Baru Berhasil Dipelajari & Terdaftar!*\n\n` +
      `🆔 ID: \`${id}\`\n` +
      `📖 Deskripsi: ${description || "-"}\n` +
      `🎯 Triggers: \`${triggers.join("`, `")}\`\n\n` +
      `_Skill ini akan otomatis dicocokkan saat Anda memberikan tugas terkait._`,
      { parse_mode: "Markdown" }
    );
  });

  // /delskill, /removeskill
  bot.command(["delskill", "removeskill"], async (ctx) => {
    const id = ctx.message?.text?.replace(/^\/(delskill|removeskill)(@\w+)?\s*/i, "").trim();
    if (!id) {
      await ctx.reply(
        "ℹ️ *Format Perintah /delskill:*\n\n" +
        "`/delskill <id_skill>`\n\n" +
        "Contoh: `/delskill restart-podcast`\n" +
        "Cek daftar ID dengan perintah `/skills`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const ok = await deleteSkill(id);
    if (ok) {
      await ctx.reply(`🗑️ *Skill \`${id}\` berhasil dihapus.*`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`⚠️ Skill dengan ID \`${id}\` tidak ditemukan. Cek daftar di \`/skills\`.`, { parse_mode: "Markdown" });
    }
  });

  // ==================== MULTI-AGENT SWARM COMMANDS ====================

  // /swarm, /parallel, /multitask
  bot.command(["swarm", "parallel", "multitask"], async (ctx) => {
    const raw = ctx.message?.text?.replace(/^\/(swarm|parallel|multitask)(@\w+)?\s*/i, "").trim();
    if (!raw) {
      await ctx.reply(
        "🐝 *Format Perintah /swarm (Multi-Agent Swarm):*\n\n" +
        "`/swarm <tugas 1> | <tugas 2> | <tugas 3>`\n\n" +
        "Atau dalam format baris bernomor:\n" +
        "`/swarm`\n" +
        "`1. Periksa container wa-bot`\n" +
        "`2. Cek disk space VPS`\n" +
        "`3. Analisis issue terakhir GitHub`\n\n" +
        "_Lead Orchestrator (TH Agent) akan langsung mendelegasikan masing-masing tugas ke Sub-Agent independen yang bekerja secara paralel di server!_",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await executeSwarm({ userMessage: raw, ctx });
  });

  // ==================== SELF-UPDATE COMMANDS ====================

  // /cekupdate, /checkupdate
  bot.command(["cekupdate", "checkupdate"], async (ctx) => {
    const statusMsg = await ctx.reply("🔍 *Memeriksa pembaruan di GitHub...*", {
      parse_mode: "Markdown",
    });

    const check = await checkForUpdates();
    if (check.error) {
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, `❌ Gagal memeriksa update: ${check.error}`)
        .catch(() => {});
      return;
    }

    if (!check.hasUpdate) {
      const msg =
        `✅ *TH Agent Sudah Versi Paling Mutakhir!*\n\n` +
        `🆔 Commit Aktif: \`${check.currentCommit}\`\n` +
        `🌐 Status: Sinkron dengan \`origin/main\` di GitHub.\n\n` +
        `_Tidak ada pembaruan baru yang perlu diinstal._`;
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
          parse_mode: "Markdown",
        })
        .catch(() => {});
      return;
    }

    const msg =
      `📦 *Pembaruan Ditemukan! (${check.commitCount} commit baru)*\n\n` +
      `• Versi Sekarang: \`${check.currentCommit}\`\n` +
      `• Versi Terbaru: \`${check.latestCommit}\`\n\n` +
      `*Daftar Perubahan:*\n\`\`\`\n${truncate(check.changelog, 500)}\n\`\`\`\n` +
      `💡 _Ketik \`/update\` untuk langsung memperbarui dan me-reload bot secara instan tanpa instal ulang!_`;

    await ctx.api
      .editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
        parse_mode: "Markdown",
      })
      .catch(() => {});
  });

  // /update, /upgrade
  bot.command(["update", "upgrade"], async (ctx) => {
    const arg = ctx.message?.text?.replace(/^\/(update|upgrade)(@\w+)?\s*/i, "").trim().toLowerCase();
    const isForce = arg === "force" || arg === "--force";

    await performSelfUpdate({ ctx, force: isForce });
  });

  // ==================== QUEUE CALLBACK QUERIES ====================

  // Callback: Lanjutkan eksekusi antrean
  bot.callbackQuery("queue_resume", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "▶️ Melanjutkan antrean..." });
    const count = getQueueLength();
    if (count === 0) {
      await ctx.reply("ℹ️ Antrean sudah kosong.");
      return;
    }
    await ctx.reply(`▶️ *Melanjutkan antrean...* (${count} instruksi tersisa)`, {
      parse_mode: "Markdown",
    });
    resumeQueue();
  });

  // Callback: Kosongkan antrean
  bot.callbackQuery("queue_clear", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🗑️ Mengosongkan antrean..." });
    const count = clearQueue();
    await ctx.reply(
      `🗑️ *Antrean Dikosongkan:*\nBerhasil membatalkan *${count} instruksi* yang ada di antrean.`,
      { parse_mode: "Markdown" }
    );
  });

  // Callback: Batalkan tugas aktif saja
  bot.callbackQuery("queue_cancel_active", async (ctx) => {
    const activeTask = getActiveTask();
    if (!activeTask) {
      await ctx.answerCallbackQuery({ text: "Tidak ada tugas aktif." });
      await ctx.reply("ℹ️ Tidak ada tugas aktif yang sedang berjalan.");
      return;
    }
    await ctx.answerCallbackQuery({ text: "🛑 Membatalkan tugas aktif..." });
    activeTask.cancelled = true;
    if (activeTask.process) killProcessTree(activeTask.process, "SIGTERM");
    await ctx.reply(`🛑 Permintaan pembatalan tugas aktif (\`${activeTask.id}\`) telah dikirim.`);
  });

  // ==================== QUICK-ACTION DASHBOARD / MENU ====================

  // /menu, /dashboard
  bot.command(["menu", "dashboard"], async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("📊 Status Server", "menu_status")
      .text("🧹 Bersihkan Cache", "menu_clean")
      .row()
      .text("🩺 Sentry Health", "menu_sentry")
      .text("🔄 Cek Update", "menu_update")
      .row()
      .text("📁 Daftar Proyek", "menu_projects")
      .text("📋 Cek Antrean", "menu_queue")
      .row()
      .text("⚙️ Pengaturan Agent", "menu_settings")
      .text("🌐 Web Control Panel", "menu_web_info");

    await ctx.reply(
      "🎛️ *Quick-Action Dashboard TH Agent*\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "Pilih tindakan operasional di bawah ini secara instan tanpa perlu mengetik manual:",
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  });

  // Callback: menu_status
  bot.callbackQuery("menu_status", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "📊 Memeriksa status..." });
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    const engineLabel = isClaude
      ? "Claude Code CLI (`claude`)"
      : isUniversal
      ? "Universal API (`Zero-CLI`)"
      : "Antigravity CLI (`agy`)";

    const queueLen = getQueueLength();
    const queueStatus =
      queueLen > 0
        ? `*${queueLen} instruksi menunggu* (\`/queue\`)`
        : "Kosong (tidak ada antrean)";

    const activeTask = getActiveTask();
    const taskStatus = activeTask
      ? `Sedang memproses (\`${activeTask.id}\`)`
      : "🟢 Idle (Siap menerima instruksi)";

    await ctx.reply(
      `📊 *Status Ringkas Server TH Agent*\n\n` +
        `• Status: ${taskStatus}\n` +
        `• Engine: *${engineLabel}*\n` +
        `• Antrean: ${queueStatus}\n\n` +
        `💡 Ketik \`/status\` untuk detail lengkap atau \`/sentry\` untuk cek kesehatan container.`,
      { parse_mode: "Markdown" }
    );
  });

  // Callback: menu_clean
  bot.callbackQuery("menu_clean", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🧹 Menjalankan pembersihan server..." });
    const statusMsg = await ctx.reply(
      "🧹 *Memulai pembersihan server...*\nSedang membersihkan Docker build cache, dangling images, NPM cache & file temporary...",
      { parse_mode: "Markdown" }
    );
    try {
      const report = await executeServerCleanup();
      const reportText = formatCleanupReport(report);
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, reportText, {
          parse_mode: "Markdown",
        })
        .catch(() => {});
    } catch (err) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ Gagal membersihkan server: ${err.message}`
        )
        .catch(() => {});
    }
  });

  // Callback: menu_sentry
  bot.callbackQuery("menu_sentry", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🩺 Memeriksa kesehatan server..." });
    const statusMsg = await ctx.reply(
      "🩺 *Memeriksa kesehatan container & resource server...*",
      { parse_mode: "Markdown" }
    );
    try {
      const cfg = await getSentryConfig();
      const health = await checkServerHealth(null, true);
      const text = formatSentryStatus(cfg, health);
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, text, {
          parse_mode: "Markdown",
        })
        .catch(() => {});
    } catch (err) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ Gagal memeriksa Sentry: ${err.message}`
        )
        .catch(() => {});
    }
  });

  // Callback: menu_update
  bot.callbackQuery("menu_update", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🔄 Memeriksa pembaruan..." });
    const check = await checkForUpdates();
    if (!check.hasUpdate) {
      await ctx.reply(
        `✅ *TH Agent Sudah Versi Paling Mutakhir!*\n\n` +
          `🆔 Commit Aktif: \`${check.currentCommit}\`\n` +
          `🌐 Status: Sinkron dengan \`origin/main\` di GitHub.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
    await ctx.reply(
      `📦 *Pembaruan Ditemukan! (${check.commitCount} commit baru)*\n\n` +
        `• Versi Sekarang: \`${check.currentCommit}\`\n` +
        `• Versi Terbaru: \`${check.latestCommit}\`\n\n` +
        `💡 Ketik \`/update\` untuk menginstal pembaruan secara instan!`,
      { parse_mode: "Markdown" }
    );
  });

  // Callback: menu_projects
  bot.callbackQuery("menu_projects", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "📁 Membaca daftar proyek..." });
    try {
      const items = await readdir(PROJECTS_DIR, { withFileTypes: true });
      const dirs = items
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);

      if (dirs.length === 0) {
        await ctx.reply("📁 Belum ada project di folder `./projects`.");
        return;
      }

      const list = dirs.map((d, i) => `${i + 1}. \`./projects/${d}\``).join("\n");
      await ctx.reply(
        `📁 *Daftar Proyek di \`./projects\` (${dirs.length}):*\n\n${list}`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal membaca folder projects: ${err.message}`);
    }
  });

  // Callback: menu_queue
  bot.callbackQuery("menu_queue", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "📋 Memeriksa antrean..." });
    const queue = getQueue();
    if (queue.length === 0) {
      await ctx.reply("📋 *Antrean Tugas Kosong*\nSemua tugas sudah selesai dikerjakan.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const lines = queue
      .map((item, idx) => `${idx + 1}. [${item.id}] _“${truncate(item.text, 50)}”_`)
      .join("\n");
    await ctx.reply(`📋 *Daftar Antrean Tugas (${queue.length}):*\n\n${lines}`, {
      parse_mode: "Markdown",
    });
  });

  // Helper render Panel Pengaturan Agent
  const renderSettingsMenu = async (ctx, editMessageId = null) => {
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    const engineLabel = isClaude ? "Claude Code" : isUniversal ? "Universal API" : "Antigravity";

    let activeModel = "";
    if (isClaude) {
      activeModel = await getUserClaudeModel(userId);
    } else if (isUniversal) {
      activeModel = await getUserUniversalModel(userId);
    } else {
      activeModel = await getUserAgyModel(userId);
    }

    const sentryCfg = await getSentryConfig();
    const voiceCfg = await getVoiceConfig();
    const hasVoiceKey = voiceCfg.provider === "groq"
      ? Boolean(voiceCfg.groqApiKey || process.env.GROQ_API_KEY)
      : Boolean(voiceCfg.openaiApiKey || process.env.OPENAI_API_KEY);

    const sandboxCfg = await getSandboxConfig();

    const universalUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
    const hasUniversalKey = Boolean(process.env.UNIVERSAL_API_KEY);
    const maskedUniversalKey = maskSecret(process.env.UNIVERSAL_API_KEY);

    let universalInfo = "";
    if (isUniversal) {
      universalInfo =
        `🔗 *Base URL:* \`${universalUrl}\`\n` +
        `🔑 *API Key:* ${hasUniversalKey ? "`" + maskedUniversalKey + "` ✅" : "⚠️ Belum diatur (/setkey)"}\n`;
    }

    const isCustomScope = sandboxCfg.role === "custom" || sandboxCfg.piSandbox;
    const scopeLabel = isCustomScope
      ? `🔒 Custom (${sandboxCfg.customFolders || "Folder Tertentu"})`
      : "🌐 Root (Full Access Semua Folder)";

    const port = process.env.WEB_PORT || 3030;
    const text =
      `⚙️ *Pusat Pengaturan TH Agent*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧠 *Engine AI:* \`${engineLabel}\`\n` +
      `🤖 *Model AI:* \`${activeModel}\`\n` +
      universalInfo +
      `🛡️ *Scope Akses:* ${scopeLabel}\n` +
      `🩺 *Sentry 24/7:* ${sentryCfg.enabled ? "🟢 Aktif (" + (sentryCfg.checkIntervalMinutes || 5) + "m)" : "🔴 Nonaktif"}\n` +
      `🛠️ *Auto-Healing:* ${sentryCfg.autoHeal ? "✅ Aktif (Auto-restart)" : "❌ Nonaktif"}\n` +
      `🎙️ *Voice Whisper:* \`${voiceCfg.provider.toUpperCase()}\` (${hasVoiceKey ? "Siap 🎙️" : "Belum diatur ⚠️"})\n` +
      `🌐 *Web Dashboard:* \`http://localhost:${port}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `_Tekan tombol di bawah untuk toggle atau ubah konfigurasi langsung:_`;

    const keyboard = new InlineKeyboard()
      .text("🔄 Ganti Engine", "setting_engine")
      .text("🤖 Ganti Model", "setting_model")
      .row();

    if (isUniversal) {
      keyboard.text("🌐 Atur API Key & URL", "setting_universal").row();
    }

    keyboard
      .text(isCustomScope ? "🌐 Ubah ke Role Root" : "🔒 Ubah ke Role Custom", "setting_toggle_scope")
      .row()
      .text(sentryCfg.enabled ? "🩺 Matikan Sentry" : "🩺 Nyalakan Sentry", "setting_toggle_sentry")
      .text(sentryCfg.autoHeal ? "🛠️ Matikan AutoHeal" : "🛠️ Nyalakan AutoHeal", "setting_toggle_heal")
      .row()
      .text("🎙️ Konfigurasi Voice", "setting_voice")
      .text("🌐 Web Control Panel", "menu_web_info")
      .row()
      .text("🔙 Kembali ke Menu Utama", "menu_main");

    if (editMessageId) {
      await ctx.api
        .editMessageText(ctx.chat.id, editMessageId, text, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        })
        .catch(() => {});
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  };

  // /settings, /pengaturan
  bot.command(["settings", "pengaturan"], async (ctx) => {
    await renderSettingsMenu(ctx);
  });

  // Callback: menu_settings
  bot.callbackQuery("menu_settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSettingsMenu(ctx, ctx.callbackQuery.message?.message_id);
  });

  // Callback: menu_main (Kembali ke menu dashboard awal)
  bot.callbackQuery("menu_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("📊 Status Server", "menu_status")
      .text("🧹 Bersihkan Cache", "menu_clean")
      .row()
      .text("🩺 Sentry Health", "menu_sentry")
      .text("🔄 Cek Update", "menu_update")
      .row()
      .text("📁 Daftar Proyek", "menu_projects")
      .text("📋 Cek Antrean", "menu_queue")
      .row()
      .text("⚙️ Pengaturan Agent", "menu_settings")
      .text("🌐 Web Control Panel", "menu_web_info");

    await ctx.api
      .editMessageText(
        ctx.chat.id,
        ctx.callbackQuery.message?.message_id,
        "🎛️ *Quick-Action Dashboard TH Agent*\n\nPilih tindakan operasional di bawah ini secara instan tanpa perlu mengetik perintah manual:",
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      )
      .catch(() => {});
  });

  // Callback: setting_toggle_scope & setting_toggle_pisandbox
  bot.callbackQuery(["setting_toggle_scope", "setting_toggle_pisandbox"], async (ctx) => {
    const current = await getSandboxConfig();
    const isCustom = current.role === "custom" || current.piSandbox;
    const newRole = isCustom ? "root" : "custom";
    await setEngineAccessRole(newRole, current.customFolders || "");
    await ctx.answerCallbackQuery({
      text: newRole === "root" ? "🌐 Role Root Aktif: Full Access Semua Folder" : "🔒 Role Custom Aktif: Dibatasi ke folder pilihan",
    });
    await renderSettingsMenu(ctx, ctx.callbackQuery.message?.message_id);
  });

  // /scope, /role, /sandbox
  bot.command(["scope", "role", "sandbox"], async (ctx) => {
    const raw = ctx.match?.trim() || "";
    const parts = raw.split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();

    if (!subCmd) {
      const cfg = await getSandboxConfig();
      const isCustom = cfg.role === "custom" || cfg.piSandbox;
      await ctx.reply(
        `🛡️ *Workspace Access Scope (Role Engine)*\n\n` +
          `• Role Aktif: *${isCustom ? "🔒 CUSTOM (Dibatasi)" : "🌐 ROOT (Akses Penuh)"}*\n` +
          `• Folder Diizinkan: \`${cfg.customFolders || "(Semua folder di ./projects)"}\`\n\n` +
          `💡 *Cara Mengubah:*\n` +
          `• \`/scope root\` - Berikan akses penuh ke seluruh folder\n` +
          `• \`/scope custom [folder1,folder2]\` - Batasi akses hanya ke folder tertentu\n` +
          `• Atau atur lewat Web Settings di \`http://localhost:${process.env.WEB_PORT || 3030}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (subCmd === "root" || subCmd === "all" || subCmd === "full") {
      await setEngineAccessRole("root");
      await ctx.reply(
        "🌐 *Role Berhasil Diubah ke ROOT (Akses Penuh)!*\n\n🔓 TH Agent kini bebas mengakses dan mengeksekusi seluruh proyek di dalam `./projects/`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (subCmd === "custom" || subCmd === "restrict") {
      const folders = parts.slice(1).join(" ").trim();
      const cur = await getSandboxConfig();
      const targetFolders = folders || cur.customFolders || "";
      await setEngineAccessRole("custom", targetFolders);
      await ctx.reply(
        `🔒 *Role Berhasil Diubah ke CUSTOM (Akses Dibatasi)!*\n\n` +
          `📁 Folder yang diizinkan:\n\`${targetFolders || "(Belum ditentukan / kosong)"}\`\n\n` +
          `_TH Agent hanya diizinkan mengakses folder tersebut saat mengeksekusi instruksi koding._`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  });

  // /pisandbox, /modepi (backwards compatibility)
  bot.command(["pisandbox", "modepi"], async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    let newRole = null;
    if (arg === "on" || arg === "aktif" || arg === "1") newRole = "custom";
    else if (arg === "off" || arg === "nonaktif" || arg === "0") newRole = "root";
    else {
      const cur = await getSandboxConfig();
      newRole = (cur.role === "custom" || cur.piSandbox) ? "root" : "custom";
    }
    const cur = await getSandboxConfig();
    const updated = await setEngineAccessRole(newRole, cur.customFolders || "");
    if (updated.role === "custom") {
      await ctx.reply(
        `🔒 *Mode Custom Scope Aktif!*\n\nAI dibatasi pada folder: \`${updated.customFolders || "Belum ditentukan"}\`.`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        "🌐 *Role ROOT Aktif (Akses Penuh)!*\n\n🔓 AI bebas mengakses seluruh folder di `./projects/`.",
        { parse_mode: "Markdown" }
      );
    }
  });

  // /setpi [API_KEY] atau /setpi [BASE_URL] [API_KEY]
  bot.command(["setpi", "pi", "setupi"], async (ctx) => {
    const rawArgs = ctx.match?.trim();
    const userId = ctx.from?.id;

    if (!rawArgs) {
      const currentUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
      const hasKey = Boolean(process.env.UNIVERSAL_API_KEY);
      const maskedKey = maskSecret(process.env.UNIVERSAL_API_KEY);
      const currentEngine = await getUserEngine(userId);
      const currentModel = await getUserUniversalModel(userId);

      await ctx.reply(
        `🍓 *Setup Model Pi (Inflection 3 AI)*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Model Pi (Inflection 3) dapat digunakan melalui penyedia API OpenAI-compatible seperti *OpenRouter* atau endpoint kustom.\n\n` +
        `📌 *Status Saat Ini:*\n` +
        `• Engine: \`${currentEngine}\`\n` +
        `• Model: \`${currentModel}\`\n` +
        `• Base URL: \`${currentUrl}\`\n` +
        `• API Key: ${hasKey ? "`" + maskedKey + "` ✅" : "⚠️ _Belum diatur_"}\n\n` +
        `🚀 *Cara Praktis 1-Langkah (via OpenRouter):*\n` +
        `Cukup kirim API Key OpenRouter kamu:\n` +
        `👉 \`/setpi sk-or-v1-xxxxxxxxxxxx\`\n\n` +
        `_Bot akan otomatis mengatur Base URL ke OpenRouter, memasang API Key, mengaktifkan Universal Engine, dan memilih model Inflection 3 Pi!_\n\n` +
        `🌐 *Atau dengan Custom URL:*\n` +
        `👉 \`/setpi <URL_API> <API_KEY>\`\n` +
        `Contoh:\n` +
        `\`/setpi https://openrouter.ai/api/v1 sk-or-v1-xxxx\`\n\n` +
        `🛠️ *Perintah Terpisah:*\n` +
        `• \`/seturl <URL>\` - Mengubah Base URL saja\n` +
        `• \`/setkey <KEY>\` - Mengubah API Key saja\n` +
        `• \`/pisandbox on\` - Kunci eksekusi ke projects/intiva\n` +
        `• Web Dashboard: \`http://localhost:${process.env.WEB_PORT || 3030}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const parts = rawArgs.split(/\s+/);

    // Cek jika pengguna memasukkan link dari Pi langsung: /pi <LINK_PI>
    const isUrlArg =
      parts[0].startsWith("http://") ||
      parts[0].startsWith("https://") ||
      parts[0].includes("://") ||
      parts[0].includes(":") ||
      parts[0].includes("/") ||
      /^(\d{1,3}\.){3}\d{1,3}/.test(parts[0]) ||
      parts[0].includes("localhost");

    if (parts.length === 1 && isUrlArg) {
      const targetUrl = normalizePiUrl(parts[0]);
      const res = await syncPiModelDirectly(targetUrl, process.env.UNIVERSAL_API_KEY || "", userId);
      if (!res.ok) {
        await ctx.reply(
          `❌ *Gagal mengambil model dari server Pi:*\n${res.error}\n\n` +
          `Server: \`${targetUrl}\`\n` +
          `💡 _Pastikan server Pi aktif dan port/path API sudah benar._`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const modelListStr = res.allModels
        .slice(0, 15)
        .map((m) => `• \`${m.id}\`${m.id === res.activeModel ? " *(Sedang Dipakai ✅)*" : ""}`)
        .join("\n");

      await ctx.reply(
        `🎉 *Setup Server Pi Berhasil!*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ *Engine Aktif:* \`Universal / Pi Server\`\n` +
        `✅ *Link Server Pi:* \`${res.serverUrl}\`\n` +
        `✅ *Model Terpilih:* \`${res.activeModel}\`\n\n` +
        `📋 *Daftar Model Ditemukan (${res.allModels.length}):*\n` +
        modelListStr +
        `\n\n_Model otomatis tersimpan di Pengaturan Web & aktif digunakan bot! 🚀_`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    let targetUrl = "https://openrouter.ai/api/v1";
    let targetKey = "";
    let targetModel = "inflection/inflection-3-pi";

    if (parts.length === 1) {
      targetKey = parts[0];
    } else if (parts.length === 2) {
      targetUrl = parts[0];
      targetKey = parts[1];
    } else {
      targetUrl = parts[0];
      targetKey = parts[1];
      targetModel = parts[2];
    }

    targetUrl = normalizePiUrl(targetUrl);

    // Coba deteksi model secara otomatis dari endpoint /models
    let detectedModels = [];
    try {
      detectedModels = await fetchRemoteModels(targetUrl, targetKey);
    } catch {
      detectedModels = [];
    }

    if (detectedModels.length > 0) {
      if (parts.length < 3) {
        // Ambil langsung model yang di-declare di server Pi (model pertama)
        targetModel = detectedModels[0].id;
      }
    }

    await updateEnvFile({
      UNIVERSAL_BASE_URL: targetUrl,
      UNIVERSAL_API_KEY: targetKey,
      CLI_ENGINE: "universal",
      UNIVERSAL_MODEL: targetModel,
    });

    await setUserEngine(userId, "universal");
    await setUserUniversalModel(userId, targetModel);

    let detectionSection = "";
    if (detectedModels.length > 0) {
      const modelItems = detectedModels
        .slice(0, 8)
        .map((m) => `• \`${m.id}\`${m.id === targetModel ? " *(Aktif ✅)*" : ""}`)
        .join("\n");
      const more =
        detectedModels.length > 8
          ? `\n_...dan ${detectedModels.length - 8} model lainnya._`
          : "";
      detectionSection =
        `\n🔍 *Auto-Detect Server (${detectedModels.length} Model Ditemukan):*\n` +
        modelItems +
        more +
        `\n💡 _Ganti model kapan saja dengan \`/model\`_\n`;
    }

    await ctx.reply(
      `🎉 *Setup Custom Pi Berhasil!*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *Engine Aktif:* \`Universal API (Zero-CLI)\`\n` +
      `✅ *Base URL:* \`${targetUrl}\`\n` +
      `✅ *API Key:* \`${maskSecret(targetKey)}\` (Tersimpan aman di .env)\n` +
      `✅ *Model Aktif:* \`${targetModel}\`\n` +
      detectionSection +
      `\n🍓 *Kombinasi Sandbox Intiva:*\n` +
      `Jika ingin membatasi coding HANYA di dalam folder \`projects/intiva/\`:\n` +
      `👉 \`/pisandbox on\`\n\n` +
      `Sekarang kamu sudah bisa langsung chat atau kirim tugas koding ke bot bro! 🚀`,
      { parse_mode: "Markdown" }
    );
  });

  // /detectmodels, /syncmodels, /cekmodels
  bot.command(["detectmodels", "syncmodels", "cekmodels"], async (ctx) => {
    const userId = ctx.from?.id;
    const url = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
    const key = process.env.UNIVERSAL_API_KEY || "";

    const loadingMsg = await ctx.reply(
      `🔍 *Menghubungi server:* \`${url}/models\`...\n_Mohon tunggu sebentar..._`,
      { parse_mode: "Markdown" }
    );

    const models = await fetchRemoteModels(url, key);

    if (models.length === 0) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          `⚠️ *Tidak ada model yang terdeteksi di server:*\n\`${url}/models\`\n\n` +
          `Kemungkinan penyebab:\n` +
          `1. Server custom belum menyediakan endpoint \`/models\` (standar OpenAI).\n` +
          `2. Server offline atau API Key salah.\n\n` +
          `💡 *Tenang!* Kamu tetap bisa menentukan model secara manual dengan mengetik:\n` +
          `👉 \`/model <NAMA_MODEL>\` (contoh: \`/model pi\`)`,
          { parse_mode: "Markdown" }
        )
        .catch(() => {});
      return;
    }

    const currentModel = await getUserUniversalModel(userId);
    const keyboard = new InlineKeyboard();
    for (const m of models.slice(0, 30)) {
      const isCurrent = m.id === currentModel;
      keyboard.text(`${isCurrent ? "🔘 " : "⚪ "}${m.name || m.id}`, `set_model:${m.id}`).row();
    }

    await ctx.api
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        `🎯 *Berhasil Mendeteksi ${models.length} Model di Server!*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 *Server:* \`${url}\`\n` +
        `👉 *Model Aktif:* \`${currentModel}\`\n\n` +
        `Silakan tap salah satu model di bawah untuk langsung mengaktifkannya:`,
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      )
      .catch(() => {});
  });

  // /getpi, /syncpi, /tarikpi, /getmodel, /getmodels - Langsung tarik dan aktifkan model dari server Pi
  bot.command(["getpi", "syncpi", "tarikpi", "getmodel", "getmodels"], async (ctx) => {
    const rawArg = ctx.match?.trim();
    const userId = ctx.from?.id;
    const url = normalizePiUrl(rawArg || process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1");
    const key = process.env.UNIVERSAL_API_KEY || "";

    const loadingMsg = await ctx.reply(
      `🔍 *Menghubungi server Pi:* \`${url}\`...\n_Sedang mengambil model langsung dari Pi..._`,
      { parse_mode: "Markdown" }
    );

    const res = await syncPiModelDirectly(url, key, userId);

    if (!res.ok) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          `❌ *Gagal mengambil model dari Pi:*\n${res.error}\n\n` +
          `Server: \`${url}\`\n\n` +
          `💡 *Solusi:*\n` +
          `• Pastikan server Pi sedang aktif dan dapat diakses.\n` +
          `• Kirim link langsung: \`/getmodel <LINK_PI>\` (contoh: \`/getmodel http://192.168.1.50:8000/v1\`).\n` +
          `• Coba periksa URL dengan \`/seturl <URL>\`.\n` +
          `• Atau atur di Web Control Panel http://localhost:${process.env.WEB_PORT || 3030}.`,
          { parse_mode: "Markdown" }
        )
        .catch(() => {});
      return;
    }

    const modelListStr = res.allModels
      .slice(0, 30)
      .map((m) => `• \`${m.id}\`${m.id === res.activeModel ? " *(Sedang Dipakai ✅)*" : ""}`)
      .join("\n");

    const moreStr =
      res.allModels.length > 30
        ? `\n_...dan ${res.allModels.length - 30} model lainnya._`
        : "";

    await ctx.api
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        `🎉 *Berhasil Get Model Langsung dari Server Pi!*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ *Model Terpilih:* \`${res.activeModel}\`\n` +
        `🌐 *Server Pi:* \`${res.serverUrl}\`\n` +
        `⚙️ *Engine:* \`Universal / Pi Server\`\n\n` +
        `📋 *Daftar Model yang Ditemukan di Pi:*\n` +
        modelListStr +
        moreStr +
        `\n\n_Model ini otomatis tersinkronisasi di Pengaturan Web & Telegram! Ketik /model untuk mengganti pilihan model kapan saja._ 🚀`,
        { parse_mode: "Markdown" }
      )
      .catch(() => {});
  });

  // /seturl <URL>
  bot.command(["seturl", "setbaseurl"], async (ctx) => {
    const url = ctx.match?.trim();
    const userId = ctx.from?.id;
    if (!url) {
      const current = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
      await ctx.reply(
        `🔗 *Pengaturan Base URL Server Pi*\n\n` +
        `Link server Pi saat ini:\n\`${current}\`\n\n` +
        `Untuk mengubah atau mengambil model dari Pi, gunakan:\n` +
        `👉 \`/getmodel <LINK_PI>\`\n` +
        `👉 \`/seturl <LINK_PI>\`\n\n` +
        `Contoh:\n` +
        `• Server Pi: \`/getmodel http://192.168.1.50:8000/v1\`\n` +
        `• LiteLLM: \`/getmodel http://localhost:4000/v1\`\n` +
        `• Ollama: \`/getmodel http://localhost:11434/v1\`\n` +
        `• OpenRouter: \`/seturl https://openrouter.ai/api/v1\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const finalUrl = normalizePiUrl(url);

    await updateEnvFile({ UNIVERSAL_BASE_URL: finalUrl, CLI_ENGINE: "universal" });
    process.env.UNIVERSAL_BASE_URL = finalUrl;
    process.env.CLI_ENGINE = "universal";
    await setUserEngine(userId, "universal");

    // Coba langsung tarik model dari server baru
    let syncInfo = "";
    try {
      const syncRes = await syncPiModelDirectly(finalUrl, process.env.UNIVERSAL_API_KEY || "", userId);
      if (syncRes.ok) {
        syncInfo = `\n🎯 *Model Auto-Sync:* Langsung terhubung ke model \`${syncRes.activeModel}\` dari server Pi!`;
      }
    } catch {}

    await ctx.reply(`✅ *Link Server Pi berhasil diubah ke:*\n\`${finalUrl}\`${syncInfo}\n\n_Engine otomatis diaktifkan ke Universal / Pi Server._`, {
      parse_mode: "Markdown",
    });
  });

  // /setkey <API_KEY>
  bot.command(["setkey", "setapikey"], async (ctx) => {
    const key = ctx.match?.trim();
    if (!key) {
      const hasKey = Boolean(process.env.UNIVERSAL_API_KEY);
      const masked = maskSecret(process.env.UNIVERSAL_API_KEY);
      await ctx.reply(
        `🔑 *Pengaturan Universal API Key*\n\n` +
        `Status API Key saat ini: ${hasKey ? "`" + masked + "` ✅" : "⚠️ _Belum diatur_"}\n\n` +
        `Untuk memasang atau mengganti, gunakan:\n` +
        `👉 \`/setkey <API_KEY>\`\n\n` +
        `_Contoh:_\n` +
        `\`/setkey sk-or-v1-abcdef123456...\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await updateEnvFile({ UNIVERSAL_API_KEY: key });
    await ctx.reply(
      `✅ *API Key berhasil disimpan!*\n\nKey: \`${maskSecret(key)}\`\nTersimpan aman di environment dan file \`.env\`.`,
      { parse_mode: "Markdown" }
    );
  });

  // /universal, /setuniversal
  bot.command(["universal", "setuniversal"], async (ctx) => {
    const userId = ctx.from?.id;
    const currentUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
    const hasKey = Boolean(process.env.UNIVERSAL_API_KEY);
    const maskedKey = maskSecret(process.env.UNIVERSAL_API_KEY);
    const currentEngine = await getUserEngine(userId);
    const currentModel = await getUserUniversalModel(userId);

    await ctx.reply(
      `🌐 *Konfigurasi Universal API (Zero-CLI)*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• *Engine Aktif:* \`${currentEngine}\` ${currentEngine === "universal" ? "✅" : "*(Ganti dengan /engine universal)*"}\n` +
      `• *Model Universal:* \`${currentModel}\`\n` +
      `• *Base URL:* \`${currentUrl}\`\n` +
      `• *API Key:* ${hasKey ? "`" + maskedKey + "` ✅" : "⚠️ _Belum diatur_"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Perintah Cepat:*\n` +
      `• \`/setpi <API_KEY>\` - Setup otomatis Model Pi via OpenRouter\n` +
      `• \`/seturl <URL>\` - Ubah Base URL\n` +
      `• \`/setkey <KEY>\` - Ubah Universal API Key\n` +
      `• \`/model\` - Pilih daftar model AI`,
      { parse_mode: "Markdown" }
    );
  });

  // Callback: setting_universal
  bot.callbackQuery("setting_universal", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🌐 *Pengaturan Universal API & Pi:*\n\n" +
      "• Atur Base URL: `/seturl <URL>`\n" +
      "• Atur API Key: `/setkey <API_KEY>`\n" +
      "• Setup instan Model Pi: `/setpi <API_KEY>`\n\n" +
      "Atau buka Web Control Panel untuk konfigurasi lengkap.",
      { parse_mode: "Markdown" }
    );
  });

  // Callback: setting_toggle_sentry
  bot.callbackQuery("setting_toggle_sentry", async (ctx) => {
    const current = await getSentryConfig();
    const newState = !current.enabled;
    await toggleSentry(newState);
    await ctx.answerCallbackQuery({ text: newState ? "🩺 Sentry diaktifkan" : "🩺 Sentry dinonaktifkan" });
    await renderSettingsMenu(ctx, ctx.callbackQuery.message?.message_id);
  });

  // Callback: setting_toggle_heal
  bot.callbackQuery("setting_toggle_heal", async (ctx) => {
    const current = await getSentryConfig();
    const newState = !current.autoHeal;
    await toggleAutoHeal(newState);
    await ctx.answerCallbackQuery({ text: newState ? "🛠️ Auto-Heal diaktifkan" : "🛠️ Auto-Heal dinonaktifkan" });
    await renderSettingsMenu(ctx, ctx.callbackQuery.message?.message_id);
  });

  // Callback: setting_engine
  bot.callbackQuery("setting_engine", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🔄 *Pilih Engine AI:*\n\nKetik `/engine` untuk memilih engine (Antigravity CLI / Claude Code / Universal API).",
      { parse_mode: "Markdown" }
    );
  });

  // Callback: setting_model
  bot.callbackQuery("setting_model", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🤖 *Pilih Model AI:*\n\nKetik `/model` untuk memilih model yang tersedia.",
      { parse_mode: "Markdown" }
    );
  });

  // Callback: setting_voice
  bot.callbackQuery("setting_voice", async (ctx) => {
    await ctx.answerCallbackQuery();
    const cfg = await getVoiceConfig();
    await ctx.reply(
      `🎙️ *Pengaturan Voice Whisper*\n\n` +
        `• Provider: *${cfg.provider.toUpperCase()}*\n` +
        `• Model: \`${cfg.model}\`\n\n` +
        `💡 *Cara Mengubah:*\nKetik perintah: \`/setwhisper <api-key> [groq|openai]\`\n\n` +
        `_Dapatkan kunci Groq kilat gratis di console.groq.com/keys._`,
      { parse_mode: "Markdown" }
    );
  });

  // Callback: menu_web_info
  bot.callbackQuery("menu_web_info", async (ctx) => {
    await ctx.answerCallbackQuery();
    const port = process.env.WEB_PORT || 3030;
    await ctx.reply(
      `🌐 *Web Control Panel & Settings Dashboard*\n\n` +
        `Dashboard web grafis aktif di port \`${port}\`:\n` +
        `• Localhost: \`http://localhost:${port}\`\n\n` +
        `💡 *Fitur Web Dashboard:*\n` +
        `• Form konfigurasi lengkap (Token, Keys, Model, Engine)\n` +
        `• Audit kesehatan kontainer & disk secara visual\n` +
        `• Kontrol Sentry & Proactive Auto-Healing\n` +
        `• Pengaturan Voice Note Whisper & bahasa\n\n` +
        `_Akses via SSH Tunnel jika remote VPS:_\n\`ssh -L ${port}:localhost:${port} user@server-ip\``,
      { parse_mode: "Markdown" }
    );
  });

  // ==================== SERVER SENTRY & AUTO-HEALING ====================

  // /sentry [check | on | off | autoheal on|off]
  bot.command("sentry", async (ctx) => {
    const raw = ctx.message?.text?.replace(/^\/sentry(@\w+)?\s*/i, "").trim().toLowerCase();
    const parts = raw ? raw.split(/\s+/) : [];
    const action = parts[0] || "check";

    if (action === "on") {
      const cfg = await toggleSentry(true);
      await ctx.reply(
        `🩺 *Server Sentry DIAKTIFKAN* ✅\n` +
          `• Interval monitoring: setiap ${cfg.checkIntervalMinutes || 5} menit\n` +
          `• Auto-healing: ${cfg.autoHeal ? "Aktif (Auto-restart container)" : "Nonaktif (Alert saja)"}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "off") {
      await toggleSentry(false);
      await ctx.reply(
        "🩺 *Server Sentry DINONAKTIFKAN* ❌\nMonitoring background dan auto-healing dijeda sementara.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "autoheal") {
      const sub = parts[1];
      if (sub === "on") {
        await toggleAutoHeal(true);
        await ctx.reply(
          "🩺 *Sentry Auto-Healing: DIAKTIFKAN* ✅\nContainer yang mati akan otomatis di-restart oleh sentry.",
          { parse_mode: "Markdown" }
        );
        return;
      }
      if (sub === "off") {
        await toggleAutoHeal(false);
        await ctx.reply(
          "🩺 *Sentry Auto-Healing: DINONAKTIFKAN* ❌\nSentry hanya akan mengirim notifikasi tanpa auto-restart.",
          { parse_mode: "Markdown" }
        );
        return;
      }
      const cfg = await getSentryConfig();
      await ctx.reply(
        `🩺 *Status Auto-Healing Sentry:* ${cfg.autoHeal ? "Aktif ✅" : "Nonaktif ❌"}\n` +
          `Ketik \`/sentry autoheal on\` untuk mengaktifkan atau \`/sentry autoheal off\` untuk mematikan.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "watch") {
      const target = parts[1];
      if (!target) {
        await ctx.reply("💡 *Format:* `/sentry watch <nama_kontainer>`\nContoh: `/sentry watch ai-podcast-live`", { parse_mode: "Markdown" });
        return;
      }
      const list = await addWatchedContainer(target);
      await ctx.reply(
        `✅ Kontainer \`${target}\` berhasil ditambahkan ke daftar pantauan Sentry!\n\n` +
          `📦 *Total Pantauan (${list.length}):*\n` +
          list.map((c) => `• \`${c}\``).join("\n"),
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "unwatch") {
      const target = parts[1];
      if (!target) {
        await ctx.reply("💡 *Format:* `/sentry unwatch <nama_kontainer>`", { parse_mode: "Markdown" });
        return;
      }
      const list = await removeWatchedContainer(target);
      await ctx.reply(
        `🗑️ Kontainer \`${target}\` telah dihapus dari pantauan Sentry.\n\n` +
          `📦 *Sisa Pantauan (${list.length}):*\n` +
          (list.length > 0 ? list.map((c) => `• \`${c}\``).join("\n") : "_Tidak ada kontainer yang dipantau_"),
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "containers" || action === "list") {
      const dockerInfo = await getDockerContainers();
      if (!dockerInfo.available) {
        await ctx.reply("💻 *Mode Lokal:* Docker daemon tidak ditemukan di lingkungan ini.", { parse_mode: "Markdown" });
        return;
      }
      const cfg = await getSentryConfig();
      const watched = new Set(cfg.targetContainers || []);
      const lines = dockerInfo.containers.map((c) => {
        const isWatched = watched.has(c.name) ? " *(Dipantau 🩺)*" : "";
        const icon = c.running ? "🟢" : "🔴";
        return `• ${icon} \`${c.name}\` (${c.status})${isWatched}`;
      });
      await ctx.reply(
        `📦 *Daftar Kontainer Docker di Server:*\n\n${lines.join("\n")}\n\n` +
          `💡 Ketik \`/sentry watch <nama>\` untuk memantau atau \`/sentry unwatch <nama>\` untuk menghapus.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Default: check status
    const statusMsg = await ctx.reply(
      "🩺 *Memeriksa kesehatan container & resource server...*",
      { parse_mode: "Markdown" }
    );
    try {
      const cfg = await getSentryConfig();
      const health = await checkServerHealth(null, true);
      const text = formatSentryStatus(cfg, health);
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, text, {
          parse_mode: "Markdown",
        })
        .catch(() => {});
    } catch (err) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ Gagal memeriksa Sentry: ${err.message}`
        )
        .catch(() => {});
    }
  });

  // ==================== VOICE / WHISPER CONFIGURATION ====================

  // /setwhisper <api-key> [groq|openai]
  bot.command(["setwhisper", "whisper", "voice"], async (ctx) => {
    const raw = ctx.message?.text?.replace(/^\/(setwhisper|whisper|voice)(@\w+)?\s*/i, "").trim();
    if (!raw) {
      const cfg = await getVoiceConfig();
      const hasKey = cfg.provider === "groq" ? !!(cfg.groqApiKey || process.env.GROQ_API_KEY) : !!(cfg.openaiApiKey || process.env.OPENAI_API_KEY);
      const activeKey = cfg.provider === "groq" ? (cfg.groqApiKey || process.env.GROQ_API_KEY) : (cfg.openaiApiKey || process.env.OPENAI_API_KEY);
      const statusKey = hasKey
        ? `Tersimpan (\`${activeKey.slice(0, 4)}...${activeKey.slice(-4)}\`)`
        : "_Belum diatur (Bisa diisi via /setwhisper atau GROQ_API_KEY di .env)_";
      await ctx.reply(
        `🎙️ *Konfigurasi Voice Note & Whisper*\n\n` +
          `• Provider aktif: *${cfg.provider.toUpperCase()}*\n` +
          `• API Key status: ${statusKey}\n` +
          `• Model: \`${cfg.model}\`\n\n` +
          `💡 *Cara Mengatur:*\n` +
          `Ketik: \`/setwhisper <api-key> [groq|openai]\`\n\n` +
          `_Rekomendasi: Gunakan API Key Groq (\`gsk_...\`) karena transkripsi Whisper di Groq sangat cepat (~500ms) dan kuotanya generous/gratis!_\n\n` +
          `🎙️ *Penggunaan:* Rekam Voice Note di Telegram dan kirim langsung ke chat ini. AI akan mentranskripsi suara Anda dan mengeksekusi instruksi kodingnya!`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const parts = raw.split(/\s+/);
    const apiKey = parts[0];
    const provider = parts[1]?.toLowerCase() || (apiKey.startsWith("gsk_") ? "groq" : "openai");

    const saved = await setWhisperApiKey(apiKey, provider);
    await ctx.reply(
      `✅ *Voice Transcription Berhasil Dikonfigurasi!*\n\n` +
        `• Provider: *${saved.provider.toUpperCase()}*\n` +
        `• Model: \`${saved.model}\`\n\n` +
        `🎙️ Sekarang Anda bisa langsung merekam & mengirim *Voice Note* di chat ini. TH Agent akan otomatis mengeksekusi instruksi Anda!`,
      { parse_mode: "Markdown" }
    );
  });

  // ==================== NOTION TASK MANAGEMENT ====================

  // /notion [check|on|off|add <project> <db_id>]
  bot.command(["notion", "notionsync"], async (ctx) => {
    const text = (ctx.message?.text || "").trim();
    const parts = text.split(/\s+/).slice(1);
    const subcmd = (parts[0] || "").toLowerCase();

    const config = await getNotionConfig();

    if (subcmd === "check" || subcmd === "sync") {
      await ctx.reply("🔍 Memeriksa task *TODO* di database Notion sekarang...", { parse_mode: "Markdown" });
      await checkNotionTasks(bot, ctx.chat?.id, true);
      return;
    }

    if (subcmd === "on") {
      config.enabled = true;
      await saveNotionConfig(config);
      await ctx.reply("🟢 *Notion Auto-Watcher diaktifkan.* Bot akan rutin memeriksa task TODO.", { parse_mode: "Markdown" });
      return;
    }

    if (subcmd === "off") {
      config.enabled = false;
      await saveNotionConfig(config);
      await ctx.reply("🔴 *Notion Auto-Watcher dinonaktifkan.*", { parse_mode: "Markdown" });
      return;
    }

    if (subcmd === "add" && parts[1] && parts[2]) {
      const projName = parts[1].trim();
      const rawDb = parts[2].trim();
      const dbId = rawDb.replace(/https:\/\/.*notion\.com\/.*p\//, "").split("?")[0];
      config.projects[projName] = dbId;
      await saveNotionConfig(config);
      await ctx.reply(`✅ *Database Notion Terhubung!*\n\n• Proyek: \`${projName}\`\n• Database ID: \`${dbId}\``, { parse_mode: "Markdown" });
      return;
    }

    // Default: Tampilkan status
    const projectsList = Object.entries(config.projects || {})
      .map(([p, id]) => `• \`${p}\`: \`${id}\``)
      .join("\n") || "_(Belum ada proyek yang dipetakan)_";

    await ctx.reply(
      `📊 *Status Integrasi Notion Task Management*\n\n` +
      `• Auto-Watcher: ${config.enabled ? "🟢 *Aktif*" : "🔴 *Non-aktif*"}\n` +
      `• Interval Patroli: *${config.checkIntervalMinutes || 3} menit*\n\n` +
      `📁 *Database Terdaftar:*\n${projectsList}\n\n` +
      `💡 *Perintah Bantuan:*\n` +
      `• \`/notion check\` – Tarik & eksekusi task TODO sekarang\n` +
      `• \`/notion on\` / \`/notion off\` – Aktifkan / hentikan auto-watcher\n` +
      `• \`/notion add <project> <database_id>\` – Tambah mapping proyek baru`,
      { parse_mode: "Markdown" }
    );
  });
}


