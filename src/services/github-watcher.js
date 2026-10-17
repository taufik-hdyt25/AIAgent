import { ALLOWED_IDS } from "../config/env.js";
import {
  isGhAvailable,
  loadWatchConfig,
  checkNewIssuesForRepo,
  fetchIssueDetails,
  formatIssueForPrompt,
} from "./github-service.js";

let watcherInterval = null;
let isPolling = false;

// Mengirim pesan ke semua user yang diizinkan (atau ke chatId spesifik)
async function notifyUsers(bot, message, specificChatId = null) {
  if (specificChatId) {
    try {
      await bot.api.sendMessage(specificChatId, message, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    } catch {
      await bot.api.sendMessage(specificChatId, message, {
        disable_web_page_preview: true,
      });
    }
    return;
  }

  for (const chatId of ALLOWED_IDS) {
    try {
      await bot.api.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    } catch {
      try {
        await bot.api.sendMessage(chatId, message, {
          disable_web_page_preview: true,
        });
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

            const notifMsg =
              `🚨 *GITHUB ISSUE BARU TERDETEKSI!*\n\n` +
              `📦 *Repo:* \`${repo}\`\n` +
              `📌 *Issue #${issue.number}:* ${issue.title}\n` +
              `👤 *Penulis:* @${author}\n` +
              `🏷 *Labels:* ${labels}\n` +
              `🔗 *URL:* ${issue.url}\n\n` +
              `💡 _Ketik \`/issue ${issue.url}\` atau balas pesan ini untuk meminta AI menganalisis & memperbaikinya._`;

            await notifyUsers(bot, notifMsg, specificChatId);
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

  // Cek apakah fitur diaktifkan di .env
  if (process.env.GITHUB_WATCHER_ENABLED === "false") {
    console.log("[GitHub Watcher] Fitur GitHub Watcher dinonaktifkan via GITHUB_WATCHER_ENABLED=false.");
    return;
  }

  const ghReady = await isGhAvailable();
  if (!ghReady) {
    console.log("[GitHub Watcher] GitHub CLI (gh) belum terpasang. Watcher otomatis tidak diaktifkan.");
    return;
  }

  const config = await loadWatchConfig();
  const intervalMs = Math.max(1, config.pollIntervalMinutes || 5) * 60 * 1000;

  console.log(
    `[GitHub Watcher] Aktif memantau ${config.watchedRepos.length} repositori setiap ${config.pollIntervalMinutes} menit.`
  );

  // Jalankan pengecekan perdana 10 detik setelah bot startup
  setTimeout(() => {
    checkAllWatchedRepos(bot, null, false).catch((err) => {
      console.warn("[GitHub Watcher] Error initial check:", err.message);
    });
  }, 10000);

  // Loop berkala
  watcherInterval = setInterval(() => {
    checkAllWatchedRepos(bot, null, false).catch((err) => {
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
