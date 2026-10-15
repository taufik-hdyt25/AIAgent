import "dotenv/config";
import { Bot } from "grammy";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const BOT_TOKEN = process.env.BOT_TOKEN;
const AGY_BIN =
  process.env.AGY_BIN || path.join(os.homedir(), ".local/bin/agy");
const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 900000);
const MAX_OUTPUT = Number(process.env.MAX_TASK_OUTPUT || 12000);
const AUTO_APPROVE_PERMISSIONS =
  process.env.AGY_AUTO_APPROVE_PERMISSIONS !== "false"; // default true untuk interaksi otonom langsung
const ALLOWED_IDS = new Set(
  (process.env.ALLOWED_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

if (!BOT_TOKEN || ALLOWED_IDS.size === 0) {
  console.warn(
    "[PERINGATAN] BOT_TOKEN atau ALLOWED_TELEGRAM_IDS belum diisi di .env."
  );
}

const bot = new Bot(BOT_TOKEN || "PLACEHOLDER_TOKEN_FOR_CHECK");
const DATA_DIR = path.resolve("./data");
const LOG_DIR = path.resolve("./logs");
const PROJECTS_DIR = path.resolve("./projects");
const CONTEXT_FILE = path.join(DATA_DIR, "context.json");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(LOG_DIR, { recursive: true });
await mkdir(PROJECTS_DIR, { recursive: true });

let activeTask = null;

function authorized(ctx) {
  return ctx.from && ALLOWED_IDS.has(String(ctx.from.id));
}

async function loadContext() {
  try {
    const data = await readFile(CONTEXT_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveContext(context) {
  await writeFile(
    CONTEXT_FILE,
    JSON.stringify(context, null, 2) + "\n",
    { mode: 0o600 }
  );
}

async function getUserConversationId(userId) {
  if (!userId) return randomUUID();
  const context = await loadContext();
  if (!context.conversations) context.conversations = {};
  if (!context.conversations[String(userId)]) {
    context.conversations[String(userId)] = randomUUID();
    await saveContext(context);
  }
  return context.conversations[String(userId)];
}

async function resetUserConversation(userId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.conversations) context.conversations = {};
  context.conversations[String(userId)] = randomUUID();
  await saveContext(context);
}

function truncate(text, max = 3500) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...[output dipotong]";
}

function killProcessTree(childProcess, signal = "SIGTERM") {
  if (!childProcess || !childProcess.pid) return;
  try {
    process.kill(-childProcess.pid, signal);
  } catch (err) {
    try {
      childProcess.kill(signal);
    } catch (_) {}
  }
}

async function appendLog(taskId, content) {
  const file = path.join(LOG_DIR, `${taskId}.log`);
  await appendFile(file, content, { mode: 0o600 });
}

// Handler utama: Mengirim pesan langsung ke Antigravity AI
async function sendToAntigravity(userMessage, ctx) {
  if (activeTask) {
    await ctx.reply(
      `⏳ Antigravity sedang memproses instruksi sebelumnya (${activeTask.id}). Tunggu sebentar atau kirim /cancel untuk membatalkan.`
    );
    return;
  }

  const userId = ctx.from?.id;
  const convId = await getUserConversationId(userId);
  const taskId = randomUUID().slice(0, 8);

  activeTask = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
  };

  const task = activeTask;

  // Indikator "typing..." di Telegram
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);
  ctx.replyWithChatAction("typing").catch(() => {});

  try {
    const prompt = `
Kamu adalah Antigravity AI, asisten software engineer otonom yang berkomunikasi langsung dengan developer melalui chat Telegram ini.

LINGKUNGAN & SISTEM:
- Kamu berada di lingkungan server developer.
- Folder './projects' adalah tempat menyimpan repository/project coding yang dikelola.
- Kamu memiliki akses tools mandiri: menjalankan perintah terminal, git clone, membuat branch, membaca kode, mengedit file, dan memeriksa file.

PANDUAN INTERAKSI:
1. Respon Natural & Cerdas: Mengobrollah dengan ramah, santai, dan profesional dalam bahasa Indonesia layaknya rekan programmer senior.
2. Percakapan / Pertanyaan: Jika pengguna bertanya umum, berdiskusi teknis, atau menanyakan seputar sistem/project (contoh: "project disimpan di mana?", "arsitektur project ini bagaimana?", "jelaskan cara pakai Docker"), jawablah secara langsung, natural, dan akurat.
3. Eksekusi Perintah: Jika pengguna memberi instruksi kerja (contoh: "clone repo https://github.com/...", "buatkan fitur login di project blog", "perbaiki error di index.js"), jalankan aksi tersebut menggunakan tools yang kamu miliki, lalu laporkan hasilnya dengan ringkas dan jelas.
4. Keamanan: Jangan pernah membocorkan isi file .env, token bot, atau secret kredensial.
5. Format: Gunakan format Markdown yang rapi agar enak dibaca di Telegram.

Pesan dari pengguna:
${userMessage}
`.trim();

    const agyArgs = [
      "--conversation",
      convId,
      "-p",
      prompt,
      "--output-format",
      "text",
      "--print-timeout",
      "10m",
    ];

    if (AUTO_APPROVE_PERMISSIONS) {
      agyArgs.push("--dangerously-skip-permissions");
    }

    const sanitizedEnv = { ...process.env };
    delete sanitizedEnv.BOT_TOKEN;
    delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;
    delete sanitizedEnv.GEMINI_API_KEY;

    const child = spawn(AGY_BIN, agyArgs, {
      cwd: process.cwd(),
      shell: false,
      detached: true,
      env: sanitizedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    task.process = child;

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    let killTimer;

    const finish = async (error, code, signal) => {
      if (settled) return;
      settled = true;
      clearInterval(typingInterval);
      clearTimeout(timer);
      clearTimeout(killTimer);

      const result = {
        taskId,
        userId,
        cancelled: task.cancelled,
        exitCode: code,
        signal,
        error: error?.message || null,
        output: truncate(stdout.trim(), MAX_OUTPUT),
        stderr: truncate(stderr.trim(), 2500),
      };

      await appendLog(taskId, JSON.stringify(result, null, 2) + "\n");
      if (activeTask?.id === taskId) activeTask = null;

      if (task.cancelled) {
        await ctx.reply("⚠️ Proses dihentikan.");
        return;
      }

      if (error || (code !== 0 && !stdout.trim())) {
        const errText = stderr.trim() || error?.message || `Exit code ${code}`;
        await ctx.reply(
          `❌ Maaf, Antigravity mengalami kendala:\n${truncate(errText, 1000)}`
        );
        return;
      }

      const responseText = stdout.trim() || "Antigravity tidak mengembalikan pesan balasan.";

      try {
        await ctx.reply(truncate(responseText, 3800), {
          parse_mode: "Markdown",
        });
      } catch {
        // Fallback ke plain text jika parsing Markdown Telegram error
        await ctx.reply(truncate(responseText, 3800));
      }
    };

    timer = setTimeout(() => {
      task.cancelled = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        if (activeTask?.id === taskId) killProcessTree(child, "SIGKILL");
      }, 5000);
      killTimer.unref();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT * 2) {
        stdout = stdout.slice(-MAX_OUTPUT * 2);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });

    child.on("error", (error) => finish(error, null, null));
    child.on("close", (code, signal) => finish(null, code, signal));
  } catch (err) {
    clearInterval(typingInterval);
    if (activeTask?.id === taskId) activeTask = null;
    await ctx.reply(`❌ Terjadi error: ${err.message}`);
  }
}

// Middleware otorisasi
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.message?.text) {
    console.log(
      `[Pesan Masuk] Dari ID: ${ctx.from.id} (@${ctx.from.username || "tanpa_username"}): "${ctx.message.text}"`
    );
  }

  if (!authorized(ctx)) {
    if (ctx.from) {
      console.warn(
        `[Akses Ditolak] Pesan dari Telegram ID tidak terdaftar: ${ctx.from.id}`
      );
      try {
        await ctx.reply(
          `⛔ *Akses Ditolak*\n\nUser ID Telegram Anda: \`${ctx.from.id}\`\n\nID Anda belum terdaftar di \`ALLOWED_TELEGRAM_IDS\` pada file \`.env\`.`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Gagal mengirim pesan penolakan:", err.message);
      }
    }
    return;
  }
  await next();
});

// Perintah ringkas
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 *Halo! Saya Antigravity AI.*\n\n" +
      "Saya terhubung langsung dengan Anda di Telegram ini. Anda bisa langsung mengobrol, bertanya seputar coding, atau memberikan perintah kerja apa pun.\n\n" +
      "Contoh yang bisa Anda ketik:\n" +
      "• _\"project yang ada disimpan di mana?\"_\n" +
      "• _\"tolong clone repo https://github.com/user/repo ke folder myapp\"_\n" +
      "• _\"buatkan REST API login di project myapp\"_\n\n" +
      "Perintah bantuan:\n" +
      "• `/reset` atau `/new` - Mulai sesi obrolan baru dari awal\n" +
      "• `/status` - Cek apakah saya sedang memproses tugas\n" +
      "• `/cancel` - Hentikan tugas yang sedang berjalan",
    { parse_mode: "Markdown" }
  );
});

bot.command(["new", "reset"], async (ctx) => {
  await resetUserConversation(ctx.from?.id);
  await ctx.reply(
    "🔄 *Sesi percakapan baru dimulai!*\nKonteks percakapan sebelumnya telah di-reset. Ada yang ingin kita kerjakan hari ini?",
    { parse_mode: "Markdown" }
  );
});

bot.command("status", async (ctx) => {
  if (!activeTask) {
    await ctx.reply("🟢 Antigravity sedang idle (siap menerima instruksi).");
    return;
  }
  const elapsed = Math.floor((Date.now() - activeTask.startedAt) / 1000);
  await ctx.reply(
    `⏳ Antigravity sedang menjalankan tugas:\nID: \`${activeTask.id}\`\nDurasi: ${elapsed} detik.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("cancel", async (ctx) => {
  if (!activeTask?.process) {
    await ctx.reply("Tidak ada proses Antigravity yang sedang aktif.");
    return;
  }
  activeTask.cancelled = true;
  killProcessTree(activeTask.process, "SIGTERM");
  await ctx.reply("🛑 Permintaan pembatalan telah dikirim.");
});

// Setiap chat yang masuk langsung diteruskan 100% ke Antigravity AI!
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  if (text.length > 5000) {
    await ctx.reply("Pesan terlalu panjang (maksimal 5000 karakter).");
    return;
  }

  await sendToAntigravity(text, ctx);
});

bot.catch((error) => {
  console.error("Telegram bot error:", error.message);
});

if (
  process.env.NODE_ENV !== "test" &&
  BOT_TOKEN &&
  BOT_TOKEN !== "PLACEHOLDER_TOKEN_FOR_CHECK"
) {
  console.log("Memulai Telegram Coding Agent (Antigravity Direct Gateway)...");
  bot.start();
} else {
  console.log("Bot diinisialisasi dalam mode pengecekan / offline.");
}

export { bot, sendToAntigravity };
