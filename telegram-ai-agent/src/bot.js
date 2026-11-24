import "dotenv/config";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { Bot } from "grammy";
import { BOT_TOKEN, ALLOWED_IDS, DATA_DIR, ensureDirectories } from "./config/env.js";
import { startWebServer } from "./web-server.js";
import { sendToAgent } from "./bot/dispatcher.js";
import { registerMiddleware } from "./bot/middleware.js";
import { registerBasicCommands } from "./bot/handlers/commands.js";
import { registerModelHandlers } from "./bot/handlers/model.js";
import { registerMessageHandlers } from "./bot/handlers/messages.js";
import { initGithubWatcher } from "./services/github-watcher.js";
import { initNotionWatcher } from "./services/notion-watcher.js";
import { initDailyCleanup } from "./services/cleanup-service.js";
import { initServerSentry } from "./services/sentry-service.js";
import {
  getActiveTasks,
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
// Gunakan flag '-ims' agar layar Mac boleh padam setelah 5 menit (hemat baterai), tetapi sistem & Wi-Fi tetap berjalan 24/7!
if (process.platform === "darwin") {
  try {
    const caffeinate = spawn("caffeinate", ["-ims", "-w", String(process.pid)], {
      detached: true,
      stdio: "ignore",
    });
    caffeinate.unref();
    console.log("☕ [macOS PowerManagement] Caffeinate aktif (-ims): Layar boleh padam (hemat baterai), sistem & Wi-Fi tetap jalan 24/7.");
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

// Lacak waktu aktivitas polling & interaksi Telegram secara realtime
let lastPollingActivity = Date.now();

// Intercept semua API request ke Telegram:
// Setiap respon getUpdates yang sukses (meskipun [] kosong saat idle)
// menandakan koneksi polling fisik ke server Telegram masih sehat & aktif!
bot.api.config.use(async (prev, method, payload, signal) => {
  try {
    const res = await prev(method, payload, signal);
    if (method === "getUpdates") {
      lastPollingActivity = Date.now();
    } else if (["sendMessage", "editMessageText", "sendChatAction", "sendPhoto", "sendDocument"].includes(method)) {
      const result = res?.result;
      console.log(
        `[Telegram API OK] method=${method} chat=${payload?.chat_id ?? "-"} message_id=${result?.message_id ?? "-"}`
      );
    }
    return res;
  } catch (err) {
    if (method === "getUpdates" && (err?.error_code || err?.response?.ok !== undefined)) {
      // Telegram server memberikan respon (misal error HTTP / rate limit), socket fisik masih aktif
      lastPollingActivity = Date.now();
    }
    if (method !== "getUpdates") {
      console.error(
        `[Telegram API Error] method=${method}: ${err?.stack || err?.message || String(err)}`
      );
    }
    throw err;
  }
});

bot.use(async (ctx, next) => {
  lastPollingActivity = Date.now();
  if (ctx.callbackQuery) {
    const origAnswer = ctx.answerCallbackQuery.bind(ctx);
    ctx.answerCallbackQuery = async (...args) => {
      try {
        return await origAnswer(...args);
      } catch (err) {
        const msg = err?.message || String(err);
        // Abaikan jika query kedaluwarsa atau Telegram server sudah menutup callback
        if (!msg.includes("query is too old") && !msg.includes("MESSAGE_ID_INVALID")) {
          console.warn("[CallbackQuery] Warning:", msg);
        }
        return false;
      }
    };
  }
  await next();
});

// 1. Registrasi Middleware (Otorisasi & Logging)
registerMiddleware(bot);

// 2. Registrasi Command Handlers
registerBasicCommands(bot);
registerModelHandlers(bot);

// 3. Registrasi Message Handlers (File, Foto, Teks)
registerMessageHandlers(bot);

// Global Error Handler
bot.catch((error) => {
  const inner = error.error || error;
  const msg = inner.message || String(inner);

  // Filter error umum/transient Telegram API agar tidak memenuhi error.log
  if (
    msg.includes("query is too old") ||
    msg.includes("message is not modified") ||
    msg.includes("bot was blocked by the user") ||
    msg.includes("user is deactivated") ||
    msg.includes("message to edit not found")
  ) {
    console.warn(`[Telegram API Notice] ${msg}`);
    return;
  }

  console.error("Telegram bot error:", msg);
  if (error.stack) {
    console.error(error.stack);
  }
});

// Satu bot hanya boleh polling dengan satu token. Dua instance yang polling
// bersamaan memicu 409 Conflict, koneksi putus-nyambung, dan pesan tertunda.
const BOT_LOCK_FILE = path.join(DATA_DIR, "bot.lock");

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireBotLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(BOT_LOCK_FILE, "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return { ok: true };
    } catch (err) {
      if (err.code !== "EEXIST") {
        console.warn(`[Bot Gateway] Gagal membuat lock file (${err.message}); lanjut tanpa lock.`);
        return { ok: true };
      }

      let pid = 0;
      try {
        pid = Number(fs.readFileSync(BOT_LOCK_FILE, "utf8").trim());
      } catch {}

      if (pid && pid !== process.pid && isProcessAlive(pid)) {
        return { ok: false, pid };
      }

      // Lock basi dari proses yang sudah mati: hapus lalu coba lagi.
      try {
        fs.unlinkSync(BOT_LOCK_FILE);
      } catch {}
    }
  }
  return { ok: true };
}

function releaseBotLock() {
  try {
    const pid = Number(fs.readFileSync(BOT_LOCK_FILE, "utf8").trim());
    if (!pid || pid === process.pid) fs.unlinkSync(BOT_LOCK_FILE);
  } catch {}
}

// Jalankan Bot Telegram jika token sudah tersedia
if (
  process.env.NODE_ENV !== "test" &&
  BOT_TOKEN &&
  BOT_TOKEN !== "PLACEHOLDER_TOKEN_FOR_CHECK"
) {
  const lock = acquireBotLock();
  if (!lock.ok) {
    console.error(
      `[Bot Gateway] Instance lain (PID ${lock.pid}) sudah memakai token bot ini. ` +
        "Hentikan instance tersebut dulu; proses ini keluar agar tidak terjadi 409 Conflict."
    );
    process.exit(1);
  }
  process.on("exit", releaseBotLock);

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
        { command: "key", description: "Lihat & atur key auto-switch proyek" },
        { command: "workspace", description: "Status / kunci workspace proyek manual (opsional)" },
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
        { command: "mode", description: "Atur mode otonomi agent (orkestrator/seimbang/ketat)" },
        { command: "usage", description: "Cek statistik & jumlah token AI yang terpakai" },
        { command: "model", description: "Pilih model AI" },
        { command: "engine", description: "Pilih engine (Pi CLI / Command Code)" },
        { command: "compact", description: "Padatkan riwayat sesi agar token hemat" },
        { command: "update", description: "Perbarui TH Agent langsung dari GitHub" },
        { command: "cekupdate", description: "Cek pembaruan baru di GitHub" },
        { command: "reset", description: "Mulai sesi percakapan baru" },
        { command: "cancel", description: "Hentikan tugas aktif atau antrean" },
      ])
      .catch((err) => {
        console.warn("Gagal mendaftarkan menu commands ke Telegram:", err.message, "cause:", err.cause?.message || err.cause || "-");
      });
  };

  syncCommands();

  let isWatcherStarted = false;
  let shouldRun = true;
  let isPollingActive = false;
  let intentionalStop = false;
  let pollingResetInProgress = false;

  // Hentikan polling tanpa memanggil bot.stop() setelah pollingRunning dipaksa false.
  // bot.stop() melakukan getUpdates konfirmasi tanpa AbortSignal; jika socket lama
  // menggantung, pemanggilan itu dapat tumpang tindih dengan polling baru.
  const stopPollingSafely = async () => {
    if (pollingResetInProgress) return;
    pollingResetInProgress = true;
    try {
      bot.pollingAbortController?.abort();
      bot.pollingRunning = false;
    } finally {
      pollingResetInProgress = false;
    }
  };

  // Auto-Recovery Polling Loop (kebal sleep/wake, network drop, dan reboot)
  const startBotLoop = async () => {
    let retryAttempt = 0;

    while (shouldRun) {
      let reconnectImmediately = false;

      try {
        // Bersihkan state polling lama jika ada. Abort harus selesai sebelum
        // start berikutnya agar tidak ada dua loop getUpdates dalam satu proses.
        if (bot.pollingRunning || bot.pollingAbortController) {
          await stopPollingSafely();
          await new Promise((resolve) => setTimeout(resolve, 50));
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

        // start() hanya selesai saat polling memang dihentikan; sambung lagi cepat.
        console.log("[Bot Gateway] Polling connection ditutup, menyambung ulang...");
        reconnectImmediately = true;
      } catch (err) {
        const message = String(err?.message || err);
        const aborted = intentionalStop || /aborted/i.test(message);

        if (aborted) {
          // Reset yang disengaja (watchdog/stop) bukan kegagalan; jangan pakai backoff.
          console.log("[Bot Gateway] Polling direset sengaja, menyambung ulang...");
          reconnectImmediately = true;
        } else {
          console.error(`❌ Kendala polling bot Telegram: ${message}`, "cause:", err.cause?.message || err.cause || "-");

          if (err.error_code === 409 || err.description?.includes("Conflict") || String(err).includes("409")) {
            console.warn("\n⚠️  [409 CONFLICT DETECTED]");
            console.warn("   Token bot ini sedang aktif dijalankan di tempat lain atau socket sebelumnya sedang ditutup oleh Telegram.");
            console.warn("   Menunggu 15 detik sebelum mencoba reconnect kembali...\n");
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }
        }
      } finally {
        isPollingActive = false;
        intentionalStop = false;
      }

      if (!shouldRun) break;

      if (reconnectImmediately) {
        retryAttempt = 0;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

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

      // Cek status semua tugas aktif (jangan langsung kill jika proses masih berjalan sehat)
      const activeTasks = getActiveTasks();
      const taskStates = activeTasks.map((task) => {
        let stillRunning = false;
        if (task.process && task.process.pid && !task.process.killed) {
          try {
            process.kill(task.process.pid, 0);
            stillRunning = true;
          } catch (_) {
            stillRunning = false;
          }
        }

        // Jika proses child masih hidup dan interupsi wajar (< 10 menit), biarkan lanjut sampai tuntas!
        if (stillRunning && sleepSeconds < 600) {
          console.log(`⚡ [PowerManagement] Tugas #${task.id} masih aktif di background. Melanjutkan eksekusi...`);
          return { task, stillRunning };
        }

        console.log(`[PowerManagement] Menghentikan tugas #${task.id} yang terinterupsi (${sleepSeconds}s)...`);
        task.cancelled = true;
        if (task.process) {
          killProcessTree(task.process, "SIGKILL");
        }
        clearActiveTask(task.id);
        return { task, stillRunning: false };
      });

      if (taskStates.length > 0) {
        processNextQueue().catch(() => {});
      }

      // Abort socket lama yang menggantung saat sleep
      intentionalStop = true;
      await stopPollingSafely();

      // Tunggu Wi-Fi aktif kembali
      console.log(`📶 [PowerManagement] Menunggu sinyal Wi-Fi aktif kembali...`);
      const isOnline = await waitForInternet(15000);
      if (isOnline) {
        lastPollingActivity = Date.now();
        console.log(`✅ [PowerManagement] Wi-Fi & Internet aktif! TH Agent langsung terhubung kembali.`);
        for (const { task, stillRunning } of taskStates) {
          if (!task.chatId) continue;
          bot.api.sendMessage(
            task.chatId,
            stillRunning
              ? `⚡ *Mac aktif kembali!*\nTugas #${task.id} tetap berjalan di background dan akan segera dilaporkan setelah selesai.`
              : `⚡ *Mac baru saja dibuka!*\nKoneksi TH Agent otomatis aktif kembali & siap menerima perintah baru.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }
      return;
    }

    // 2. Deteksi Stale Socket / Dead Connection Tanpa Polling Response (> 75 detik)
    // Long-polling normal dari Telegram merespon setiap 30 detik (atau array [] kosong jika idle).
    // Jika lebih dari 75 detik tidak ada sinyal apapun dari Telegram padahal internet aktif,
    // maka TCP socket kemungkinan besar mengalami TCP half-open dead lock.
    if (isPollingActive && (now - lastPollingActivity > 75000)) {
      console.warn(`[Watchdog] Tidak ada respon polling dari Telegram selama ${Math.round((now - lastPollingActivity) / 1000)}s.`);
      
      const hasNet = await waitForInternet(4000).catch(() => false);
      if (hasNet) {
        console.warn("⚠️ [Watchdog] Internet aktif tetapi socket Telegram menggantung (dead socket). Mereset socket polling secara aman...");
        lastPollingActivity = Date.now(); // reset timer agar tidak spam abort
        intentionalStop = true;
        await stopPollingSafely();
      } else {
        console.warn("📶 [Watchdog] Menunggu koneksi internet pulih kembali...");
      }
    }
  }, 5000);

  // Graceful shutdown (dengan batas waktu agar tidak menggantung selamanya)
  const handleExit = async () => {
    shouldRun = false;
    clearInterval(watchdogInterval);
    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();
    try {
      await bot.stop().catch(() => {});
    } catch (_) {}
    releaseBotLock();
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

export { bot, sendToAgent };
