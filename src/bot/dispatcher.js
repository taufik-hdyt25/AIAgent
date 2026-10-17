import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  AGY_BIN,
  CLAUDE_BIN,
  TIMEOUT_MS,
  MAX_OUTPUT,
  AUTO_APPROVE_PERMISSIONS,
} from "../config/env.js";
import {
  getUserConversationId,
  getUserEngine,
  getUserAgyModel,
  getUserClaudeModel,
  getUserUniversalModel,
  isClaudeSessionStarted,
  markClaudeSessionStarted,
} from "../services/context-store.js";
import {
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  appendLog,
  killProcessTree,
} from "../services/cli-runner.js";
import { truncate } from "../services/telegram-files.js";
import { runUniversalAgent } from "../universal-agent.js";

export async function sendToAgent(userMessage, ctx, fileInfo = null) {
  const currentTask = getActiveTask();
  if (currentTask) {
    await ctx.reply(
      `⏳ TH Agent sedang memproses instruksi sebelumnya (${currentTask.id}). Tunggu sebentar atau kirim /cancel untuk membatalkan.`
    );
    return;
  }

  const userId = ctx.from?.id;
  const convId = await getUserConversationId(userId);
  const taskId = randomUUID().slice(0, 8);

  const task = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
  };
  setActiveTask(task);

  // Indikator "sedang mengetik..." di Telegram berkala
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
          clearActiveTask(taskId);
          await ctx.reply(
            "⚠️ *API Key Universal belum diisi!*\n\nUntuk menggunakan engine Universal API (Zero-CLI), silakan buka Web Control Panel di http://localhost:3030 dan isi *UNIVERSAL_API_KEY*.",
            { parse_mode: "Markdown" }
          );
          return;
        }

        const universalBaseUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
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
        clearActiveTask(taskId);

        try {
          await ctx.reply(truncate(replyText, 3800), { parse_mode: "Markdown" });
        } catch {
          await ctx.reply(truncate(replyText, 3800));
        }
        return;
      } catch (err) {
        clearInterval(typingInterval);
        clearActiveTask(taskId);
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

      if (process.env.CLAUDE_AUTH_TYPE === "oauth") {
        delete sanitizedEnv.ANTHROPIC_API_KEY;
      }
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

        // Auto-recovery sesi Claude Code
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
        clearActiveTask(taskId);

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
          await ctx.reply(truncate(responseText, 3800));
        }
      };

      timer = setTimeout(() => {
        task.cancelled = true;
        killProcessTree(child, "SIGTERM");
        killTimer = setTimeout(() => {
          if (getActiveTask()?.id === taskId) killProcessTree(child, "SIGKILL");
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
    clearActiveTask(taskId);
    await ctx.reply(`❌ Terjadi error: ${err.message}`);
  }
}
