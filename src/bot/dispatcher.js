import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AGY_BIN,
  CLAUDE_BIN,
  TIMEOUT_MS,
  MAX_OUTPUT,
  AUTO_APPROVE_PERMISSIONS,
  PROJECTS_DIR,
} from "../config/env.js";
import {
  getUserConversationId,
  getUserAgyConversationId,
  setUserAgyConversationId,
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
  runProcess,
} from "../services/cli-runner.js";
import { truncate } from "../services/telegram-files.js";
import { runUniversalAgent } from "../universal-agent.js";
import {
  GITHUB_ISSUE_REGEX,
  fetchIssueDetails,
  formatIssueForPrompt,
  isGhAvailable,
} from "../services/github-service.js";
import {
  enqueueTask,
  getQueuePosition,
  getQueueLength,
  getDeferredProjects,
  markProjectDeferred,
  clearDeferredProjects,
  processNextQueue,
  registerQueueExecutor,
  isQueuePaused,
  resumeQueue,
} from "../services/queue-service.js";
import { ensureProjectsIndexed } from "../services/project-indexer.js";

// Fungsi inti eksekusi instruksi AI (CLI atau Universal API)
export async function executeTaskInternal({ userMessage, ctx, fileInfo = null, id = null }) {
  const userId = ctx.from?.id;
  const taskId = id || randomUUID().slice(0, 8);

  const task = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
    preview: truncate(userMessage, 100),
    userId,
    chatId: ctx.chat?.id,
    userMessage,
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
    const convId = await getUserConversationId(userId);

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

    let issueInfoPrompt = "";
    const issueMatch = userMessage.match(GITHUB_ISSUE_REGEX);
    if (issueMatch) {
      try {
        const [fullUrl, owner, repo, issueNum] = issueMatch;
        const ghReady = await isGhAvailable();
        if (ghReady) {
          ctx.reply(
            `🐙 *Membaca GitHub Issue #${issueNum}* dari \`${owner}/${repo}\`...`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
          const issueData = await fetchIssueDetails(fullUrl);
          issueInfoPrompt = formatIssueForPrompt(issueData);
        }
      } catch (ghErr) {
        console.warn("[GitHub Service] Gagal mengambil issue:", ghErr.message);
      }
    }

    const engine = await getUserEngine(userId);
    const agyConvId = userId ? await getUserAgyConversationId(userId) : null;
    const isOngoingSession = Boolean(
      (engine === "claude" && (await isClaudeSessionStarted(convId))) ||
      (engine === "agy" && agyConvId)
    );

    const currentQueueLen = getQueueLength();
    const deferredList = getDeferredProjects();

    let queueStatusPrompt = "";
    if (currentQueueLen > 0) {
      queueStatusPrompt = `
[STATUS ANTREAN CHAT TELEGRAM: SIBUK (${currentQueueLen} TUGAS MENUNGGU)]
⚠️ ATURAN DEFERRED BUILD & DEPLOY (PENTING!):
- Saat ini masih ada ${currentQueueLen} tugas lain di antrean chat Telegram yang sedang menunggu giliran.
- DILARANG melakukan build ('npm run build', docker build, dll.) dan DILARANG melakukan deploy ke VPS/server sekarang!
- Cukup selesaikan modifikasi kode, periksa syntax/linter, simpan file, dan commit jika diperlukan.
- Jangan menghabiskan waktu untuk build/deploy agar tugas berikutnya di antrean dapat segera diproses dengan cepat.
- Di akhir respon chat, informasikan secara singkat dan santai kepada developer bahwa proses build & deploy ditunda dulu karena masih ada antrean chat.
`.trim();
    } else {
      let deferredNotice = "";
      if (deferredList.length > 0) {
        deferredNotice = `\n- CATATAN PERUBAHAN TERTUNDA: Proyek berikut memiliki perubahan dari instruksi antrean sebelumnya yang belum dibuild/deploy: ${deferredList.map((p) => `'${p}'`).join(", ")}. Karena antrean sekarang sudah kosong, SEGERA jalankan build dan deploy untuk proyek tersebut sekarang sampai live!`;
      }
      queueStatusPrompt = `
[STATUS ANTREAN CHAT TELEGRAM: KOSONG / TUGAS TERAKHIR]
🟢 ATURAN BUILD & DEPLOY SEKARANG:
- Antrean chat sudah kosong (ini giliran tugas terakhir).
- Jika tugas ini atau tugas sebelumnya mengubah kode proyek yang butuh build/deploy (misal: 'npm run build', './deploy-to-vps.sh', restart service/container), LANGSUNG LAKUKAN BUILD DAN DEPLOY SEKARANG sampai selesai dan live!${deferredNotice}
`.trim();
    }

    let prompt = "";
    if (isOngoingSession) {
      // Sesi aktif berjalan: hemat token drastis tanpa mengulang puluhan baris persona boilerplate
      prompt = `
${queueStatusPrompt}

[Pesan dari Pengguna]:
${userMessage}
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}
[Panduan Eksekusi Lanjutan]:
- Lanjutkan tugas secara otonom & langsung eksekusi tanpa meminta konfirmasi (Zero-Confirmation).
- Jika ada proyek yang belum terdaftar di ./projects/PROJECTS_SUMMARY.md, telusuri dan daftarkan ke file tersebut.
- Patuhi aturan status antrean chat di atas (tunda build/deploy jika antrean > 0; langsung build & deploy jika antrean kosong).
- Format respon dalam Markdown rapi untuk chat Telegram.
`.trim();
    } else {
      await ensureProjectsIndexed().catch((err) =>
        console.warn("[Project Indexer] Check error:", err.message)
      );

      let availableProjectsPrompt = "";
      try {
        const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
        if (dirs.length > 0) {
          availableProjectsPrompt = `\n- Proyek aktif yang sudah ada di folder './projects': ${dirs.map((d) => `'./projects/${d}'`).join(", ")}.`;
        }
      } catch (_) {}

      let projectsSummaryPrompt = "";
      try {
        const summaryFile = path.join(PROJECTS_DIR, "PROJECTS_SUMMARY.md");
        const summaryContent = await readFile(summaryFile, "utf8");
        projectsSummaryPrompt = `\n\nRINGKASAN ARSITEKTUR & PETA PROYEK (BACA INI DULU AGAR TIDAK SCAN DARI NOL):\n${summaryContent.trim()}\n\n*ATURAN WAJIB TOKEN EFFICIENCY & PROYEK BARU:*
1. Jangan membaca atau menelusuri folder/file dari awal jika proyek sudah tercatat di ringkasan di atas (manfaatkan info port, stack, container, dan file utama yang ada).
2. Jika ada proyek baru yang dibuat, di-clone, atau belum ada di ringkasan di atas, telusuri secara ringkas lalu WAJIB perbarui file './projects/PROJECTS_SUMMARY.md' agar sesi berikutnya langsung tahu tanpa perlu read dari awal lagi.`;
      } catch (_) {}

      prompt = `
Kamu adalah TH Agent, asisten software engineer cowok (pria) yang otonom dan berkomunikasi langsung dengan developer melalui chat Telegram ini.

PERSONA & GAYA KOMUNIKASI:
- Persona: Cowok programmer senior yang ramah, asik, cerdas, solutif, dan bisa diandalkan.
- Gaya Bicara: Santai dan akrab layaknya rekan kerja/bro sesama developer (bisa pakai sapaan santai seperti 'bro', 'mas', dsb.), tidak kaku, namun tetap profesional dan to the point saat membahas kode/solusi teknis.

LINGKUNGAN & SISTEM:
- Kamu berada di lingkungan server developer.
- Folder './projects' adalah tempat menyimpan repository/project coding yang dikelola.${availableProjectsPrompt}
- Folder './uploads' adalah tempat menyimpan file, dokumen, script, dan gambar yang diunggah pengguna via chat Telegram.
- Kamu memiliki AKSES PENUH & LANGSUNG ke tools mandiri di server: menjalankan perintah terminal shell, membuat/mengedit/menghapus file, git, compile, install dependencies, dan memeriksa file.${projectsSummaryPrompt}

PRINSIP UTAMA: AKSES PENUH & ZERO-CONFIRMATION (EKSEKUSI LANGSUNG TANPA TANYA):
1. KAMU MEMILIKI HAK AKSES DAN IZIN PENUH 100% di server ini. Developer sudah memberikan mandat penuh kepadamu untuk mengeksekusi apa pun yang diminta.
2. DILARANG KERAS BERTANYA BALIK UNTUK MEMINTA IZIN ATAU KONFIRMASI:
   - JANGAN PERNAH bertanya hal seperti: "Apakah ingin saya buatkan filenya sekarang?", "Boleh saya perbaiki kodenya?", "Apakah Anda yakin ingin menjalankan ini?", "Mau saya push ke GitHub?", "Konfirmasi dulu ya bro".
   - Pertanyaan izin/konfirmasi semacam ini SANGAT MEMPERLAMA PROSES EKSEKUSI dan TIDAK DIINGINKAN oleh developer.
3. PRINSIP "JUST DO IT" (EKSEKUSI NYATA SEKETIKA):
   - Jika developer memberi instruksi, meminta membuat fitur, memperbaiki bug, menjalankan perintah terminal, mengedit file, atau mengeksekusi file/script dari Telegram: LANGSUNG LAKUKAN tindakan nyata tersebut saat itu juga menggunakan tools (terminal/file) yang kamu miliki!
   - JANGAN HANYA MEMBERIKAN KODE SEBAGAI TEKS DI CHAT tanpa benar-benar menerapkannya di server. Buat file aslinya, edit kodenya, dan jalankan perintahnya di server secara langsung.
4. OTONOM & PROAKTIF:
   - Ambil keputusan teknis terbaik secara mandiri tanpa membebani developer dengan pertanyaan-pertanyaan kecil.
   - Kerjakan seluruh alur kerja sampai tuntas: baca kode/file -> buat/edit file -> jalankan / test -> perbaiki sendiri jika ada error -> laporkan hasil akhirnya yang sudah jadi dan berhasil.
5. HANYA BERTANYA JIKA ADA KEBUTUHAN KRUSIAL YANG BENAR-BENAR TIDAK DAPAT DITEMUKAN:
   - Kamu HANYA boleh bertanya jika ada kredensial/secret pihak ketiga (seperti token API berbayar yang belum ada di server) yang mutlak dibutuhkan dan tidak bisa dibuat/disimulasikan sendiri.

PANDUAN INTERAKSI:
1. Respon Natural & Cerdas: Mengobrollah dengan ramah, santai, dan profesional dalam bahasa Indonesia layaknya rekan programmer senior cowok.
2. Percakapan / Pertanyaan Umum: Jika pengguna bertanya umum atau berdiskusi teknis seputar arsitektur/sistem, jawablah secara langsung, natural, dan akurat.
3. Eksekusi Perintah & File: Jika pengguna memberi instruksi kerja atau meminta mengeksekusi file/script dari Telegram, jalankan aksi tersebut menggunakan tools yang kamu miliki, lalu laporkan hasilnya dengan ringkas dan jelas.
4. Keamanan: Jangan pernah membocorkan isi file .env, token bot, atau secret kredensial.
5. Format: Gunakan format Markdown yang rapi agar enak dibaca di Telegram.
6. Alur Development & Manajemen Antrean (Deferred Build & Deploy - Berlaku untuk Semua Proyek):
   - WAJIB periksa status antrean chat (dari status antrean di prompt di bawah, file './data/queue-status.json', atau env QUEUE_LENGTH).
   - JIKA ADA ANTREAN MENUNGGU (queueLength > 0): DILARANG menjalankan proses build ('npm run build', docker build) dan DILARANG deploy! Cukup edit kode, validasi syntax/linting, dan simpan. Biarkan tugas berikutnya di antrean berjalan cepat tanpa tertahan proses build.
   - JIKA ANTREAN HABIS/KOSONG (queueLength == 0): Lakukan proses build dan deploy penuh (misal: 'npm run build', './deploy-to-vps.sh', restart container/service) agar semua hasil perubahan kode dari antrean sebelumnya langsung ter-deploy dan aktif live.
7. Efisiensi Token & Pembacaan Bedah (Surgical):
   - Di setiap proyek './projects/<nama-proyek>', terdapat file 'ARCHITECTURE.md' yang merangkum rute, arsitektur, dan komponen kunci. Cek file ringkas ini terlebih dahulu daripada membaca puluhan file dari awal.
   - Hindari membaca file utuh (500+ baris); gunakan grep/pencarian baris lalu baca range baris yang dibutuhkan saja (StartLine & EndLine) agar context token selalu hemat dan awet.
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}
${queueStatusPrompt}

Pesan dari pengguna:
${userMessage}
`.trim();
    }

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
          processNextQueue().catch(() => {});
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
          systemPrompt: `Kamu adalah TH Agent, asisten software engineer cowok (pria) yang memiliki AKSES PENUH & 100% OTONOM di server ini melalui tools mandiri (execute_command, read_file, write_file, list_directory).
ATURAN UTAMA:
1. DILARANG KERAS BERTANYA BALIK MEMINTA IZIN ATAU KONFIRMASI (seperti "apakah ingin dijalankan?", "boleh saya buat filenya?"). Pertanyaan semacam ini dilarang karena memperlama proses.
2. LANGSUNG EKSEKUSI tugas secara nyata menggunakan tools yang kamu miliki sampai selesai tuntas.
3. Ambil inisiatif teknis terbaik secara mandiri, jalankan perintah shell, buat/edit file yang dibutuhkan, uji/test jika perlu, dan laporkan hasil jadinya dengan santai, ramah, dan profesional.
4. ATURAN MANAJEMEN ANTREAN (BUILD & DEPLOY):
   - Jika ada antrean tugas chat (queueLength > 0), DILARANG melakukan build ('npm run build', docker build) atau deploy. Cukup selesaikan modifikasi kode dan validasi syntax.
   - Jika antrean chat kosong (queueLength == 0), segera lakukan build dan deploy semua proyek yang tertunda sampai live.`,
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

        // Lanjutkan antrean tugas berikutnya
        processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
        return;
      } catch (err) {
        clearInterval(typingInterval);
        clearActiveTask(taskId);
        await ctx.reply(`❌ Maaf, Universal Agent mengalami kendala:\n${err.message}`);
        processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
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
          cliArgs.push("--dangerously-skip-permissions", "--permission-mode", "bypassPermissions");
        }
      } else {
        binToRun = AGY_BIN;
        const userModel = await getUserAgyModel(userId);
        const agyConvId = userId ? await getUserAgyConversationId(userId) : null;
        cliArgs = [
          "--model",
          userModel,
          "-p",
          prompt,
          "--output-format",
          "json",
        ];
        if (agyConvId) {
          cliArgs.unshift("--conversation", agyConvId);
        }
        if (AUTO_APPROVE_PERMISSIONS) {
          cliArgs.push("--dangerously-skip-permissions");
        }
      }

      const sanitizedEnv = { ...process.env };
      delete sanitizedEnv.BOT_TOKEN;
      delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;

      // Flag environment agar child process & tools (npm, git, apt, bash) berjalan non-interactive tanpa prompt
      sanitizedEnv.CI = "true";
      sanitizedEnv.NONINTERACTIVE = "1";
      sanitizedEnv.DEBIAN_FRONTEND = "noninteractive";
      sanitizedEnv.CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS = "1";
      sanitizedEnv.QUEUE_LENGTH = String(currentQueueLen);
      sanitizedEnv.HAS_PENDING_QUEUE = currentQueueLen > 0 ? "1" : "0";
      sanitizedEnv.QUEUE_STATUS_FILE = path.join(process.cwd(), "data", "queue-status.json");

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

        const engineLabel = isClaude ? "Claude Code" : "Antigravity";
        let responseText = "";
        let jsonError = null;

        if (!isClaude) {
          const rawOutput = stdout.trim();
          let parsed = null;
          try {
            parsed = JSON.parse(rawOutput);
          } catch {
            const jsonMatch = rawOutput.match(/\{[\s\S]*"conversation_id"[\s\S]*\}/);
            if (jsonMatch) {
              try {
                parsed = JSON.parse(jsonMatch[0]);
              } catch (_) {}
            }
          }

          if (parsed) {
            if (parsed.conversation_id && userId) {
              await setUserAgyConversationId(userId, parsed.conversation_id);
            }
            if (parsed.status === "SUCCESS") {
              responseText = parsed.response || "";
            } else if (parsed.error) {
              jsonError = parsed.error;
            }
          } else {
            responseText = rawOutput;
          }
        } else {
          responseText = stdout.trim();
        }

        const result = {
          taskId,
          userId,
          cancelled: task.cancelled,
          exitCode: code,
          signal,
          error: error?.message || jsonError || null,
          output: truncate(responseText || stdout.trim(), MAX_OUTPUT),
          stderr: truncate(stderr.trim(), 2500),
        };

        await appendLog(taskId, JSON.stringify(result, null, 2) + "\n");
        clearActiveTask(taskId);

        if (task.cancelled) {
          await ctx.reply("⚠️ Proses dihentikan.");
          processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
          return;
        }

        const isTimedOut = signal === "SIGTERM" || signal === "SIGKILL" || stderr.includes("print timeout") || stderr.includes("timed out");
        const hasError = error || jsonError || (code !== 0 && !responseText.trim()) || (!responseText.trim() && stderr.trim());

        if (hasError) {
          let errText = jsonError || stderr.trim() || error?.message || (code !== null ? `Exit code ${code}` : "");

          if (isTimedOut) {
            errText = `⏱️ *Batas Waktu Eksekusi Terlampaui (Timeout)*\n\n${engineLabel} memerlukan waktu pemrosesan lebih lama dari batas waktu yang ditentukan. Coba persempit atau pecah instruksi menjadi langkah-langkah yang lebih terarah.`;
          } else if (errText.includes("permission that headless mode cannot prompt for") || errText.includes("permission")) {
            errText = `🔒 *Izin Akses File / Terminal Ditolak*\n\n${truncate(errText, 700)}\n\n💡 Pastikan \`AGY_AUTO_APPROVE_PERMISSIONS=true\` diaktifkan pada .env.`;
          } else {
            errText = `❌ Maaf, ${engineLabel} mengalami kendala:\n${truncate(errText, 1000)}`;
          }

          await ctx.reply(errText, { parse_mode: "Markdown" }).catch(() => ctx.reply(truncate(errText, 1000)));
          processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
          return;
        }

        if (!responseText.trim()) {
          responseText = `ℹ️ ${engineLabel} telah selesai memproses instruksi, namun tidak ada teks balasan yang dihasilkan.`;
        }

        try {
          await ctx.reply(truncate(responseText, 3800), {
            parse_mode: "Markdown",
          });
        } catch {
          await ctx.reply(truncate(responseText, 3800));
        }

        // Lanjutkan antrean tugas berikutnya
        processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
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
    processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
  }
}

// Registrasi executor ke Queue Service
registerQueueExecutor(async (item) => {
  await executeTaskInternal(item);
});

/**
 * Entry point utama menerima pesan/file untuk TH Agent.
 * Jika AI sedang sibuk menjalankan instruksi lain, pesan dimasukkan ke antrean.
 */
export async function sendToAgent(userMessage, ctx, fileInfo = null) {
  // Jika antrean sedang di-pause tapi user mengirim pesan baru, unpause otomatis
  if (isQueuePaused()) {
    resumeQueue();
  }

  const currentTask = getActiveTask();
  if (currentTask) {
    const queueItem = enqueueTask({ userMessage, ctx, fileInfo });
    const position = getQueuePosition(queueItem.id);
    const activePreview = currentTask.preview
      ? `\n_“${truncate(currentTask.preview, 70)}”_`
      : "";

    await ctx.reply(
      `📥 *Instruksi Dimasukkan ke Antrean (Urutan #${position})*\n\n` +
        `⏳ TH Agent sedang memproses tugas sebelumnya (\`${currentTask.id}\`):${activePreview}\n\n` +
        `Instruksi Anda telah dicatat dan akan *otomatis dijalankan* saat gilirannya tiba.\n\n` +
        `💬 *Instruksi:*\n_"${truncate(userMessage, 120)}"_${
          fileInfo ? `\n📎 *File:* \`${fileInfo.fileName}\`` : ""
        }\n\n` +
        `💡 _Ketik /queue untuk melihat daftar antrean atau /clearqueue untuk membatalkan._`,
      { parse_mode: "Markdown" }
    );
    return { queued: true, id: queueItem.id, position };
  }

  await executeTaskInternal({ userMessage, ctx, fileInfo });
}

// Fungsi eksekusi AI mandiri untuk background task / autonomous agent (Auto-Analyze, Auto-Fix)
export async function runAgentAutonomous({
  prompt,
  convId = null,
  userId = null,
  cwd = process.cwd(),
  systemPrompt = null,
  engineOverride = null,
  timeoutMs = TIMEOUT_MS,
}) {
  const engine = engineOverride || (userId ? await getUserEngine(userId) : process.env.CLI_ENGINE || "agy");
  const actualConvId = convId || `auto-${randomUUID().slice(0, 8)}`;

  // 1. Engine: Universal API (Zero-CLI)
  if (engine === "universal") {
    const universalApiKey =
      process.env.UNIVERSAL_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY;

    if (!universalApiKey) {
      throw new Error("UNIVERSAL_API_KEY belum dikonfigurasi di file .env atau Web Control Panel.");
    }

    const universalBaseUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
    const universalModel = userId ? await getUserUniversalModel(userId) : (process.env.UNIVERSAL_MODEL || "deepseek-chat");

    const replyText = await runUniversalAgent({
      prompt,
      convId: actualConvId,
      apiKey: universalApiKey,
      baseUrl: universalBaseUrl,
      model: universalModel,
      systemPrompt: systemPrompt || "Kamu adalah TH Agent, asisten AI software engineer cowok (pria) yang otonom, ramah, dan solutif.",
      workingDir: cwd,
    });

    return { ok: true, output: replyText };
  }

  // 2. Engine: CLI (agy atau claude)
  const isClaude = engine === "claude";
  const binToRun = isClaude ? CLAUDE_BIN : AGY_BIN;

  let cliArgs = [];
  if (isClaude) {
    const claudeModel = userId ? await getUserClaudeModel(userId) : (process.env.CLAUDE_MODEL || "sonnet");
    cliArgs = ["--session-id", actualConvId, "--model", claudeModel, "-p", prompt, "--output-format", "text"];
    if (AUTO_APPROVE_PERMISSIONS) {
      cliArgs.push("--dangerously-skip-permissions", "--permission-mode", "bypassPermissions");
    }
  } else {
    const agyModel = userId ? await getUserAgyModel(userId) : (process.env.AGY_MODEL || "gemini-3.8-flash-medium");
    cliArgs = [
      "--model",
      agyModel,
      "-p",
      prompt,
      "--output-format",
      "json",
    ];
    if (convId) {
      cliArgs.unshift("--conversation", convId);
    }
    if (AUTO_APPROVE_PERMISSIONS) {
      cliArgs.push("--dangerously-skip-permissions");
    }
  }

  const sanitizedEnv = { ...process.env };
  delete sanitizedEnv.BOT_TOKEN;
  delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;

  // Flag environment agar child process & tools (npm, git, apt, bash) berjalan non-interactive tanpa prompt
  sanitizedEnv.CI = "true";
  sanitizedEnv.NONINTERACTIVE = "1";
  sanitizedEnv.DEBIAN_FRONTEND = "noninteractive";
  sanitizedEnv.CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS = "1";

  if (process.env.GITHUB_TOKEN) {
    sanitizedEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.CLAUDE_AUTH_TYPE === "oauth") {
    delete sanitizedEnv.ANTHROPIC_API_KEY;
  }
  if (process.env.AGY_AUTH_TYPE === "oauth") {
    delete sanitizedEnv.GEMINI_API_KEY;
  }

  const res = await runProcess({
    command: binToRun,
    args: cliArgs,
    cwd,
    timeoutMs,
    env: sanitizedEnv,
  });

  if (res.code === 0 && res.stdout) {
    if (!isClaude) {
      try {
        let parsed = null;
        try {
          parsed = JSON.parse(res.stdout.trim());
        } catch {
          const match = res.stdout.match(/\{[\s\S]*"conversation_id"[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
        if (parsed) {
          if (parsed.status === "SUCCESS") {
            return { ok: true, output: parsed.response, conversationId: parsed.conversation_id };
          }
          if (parsed.error) {
            throw new Error(`Eksekusi Agent CLI gagal: ${parsed.error}`);
          }
        }
      } catch (err) {
        if (err.message.startsWith("Eksekusi Agent CLI gagal:")) throw err;
      }
    }
    return { ok: true, output: res.stdout };
  }

  // Jika ada output dari CLI meskipun exit non-nol (misal warning)
  if (res.stdout && res.stdout.length > 50) {
    return { ok: true, output: res.stdout };
  }

  const errMsg = res.stderr || res.stdout || `CLI exit code ${res.code}`;
  throw new Error(`Eksekusi Agent CLI gagal: ${errMsg}`);
}

