import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { startWebServer } from "./web-server.js";
import { runUniversalAgent, resetSessionHistory } from "./universal-agent.js";

const AVAILABLE_AGY_MODELS = [
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium Thinking)" },
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High Thinking)" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low Thinking)" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
];

const AVAILABLE_CLAUDE_MODELS = [
  { id: "sonnet", name: "Claude Sonnet (Cepat & Pintar - Default)" },
  { id: "opus", name: "Claude Opus (Analisis Kompleks & Mendalam)" },
  { id: "haiku", name: "Claude Haiku (Ultra Cepat & Ringan)" },
];

const AVAILABLE_UNIVERSAL_MODELS = [
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (Sangat Cerdas & Hemat - Rekomendasi)" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (Penalaran Ekstrem / Thinking)" },
  { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Hybrid Reasoning)" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Cepat & Ringkas)" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (Super Cepat)" },
  { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B (Spesialis Koding)" },
];

const AVAILABLE_MODELS = AVAILABLE_AGY_MODELS;
const DEFAULT_AGY_MODEL = process.env.AGY_MODEL || "gemini-3.8-flash-medium";
const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const DEFAULT_UNIVERSAL_MODEL = process.env.UNIVERSAL_MODEL || "deepseek/deepseek-chat";

const BOT_TOKEN = process.env.BOT_TOKEN;
const AGY_BIN =
  process.env.AGY_BIN || path.join(os.homedir(), ".local/bin/agy");
const CLAUDE_BIN =
  process.env.CLAUDE_BIN || path.join(os.homedir(), ".local/bin/claude");
const DEFAULT_ENGINE = process.env.CLI_ENGINE || "agy"; // 'agy' atau 'claude'

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
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || "./uploads");
const CONTEXT_FILE = path.join(DATA_DIR, "context.json");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(LOG_DIR, { recursive: true });
await mkdir(PROJECTS_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

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
  const oldConvId = context.conversations[String(userId)];
  const newConvId = randomUUID();
  context.conversations[String(userId)] = newConvId;
  if (context.claudeSessions && oldConvId) {
    delete context.claudeSessions[oldConvId];
  }
  if (oldConvId) resetSessionHistory(oldConvId);
  resetSessionHistory(newConvId);
  await saveContext(context);
}

async function isClaudeSessionStarted(convId) {
  if (!convId) return false;
  const context = await loadContext();
  return Boolean(context.claudeSessions?.[convId]);
}

async function markClaudeSessionStarted(convId, started = true) {
  if (!convId) return;
  const context = await loadContext();
  if (!context.claudeSessions) context.claudeSessions = {};
  if (started) {
    context.claudeSessions[convId] = true;
  } else {
    delete context.claudeSessions[convId];
  }
  await saveContext(context);
}

async function getUserAgyModel(userId) {
  if (!userId) return DEFAULT_AGY_MODEL;
  const context = await loadContext();
  return context.agyModels?.[String(userId)] || context.models?.[String(userId)] || DEFAULT_AGY_MODEL;
}

async function setUserAgyModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.agyModels) context.agyModels = {};
  context.agyModels[String(userId)] = modelId;
  if (!context.models) context.models = {};
  context.models[String(userId)] = modelId;
  await saveContext(context);
}

async function getUserClaudeModel(userId) {
  if (!userId) return DEFAULT_CLAUDE_MODEL;
  const context = await loadContext();
  return context.claudeModels?.[String(userId)] || DEFAULT_CLAUDE_MODEL;
}

async function setUserClaudeModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.claudeModels) context.claudeModels = {};
  context.claudeModels[String(userId)] = modelId;
  await saveContext(context);
}

async function getUserUniversalModel(userId) {
  if (!userId) return DEFAULT_UNIVERSAL_MODEL;
  const context = await loadContext();
  return context.universalModels?.[String(userId)] || DEFAULT_UNIVERSAL_MODEL;
}

async function setUserUniversalModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.universalModels) context.universalModels = {};
  context.universalModels[String(userId)] = modelId;
  await saveContext(context);
}

async function getUserModel(userId) {
  const engine = await getUserEngine(userId);
  if (engine === "claude") return getUserClaudeModel(userId);
  if (engine === "universal") return getUserUniversalModel(userId);
  return getUserAgyModel(userId);
}

async function setUserModel(userId, modelId) {
  const engine = await getUserEngine(userId);
  if (engine === "claude") return setUserClaudeModel(userId, modelId);
  if (engine === "universal") return setUserUniversalModel(userId, modelId);
  return setUserAgyModel(userId, modelId);
}

async function getUserEngine(userId) {
  if (!userId) return DEFAULT_ENGINE;
  const context = await loadContext();
  return context.engines?.[String(userId)] || DEFAULT_ENGINE;
}

async function setUserEngine(userId, engine) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.engines) context.engines = {};
  context.engines[String(userId)] = engine;
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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function downloadTelegramFile(
  ctx,
  fileId,
  originalName,
  isPhoto = false,
  mimeType = null
) {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram tidak mengembalikan file_path.");
  }

  // Cek batas ukuran 20MB bot Telegram
  if (file.file_size && file.file_size > 20 * 1024 * 1024) {
    throw new Error(
      `Ukuran file (${formatBytes(file.file_size)}) melebihi batas maksimum 20MB Telegram Bot API.`
    );
  }

  const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Gagal mengunduh file dari server Telegram (${response.status} ${response.statusText})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let ext = path.extname(originalName || file.file_path || "");
  if (!ext && isPhoto) ext = ".jpg";

  const rawBase = path.basename(originalName || `media_${Date.now()}`, ext);
  const safeBase =
    rawBase.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "file";
  const savedFileName = `${Date.now()}_${safeBase}${ext}`;
  const targetPath = path.join(UPLOADS_DIR, savedFileName);
  const relativePath = path.relative(process.cwd(), targetPath);

  await writeFile(targetPath, buffer);

  const effectiveMime =
    mimeType ||
    file.mime_type ||
    (isPhoto ? "image/jpeg" : "application/octet-stream");
  const isImage =
    isPhoto || Boolean(effectiveMime && effectiveMime.startsWith("image/"));

  // Periksa apakah file berupa skrip/teks/kode agar bisa di-preview di prompt AI
  const isCodeOrText =
    /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|php|rb|go|rs|c|cpp|h|hpp|java|kt|scala|html|htm|css|scss|sass|json|jsonc|yaml|yml|xml|sql|env|md|txt|csv|tsv|log|toml|ini|conf)$/i.test(
      savedFileName
    ) ||
    Boolean(
      effectiveMime &&
        (effectiveMime.startsWith("text/") ||
          effectiveMime.includes("json") ||
          effectiveMime.includes("javascript"))
    );

  let textContent = null;
  if (isCodeOrText && buffer.length <= 100 * 1024) {
    try {
      textContent = buffer.toString("utf8");
    } catch {
      textContent = null;
    }
  }

  return {
    fileName: originalName || savedFileName,
    savedFileName,
    relativePath,
    absolutePath: path.resolve(targetPath),
    fileSize: buffer.length,
    fileSizeFormatted: formatBytes(buffer.length),
    isPhoto: isImage,
    mimeType: effectiveMime,
    textContent,
  };
}

// Handler utama: Mengirim pesan langsung ke TH Agent
async function sendToAntigravity(userMessage, ctx, fileInfo = null) {
  if (activeTask) {
    await ctx.reply(
      `⏳ TH Agent sedang memproses instruksi sebelumnya (${activeTask.id}). Tunggu sebentar atau kirim /cancel untuk membatalkan.`
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

  // Indikator "sedang mengetik..." di Telegram secara berkala selama AI berpikir
  const sendTyping = () => {
    if (ctx.chat?.id) {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }
  };

  sendTyping();
  const typingInterval = setInterval(sendTyping, 4000);

  try {
    let fileInfoPrompt = "";
    if (fileInfo) {
      fileInfoPrompt = `
INFORMASI FILE / GAMBAR DARI PENGGUNA:
- Nama File: ${fileInfo.fileName}
- Tipe Media: ${fileInfo.isPhoto ? "Gambar / Foto" : "Dokumen / File"} (${fileInfo.mimeType || "tidak diketahui"})
- Ukuran File: ${fileInfo.fileSizeFormatted}
- Lokasi di Server:
  * Path Relatif: ${fileInfo.relativePath}
  * Path Absolut: ${fileInfo.absolutePath}
${fileInfo.textContent ? `\n--- ISI DOKUMEN / KODE (${fileInfo.fileName}) ---\n${truncate(fileInfo.textContent, 15000)}\n--- AKHIR ISI DOKUMEN ---` : ""}

PANDUAN EKSEKUSI & PENANGANAN FILE:
1. File/gambar ini SUDAH berhasil diunduh dan tersimpan di server pada path di atas.
2. JIKA PENGGUNA MEMINTA EKSEKUSI (contoh: "eksekusi file ini", "jalankan script ini", "run file python ini", "test script ini"):
   - Gunakan terminal tool untuk mengeksekusi langsung file tersebut (contoh: python3 "${fileInfo.relativePath}", node "${fileInfo.relativePath}", atau bash "${fileInfo.relativePath}").
   - Tampilkan laporan dan hasil keluaran terminal (stdout/stderr) secara rapi dan jelas ke chat Telegram.
3. JIKA BERUPA PROYEK / FILE KODE:
   - Kamu dapat memindahkan/menyalin file ini ke subfolder './projects' jika diminta, atau memeriksa dan mengeditnya.
4. JIKA BERUPA GAMBAR:
   - Analisis informasi visual / teks error / rancangan diagram yang ada pada gambar tersebut untuk membantu menjawab atau menyelesaikan error koding pengguna.
`.trim();
    }

    const prompt = `
Kamu adalah TH Agent, asisten software engineer otonom yang berkomunikasi langsung dengan developer melalui chat Telegram ini.

LINGKUNGAN & SISTEM:
- Kamu berada di lingkungan server developer.
- Folder './projects' adalah tempat menyimpan repository/project coding yang dikelola.
- Folder './uploads' adalah tempat menyimpan file, dokumen, script, dan gambar yang diunggah pengguna via chat Telegram.
- Kamu memiliki akses tools mandiri: menjalankan perintah terminal, git clone, membuat branch, membaca kode, mengedit file, dan memeriksa file.

PANDUAN INTERAKSI:
1. Respon Natural & Cerdas: Mengobrollah dengan ramah, santai, dan profesional dalam bahasa Indonesia layaknya rekan programmer senior.
2. Percakapan / Pertanyaan: Jika pengguna bertanya umum, berdiskusi teknis, atau menanyakan seputar sistem/project (contoh: "project disimpan di mana?", "arsitektur project ini bagaimana?", "jelaskan cara pakai Docker"), jawablah secara langsung, natural, dan akurat.
3. Eksekusi Perintah & File: Jika pengguna memberi instruksi kerja (contoh: "clone repo https://github.com/...", "buatkan fitur login di project blog", "perbaiki error di index.js") atau meminta mengeksekusi file/script dari Telegram, jalankan aksi tersebut menggunakan tools yang kamu miliki, lalu laporkan hasilnya dengan ringkas dan jelas.
4. Keamanan: Jangan pernah membocorkan isi file .env, token bot, atau secret kredensial.
5. Format: Gunakan format Markdown yang rapi agar enak dibaca di Telegram.
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}
Pesan dari pengguna:
${userMessage}
`.trim();

    const engine = await getUserEngine(userId);

    // Engine 3: Universal API Agent (Zero-CLI / Built-in Tools)
    if (engine === "universal") {
      try {
        const universalApiKey =
          process.env.UNIVERSAL_API_KEY ||
          process.env.OPENROUTER_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.DEEPSEEK_API_KEY;

        if (!universalApiKey) {
          clearInterval(typingInterval);
          if (activeTask?.id === taskId) activeTask = null;
          await ctx.reply(
            "⚠️ *API Key Universal belum diisi!*\n\nUntuk menggunakan engine Universal API (Zero-CLI), silakan buka Web Control Panel di http://localhost:3030 dan isi *UNIVERSAL_API_KEY* (atau *OPENROUTER_API_KEY* / *OPENAI_API_KEY* / *DEEPSEEK_API_KEY*).",
            { parse_mode: "Markdown" }
          );
          return;
        }

        const universalBaseUrl =
          process.env.UNIVERSAL_BASE_URL || "https://openrouter.ai/api/v1";
        const universalModel = await getUserUniversalModel(userId);

        const replyText = await runUniversalAgent({
          prompt,
          convId,
          apiKey: universalApiKey,
          baseUrl: universalBaseUrl,
          model: universalModel,
          systemPrompt: `Kamu adalah TH Agent, asisten software engineer otonom yang berkomunikasi langsung dengan developer melalui chat Telegram ini. Kamu memiliki akses tools mandiri di server (execute_command, read_file, write_file, list_directory). Gunakan bahasa Indonesia yang ramah, santai, dan profesional.`,
          onToolStart: () => {
            sendTyping();
          },
        });

        clearInterval(typingInterval);
        if (activeTask?.id === taskId) activeTask = null;

        try {
          await ctx.reply(truncate(replyText, 3800), {
            parse_mode: "Markdown",
          });
        } catch {
          await ctx.reply(truncate(replyText, 3800));
        }
        return;
      } catch (err) {
        clearInterval(typingInterval);
        if (activeTask?.id === taskId) activeTask = null;
        await ctx.reply(`❌ Maaf, Universal Agent mengalami kendala:\n${err.message}`);
        return;
      }
    }

    const isClaude = engine === "claude";

    const executeCli = async (sessionFlagOverride = null) => {
      let binToRun = AGY_BIN;
      let cliArgs = [];

      if (isClaude) {
        binToRun = CLAUDE_BIN;
        const isStarted = await isClaudeSessionStarted(convId);
        const sessionFlag = sessionFlagOverride || (isStarted ? "--resume" : "--session-id");
        const claudeModel = await getUserClaudeModel(userId);
        cliArgs = [
          sessionFlag,
          convId,
          "--model",
          claudeModel,
          "-p",
          prompt,
          "--output-format",
          "text",
        ];
        if (AUTO_APPROVE_PERMISSIONS) {
          cliArgs.push("--dangerously-skip-permissions");
        }
      } else {
        binToRun = AGY_BIN;
        const userModel = await getUserAgyModel(userId);
        cliArgs = [
          "--conversation",
          convId,
          "--model",
          userModel,
          "-p",
          prompt,
          "--output-format",
          "text",
          "--print-timeout",
          "10m",
        ];
        if (AUTO_APPROVE_PERMISSIONS) {
          cliArgs.push("--dangerously-skip-permissions");
        }
      }

      const sanitizedEnv = { ...process.env };
      delete sanitizedEnv.BOT_TOKEN;
      delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;

      // Konfigurasi mode autentikasi Claude Code (OAuth / Browser vs API Key)
      if (process.env.CLAUDE_AUTH_TYPE === "oauth") {
        delete sanitizedEnv.ANTHROPIC_API_KEY;
      }

      // Konfigurasi mode autentikasi Antigravity (Google Session vs API Key)
      if (process.env.AGY_AUTH_TYPE === "oauth") {
        delete sanitizedEnv.GEMINI_API_KEY;
      }

      const child = spawn(binToRun, cliArgs, {
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
        clearTimeout(timer);
        clearTimeout(killTimer);

        // Auto-recovery jika Claude session sudah ada (--session-id bentrok) atau belum ada (--resume missing)
        if (isClaude && !task.cancelled) {
          const fullErr = (stderr + "\n" + stdout).toLowerCase();
          if (fullErr.includes("already in use") && sessionFlagOverride !== "--resume") {
            console.log(`[Claude Session] Sesi ${convId} sudah ada di Claude, beralih ke --resume...`);
            await markClaudeSessionStarted(convId, true);
            return executeCli("--resume");
          }
          if (fullErr.includes("no conversation found") && sessionFlagOverride !== "--session-id") {
            console.log(`[Claude Session] Sesi ${convId} belum terdaftar, beralih ke --session-id...`);
            await markClaudeSessionStarted(convId, false);
            return executeCli("--session-id");
          }
          if (code === 0) {
            await markClaudeSessionStarted(convId, true);
          }
        }

        clearInterval(typingInterval);

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

        const engineLabel = isClaude ? "Claude Code" : "Antigravity";

        if (error || (code !== 0 && !stdout.trim())) {
          const errText = stderr.trim() || error?.message || `Exit code ${code}`;
          await ctx.reply(
            `❌ Maaf, ${engineLabel} mengalami kendala:\n${truncate(errText, 1000)}`
          );
          return;
        }

        const responseText = stdout.trim() || `${engineLabel} tidak mengembalikan pesan balasan.`;

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
    };

    await executeCli();
  } catch (err) {
    clearInterval(typingInterval);
    if (activeTask?.id === taskId) activeTask = null;
    await ctx.reply(`❌ Terjadi error: ${err.message}`);
  }
}

// Middleware otorisasi
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const summary =
      ctx.message?.text ||
      (ctx.message?.caption ? `[Caption] ${ctx.message.caption}` : "") ||
      (ctx.message?.photo ? "[Foto/Gambar]" : "") ||
      (ctx.message?.document
        ? `[Dokumen: ${ctx.message.document.file_name || "file"}]`
        : "") ||
      "[Pesan Lain]";
    console.log(
      `[Pesan Masuk] Dari ID: ${ctx.from.id} (@${ctx.from.username || "tanpa_username"}): "${summary}"`
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
      "• *Kirim Dokumen / Skrip:* Kirim file `.py`, `.js`, `.sh`, `.json`, `.zip` dll. dengan caption instruksi (contoh: _\"jalankan script ini\"_, _\"analisis kodingan ini\"_).\n" +
      "• *Kirim Gambar / Foto:* Kirim screenshot error terminal, mockup UI, atau diagram untuk dianalisis oleh AI.\n\n" +
      "Contoh pesan teks yang bisa Anda ketik:\n" +
      "• _\"project yang ada disimpan di mana?\"_\n" +
      "• _\"tolong clone repo https://github.com/user/repo ke folder myapp\"_\n" +
      "• _\"buatkan REST API login di project myapp\"_\n\n" +
      "Perintah bantuan:\n" +
      "• `/files` - Lihat daftar file dan gambar yang telah diunggah\n" +
      "• `/exec <cmd>` - Eksekusi perintah terminal langsung di server (misal: `/exec python3 uploads/...`)\n" +
      "• `/engine` atau `/cli` - Ganti engine (Antigravity CLI / Claude Code CLI)\n" +
      "• `/model` - Ganti model AI untuk Antigravity (Claude Sonnet/Opus, Gemini, GPT)\n" +
      "• `/reset` atau `/new` - Mulai sesi obrolan baru dari awal\n" +
      "• `/status` - Cek status bot, engine & model aktif\n" +
      "• `/cancel` - Hentikan tugas yang sedang berjalan",
    { parse_mode: "Markdown" }
  );
});

bot.command(["engine", "cli"], async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();
  const userId = ctx.from?.id;
  const currentEngine = await getUserEngine(userId);

  if (arg === "agy" || arg === "antigravity") {
    await setUserEngine(userId, "agy");
    await ctx.reply("✅ Engine berhasil diubah ke: *Antigravity CLI* (`agy`)", {
      parse_mode: "Markdown",
    });
    return;
  }
  if (arg === "claude" || arg === "claudecode") {
    await setUserEngine(userId, "claude");
    await ctx.reply("✅ Engine berhasil diubah ke: *Claude Code CLI* (`claude`)", {
      parse_mode: "Markdown",
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(
      `${currentEngine === "agy" ? "🔘 " : "⚪ "}Antigravity CLI (agy)`,
      "set_engine:agy"
    )
    .row()
    .text(
      `${currentEngine === "claude" ? "🔘 " : "⚪ "}Claude Code CLI (claude)`,
      "set_engine:claude"
    )
    .row()
    .text(
      `${currentEngine === "universal" ? "🔘 " : "⚪ "}Universal API (Zero-CLI / OpenRouter)`,
      "set_engine:universal"
    );

  const engineLabel =
    currentEngine === "claude"
      ? "Claude Code CLI (claude)"
      : currentEngine === "universal"
      ? "Universal API (Zero-CLI)"
      : "Antigravity CLI (agy)";

  await ctx.reply(
    `⚙️ *Pilihan Engine Eksekusi*\n\nEngine aktif saat ini:\n👉 *${engineLabel}*\n\nSilakan pilih engine eksekusi yang ingin digunakan:`,
    {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    }
  );
});

bot.callbackQuery(/^set_engine:(.+)$/, async (ctx) => {
  const engineId = ctx.match[1];
  const userId = ctx.from?.id;

  if (engineId !== "agy" && engineId !== "claude" && engineId !== "universal") {
    await ctx.answerCallbackQuery({ text: "Engine tidak valid!" });
    return;
  }

  await setUserEngine(userId, engineId);
  const engineLabel =
    engineId === "claude"
      ? "Claude Code CLI (claude)"
      : engineId === "universal"
      ? "Universal API (Zero-CLI)"
      : "Antigravity CLI (agy)";

  await ctx.answerCallbackQuery({
    text: `Engine diubah ke ${engineLabel}`,
  });

  const keyboard = new InlineKeyboard()
    .text(
      `${engineId === "agy" ? "🔘 " : "⚪ "}Antigravity CLI (agy)`,
      "set_engine:agy"
    )
    .row()
    .text(
      `${engineId === "claude" ? "🔘 " : "⚪ "}Claude Code CLI (claude)`,
      "set_engine:claude"
    )
    .row()
    .text(
      `${engineId === "universal" ? "🔘 " : "⚪ "}Universal API (Zero-CLI / OpenRouter)`,
      "set_engine:universal"
    );

  let engineModel = "";
  let matchedModel = "";
  if (engineId === "claude") {
    engineModel = await getUserClaudeModel(userId);
    matchedModel = AVAILABLE_CLAUDE_MODELS.find((m) => m.id === engineModel)?.name || engineModel;
  } else if (engineId === "universal") {
    engineModel = await getUserUniversalModel(userId);
    matchedModel = AVAILABLE_UNIVERSAL_MODELS.find((m) => m.id === engineModel)?.name || engineModel;
  } else {
    engineModel = await getUserAgyModel(userId);
    matchedModel = AVAILABLE_AGY_MODELS.find((m) => m.id === engineModel)?.name || engineModel;
  }

  try {
    await ctx.editMessageText(
      `⚙️ *Pilihan Engine CLI*\n\n` +
      `✅ Engine aktif sekarang:\n👉 *${engineLabel}*\n\n` +
      `🤖 Model aktif untuk engine ini:\n👉 *${matchedModel}* (\`${engineModel}\`)\n\n` +
      `💡 _Ketik /model untuk memilih daftar model khusus ${engineId === "claude" ? "Claude" : "Antigravity"}._`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  } catch {
    // Abaikan jika pesan tidak berubah
  }
});

bot.command("model", async (ctx) => {
  const arg = ctx.match?.trim();
  const userId = ctx.from?.id;
  const currentEngine = await getUserEngine(userId);
  const isClaude = currentEngine === "claude";
  const isUniversal = currentEngine === "universal";
  const modelList = isClaude
    ? AVAILABLE_CLAUDE_MODELS
    : isUniversal
    ? AVAILABLE_UNIVERSAL_MODELS
    : AVAILABLE_AGY_MODELS;
  const currentModel = isClaude
    ? await getUserClaudeModel(userId)
    : isUniversal
    ? await getUserUniversalModel(userId)
    : await getUserAgyModel(userId);
  const engineLabel = isClaude
    ? "Claude Code CLI"
    : isUniversal
    ? "Universal API (Zero-CLI)"
    : "Antigravity CLI";

  if (arg) {
    const matched = modelList.find(
      (m) => m.id.toLowerCase() === arg.toLowerCase()
    );
    const chosenId = matched ? matched.id : isUniversal ? arg : null;

    if (!chosenId) {
      const listStr = modelList
        .map((m) => `• \`${m.id}\` (${m.name})`)
        .join("\n");
      await ctx.reply(
        `❌ Model \`${arg}\` tidak dikenali untuk engine *${engineLabel}*.\n\nPilihan yang tersedia:\n${listStr}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (isClaude) {
      await setUserClaudeModel(userId, chosenId);
    } else if (isUniversal) {
      await setUserUniversalModel(userId, chosenId);
    } else {
      await setUserAgyModel(userId, chosenId);
    }

    const modelName = matched ? matched.name : chosenId;
    await ctx.reply(
      `✅ Model untuk *${engineLabel}* berhasil diubah ke: *${modelName}*\nID: \`${chosenId}\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const model of modelList) {
    const isCurrent = model.id === currentModel;
    const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}`;
    keyboard.text(label, `set_model:${model.id}`).row();
  }

  const activeName =
    modelList.find((m) => m.id === currentModel)?.name || currentModel;

  await ctx.reply(
    `🤖 *Pilihan Model AI*\n\n` +
      `⚙️ Engine aktif: *${engineLabel}*\n` +
      `👉 Model aktif saat ini:\n*${activeName}* (\`${currentModel}\`)\n\n` +
      `Silakan pilih model khusus *${engineLabel}* di bawah ini:`,
    {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    }
  );
});

bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
  const modelId = ctx.match[1];
  const userId = ctx.from?.id;
  const currentEngine = await getUserEngine(userId);
  const isClaude = currentEngine === "claude";
  const isUniversal = currentEngine === "universal";
  const modelList = isClaude
    ? AVAILABLE_CLAUDE_MODELS
    : isUniversal
    ? AVAILABLE_UNIVERSAL_MODELS
    : AVAILABLE_AGY_MODELS;
  const engineLabel = isClaude
    ? "Claude Code CLI"
    : isUniversal
    ? "Universal API (Zero-CLI)"
    : "Antigravity CLI";

  const matched = modelList.find((m) => m.id === modelId);

  if (!matched && !isUniversal) {
    await ctx.answerCallbackQuery({
      text: "Model tidak dikenali untuk engine ini!",
    });
    return;
  }

  const chosenId = matched ? matched.id : modelId;
  const chosenName = matched ? matched.name : modelId;

  if (isClaude) {
    await setUserClaudeModel(userId, chosenId);
  } else if (isUniversal) {
    await setUserUniversalModel(userId, chosenId);
  } else {
    await setUserAgyModel(userId, chosenId);
  }

  await ctx.answerCallbackQuery({
    text: `Model diubah ke ${chosenName}`,
  });

  const keyboard = new InlineKeyboard();
  for (const model of modelList) {
    const isCurrent = model.id === chosenId;
    const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}`;
    keyboard.text(label, `set_model:${model.id}`).row();
  }

  try {
    await ctx.editMessageText(
      `🤖 *Pilihan Model AI*\n\n` +
        `⚙️ Engine aktif: *${engineLabel}*\n` +
        `✅ Model aktif sekarang:\n👉 *${chosenName}* (\`${chosenId}\`)\n\n` +
        `Silakan klik tombol di bawah jika ingin mengganti ke model lain:`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  } catch {
    // Abaikan jika tidak ada perubahan tampilan
  }
});

bot.command(["new", "reset"], async (ctx) => {
  await resetUserConversation(ctx.from?.id);
  await ctx.reply(
    "🔄 *Sesi percakapan baru dimulai!*\nKonteks percakapan sebelumnya telah di-reset. Ada yang ingin kita kerjakan hari ini?",
    { parse_mode: "Markdown" }
  );
});

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


bot.command(["exec", "run", "sh"], async (ctx) => {
  const cmd = ctx.match?.trim();
  if (!cmd) {
    await ctx.reply(
      "ℹ️ *Cara penggunaan /exec:*\n\nKetik `/exec <perintah_shell>`\n\nContoh:\n• `/exec ls -la uploads`\n• `/exec python3 uploads/nama_file.py`\n• `/exec node uploads/nama_file.js`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (activeTask) {
    await ctx.reply(
      `⏳ Ada proses lain yang sedang berjalan (${activeTask.id}). Tunggu selesai atau kirim /cancel.`
    );
    return;
  }

  const taskId = randomUUID().slice(0, 8);
  activeTask = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
  };
  const task = activeTask;

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
    if (activeTask?.id === taskId) activeTask = null;

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
      const detail =
        errOutput || output || error?.message || `Exit code ${code}`;
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
      if (activeTask?.id === taskId) killProcessTree(child, "SIGKILL");
    }, 3000).unref();
  }, 120000); // 2 menit timeout untuk direct exec

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

bot.command("cancel", async (ctx) => {
  if (!activeTask?.process) {
    await ctx.reply("Tidak ada proses Antigravity yang sedang aktif.");
    return;
  }
  activeTask.cancelled = true;
  killProcessTree(activeTask.process, "SIGTERM");
  await ctx.reply("🛑 Permintaan pembatalan telah dikirim.");
});

// Handler untuk menerima dokumen/file dari Telegram chat
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  if (!doc) return;

  const caption = (ctx.message.caption || "").trim();
  if (caption.startsWith("/")) return;

  let statusMsg = null;
  try {
    statusMsg = await ctx.reply(
      `📥 *Mengunduh file: \`${doc.file_name || "dokumen"}\`*...`,
      { parse_mode: "Markdown" }
    );

    const fileInfo = await downloadTelegramFile(
      ctx,
      doc.file_id,
      doc.file_name,
      false,
      doc.mime_type
    );

    try {
      if (statusMsg) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `📥 *File tersimpan:* \`${fileInfo.savedFileName}\` (${fileInfo.fileSizeFormatted})\n📂 Lokasi: \`${fileInfo.relativePath}\`\n⏳ *Mengirim instruksi ke AI Agent...*`,
          { parse_mode: "Markdown" }
        );
      }
    } catch {
      // Abaikan jika tidak bisa edit pesan
    }

    const defaultInstruction = `Pengguna mengirim file "${fileInfo.fileName}". Analisis file ini, jelaskan isi atau fungsinya, dan jika diminta dieksekusi atau berupa skrip/program, jalankan perintah eksekusinya dan laporkan hasilnya.`;
    const promptMessage = caption || defaultInstruction;

    await sendToAntigravity(promptMessage, ctx, fileInfo);
  } catch (err) {
    console.error("Gagal memproses dokumen:", err);
    await ctx.reply(`❌ Gagal memproses file: ${err.message}`);
  }
});

// Handler untuk menerima gambar / foto dari Telegram chat
bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  const caption = (ctx.message.caption || "").trim();
  if (caption.startsWith("/")) return;

  const highestPhoto = photos[photos.length - 1];

  let statusMsg = null;
  try {
    statusMsg = await ctx.reply(`📸 *Mengunduh gambar...*`, {
      parse_mode: "Markdown",
    });

    const fileInfo = await downloadTelegramFile(
      ctx,
      highestPhoto.file_id,
      `image_${highestPhoto.file_unique_id}.jpg`,
      true,
      "image/jpeg"
    );

    try {
      if (statusMsg) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `📸 *Gambar tersimpan:* \`${fileInfo.savedFileName}\` (${fileInfo.fileSizeFormatted})\n📂 Lokasi: \`${fileInfo.relativePath}\`\n⏳ *Menganalisis bersama AI Agent...*`,
          { parse_mode: "Markdown" }
        );
      }
    } catch {
      // Abaikan jika tidak bisa edit pesan
    }

    const defaultInstruction = `Pengguna mengirim gambar ini tanpa pesan teks tambahan. Analisis gambar ini (misalnya jika berupa screenshot error koding, diagram sistem, UI mockup, atau log terminal), jelaskan temuanmu, dan berikan solusi atau langkah konkrit untuk menindaklanjutinya.`;
    const promptMessage = caption || defaultInstruction;

    await sendToAntigravity(promptMessage, ctx, fileInfo);
  } catch (err) {
    console.error("Gagal memproses gambar:", err);
    await ctx.reply(`❌ Gagal memproses gambar: ${err.message}`);
  }
});

// Setiap chat yang masuk langsung diteruskan 100% ke TH Agent!
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
  console.log("Memulai Telegram Coding Agent (TH Agent Gateway)...");
  bot.api
    .setMyCommands([
      { command: "start", description: "Sambutan & info bot" },
      { command: "help", description: "Panduan lengkap perintah" },
      { command: "files", description: "Daftar file & gambar yang diunggah" },
      { command: "exec", description: "Eksekusi perintah terminal langsung di server" },
      { command: "status", description: "Cek status tugas, engine & model aktif" },
      { command: "model", description: "Pilih model AI (Gemini, Claude, GPT)" },
      { command: "engine", description: "Pilih engine CLI (Antigravity / Claude Code)" },
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
      console.warn("   👉 Solusi: Hentikan instance bot di server lain, atau gunakan token bot baru dari @BotFather untuk lokal.");
      const webPort = process.env.WEB_PORT || 3030;
      console.warn(`   🌐 Web UI tetap aktif di http://localhost:${webPort} untuk mengubah konfigurasi token Anda.\n`);
    }
  });
} else {
  const webPort = process.env.WEB_PORT || 3030;
  console.log("\nℹ️  BOT_TOKEN belum diisi atau masih kosong.");
  console.log(`👉 Silakan buka Web UI di http://localhost:${webPort} untuk memasukkan token bot & ID Telegram Anda.\n`);
}

if (process.env.NODE_ENV !== "test" && process.env.ENABLE_WEB_UI !== "false") {
  startWebServer(process.env.WEB_PORT || 3030);
}

export { bot, sendToAntigravity };
