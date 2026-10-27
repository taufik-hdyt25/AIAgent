import "dotenv/config";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import { Bot } from "grammy";
import { BOT_TOKEN, ALLOWED_IDS, ensureDirectories } from "./config/env.js";
import { startWebServer } from "./web-server.js";
import { sendToAgent } from "./bot/dispatcher.js";
import { registerMiddleware } from "./bot/middleware.js";
import { registerBasicCommands } from "./bot/handlers/commands.js";
import { registerEngineHandlers } from "./bot/handlers/engine.js";
import { registerModelHandlers } from "./bot/handlers/model.js";
import { registerMessageHandlers } from "./bot/handlers/messages.js";
import { initGithubWatcher } from "./services/github-watcher.js";
import { initNotionWatcher } from "./services/notion-watcher.js";
import { initDailyCleanup } from "./services/cleanup-service.js";
import { initServerSentry } from "./services/sentry-service.js";
import {
  getActiveTask,
  clearActiveTask,
  killProcessTree,
} from "./services/cli-runner.js";
import { processNextQueue } from "./services/queue-service.js";
import { loadMemories } from "./services/memory-service.js";
import { initSkillStore } from "./services/skill-service.js";
import { checkPendingUpdateNotification } from "./services/update-service.js";
import { initAutoUpdateWatcher } from "./services/auto-update-watcher.js";

// Mencegah process crash akibat unhandled promise rejection atau socket error saat sleep/wake pada Mac/Laptop
process.on("unhandledRejection", (reason) => {
  console.warn("⚠️ [Process Warning] Unhandled Rejection diabaikan:", reason?.message || reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ [Process Error] Uncaught Exception diamankan:", error?.message || error);
});

// Otomatis aktifkan caffeinate jika berjalan di macOS lokal:
// Gunakan flag '-ims' (tanpa '-d') agar layar/display Mac BOLEH mati/sleep, tetapi sistem & Wi-Fi tetap berjalan!
if (process.platform === "darwin") {
  try {
    const caffeinate = spawn("caffeinate", ["-ims", "-w", String(process.pid)], {
      detached: true,
      stdio: "ignore",
    });
    caffeinate.unref();
    console.log("☕ [macOS PowerManagement] Caffeinate aktif (-ims): Layar boleh mati, sistem & Wi-Fi tetap jalan.");
  } catch (err) {
    console.warn("⚠️ [macOS PowerManagement] Gagal mengaktifkan caffeinate:", err.message);
  }
}

/**
 * Menunggu hingga koneksi internet (DNS Telegram) siap kembali setelah Mac bangun dari sleep
 */
async function waitForInternet(maxWaitMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await dns.lookup("api.telegram.org");
      return true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return false;
}

// Pastikan semua direktori kerja lokal siap & load persistent vector memory & dynamic skills
await ensureDirectories();
await Promise.all([loadMemories(), initSkillStore()]).catch((err) =>
  console.warn("[Init] Gagal inisialisasi memori/skills:", err.message)
);

if (!BOT_TOKEN || ALLOWED_IDS.size === 0) {
  console.warn(
    "[PERINGATAN] BOT_TOKEN atau ALLOWED_TELEGRAM_IDS belum diisi di .env."
  );
}

// Inisialisasi bot grammY dengan client timeout (45s) agar kebal stale socket / network freeze
const bot = new Bot(BOT_TOKEN || "PLACEHOLDER_TOKEN_FOR_CHECK", {
  client: {
    timeoutSeconds: 45, // Hard timeout untuk setiap pemanggilan API Telegram
  },
});

// Lacak waktu aktivitas polling terakhir untuk auto-heal
let lastPollingActivity = Date.now();
bot.use(async (ctx, next) => {
  lastPollingActivity = Date.now();
  await next();
});

// 1. Registrasi Middleware (Otorisasi & Logging)
registerMiddleware(bot);

// 2. Registrasi Command Handlers
registerBasicCommands(bot);
registerEngineHandlers(bot);
registerModelHandlers(bot);

// 3. Registrasi Message Handlers (File, Foto, Teks)
registerMessageHandlers(bot);

// Global Error Handler
bot.catch((error) => {
  console.error("Telegram bot error:", error.message || error);
  if (error.stack) {
    console.error(error.stack);
  }
});

// Jalankan Bot Telegram jika token sudah tersedia
if (
  process.env.NODE_ENV !== "test" &&
  BOT_TOKEN &&
  BOT_TOKEN !== "PLACEHOLDER_TOKEN_FOR_CHECK"
) {
  console.log("Memulai Telegram Coding Agent (TH Agent Gateway)...");

  const syncCommands = () => {
    bot.api
      .setMyCommands([
        { command: "menu", description: "Quick-Action Dashboard interaktif" },
        { command: "settings", description: "Panel pengaturan Agent interaktif" },
        { command: "start", description: "Sambutan & info bot" },
        { command: "help", description: "Panduan lengkap perintah" },
        { command: "sentry", description: "Kesehatan container & auto-healing" },
        { command: "setwhisper", description: "Atur API Whisper untuk Voice Note" },
        { command: "projects", description: "Daftar proyek coding di ./projects" },
        { command: "notion", description: "Cek & kelola auto-sync task Notion" },
        { command: "syncprojects", description: "Sinkronisasi peta arsitektur semua project" },
        { command: "swarm", description: "Eksekusi multi-tugas dengan Sub-Agent Swarm" },
        { command: "memories", description: "Daftar memori jangka panjang AI" },
        { command: "remember", description: "Simpan fakta/aturan baru ke memori AI" },
        { command: "skills", description: "Daftar skill & SOP AI" },
        { command: "learn", description: "Ajarkan skill baru ke AI" },
        { command: "clean", description: "Bersihkan cache & file server tidak terpakai" },
        { command: "deploy", description: "Deploy aplikasi ke server" },
        { command: "autofix", description: "Auto-Fix issue & buat Draft PR" },
        { command: "issue", description: "Analisis GitHub Issue secara mendalam" },
        { command: "checkissues", description: "Cek issue GitHub baru sekarang" },
        { command: "watched", description: "Status pantauan repo & otomasi" },
        { command: "watcher", description: "Nyalakan/matikan GitHub Watcher" },
        { command: "files", description: "Daftar file & gambar yang diunggah" },
        { command: "exec", description: "Eksekusi perintah terminal di server" },
        { command: "queue", description: "Cek antrean instruksi AI" },
        { command: "clearqueue", description: "Kosongkan seluruh antrean tugas" },
        { command: "status", description: "Cek status tugas, antrean, engine & model aktif" },
        { command: "model", description: "Pilih model AI (Gemini, Claude, DeepSeek, GPT)" },
        { command: "compact", description: "Padatkan riwayat sesi agar token hemat" },
        { command: "update", description: "Perbarui TH Agent langsung dari GitHub" },
        { command: "cekupdate", description: "Cek pembaruan baru di GitHub" },
        { command: "engine", description: "Pilih engine (Antigravity / Claude / Universal)" },
        { command: "reset", description: "Mulai sesi percakapan baru" },
        { command: "cancel", description: "Hentikan tugas aktif atau antrean" },
      ])
      .catch((err) => {
        console.warn("Gagal mendaftarkan menu commands ke Telegram:", err.message);
      });
  };

  syncCommands();

  let isWatcherStarted = false;
  let shouldRun = true;
  let isPollingActive = false;

  // Auto-Recovery Polling Loop (kebal sleep/wake, network drop, dan reboot)
  const startBotLoop = async () => {
    let retryAttempt = 0;

    while (shouldRun) {
      try {
        // Bersihkan state polling lama jika ada
        if (bot.pollingRunning) {
          try {
            bot.pollingAbortController?.abort();
          } catch (_) {}
          bot.pollingRunning = false;
          bot.pollingAbortController = undefined;
        }

        isPollingActive = true;
        lastPollingActivity = Date.now();

        await bot.start({
          drop_pending_updates: false, // Pertahankan pesan yang masuk saat offline
          allowed_updates: ["message", "edited_message", "callback_query"],
          getUpdates: {
            timeout: 30, // 30 detik long-polling di server Telegram
          },
          onStart: (botInfo) => {
            retryAttempt = 0;
            lastPollingActivity = Date.now();
            console.log(`🤖 Bot @${botInfo.username} berhasil terhubung dan siap menerima pesan di Telegram!`);
            syncCommands();

            // Notifikasi jika bot baru saja di-update via /update
            checkPendingUpdateNotification(bot);

            if (!isWatcherStarted) {
              isWatcherStarted = true;
              initGithubWatcher(bot).catch((err) => {
                console.warn("Gagal memulai GitHub Issue Watcher:", err.message);
              });
              initNotionWatcher(bot);
              initDailyCleanup(bot);
              initServerSentry(bot);
              initAutoUpdateWatcher(bot);
            }
          },
        });

        console.log("[Bot Gateway] Polling connection ditutup atau dihentikan.");
      } catch (err) {
        console.error(`❌ Kendala polling bot Telegram: ${err.message}`);

        if (err.error_code === 409 || err.description?.includes("Conflict") || String(err).includes("409")) {
          console.warn("\n⚠️  [409 CONFLICT DETECTED]");
          console.warn("   Token bot ini sedang aktif dijalankan di tempat lain atau socket sebelumnya sedang ditutup oleh Telegram.");
          console.warn("   Menunggu 15 detik sebelum mencoba reconnect kembali...\n");
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
      } finally {
        isPollingActive = false;
      }

      if (!shouldRun) break;

      retryAttempt++;
      // Pastikan koneksi internet (DNS Telegram) sudah siap sebelum mencoba start polling ulang
      await waitForInternet(15000).catch(() => {});

      const delayMs = Math.min(20000, 2000 * Math.min(retryAttempt, 5));
      console.log(`[Bot Gateway] Menghubungkan ulang ke Telegram dalam ${Math.round(delayMs / 1000)} detik (percobaan #${retryAttempt})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  };

  startBotLoop().catch((err) => console.error("[Bot Gateway] Loop error fatal:", err));

  // Watchdog Koneksi & Anti-Hang (Interval 5 detik)
  let lastHeartbeatTime = Date.now();

  const watchdogInterval = setInterval(async () => {
    const now = Date.now();
    const elapsed = now - lastHeartbeatTime;
    lastHeartbeatTime = now;

    // 1. Khusus macOS: Deteksi Sleep / Wake-up nyata (jika gap waktu > 15 detik)
    if (process.platform === "darwin" && elapsed > 15000) {
      const sleepSeconds = Math.round(elapsed / 1000);
      console.log(`\n💤 [PowerManagement] Terdeteksi Mac baru saja dibuka dari Sleep mode (${sleepSeconds} detik).`);
      console.log(`⚡ [PowerManagement] Memulihkan koneksi bot secara kilat...`);

      // Cek status tugas aktif (jangan langsung kill jika proses masih berjalan sehat)
      const activeTask = getActiveTask();
      let taskStillRunning = false;

      if (activeTask) {
        if (activeTask.process && activeTask.process.pid && !activeTask.process.killed) {
          try {
            process.kill(activeTask.process.pid, 0);
            taskStillRunning = true;
          } catch (_) {
            taskStillRunning = false;
          }
        }

        // Jika proses child masih hidup dan interupsi wajar (< 10 menit), biarkan lanjut sampai tuntas!
        if (taskStillRunning && sleepSeconds < 600) {
          console.log(`⚡ [PowerManagement] Tugas #${activeTask.id} masih aktif di background. Melanjutkan eksekusi...`);
        } else {
          console.log(`[PowerManagement] Menghentikan tugas #${activeTask.id} yang terinterupsi (${sleepSeconds}s)...`);
          activeTask.cancelled = true;
          if (activeTask.process) {
            killProcessTree(activeTask.process, "SIGKILL");
          }
          clearActiveTask(activeTask.id);
          processNextQueue().catch(() => {});
        }
      }

      // Abort socket lama yang menggantung saat sleep
      try {
        bot.pollingAbortController?.abort();
      } catch (_) {}

      // Tunggu Wi-Fi aktif kembali
      console.log(`📶 [PowerManagement] Menunggu sinyal Wi-Fi aktif kembali...`);
      const isOnline = await waitForInternet(15000);
      if (isOnline) {
        lastPollingActivity = Date.now();
        console.log(`✅ [PowerManagement] Wi-Fi & Internet aktif! TH Agent langsung terhubung kembali.`);
        if (activeTask?.chatId) {
          if (taskStillRunning) {
            bot.api.sendMessage(
              activeTask.chatId,
              `⚡ *Mac aktif kembali!*\nTugas #${activeTask.id} tetap berjalan di background dan akan segera dilaporkan setelah selesai.`,
              { parse_mode: "Markdown" }
            ).catch(() => {});
          } else {
            bot.api.sendMessage(
              activeTask.chatId,
              `⚡ *Mac baru saja dibuka!*\nKoneksi TH Agent otomatis aktif kembali & siap menerima perintah baru.`,
              { parse_mode: "Markdown" }
            ).catch(() => {});
          }
        }
      }
      return;
    }

    // 2. Deteksi Stale Socket / Dead Connection Tanpa Polling Response (> 75 detik)
    // Long-polling normal dari Telegram merespon setiap 30 detik.
    // Jika lebih dari 75 detik tidak ada sinyal apapun dari Telegram padahal internet aktif,
    // maka TCP socket kemungkinan besar mengalami TCP half-open dead lock.
    if (isPollingActive && (now - lastPollingActivity > 75000)) {
      console.warn(`[Watchdog] Tidak ada respon polling dari Telegram selama ${Math.round((now - lastPollingActivity) / 1000)}s.`);
      
      const hasNet = await waitForInternet(4000).catch(() => false);
      if (hasNet) {
        console.warn("⚠️ [Watchdog] Internet aktif tetapi socket Telegram menggantung (dead socket). Mereset socket polling secara aman...");
        lastPollingActivity = Date.now(); // reset timer agar tidak spam abort
        try {
          bot.pollingAbortController?.abort();
        } catch (_) {}
      } else {
        console.warn("📶 [Watchdog] Menunggu koneksi internet pulih kembali...");
      }
    }
  }, 5000);

  // Graceful shutdown
  const handleExit = async () => {
    shouldRun = false;
    clearInterval(watchdogInterval);
    try {
      await bot.stop().catch(() => {});
    } catch (_) {}
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
} else {
  const webPort = process.env.WEB_PORT || 3030;
  console.log("\nℹ️  BOT_TOKEN belum diisi atau masih kosong.");
  console.log(`👉 Silakan buka Web UI di http://localhost:${webPort} untuk memasukkan token bot & ID Telegram Anda.\n`);
}

// Jalankan Web Server
if (process.env.NODE_ENV !== "test" && process.env.ENABLE_WEB_UI !== "false") {
  startWebServer(process.env.WEB_PORT || 3030);
}

// Alias backward compatibility untuk tests atau file lain
export const sendToAntigravity = sendToAgent;
export { bot, sendToAgent };
