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
}

