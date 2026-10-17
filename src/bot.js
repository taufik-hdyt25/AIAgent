import "dotenv/config";
import { Bot } from "grammy";
import { BOT_TOKEN, ALLOWED_IDS, ensureDirectories } from "./config/env.js";
import { startWebServer } from "./web-server.js";
import { sendToAgent } from "./bot/dispatcher.js";
import { registerMiddleware } from "./bot/middleware.js";
import { registerBasicCommands } from "./bot/handlers/commands.js";
import { registerEngineHandlers } from "./bot/handlers/engine.js";
import { registerModelHandlers } from "./bot/handlers/model.js";
import { registerMessageHandlers } from "./bot/handlers/messages.js";

// Pastikan semua direktori kerja lokal siap
await ensureDirectories();

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
  
  bot.api
    .setMyCommands([
      { command: "start", description: "Sambutan & info bot" },
      { command: "help", description: "Panduan lengkap perintah" },
      { command: "files", description: "Daftar file & gambar yang diunggah" },
      { command: "exec", description: "Eksekusi perintah terminal langsung di server" },
      { command: "status", description: "Cek status tugas, engine & model aktif" },
      { command: "model", description: "Pilih model AI (Gemini, Claude, DeepSeek, GPT)" },
      { command: "engine", description: "Pilih engine (Antigravity / Claude / Universal)" },
      { command: "reset", description: "Mulai sesi percakapan baru" },
      { command: "cancel", description: "Hentikan tugas yang sedang berjalan" },
    ])
    .catch((err) => {
      console.warn("Gagal mendaftarkan menu commands ke Telegram:", err.message);
    });

  bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      console.log(`🤖 Bot @${botInfo.username} berhasil terhubung dan siap menerima pesan di Telegram!`);
    },
  }).catch((err) => {
    console.error("❌ Gagal memulai bot Telegram:", err.message);
    if (err.error_code === 409 || err.description?.includes("Conflict") || String(err).includes("409")) {
      console.warn("\n⚠️  [409 CONFLICT DETECTED]");
      console.warn("   Token bot ini sedang aktif dijalankan di server/tempat lain (misal: di VPS atau terminal lain).");
      console.warn("   Telegram melarang 2 aplikasi berjalan bersamaan menggunakan 1 token bot yang sama.");
      console.warn("   👉 Solusi: Hentikan instance bot di server lain, atau gunakan token bot baru dari @BotFather.");
      const webPort = process.env.WEB_PORT || 3030;
      console.warn(`   🌐 Web UI tetap aktif di http://localhost:${webPort} untuk mengubah konfigurasi token Anda.\n`);
    }
  });
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
