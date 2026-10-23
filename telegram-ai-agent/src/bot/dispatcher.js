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
  IS_PI,
} from "../config/env.js";
import {
  isPiSandboxActive,
  getSandboxConfig,
  getAllowedFolders,
} from "../services/sandbox-service.js";
import { syncPiModelDirectly } from "../services/pi-service.js";
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
  getUserModel,
} from "../services/context-store.js";
import {
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  appendLog,
  killProcessTree,
  runProcess,
  registerWorker,
  unregisterWorker,
  getActiveWorkers,
  getLockedProjects,
  isProjectBusy,
} from "../services/cli-runner.js";
import { truncate, sendSmartReply, stripAnsi } from "../services/telegram-files.js";
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
  processNextQueue,
  registerQueueExecutor,
  isQueuePaused,
  resumeQueue,
} from "../services/queue-service.js";
import { ensureProjectsIndexed } from "../services/project-indexer.js";
import {
  searchMemories,
  formatMemoriesForPrompt,
  addMemory,
} from "../services/memory-service.js";
import {
  findMatchingSkills,
  formatSkillsForPrompt,
  saveSkill,
} from "../services/skill-service.js";
import {
  isMultiTaskRequest,
  executeSwarm,
  WORKER_PROFILES,
} from "../services/swarm-service.js";
import { resolveDynamicUniversalModel } from "../config/models.js";
import { detectTargetProject } from "../services/project-detector.js";

/**
 * Memproses tag otonom dari output AI (Hermes-like self-learning & persistent memory):
 * - :::memory:add {"content": "...", "category": "...", "tags": [...]}:::
 * - :::skill:add {"id": "...", "name": "...", "description": "...", "triggers": [...], "instructions": "..."}:::
 */
export async function processAutonomousOutput(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { cleanedText: rawText || "", savedMemories: [], savedSkills: [] };
  }

  const savedMemories = [];
  const savedSkills = [];
  let cleaned = rawText;

  // 1. Ekstraksi :::memory:add {...} :::
  const memoryRegex = /:::memory:add\s*([\s\S]*?):::/g;
  let match;
  while ((match = memoryRegex.exec(rawText)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr);
      if (data.content) {
        const saved = await addMemory({
          content: data.content,
          category: data.category || "general",
          tags: Array.isArray(data.tags) ? data.tags : [],
          importance: data.importance || 4,
        });
        if (saved) savedMemories.push(saved);
      }
    } catch (e) {
      console.warn("[Dispatcher] Gagal parse memory tag:", e.message);
    }
  }
  cleaned = cleaned.replace(memoryRegex, "").trim();

  // 2. Ekstraksi :::skill:add {...} :::
  const skillRegex = /:::skill:add\s*([\s\S]*?):::/g;
  while ((match = skillRegex.exec(rawText)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr);
      if (data.id || data.name) {
        await saveSkill({
          id: data.id,
          name: data.name || data.id,
          description: data.description || "",
          triggers: Array.isArray(data.triggers) ? data.triggers : [data.triggers || data.id],
          instructions: data.instructions || "",
          source: "learned",
        });
        savedSkills.push(data.name || data.id);
      }
    } catch (e) {
      console.warn("[Dispatcher] Gagal parse skill tag:", e.message);
    }
  }
  cleaned = cleaned.replace(skillRegex, "").trim();

  return {
    cleanedText: cleaned,
    savedMemories,
    savedSkills,
  };
}

// Fungsi inti eksekusi instruksi AI (CLI atau Universal API)
export async function executeTaskInternal({ userMessage, ctx, fileInfo = null, id = null, targetProject = null }) {
  const userId = ctx.from?.id;
  const taskId = id || randomUUID().slice(0, 8);
  const resolvedProject = targetProject || await detectTargetProject(userMessage, fileInfo);

  const task = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
    preview: truncate(userMessage, 100),
    userId,
    chatId: ctx.chat?.id,
    userMessage,
    targetProject: resolvedProject,
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
⚠️ ATURAN DEFERRED BUILD & DEPLOY:
- Masih ada ${currentQueueLen} tugas lain di antrean chat Telegram yang menunggu giliran.
- TUNDA build ('npm run build', docker build) dan deploy ke server agar tugas berikutnya dapat segera diproses dengan cepat.
- Cukup selesaikan modifikasi kode, validasi syntax, simpan file, dan commit jika diperlukan.
- Di akhir respon chat, informasikan bahwa build & deploy ditunda karena antrean sedang aktif.
`.trim();
    } else {
      let deferredNotice = "";
      if (deferredList.length > 0) {
        deferredNotice = `\n- Proyek tertunda dari antrean sebelumnya: ${deferredList.map((p) => `'${p}'`).join(", ")}. Karena antrean sekarang sudah kosong, segera jalankan build dan deploy untuk proyek tersebut sampai live!`;
      }
      queueStatusPrompt = `
[STATUS ANTREAN CHAT TELEGRAM: KOSONG / TUGAS TERAKHIR]
🟢 ATURAN BUILD & DEPLOY:
- JIKA DAN HANYA JIKA tugas/instruksi pengguna saat ini meminta pembuatan atau modifikasi kode yang membutuhkan build/deploy, lakukan build dan deploy sekarang sampai selesai dan live!${deferredNotice}
- DILARANG KERAS menjalankan git commit, git push, build, atau perintah terminal yang tidak diminta jika pengguna hanya bertanya, berkonsultasi, meminta penjelasan, atau mengobrol.
`.trim();
    }

    // Retrieve relevant persistent memories & skills (Hermes-like dynamic injection)
    const [relevantMemories, matchingSkills] = await Promise.all([
      searchMemories(userMessage, { limit: 3, minScore: 0.18 }).catch(() => []),
      findMatchingSkills(userMessage, { limit: 2, minScore: 0.22 }).catch(() => []),
    ]);
    const memoryPrompt = formatMemoriesForPrompt(relevantMemories);
    const skillPrompt = formatSkillsForPrompt(matchingSkills);

    const sandboxCfg = await getSandboxConfig();
    const isCustomRole = sandboxCfg.role === "custom" || sandboxCfg.piSandbox;
    const allowedList = await getAllowedFolders();
    const allowedDisplay = allowedList.length > 0
      ? allowedList.map((f) => `'${f}'`).join(", ")
      : "(Belum ditentukan folder kustom - Akses proyek dibatasi)";

    let prompt = "";
    if (isOngoingSession) {
      const scopeOngoingRule = isCustomRole
        ? `- Aturan Scope Engine (Role Custom Aktif): Seluruh pengerjaan dan eksekusi coding DIBATASI HANYA di dalam folder: ${allowedDisplay}. Dilarang menyentuh atau memodifikasi file di luar folder tersebut.`
        : "- Lingkungan Server/VPS (Akses Penuh): Kamu memiliki role 'root' dengan hak akses penuh dan bebas ke seluruh proyek di './projects/' (seperti th-blog, wa-chat-bot, dll.).";

      // Sesi aktif berjalan: hemat token drastis tanpa mengulang puluhan baris persona boilerplate
      prompt = `
[Pesan dari Pengguna]:
${userMessage}
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}${queueStatusPrompt ? `\n${queueStatusPrompt}\n` : ""}${memoryPrompt ? `\n${memoryPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
[Panduan Eksekusi Lanjutan]:
- Fokus HANYA pada maksud pesan pengguna di atas. Jangan mengulang, meng-commit, atau men-deploy pekerjaan lama dari sesi sebelumnya jika tidak diminta.
- Lanjutkan tugas secara otonom & langsung eksekusi tanpa meminta konfirmasi (Zero-Confirmation) HANYA jika pesan pengguna memang meminta tindakan coding/eksekusi.
${scopeOngoingRule}
- Simpan fakta/preferensi baru jika ada: :::memory:add {"content": "...", "category": "preference|architecture|workflow|solution", "tags": [...]}:::
- Simpan SOP/skill berulang jika baru dipelajari: :::skill:add {"id": "nama-skill", "name": "...", "description": "...", "triggers": [...], "instructions": "..."}:::
- Jika ada proyek yang belum terdaftar di ./projects/PROJECTS_SUMMARY.md, telusuri dan daftarkan ke file tersebut.
- Format respon dalam Markdown rapi untuk chat Telegram:
  * 🎯 ATURAN UTAMA: Jawaban WAJIB RINGKAS, PADAT, dan LANGSUNG KE POIN PENTING / KESIMPULAN (Summary).
  * DILARANG KERAS men-dump log terminal panjang, seluruh baris kode, atau rincian berbelit-belit yang membuat pesan terpotong!
  * Cukup sampaikan: (1) Apa yang dilakukan/diperbaiki, (2) Poin perubahan penting, (3) Kesimpulan status akhir.
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

      const memorySkillInstructions = `
FITUR OTONOM: PERSISTENT MEMORY & AUTO-SKILL CREATION:
1. Persistent Vector Memory:
   Jika developer menyampaikan preferensi, aturan kerja, port container, atau fakta penting yang harus selalu diingat lintas sesi, kamu BISA menyimpan memori baru dengan menyisipkan blok tag berikut di akhir jawabanmu:
   :::memory:add {"content": "Deskripsi fakta yang diingat", "category": "preference|architecture|workflow|solution", "tags": ["tag1", "tag2"]}:::
2. Auto-Skill Creation:
   Jika kamu berhasil menyelesaikan masalah kompleks, deployment khusus, atau prosedur berulang yang sangat bernilai untuk dipakai kembali di masa depan, kamu BISA membuat skill baru secara otomatis dengan menyisipkan tag:
   :::skill:add {"id": "nama-skill-kebab-case", "name": "Judul Skill", "description": "Kegunaan skill", "triggers": ["trigger 1", "trigger 2"], "instructions": "Langkah-langkah instruksi..."}:::
   Sistem akan otomatis menyimpan dan mengindeks skill tersebut ke dalam persistent storage.`;

      const scopeEnvironmentNotice = isCustomRole
        ? `- Lingkungan Server/VPS (Scope Terbatas - Role Custom):
  * ATURAN KETAT SCOPE ENGINE (AKTIF): Seluruh pengerjaan tugas proyek, clone repo, modifikasi kode, dan eksekusi proyek coding DIBATASI HANYA di dalam folder: ${allowedDisplay}.
  * DILARANG KERAS mengeksekusi atau memodifikasi proyek jika berada di luar folder yang diizinkan tersebut.`
        : `- Lingkungan Server/VPS (Akses Penuh - Role Root): Kamu memiliki role 'root' dengan hak akses penuh dan bebas ke seluruh proyek di dalam './projects/' (seperti th-blog, wa-chat-bot, ai-podcast-live, dll.). Aturan pembatasan HANYA berlaku jika mode Custom Scope diaktifkan di menu pengaturan.`;

      prompt = `
Kamu adalah TH Agent, asisten software engineer cowok (pria) yang otonom dan berkomunikasi langsung dengan developer melalui chat Telegram ini.

PERSONA & GAYA KOMUNIKASI:
- Persona: Cowok programmer senior yang ramah, asik, cerdas, solutif, dan bisa diandalkan.
- Gaya Bicara: Santai dan akrab layaknya rekan kerja/bro sesama developer (bisa pakai sapaan santai seperti 'bro', 'mas', dsb.), tidak kaku, namun tetap profesional dan to the point saat membahas kode/solusi teknis.

LINGKUNGAN & SISTEM:
- Kamu berada di lingkungan server developer.
- Folder './projects' adalah tempat menyimpan repository/project coding yang dikelola.${availableProjectsPrompt}
${scopeEnvironmentNotice}
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
${memorySkillInstructions}

PANDUAN INTERAKSI:
1. Respon Natural & Cerdas: Mengobrollah dengan ramah, santai, dan profesional dalam bahasa Indonesia layaknya rekan programmer senior cowok.
2. 🎯 ATURAN FORMAT OUTPUT TELEGRAM (RINGKAS & TO-THE-POINT):
   - Pengguna membaca pesan di aplikasi Telegram (layar ponsel): JANGAN PERNAH men-dump log terminal panjang, potongan kode ratusan baris, atau penjelasan berbelit-belit yang menyebabkan teks terpotong!
   - Langsung ke poin penting & kesimpulan (Summary).
   - Gunakan bullet points ringkas untuk poin-poin yang dikerjakan / diubah.
   - Laporkan hasil akhir: apakah berhasil, file mana saja yang disentuh, dan status deploy/git.
   - Buat jawaban padat dan tuntas agar pas dalam layar chat Telegram tanpa ada yang terpotong.
3. Percakapan / Pertanyaan Umum: Jika pengguna bertanya umum atau berdiskusi teknis seputar arsitektur/sistem, jawablah secara langsung, natural, dan akurat.
4. Eksekusi Perintah & File: Jika pengguna memberi instruksi kerja atau meminta mengeksekusi file/script dari Telegram, jalankan aksi tersebut menggunakan tools yang kamu miliki, lalu laporkan hasilnya dengan ringkas dan jelas.
4. Keamanan: Jangan pernah membocorkan isi file .env, token bot, atau secret kredensial.
5. Format: Gunakan format Markdown yang rapi agar enak dibaca di Telegram.
6. Alur Development: Setiap selesai mengerjakan kode, WAJIB review perubahan dan jalankan test/pengecekan dulu. Hanya jika semua lolos, lanjut build (bila ada) lalu commit & push. Jika test/build gagal, perbaiki secara mandiri sampai beres.
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}${memoryPrompt ? `\n${memoryPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
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
            "⚠️ *API Key Universal belum diisi!*\n\nUntuk menggunakan engine Universal API (Zero-CLI), gunakan perintah:\n👉 `/setkey <api_key>`\n_Atau buka Web Control Panel di http://localhost:3030 (jika server custom/lokal tidak butuh auth, isi dummy seperti `sk-local`)._",
            { parse_mode: "Markdown" }
          );
          processNextQueue().catch(() => {});
          return;
        }

        const universalBaseUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
        let universalModel = await getUserUniversalModel(userId);

        // Auto-get model langsung dari server Pi jika menggunakan custom URL / local endpoint
        const isCustomServer =
          universalBaseUrl.startsWith("http://") ||
          universalBaseUrl.includes(":") ||
          universalBaseUrl.includes("localhost") ||
          !universalBaseUrl.includes("deepseek.com");

        if (
          isCustomServer &&
          (universalModel === "deepseek-chat" ||
            universalModel === "inflection/inflection-3-pi" ||
            !universalModel)
        ) {
          try {
            const syncResult = await syncPiModelDirectly(universalBaseUrl, universalApiKey, userId);
            if (syncResult.ok && syncResult.activeModel) {
              universalModel = syncResult.activeModel;
            }
          } catch {
            // Lanjut jika gagal
          }
        }

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
${isCustomRole ? `3. ATURAN SCOPE ENGINE (ROLE CUSTOM): Seluruh pengerjaan dan eksekusi proyek coding dibatasi HANYA di dalam folder: ${allowedDisplay}. Dilarang mengeksekusi proyek di luar folder tersebut.` : "3. AKSES PROYEK: Akses penuh (role root) ke seluruh proyek di './projects/' (th-blog, wa-chat-bot, ai-podcast-live, dll.)."}
4. Ambil inisiatif teknis terbaik secara mandiri, jalankan perintah shell, buat/edit file yang dibutuhkan, uji/test jika perlu, dan laporkan hasil jadinya dengan santai, ramah, dan profesional.
5. ATURAN OUTPUT TELEGRAM: Berikan respon yang RINGKAS, PADAT, dan FOKUS KE POIN PENTING & KESIMPULAN (Summary). Hindari dump log terminal mentah atau teks kepanjangan agar tidak terpotong.`,
          onToolStart: () => {
            sendTyping();
          },
        });

        const { cleanedText } = await processAutonomousOutput(replyText);

        clearInterval(typingInterval);
        clearActiveTask(taskId);

        await sendSmartReply(ctx, cleanedText);

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
      // Simpan model saat task dimulai untuk guard race condition saat task selesai
      let taskStartModel = null;

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
        taskStartModel = userModel; // Catat model saat task mulai
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

      // Jaga Mac agar tidak sleep saat tugas sedang aktif dieksekusi (bahkan saat pakai baterai)
      if (process.platform === "darwin" && child.pid) {
        try {
          const taskCaffeinate = spawn("caffeinate", ["-dimsu", "-w", String(child.pid)], {
            detached: true,
            stdio: "ignore",
          });
          taskCaffeinate.unref();
        } catch (_) {}
      }

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
              // Guard: hanya simpan conversation ID jika model belum berubah
              // Mencegah race condition di mana user switch model saat task masih jalan
              const currentModel = await getUserAgyModel(userId);
              if (!taskStartModel || currentModel === taskStartModel) {
                await setUserAgyConversationId(userId, parsed.conversation_id);
              } else {
                console.log(`[Dispatcher] Model berubah saat task berjalan (${taskStartModel} → ${currentModel}). Conversation ID lama TIDAK disimpan untuk mencegah rate-limit leak.`);
              }
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

        // Process autonomous tags (Memory & Skills) jika response ada
        if (responseText) {
          const { cleanedText } = await processAutonomousOutput(responseText);
          responseText = cleanedText;
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

        responseText = stripAnsi(responseText);
        await sendSmartReply(ctx, responseText);

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

// Registrasi executor ke Queue Service (Mendukung Single Task & Multi-Agent Swarm)
registerQueueExecutor(async (item) => {
  if (isMultiTaskRequest(item.userMessage)) {
    await executeSwarm(item);
  } else {
    await executeTaskInternal(item);
  }
});

/**
 * Eksekusi instruksi paralel dengan Subagent Worker untuk proyek yang berbeda
 */
export async function executeParallelProjectTask({ userMessage, ctx, fileInfo = null, targetProject }) {
  const userId = ctx.from?.id;
  const activeWorkers = getActiveWorkers();
  const usedNames = new Set(activeWorkers.map((w) => w.name));
  const profile = WORKER_PROFILES.find((p) => !usedNames.has(p.name)) || WORKER_PROFILES[activeWorkers.length % WORKER_PROFILES.length];
  const workerId = `sub-${targetProject.slice(0, 10)}-${randomUUID().slice(0, 4)}`;

  const worker = {
    id: workerId,
    name: profile.name,
    emoji: profile.emoji,
    title: userMessage,
    targetProject,
    process: null,
    startedAt: Date.now(),
  };

  registerWorker(workerId, worker);

  // Beritahu pengguna di Telegram bahwa subagent paralel aktif
  await ctx.reply(
    `🚀 *Smart Concurrency: Subagent Worker Diaktifkan!*\n\n` +
      `${profile.emoji} *[Subagent ${profile.name}]* ditugaskan khusus:\n` +
      `📁 *Target Proyek:* \`projects/${targetProject}\`\n` +
      `📌 _"${truncate(userMessage, 90)}"_\n\n` +
      `⚡ _Tugas ini dieksekusi secara independen & paralel bersamaan di server._`,
    { parse_mode: "Markdown" }
  ).catch(() => {});

  // Send typing indicator
  const sendTyping = () => {
    if (ctx.chat?.id) ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  };
  sendTyping();
  const typingTimer = setInterval(sendTyping, 4000);

  try {
    const workerConvId = `${userId || "u"}-${targetProject}`;

    // Prompt terarah khusus untuk proyek ini
    const projectNotice = `
FOKUS TARGET PROYEK (SUBAGENT WORKER ${profile.name} ${profile.emoji}):
- Kamu adalah Subagent khusus yang ditugaskan secara spesifik untuk proyek: './projects/${targetProject}'.
- Seluruh pemeriksaan kode, pengeditan file, testing, dan perintah terminal WAJIB difokuskan di dalam direktori './projects/${targetProject}'.
- DILARANG menyentuh atau memodifikasi file di luar folder proyek './projects/${targetProject}'.
`.trim();

    let fileInfoPrompt = "";
    if (fileInfo) {
      fileInfoPrompt = `
INFORMASI FILE DARI PENGGUNA:
- Nama File: ${fileInfo.fileName}
- Lokasi: ${fileInfo.absolutePath}
${fileInfo.textContent ? `\n--- ISI DOKUMEN ---\n${truncate(fileInfo.textContent, 8000)}\n--- AKHIR ---` : ""}
`.trim();
    }

    const [relevantMemories, matchingSkills] = await Promise.all([
      searchMemories(userMessage, { limit: 2, minScore: 0.2 }).catch(() => []),
      findMatchingSkills(userMessage, { limit: 2, minScore: 0.25 }).catch(() => []),
    ]);
    const memoryPrompt = formatMemoriesForPrompt(relevantMemories);
    const skillPrompt = formatSkillsForPrompt(matchingSkills);

    const workerPrompt = `
[Pesan dari Pengguna]:
${userMessage}
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}
${projectNotice}
${memoryPrompt ? `\n${memoryPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
[Panduan Eksekusi Subagent]:
- Fokus langsung pada pengerjaan tugas di './projects/${targetProject}' tanpa meminta konfirmasi (Zero-Confirmation).
- Simpan fakta baru jika ada: :::memory:add {"content": "...", "category": "preference|architecture|workflow|solution", "tags": [...]}:::
- Format output: Ringkas, padat, laporkan hasil jadinya secara langsung.
`.trim();

    const res = await runAgentAutonomous({
      prompt: workerPrompt,
      convId: workerConvId,
      userId,
      cwd: path.join(PROJECTS_DIR, targetProject),
      systemPrompt: `Kamu adalah Subagent [${profile.name} ${profile.emoji}] dari TH Agent, khusus menangani proyek ./projects/${targetProject}. Bersikap ramah, senior programmer, dan solutif.`,
      onSpawn: (child) => {
        worker.process = child;
      },
    });

    clearInterval(typingTimer);
    unregisterWorker(workerId);

    const { cleanedText } = await processAutonomousOutput(res.output || "");
    const header = `${profile.emoji} *[Subagent ${profile.name}] Proyek \`projects/${targetProject}\` Selesai!*\n\n`;
    await sendSmartReply(ctx, header + cleanedText);

    // Lanjutkan antrean jika ada tugas yang menunggu
    processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
  } catch (err) {
    clearInterval(typingTimer);
    unregisterWorker(workerId);
    await ctx.reply(`❌ *[Subagent ${profile.name}]* Mengalami kendala pada proyek \`${targetProject}\`:\n${err.message}`);
    processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
  }
}

/**
 * Entry point utama menerima pesan/file untuk TH Agent.
 * Mendukung Smart Concurrency: eksekusi paralel instan jika target proyek berbeda!
 */
export async function sendToAgent(userMessage, ctx, fileInfo = null) {
  // Jika antrean sedang di-pause tapi user mengirim pesan baru, unpause otomatis
  if (isQueuePaused()) {
    resumeQueue();
  }

  // Jika terdeteksi multi-task request, langsung delegasikan ke Multi-Agent Swarm!
  if (isMultiTaskRequest(userMessage)) {
    await executeSwarm({ userMessage, ctx, fileInfo });
    return;
  }

  const targetProject = await detectTargetProject(userMessage, fileInfo);
  const currentTask = getActiveTask();
  const activeWorkers = getActiveWorkers();
  const totalActive = (currentTask ? 1 : 0) + activeWorkers.length;

  // 1. Jika sistem sedang benar-benar idle, langsung eksekusi sebagai tugas utama
  if (!currentTask && activeWorkers.length === 0) {
    await executeTaskInternal({ userMessage, ctx, fileInfo, targetProject });
    return;
  }

  // 2. SMART PROJECT-AWARE CONCURRENCY:
  // Jika ada tugas yang sedang jalan, cek apakah target proyeknya BERBEDA & TIDAK SEDANG SIBUK
  const lockedProjects = getLockedProjects();
  const isTargetBusy = targetProject && lockedProjects.has(targetProject);
  const maxConcurrent = 3; // Menjaga batas RAM & CPU VPS tetap aman

  if (targetProject && !isTargetBusy && totalActive < maxConcurrent) {
    console.log(`[Smart Concurrency] Target proyek '${targetProject}' bebas. Menjalankan subagent paralel!`);
    await executeParallelProjectTask({ userMessage, ctx, fileInfo, targetProject });
    return;
  }

  // 3. JIKA PROYEK SAMA ATAU GLOBAL ATAU WORKER PENUH -> MASUKKAN KE ANTREAN (FIFO)
  const queueItem = enqueueTask({ userMessage, ctx, fileInfo, targetProject });
  const position = getQueuePosition(queueItem.id);

  let reasonNotice = "";
  if (targetProject && isTargetBusy) {
    reasonNotice = `🔒 *Proyek \`${targetProject}\` sedang dikerjakan oleh tugas aktif.*\nUntuk mencegah konflik git & file overwriting, tugas ini diantrekan secara aman.`;
  } else if (totalActive >= maxConcurrent) {
    reasonNotice = `⚡ Kapasitas subagent paralel (${maxConcurrent} tugas) sedang penuh.`;
  } else {
    reasonNotice = `⏳ TH Agent sedang memproses tugas sebelumnya (\`${currentTask?.id || "Worker"}\`).`;
  }

  await ctx.reply(
    `📥 *Instruksi Dimasukkan ke Antrean (Urutan #${position})*\n\n` +
      `${reasonNotice}\n\n` +
      `Instruksi Anda telah dicatat dan akan *otomatis dijalankan* saat gilirannya tiba.\n\n` +
      `💬 *Instruksi:*\n_"${truncate(userMessage, 120)}"_${
        fileInfo ? `\n📎 *File:* \`${fileInfo.fileName}\`` : ""
      }\n` +
      (targetProject ? `📁 *Target Proyek:* \`projects/${targetProject}\`\n` : "") +
      `\n💡 _Ketik /queue untuk melihat daftar antrean atau /cancel untuk membatalkan._`,
    { parse_mode: "Markdown" }
  );

  return { queued: true, id: queueItem.id, position, targetProject };
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
  onSpawn = null,
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
    let universalModel = userId ? await getUserUniversalModel(userId) : (process.env.UNIVERSAL_MODEL || "");

    // Jika model belum diset (kosong atau 'auto'), ambil secara dinamis langsung dari server
    if (!universalModel || universalModel === "auto") {
      try {
        const dynamicModel = await resolveDynamicUniversalModel(universalBaseUrl, universalApiKey);
        if (dynamicModel) {
          universalModel = dynamicModel;
          console.log(`[Universal Agent] Model dinamis terpilih dari server: ${universalModel}`);
        }
      } catch (e) {
        console.warn("[Universal Agent] Gagal auto-detect model dinamis:", e.message);
      }
    }

    const isCustomServer =
      universalBaseUrl.startsWith("http://") ||
      universalBaseUrl.includes(":") ||
      universalBaseUrl.includes("localhost") ||
      !universalBaseUrl.includes("deepseek.com");

    if (
      isCustomServer &&
      (!universalModel ||
        universalModel === "deepseek-chat" ||
        universalModel === "inflection/inflection-3-pi")
    ) {
      try {
        const syncResult = await syncPiModelDirectly(universalBaseUrl, universalApiKey, userId);
        if (syncResult.ok && syncResult.activeModel) {
          universalModel = syncResult.activeModel;
        }
      } catch {}
    }

    // Fallback default jika endpoint adalah deepseek resmi
    if (!universalModel && universalBaseUrl.includes("deepseek.com")) {
      universalModel = "deepseek-chat";
    }

    if (!universalModel) {
      throw new Error(
        `Model Universal API belum ditentukan dan server di ${universalBaseUrl} tidak merespon daftar model otomatis (/v1/models). Silakan atur model via command /model <id> atau isi UNIVERSAL_MODEL di pengaturan.`
      );
    }

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
    onSpawn,
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

