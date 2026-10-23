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

// Inisialisasi bot grammY
const bot = new Bot(BOT_TOKEN || "PLACEHOLDER_TOKEN_FOR_CHECK");

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
  console.error("Telegram bot error:", error.message);
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
        isPollingActive = true;
        await bot.start({
          drop_pending_updates: false, // Pertahankan pesan yang masuk saat laptop sleep/offline
          onStart: (botInfo) => {
            retryAttempt = 0;
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
          console.warn("   Token bot ini sedang aktif dijalankan di tempat lain (misal: di VPS atau terminal lain).");
          console.warn("   Menunggu 30 detik sebelum mencoba reconnect kembali...\n");
          await new Promise((r) => setTimeout(r, 30000));
          continue;
        }
      } finally {
        isPollingActive = false;
      }

      if (!shouldRun) break;

      retryAttempt++;
      // Pastikan koneksi internet (DNS Telegram) sudah siap sebelum mencoba start polling ulang
      await waitForInternet(10000).catch(() => {});

      const delayMs = Math.min(25000, 2000 * Math.min(retryAttempt, 5));
      console.log(`[Bot Gateway] Menghubungkan ulang ke Telegram dalam ${Math.round(delayMs / 1000)} detik (percobaan #${retryAttempt})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  };

  startBotLoop().catch((err) => console.error("[Bot Gateway] Loop error fatal:", err));

  // Deteksi Sleep / Wake-up Mac Kilat & Heartbeat Watchdog (Interval 2 detik)
  let lastHeartbeatTime = Date.now();
  let consecutivePingFails = 0;
  let pingTickCounter = 0;

  const watchdogInterval = setInterval(async () => {
    const now = Date.now();
    const elapsed = now - lastHeartbeatTime;
    lastHeartbeatTime = now;

    // Jika selisih waktu > 5 detik (interval normal 2s), berarti Mac baru saja dibuka dari mode Sleep!
    if (elapsed > 5000) {
      const sleepSeconds = Math.round(elapsed / 1000);
      console.log(`\n💤 [PowerManagement] Terdeteksi Mac baru saja dibuka dari Sleep mode (${sleepSeconds} detik).`);
      console.log(`⚡ [PowerManagement] Memulihkan koneksi bot secara kilat...`);

      // 1. Hentikan tugas CLI yang terputus di tengah jalan saat laptop ditutup
      const activeTask = getActiveTask();
      if (activeTask) {
        console.log(`[PowerManagement] Menghentikan tugas #${activeTask.id} yang terinterupsi saat lid Mac ditutup...`);
        activeTask.cancelled = true;
        if (activeTask.process) {
          killProcessTree(activeTask.process, "SIGKILL");
        }
        clearActiveTask(activeTask.id);
        processNextQueue().catch(() => {});
      }

      // 2. Putuskan koneksi polling lama yang menggantung (timeout cepat 1.5 detik)
      try {
        await Promise.race([
          bot.stop(),
          new Promise((r) => setTimeout(r, 1500)),
        ]).catch(() => {});
      } catch (_) {}

      // 3. Tunggu Wi-Fi aktif kembali (biasanya 1-3 detik setelah Mac dibuka)
      console.log(`📶 [PowerManagement] Menunggu sinyal Wi-Fi aktif kembali...`);
      const isOnline = await waitForInternet(12000);
      if (isOnline) {
        console.log(`✅ [PowerManagement] Wi-Fi & Internet aktif! TH Agent langsung terhubung kembali.`);
        if (activeTask?.chatId) {
          bot.api.sendMessage(
            activeTask.chatId,
            `⚡ *Mac baru saja dibuka!*\nKoneksi TH Agent otomatis aktif kembali & siap menerima perintah baru.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }
      return;
    }

    // Ping healthcheck setiap 5 tick (10 detik sekali)
    pingTickCounter = (pingTickCounter + 1) % 5;
    if (pingTickCounter !== 0) return;
    if (!isPollingActive) return;

    try {
      await Promise.race([
        bot.api.getMe(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Ping Timeout")), 6000)),
      ]);
      consecutivePingFails = 0;
    } catch (pingErr) {
      consecutivePingFails++;
      console.warn(`[Watchdog] Healthcheck Telegram gagal (${consecutivePingFails}/3): ${pingErr.message}`);
      if (consecutivePingFails >= 3) {
        console.warn("[Watchdog] Koneksi Telegram terputus (stale socket). Merefresh polling bot...");
        consecutivePingFails = 0;
        try {
          await Promise.race([
            bot.stop(),
            new Promise((r) => setTimeout(r, 2000)),
          ]).catch(() => {});
        } catch (_) {}
      }
    }
  }, 2000);

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
