import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR, MAX_OUTPUT } from "../../config/env.js";
import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
} from "../../config/models.js";
import {
  getUserEngine,
  getUserAgyModel,
  getUserClaudeModel,
  getUserUniversalModel,
  resetUserConversation,
} from "../../services/context-store.js";
import {
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  killProcessTree,
} from "../../services/cli-runner.js";
import { formatBytes, truncate } from "../../services/telegram-files.js";
import { sendToAgent } from "../dispatcher.js";
import {
  isGhAvailable,
  loadWatchConfig,
  addWatchedRepo,
  removeWatchedRepo,
} from "../../services/github-service.js";
import { triggerManualCheck } from "../../services/github-watcher.js";

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
      activeModelDisplay = `*${matched?.name || univModel}* (\`${univModel}\`)`;
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
        "📁 *Fitur File & Gambar:*\n" +
        "• *Kirim Dokumen / Skrip:* Kirim file `.py`, `.js`, `.sh`, `.json`, `.zip` dll. dengan caption instruksi.\n" +
        "• *Kirim Gambar / Foto:* Kirim screenshot error terminal, mockup UI, atau diagram untuk dianalisis AI.\n\n" +
        "Perintah bantuan:\n" +
        "• `/files` - Lihat daftar file dan gambar yang telah diunggah\n" +
        "• `/issue <url>` - Baca & selesaikan GitHub Issue secara otomatis\n" +
        "• `/checkissues` - Cek issue baru di GitHub sekarang (manual trigger)\n" +
        "• `/watched` - Lihat repository yang sedang dipantau secara berkala\n" +
        "• `/watchrepo <repo>` - Pantau repo baru (contoh: owner/repo)\n" +
        "• `/exec <cmd>` - Eksekusi perintah terminal langsung di server\n" +
        "• `/engine` - Ganti engine (Antigravity / Claude Code / Universal API)\n" +
        "• `/model` - Pilih atau ganti model AI\n" +
        "• `/reset` - Mulai sesi obrolan baru dari awal\n" +
        "• `/status` - Cek status bot, engine & model aktif\n" +
        "• `/cancel` - Hentikan tugas yang sedang berjalan",
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
      activeModelDisplay = `*${matched?.name || univModel}* (\`${univModel}\`)`;
    } else {
      const agyModel = await getUserAgyModel(userId);
      const matched = AVAILABLE_AGY_MODELS.find((m) => m.id === agyModel);
      activeModelDisplay = `*${matched?.name || agyModel}* (\`${agyModel}\`)`;
    }

    const activeTask = getActiveTask();
    if (!activeTask) {
      await ctx.reply(
        `🟢 TH Agent sedang idle (siap menerima instruksi).\n` +
        `⚙️ Engine aktif: *${engineLabel}*\n` +
        `🤖 Model aktif: ${activeModelDisplay}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const elapsed = Math.floor((Date.now() - activeTask.startedAt) / 1000);
    await ctx.reply(
      `⏳ TH Agent sedang menjalankan tugas:\nID: \`${activeTask.id}\`\nDurasi: ${elapsed} detik.\n` +
      `⚙️ Engine: *${engineLabel}*\n` +
      `🤖 Model: ${activeModelDisplay}`,
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

  // /cancel
  bot.command("cancel", async (ctx) => {
    const activeTask = getActiveTask();
    if (!activeTask?.process) {
      await ctx.reply("Tidak ada proses agent yang sedang aktif.");
      return;
    }
    activeTask.cancelled = true;
    killProcessTree(activeTask.process, "SIGTERM");
    await ctx.reply("🛑 Permintaan pembatalan telah dikirim.");
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

      await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`❌ Gagal membaca status pantauan: ${err.message}`);
    }
  });
}
