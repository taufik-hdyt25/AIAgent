import { InlineKeyboard } from "grammy";
import { ALLOWED_IDS } from "../config/env.js";
import {
  isGhAvailable,
  loadWatchConfig,
  checkNewIssuesForRepo,
  fetchIssueDetails,
  formatIssueForPrompt,
} from "./github-service.js";
import { runIssueAnalysis, runAutoFixAndCreatePr } from "./autofix-service.js";

let watcherInterval = null;
let isPolling = false;

// Mengirim pesan ke semua user yang diizinkan (atau ke chatId spesifik)
export async function notifyUsers(bot, message, specificChatId = null, replyMarkup = null) {
  const options = {
    disable_web_page_preview: true,
  };
  if (replyMarkup) {
    options.reply_markup = replyMarkup;
  }

  if (specificChatId) {
    try {
      await bot.api.sendMessage(specificChatId, message, {
        ...options,
        parse_mode: "Markdown",
      });
    } catch {
      await bot.api.sendMessage(specificChatId, message, options);
    }
    return;
  }

  for (const chatId of ALLOWED_IDS) {
    try {
      await bot.api.sendMessage(chatId, message, {
        ...options,
        parse_mode: "Markdown",
      });
    } catch {
      try {
        await bot.api.sendMessage(chatId, message, options);
      } catch (err) {
        console.warn(`[GitHub Watcher] Gagal kirim notifikasi ke ${chatId}:`, err.message);
      }
    }
  }
}

// Fungsi utama pengecekan seluruh repository yang dipantau
export async function checkAllWatchedRepos(bot, specificChatId = null, isManual = false) {
  if (isPolling) {
    if (specificChatId) {
      await bot.api.sendMessage(
        specificChatId,
        "⏳ Pengecekan GitHub Issue sedang berlangsung, harap tunggu sebentar..."
      );
    }
    return;
  }

  const ghReady = await isGhAvailable();
  if (!ghReady) {
    if (specificChatId) {
      await bot.api.sendMessage(
        specificChatId,
        "⚠️ *GitHub CLI (`gh`) belum aktif!*\nSilakan pasang `gh` dan isi `GITHUB_TOKEN` di file `.env` atau Web Control Panel.",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  isPolling = true;
  try {
    const config = await loadWatchConfig();
    const repos = config.watchedRepos || [];

    if (repos.length === 0) {
      if (specificChatId) {
        await bot.api.sendMessage(
          specificChatId,
          "ℹ️ Belum ada repositori yang dipantau.\nGunakan `/watchrepo <owner/repo>` untuk mulai memantau.",
          { parse_mode: "Markdown" }
        );
      }
      return;
    }

    let totalNew = 0;

    for (const repo of repos) {
      try {
        const { isFirstRun, newIssues, existingCount } = await checkNewIssuesForRepo(repo);

        if (isFirstRun) {
          console.log(
            `[GitHub Watcher] Inisialisasi awal repositori ${repo}: mencatat ${existingCount} issue eksisting.`
          );
          if (isManual && specificChatId) {
            await notifyUsers(
              bot,
              `✅ Berhasil menginisialisasi pantauan untuk \`${repo}\` (${existingCount} issue terbuka dicatat).`,
              specificChatId
            );
          }
          continue;
        }

        if (newIssues && newIssues.length > 0) {
          totalNew += newIssues.length;
          for (const issue of newIssues) {
            const author = issue.author?.login || "anonymous";
            const labels = (issue.labels || []).map((l) => l.name).join(", ") || "-";

            const keyboard = new InlineKeyboard()
              .text(`🛠️ Bikin Fix & Draft PR`, `autofix:${repo}:${issue.number}`)
              .row()
              .url(`🌐 Buka di GitHub`, issue.url || `https://github.com/${repo}/issues/${issue.number}`)
              .text(`🚀 Deploy ke Server`, `deploy_prompt:${repo}`);

            const notifMsg =
              `🚨 *GITHUB ISSUE BARU TERDETEKSI!*\n\n` +
              `📦 *Repo:* \`${repo}\`\n` +
              `📌 *Issue #${issue.number}:* ${issue.title}\n` +
              `👤 *Penulis:* @${author}\n` +
              `🏷 *Labels:* ${labels}\n` +
              `🔗 *URL:* ${issue.url}\n\n` +
              `⚙️ *Auto-Analyze:* ${config.autoAnalyze !== false ? "🟢 Aktif" : "⚪ Nonaktif"}\n` +
              `🤖 *Auto-Fix & PR:* ${config.autoFix ? "🟢 Aktif" : "⚪ Nonaktif (Klik tombol di bawah)"}`;

            await notifyUsers(bot, notifMsg, specificChatId, keyboard);

            // Step 2: Auto-Analyze jika aktif
            if (config.autoAnalyze !== false) {
              console.log(`[GitHub Watcher] Menjalankan Auto-Analyze untuk issue #${issue.number} di ${repo}...`);
              runIssueAnalysis({
                repo,
                issueNumber: issue.number,
                issueData: issue,
                bot,
                notifyChatId: specificChatId,
              }).catch((err) => {
                console.error(`[GitHub Watcher] Error auto-analyze #${issue.number}:`, err);
              });
            }

            // Step 3: Auto-Fix jika dikonfigurasi aktif secara otomatis
            if (config.autoFix) {
              console.log(`[GitHub Watcher] Menjalankan Auto-Fix otomatis untuk issue #${issue.number} di ${repo}...`);
              runAutoFixAndCreatePr({
                repo,
                issueNumber: issue.number,
                bot,
                notifyChatId: specificChatId,
              }).catch((err) => {
                console.error(`[GitHub Watcher] Error auto-fix #${issue.number}:`, err);
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[GitHub Watcher] Error cek repo ${repo}:`, err.message);
        if (isManual && specificChatId) {
          await notifyUsers(bot, `⚠️ Gagal memeriksa \`${repo}\`: ${err.message}`, specificChatId);
        }
      }
    }

    if (isManual && specificChatId && totalNew === 0) {
      await notifyUsers(
        bot,
        `✅ *Pengecekan Selesai!*\nTidak ada issue baru pada ${repos.length} repositori yang dipantau.`,
        specificChatId
      );
    }
  } finally {
    isPolling = false;
  }
}

// Inisialisasi watcher berkala (background interval)
export async function initGithubWatcher(bot) {
  if (watcherInterval) {
    clearInterval(watcherInterval);
  }

  const ghReady = await isGhAvailable();
  if (!ghReady) {
    console.log("[GitHub Watcher] GitHub CLI (gh) belum terpasang. Watcher otomatis tidak diaktifkan.");
    return;
  }

  const config = await loadWatchConfig();
  const intervalMs = Math.max(1, config.pollIntervalMinutes || 5) * 60 * 1000;

  console.log(
    `[GitHub Watcher] ${config.enabled ? "Aktif" : "Nonaktif (bisa diaktifkan via /watcher on)"} - ` +
      `${config.watchedRepos.length} repositori, interval ${config.pollIntervalMinutes} menit.`
  );

  // Status ON/OFF dibaca ulang setiap tick, jadi toggle via /watcher atau Web Panel berlaku tanpa restart
  const scheduledCheck = async () => {
    const current = await loadWatchConfig();
    if (!current.enabled) return;
    await checkAllWatchedRepos(bot, null, false);
  };

  // Jalankan pengecekan perdana 10 detik setelah bot startup
  setTimeout(() => {
    scheduledCheck().catch((err) => {
      console.warn("[GitHub Watcher] Error initial check:", err.message);
    });
  }, 10000);

  // Loop berkala
  watcherInterval = setInterval(() => {
    scheduledCheck().catch((err) => {
      console.warn("[GitHub Watcher] Error interval check:", err.message);
    });
  }, intervalMs);
}

// Trigger manual
export async function triggerManualCheck(bot, ctx) {
  const userId = ctx.from?.id;
  await ctx.reply("🔍 Memeriksa issue terbaru di GitHub sekarang...");
  await checkAllWatchedRepos(bot, userId, true);
}
