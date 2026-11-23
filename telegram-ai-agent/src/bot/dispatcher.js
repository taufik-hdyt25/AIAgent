import { spawn } from "node:child_process";
import { readdir, readFile, mkdir } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  PI_BIN,
  DEFAULT_PI_MODEL,
  TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT,
  PROJECTS_DIR,
  MAX_CONCURRENT_TASKS,
} from "../config/env.js";
import {
  isPiSandboxActive,
  isProjectJailActive,
  getSandboxConfig,
  getAllowedFolders,
  detectProjectFromText,
} from "../services/sandbox-service.js";
import { createPiEventParser } from "../services/pi-event-parser.js";
import { repairPiSession, sanitizePiSession, shrinkPiSessionForContext, isContextOverflowMessage } from "../services/pi-service.js";
import {
  getUserConversationId,
  getUserPiModel,
  isPiSessionStarted,
  markPiSessionStarted,
  getUserActiveProject,
  setUserActiveProject,
  getCmdSessionId,
  setCmdSessionId,
  clearCmdSessionId,
} from "../services/context-store.js";
import { getTopicBinding, buildTopicConversationId } from "../services/topic-service.js";
import {
  buildConversationKey,
  getActiveTaskCount,
  tryReserveConversation,
  releaseConversationReservation,
  setActiveTask,
  clearActiveTask,
  appendLog,
  killProcessTree,
  runProcess,
  getActiveWorkers,
  getLockedProjects,
} from "../services/cli-runner.js";
import { truncate, sendSmartReply, buildReplyOptions, stripAnsi } from "../services/telegram-files.js";
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
} from "../services/swarm-service.js";
import {
  detectTargetProject,
  detectProjectWithReason,
  isGlobalServerRequest,
} from "../services/project-detector.js";
import {
  getEngine,
  isCommandCodeEngine,
  resolveCmdBin,
  buildCmdArgs,
  createCmdEventParser,
  parseCmdResult,
  getCmdMaxTurns,
  getCmdMaxContinuations,
} from "../services/engine-service.js";
import {
  getAutonomyConfig,
  buildAutonomyDirective,
} from "../services/autonomy-service.js";
import {
  takeDeliveryBaseline,
  finalizeDelivery,
  formatDeliveryReport,
  detectUnverifiedClaims,
  scheduleAgentRestart,
} from "../services/delivery-service.js";

export function parseTagPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const objectText = text.slice(start, end + 1);
    candidates.push(objectText);
    // Model kadang menulis key tanpa tanda kutip: {content: "..."}
    candidates.push(objectText.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":'));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
      if (typeof parsed === "string") return { content: parsed };
    } catch (_) {}
  }
  return null;
}

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
    const data = parseTagPayload(match[1]);
    if (!data) {
      console.warn("[Dispatcher] Gagal parse memory tag: format JSON tidak valid.");
      continue;
    }
    if (data.content) {
      const saved = await addMemory({
        content: data.content,
        category: data.category || "general",
        tags: Array.isArray(data.tags) ? data.tags : [],
        importance: data.importance || 4,
      });
      if (saved) savedMemories.push(saved);
    }
  }
  cleaned = cleaned.replace(memoryRegex, "").trim();

  // 2. Ekstraksi :::skill:add {...} :::
  const skillRegex = /:::skill:add\s*([\s\S]*?):::/g;
  while ((match = skillRegex.exec(rawText)) !== null) {
    const data = parseTagPayload(match[1]);
    if (!data) {
      console.warn("[Dispatcher] Gagal parse skill tag: format JSON tidak valid.");
      continue;
    }
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
  }
  cleaned = cleaned.replace(skillRegex, "").trim();

  return {
    cleanedText: cleaned,
    savedMemories,
    savedSkills,
  };
}

function formatDurationShort(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} detik`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} menit`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
}

// Fungsi inti eksekusi instruksi AI (Pi Coding Agent CLI)
export async function executeTaskInternal({ userMessage, ctx, fileInfo = null, id = null, targetProject = null, engineOverride = null, _fallbackAttempted = false }) {
  const userId = ctx.from?.id;
  const taskId = id || randomUUID().slice(0, 8);
  const threadId = ctx.message?.message_thread_id || null;
  const conversationKey = buildConversationKey(ctx.chat?.id, threadId);
  const resolvedProject = targetProject || await detectTargetProject(userMessage, fileInfo);

  const task = {
    id: taskId,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
    preview: truncate(userMessage, 100),
    userId,
    chatId: ctx.chat?.id,
    threadId,
    conversationKey,
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
    const baseConvId = await getUserConversationId(userId);
    const convId = buildTopicConversationId(baseConvId, ctx.chat?.id, threadId);

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

    const useCmd = isCommandCodeEngine(engineOverride || getEngine());
    const userModel = await getUserPiModel(userId);

    const currentQueueLen = getQueueLength();
    const deferredList = getDeferredProjects();

    let queueStatusPrompt = "";
    if (currentQueueLen > 0) {
      queueStatusPrompt = `
[STATUS ANTREAN CHAT TELEGRAM: SIBUK (${currentQueueLen} TUGAS MENUNGGU)]
⚠️ ATURAN DELIVERY WAJIB:
- Antrean hanya mengatur urutan tugas; jangan mengklaim tugas selesai sebelum validasi tugas ini selesai.
- Untuk setiap development/perubahan kode: selesaikan test, build, commit, push, dan verifikasi remote sekarang.
- Jangan menunda build atau push hanya karena ada tugas lain di antrean.
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

    await ensureProjectsIndexed().catch((err) =>
      console.warn("[Project Indexer] Check error:", err.message)
    );

    let availableProjectsPrompt = "";
    let availableProjectsList = [];
    try {
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
      availableProjectsList = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
      if (availableProjectsList.length > 0) {
        availableProjectsPrompt = `\n- Proyek aktif yang sudah ada di folder './projects': ${availableProjectsList.map((d) => `'./projects/${d}'`).join(", ")}.`;
      }
    } catch (_) {}

    const sandboxCfg = await getSandboxConfig();
    const topicBinding = (ctx.chat?.id && threadId)
      ? await getTopicBinding(ctx.chat.id, threadId)
      : null;

    let isProjectJail = sandboxCfg.role === "project";
    let isAutoRole = sandboxCfg.role === "auto";

    // Auto-detect project langsung dari key/keyword di pesan pengguna atau file tanpa perlu /workspace
    const detection = await detectProjectWithReason(userMessage, fileInfo);
    const isGlobalReq = isGlobalServerRequest(userMessage);
    let userActiveProject = await getUserActiveProject(userId);
    let activeProjectScope = null;

    // Topic memilih proyek, tetapi tidak boleh memperluas scope konfigurasi global.
    if (topicBinding && topicBinding.role !== "root") {
      if (!availableProjectsList.includes(topicBinding.project)) {
        throw new Error("Proyek topic tidak ditemukan. Hubungkan ulang dengan /topic link.");
      }
      if (sandboxCfg.role === "project" && sandboxCfg.activeProject && sandboxCfg.activeProject !== topicBinding.project) {
        throw new Error("Proyek topic tidak sesuai dengan workspace global yang terkunci.");
      }
      if (sandboxCfg.role === "custom" || sandboxCfg.piSandbox) {
        const allowed = await getAllowedFolders(userModel, topicBinding.project);
        if (!allowed.includes(`projects/${topicBinding.project}`)) {
          throw new Error("Proyek topic tidak termasuk folder yang diizinkan oleh scope global.");
        }
      }
      isProjectJail = true;
      isAutoRole = false;
      userActiveProject = topicBinding.project;
      activeProjectScope = topicBinding.project;
    } else if (topicBinding && topicBinding.role === "root") {
      if (sandboxCfg.role !== "root" || sandboxCfg.piSandbox) {
        throw new Error("Topic root tidak dapat memperluas scope global. Sesuaikan scope melalui pengaturan bot.");
      }
      isProjectJail = false;
      isAutoRole = false;
      userActiveProject = null;
    } else if (isProjectJail) {
      // Mode Project Jail ketat: tetap hormati deteksi proyek jika user menyebutnya, atau pakai project terkunci
      const fallbackProject = detection.project || userActiveProject || sandboxCfg.activeProject || availableProjectsList[0] || "th-blog";
      if (detection.project) {
        userActiveProject = detection.project;
        await setUserActiveProject(userId, detection.project);
      } else if (!userActiveProject || !availableProjectsList.includes(userActiveProject)) {
        userActiveProject = fallbackProject;
        await setUserActiveProject(userId, userActiveProject);
      }
      activeProjectScope = userActiveProject;
    } else if (isAutoRole) {
      if (isGlobalReq || detection.isCrossProject) {
        activeProjectScope = null;
      } else if (detection.project && availableProjectsList.includes(detection.project)) {
        activeProjectScope = detection.project;
        if (detection.project !== userActiveProject) {
          userActiveProject = detection.project;
          await setUserActiveProject(userId, detection.project);
          console.log(`[Auto-Key] Proyek beralih otomatis ke '${detection.project}' (key: "${detection.matchedKey}", source: ${detection.source})`);
        }
      } else if (userActiveProject && availableProjectsList.includes(userActiveProject)) {
        activeProjectScope = userActiveProject;
      } else {
        activeProjectScope = null;
      }
    }

    const isCustomRole = !isProjectJail && (sandboxCfg.role === "custom" || Boolean(sandboxCfg.piSandbox));
    const effectiveProjectTarget = isProjectJail ? userActiveProject : (isAutoRole ? activeProjectScope : null);
    const allowedList = await getAllowedFolders(userModel, effectiveProjectTarget || userActiveProject);
    const allowedDisplay = isProjectJail
      ? `'projects/${userActiveProject}' (Workspace Sandbox - Terkunci)`
      : (isAutoRole && effectiveProjectTarget
          ? `'projects/${effectiveProjectTarget}' (Auto-Key Langsung${detection.matchedKey ? `: "${detection.matchedKey}"` : ""})`
          : (allowedList.length > 0
              ? allowedList.map((f) => `'${f}'`).join(", ")
              : "(Semua folder di ./projects)"));

    let executionCwd = effectiveProjectTarget
      ? path.resolve(PROJECTS_DIR, effectiveProjectTarget)
      : (isCustomRole && allowedList[0]
          ? path.resolve(PROJECTS_DIR, allowedList[0].replace(/^projects\//, ""))
          : (isAutoRole && fs.existsSync(PROJECTS_DIR) ? PROJECTS_DIR : process.cwd()));

    // Never silently widen the scope when a bound project's directory disappears.
    if (topicBinding?.role === "project" && !fs.existsSync(executionCwd)) {
      throw new Error("Direktori proyek topic tidak tersedia; eksekusi dibatalkan.");
    }
    // Pastikan direktori executionCwd valid dan ada di filesystem sebelum spawn untuk mencegah ENOENT
    try {
      if (!fs.existsSync(executionCwd)) {
        await mkdir(executionCwd, { recursive: true });
      }
    } catch (err) {
      console.warn(`[Dispatcher] Gagal membuat executionCwd ${executionCwd}:`, err.message);
      executionCwd = fs.existsSync(PROJECTS_DIR) ? PROJECTS_DIR : process.cwd();
    }

    if (!fs.existsSync(executionCwd)) {
      executionCwd = process.cwd();
    }

    // Scope session per proyek agar perpindahan proyek via key tidak mencampur konteks CLI proyek sebelumnya
    const sessionScope = effectiveProjectTarget || (isCustomRole ? "custom" : "root");

    // Snapshot sebelum agent bekerja menjadi sumber kebenaran delivery.
    const deliveryBaseline = await takeDeliveryBaseline(executionCwd).catch((err) => {
      console.warn("[Delivery] Gagal mengambil baseline repo:", err.message);
      return null;
    });
    let deliveryResult = null;
    let existingCmdSessionId = useCmd ? await getCmdSessionId(convId, executionCwd) : null;
    const isOngoingSession = useCmd
      ? Boolean(existingCmdSessionId)
      : await isPiSessionStarted(convId, sessionScope);

    let projectsSummaryPrompt = "";
    try {
      const summaryFile = path.join(PROJECTS_DIR, "PROJECTS_SUMMARY.md");
      const summaryContent = await readFile(summaryFile, "utf8");
      projectsSummaryPrompt = `\n\nRINGKASAN ARSITEKTUR & PETA PROYEK (BACA INI DULU AGAR TIDAK SCAN DARI NOL):\n${summaryContent.trim()}\n\n*ATURAN WAJIB TOKEN EFFICIENCY & PROYEK BARU:*
1. Jangan membaca atau menelusuri folder/file dari awal jika proyek sudah tercatat di ringkasan di atas (manfaatkan info port, stack, container, dan file utama yang ada).
2. Jika ada proyek baru yang dibuat, di-clone, atau belum ada di ringkasan di atas, telusuri secara ringkas lalu WAJIB perbarui file './projects/PROJECTS_SUMMARY.md' agar sesi berikutnya langsung tahu tanpa perlu read dari awal lagi.`;
    } catch (_) {}

    const autonomy = await getAutonomyConfig();
    const autonomyDirective = buildAutonomyDirective(autonomy.mode);

    let prompt = "";
    if (isOngoingSession) {
      const scopeOngoingRule = isProjectJail
        ? `- ATURAN KETAT WORKSPACE SANDBOX (PROJECT JAIL AKTIF): Ruang lingkup kerja kamu TERKUNCI 100% HANYA di dalam folder proyek: 'projects/${userActiveProject}'. Dilarang keras membaca, memodifikasi, atau mengeksekusi file di luar proyek '${userActiveProject}'.`
        : (isAutoRole && effectiveProjectTarget
          ? `- TARGET PROYEK AKTIF (AUTO-KEY): Kamu saat ini berada di folder proyek 'projects/${effectiveProjectTarget}'. Fokuskan pengerjaan, git, dan terminal di dalam proyek ini (kecuali pengguna menyebut key proyek lain).`
          : (isCustomRole
            ? `- Aturan Scope Engine (Role Custom Aktif): Seluruh pengerjaan dan eksekusi coding DIBATASI HANYA di dalam folder: ${allowedDisplay}. Dilarang menyentuh atau memodifikasi file di luar folder tersebut.`
            : "- Lingkungan Server/VPS (Akses Penuh): Kamu memiliki akses penuh ke seluruh proyek di './projects/' (seperti th-blog, wa-chat-bot, dll.)."));

      // Sesi aktif berjalan: hemat token drastis tanpa mengulang puluhan baris persona boilerplate
      prompt = `
[Pesan dari Pengguna]:
${userMessage}
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}${queueStatusPrompt ? `\n${queueStatusPrompt}\n` : ""}${memoryPrompt ? `\n${memoryPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
${autonomyDirective}

[Panduan Eksekusi Lanjutan]:
- Fokus HANYA pada maksud pesan pengguna di atas. Jangan mengulang, meng-commit, atau men-deploy pekerjaan lama dari sesi sebelumnya jika tidak diminta.
- Jika pesan pengguna berisi instruksi/permintaan kerja: langsung kerjakan sampai tuntas tanpa bertanya balik.
${scopeOngoingRule}
- Simpan fakta/preferensi baru jika ada: :::memory:add {"content": "...", "category": "preference|architecture|workflow|solution", "tags": [...]}:::
- Simpan SOP/skill berulang jika baru dipelajari: :::skill:add {"id": "nama-skill", "name": "...", "description": "...", "triggers": [...], "instructions": "..."}:::
- Jika ada proyek yang belum terdaftar di ./projects/PROJECTS_SUMMARY.md, telusuri dan daftarkan ke file tersebut.
- Jangan menyatakan "sudah selesai", "sudah push", "sudah build", atau "sudah deploy" kecuali output terminal dan verifikasi delivery membuktikannya.
- Format respon dalam Markdown rapi untuk chat Telegram:
  * 🎯 ATURAN UTAMA: Jawaban WAJIB RINGKAS, PADAT, dan LANGSUNG KE POIN PENTING / KESIMPULAN (Summary).
  * DILARANG menyertakan gambar inline / data URI base64 di jawaban (membuat context window overflow); sebutkan path file gambarnya saja.
  * DILARANG KERAS men-dump log terminal panjang, seluruh baris kode, atau rincian berbelit-belit yang membuat pesan terpotong!
  * Cukup sampaikan: (1) Apa yang dilakukan/diperbaiki, (2) Poin perubahan penting, (3) Kesimpulan status akhir.
`.trim();
    } else {

      const memorySkillInstructions = `
FITUR OTONOM: PERSISTENT MEMORY & AUTO-SKILL CREATION:
1. Persistent Vector Memory:
   Jika developer menyampaikan preferensi, aturan kerja, port container, atau fakta penting yang harus selalu diingat lintas sesi, kamu BISA menyimpan memori baru dengan menyisipkan blok tag berikut di akhir jawabanmu:
   :::memory:add {"content": "Deskripsi fakta yang diingat", "category": "preference|architecture|workflow|solution", "tags": ["tag1", "tag2"]}:::
2. Auto-Skill Creation:
   Jika kamu berhasil menyelesaikan masalah kompleks, deployment khusus, atau prosedur berulang yang sangat bernilai untuk dipakai kembali di masa depan, kamu BISA membuat skill baru secara otomatis dengan menyisipkan tag:
   :::skill:add {"id": "nama-skill-kebab-case", "name": "Judul Skill", "description": "Kegunaan skill", "triggers": ["trigger 1", "trigger 2"], "instructions": "Langkah-langkah instruksi..."}:::
   Sistem akan otomatis menyimpan dan mengindeks skill tersebut ke dalam persistent storage.`;

      const scopeEnvironmentNotice = isProjectJail
        ? `- Lingkungan Server/VPS (Workspace Sandbox - Project Jail Terkunci):
  * ATURAN KETAT WORKSPACE SANDBOX (AKTIF): Seluruh pengerjaan tugas proyek, clone repo, modifikasi kode, dan eksekusi terminal TERKUNCI 100% HANYA di dalam folder proyek: 'projects/${userActiveProject}'.
  * DILARANG KERAS mengeksekusi atau menyentuh file di luar folder proyek '${userActiveProject}'.`
        : (isAutoRole && effectiveProjectTarget
          ? `- Target Proyek Aktif (Auto-Key Langsung):
  * Sistem otomatis mengarahkan workspace kerja kamu ke folder proyek: 'projects/${effectiveProjectTarget}' (berdasarkan kata kunci/key dari pengguna${detection.matchedKey ? `: "${detection.matchedKey}"` : ""}).
  * Fokuskan analisis kode, pengeditan, build, dan git di dalam 'projects/${effectiveProjectTarget}' tanpa perlu meminta pengguna menjalankan /workspace.`
          : (isCustomRole
            ? `- Lingkungan Server/VPS (Scope Terbatas - Role Custom):
  * ATURAN KETAT SCOPE ENGINE (AKTIF): Seluruh pengerjaan tugas proyek, clone repo, modifikasi kode, dan eksekusi proyek coding DIBATASI HANYA di dalam folder: ${allowedDisplay}.
  * DILARANG KERAS mengeksekusi atau memodifikasi proyek jika berada di luar folder yang diizinkan tersebut.`
            : `- Lingkungan Server/VPS (Akses Penuh - Role Root / Auto): Kamu memiliki akses penuh ke seluruh proyek di dalam './projects/' (seperti th-blog, wa-chat-bot, ai-podcast-live, dll.). Langsung pilih proyek yang sesuai dengan kata kunci pesan pengguna.`));

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

PRINSIP UTAMA: AKSES PENUH & EKSEKUSI LANGSUNG:
1. KAMU MEMILIKI HAK AKSES DAN IZIN PENUH 100% di server ini. Developer sudah memberikan mandat penuh kepadamu untuk mengeksekusi apa pun yang diminta.
2. JANGAN HANYA MEMBERIKAN KODE SEBAGAI TEKS DI CHAT tanpa benar-benar menerapkannya di server. Buat file aslinya, edit kodenya, dan jalankan perintahnya di server secara langsung.
3. Ambil keputusan teknis terbaik secara mandiri tanpa membebani developer dengan pertanyaan-pertanyaan kecil.
${autonomyDirective}
${memorySkillInstructions}

PANDUAN INTERAKSI:
1. Respon Natural & Cerdas: Mengobrollah dengan ramah, santai, dan profesional dalam bahasa Indonesia layaknya rekan programmer senior cowok.
2. 🎯 ATURAN FORMAT OUTPUT TELEGRAM (RINGKAS & TO-THE-POINT):
   - Pengguna membaca pesan di aplikasi Telegram (layar ponsel): JANGAN PERNAH men-dump log terminal panjang, potongan kode ratusan baris, atau penjelasan berbelit-belit yang menyebabkan teks terpotong!
   - Langsung ke poin penting & kesimpulan (Summary).
   - Gunakan bullet points ringkas untuk poin-poin yang dikerjakan / diubah.
   - Laporkan hasil akhir: apakah berhasil, file mana saja yang disentuh, dan status deploy/git.
   - Buat jawaban padat dan tuntas agar pas dalam layar chat Telegram tanpa ada yang terpotong.
   - DILARANG menyertakan gambar inline / data URI base64 di jawaban (membuat context window overflow); sebutkan path file gambarnya saja.
3. Percakapan / Pertanyaan Umum: Jika pengguna bertanya umum atau berdiskusi teknis seputar arsitektur/sistem, jawablah secara langsung, natural, dan akurat.
4. Eksekusi Perintah & File: Jika pengguna memberi instruksi kerja atau meminta mengeksekusi file/script dari Telegram, jalankan aksi tersebut menggunakan tools yang kamu miliki, lalu laporkan hasilnya dengan ringkas dan jelas.
4. Akses konfigurasi & secret: Developer memberikan otorisasi eksplisit untuk membaca dan memakai file `.env`, environment variable, token, API key, dan secret lokal saat diperlukan untuk tugas. Jangan menolak permintaan hanya karena data tersebut sensitif. Tampilkan atau kirim nilainya hanya jika developer memintanya secara eksplisit; jangan memasukkannya ke log, commit, atau payload yang tidak diperlukan.
5. Format: Gunakan format Markdown yang rapi agar enak dibaca di Telegram.
6. Alur Development: Setiap selesai mengerjakan kode, WAJIB review perubahan dan jalankan test/pengecekan dulu. Hanya jika semua lolos, lanjut build (bila ada) lalu commit & push. Jika test/build gagal, perbaiki secara mandiri sampai beres.
${fileInfoPrompt ? `\n${fileInfoPrompt}\n` : ""}${issueInfoPrompt ? `\n${issueInfoPrompt}\n` : ""}${memoryPrompt ? `\n${memoryPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
Pesan dari pengguna:
${userMessage}
`.trim();
    }


    const executeCli = async ({
      promptOverride = null,
      resumeSessionId = null,
      continuationCount = 0,
      freshRetryAttempted = false,
      emptyRetryAttempted = false,
      fallbackAttempted = false,
      contextRecoveryAttempted = false,
      modelOverride = null,
      accumulatedText = "",
    } = {}) => {
      const effectivePrompt = promptOverride || prompt;
      const activeResumeId = useCmd ? (resumeSessionId !== undefined && resumeSessionId !== null ? resumeSessionId : existingCmdSessionId) : null;
      const scopedPiSessionId = sessionScope ? `${convId}-${sessionScope}` : convId;
      let binToRun = useCmd ? resolveCmdBin() : PI_BIN;
      let cliArgs = [];

      if (useCmd) {
        cliArgs = buildCmdArgs(effectivePrompt, {
          resumeSessionId: activeResumeId,
        });
      } else {
        if (!fs.existsSync(binToRun)) {
          try {
            const { execSync } = await import("node:child_process");
            let w = "";
            try {
              w = execSync("which pi 2>/dev/null", { encoding: "utf8" }).trim();
            } catch (_) {}
            if (w && fs.existsSync(w)) {
              binToRun = w;
            } else {
              console.log("[Dispatcher] Pi CLI belum terpasang, menginstal otomatis...");
              if (ctx?.reply) {
                ctx.reply("⏳ *Menginstal binary Pi Coding Agent CLI di sistem...*\n_Mohon tunggu sebentar (hanya sekali saat pertama kali)..._", { parse_mode: "Markdown" }).catch(() => {});
              }
              execSync("npm install -g @earendil-works/pi-coding-agent 2>/dev/null || sudo npm install -g @earendil-works/pi-coding-agent 2>/dev/null || npm install @earendil-works/pi-coding-agent || true", { timeout: 180000 });
              try {
                const wAfter = execSync("which pi 2>/dev/null", { encoding: "utf8" }).trim();
                if (wAfter && fs.existsSync(wAfter)) binToRun = wAfter;
              } catch (_) {}
            }
          } catch (autoErr) {
            console.warn("[Dispatcher] Gagal auto-install Pi CLI:", autoErr.message);
          }
        }
        const piModel = modelOverride || userModel || await getUserPiModel(userId);
        cliArgs = [
          "--session-id",
          scopedPiSessionId,
          "--mode",
          "json",
          "-p",
          effectivePrompt,
          "--approve",
        ];
        if (piModel) {
          cliArgs.unshift("--provider", process.env.PI_PROVIDER || "local-pi", "--model", piModel);
        }
      }

      // Agent Telegram berjalan dengan environment penuh milik service agar dapat
      // memeriksa konfigurasi runtime dan secret lokal saat diminta developer.
      // Jangan kirim secret ke log atau chat kecuali developer memintanya secara eksplisit.
      const sanitizedEnv = { ...process.env };

      // Flag environment agar child process & tools (npm, git, apt, bash) berjalan non-interactive tanpa prompt
      sanitizedEnv.CI = "true";
      sanitizedEnv.NONINTERACTIVE = "1";
      sanitizedEnv.DEBIAN_FRONTEND = "noninteractive";
      sanitizedEnv.QUEUE_LENGTH = String(currentQueueLen);
      sanitizedEnv.HAS_PENDING_QUEUE = currentQueueLen > 0 ? "1" : "0";
      sanitizedEnv.QUEUE_STATUS_FILE = path.join(process.cwd(), "data", "queue-status.json");

      if (process.env.GROQ_API_KEY) {
        sanitizedEnv.GROQ_API_KEY = process.env.GROQ_API_KEY;
      }

      if (!useCmd) {
        const sanitized = await sanitizePiSession(executionCwd, scopedPiSessionId, {
          aggressive: contextRecoveryAttempted,
        }).catch(() => null);
        if (sanitized?.changed > 0) {
          console.warn(
            `[Dispatcher] Menyusutkan ${sanitized.changed} pesan raksasa di sesi Pi (${Math.round(sanitized.bytesBefore / 1024)}KB -> ${Math.round(sanitized.bytesAfter / 1024)}KB).`
          );
        }

        const repaired = await repairPiSession(executionCwd, scopedPiSessionId).catch(() => ({ repaired: 0, truncated: 0 }));
        if (repaired.repaired > 0 || repaired.truncated > 0) {
          console.warn(
            `[Dispatcher] Membersihkan sesi Pi sebelum eksekusi (kosong: ${repaired.repaired}, giliran gagal: ${repaired.truncated}).`
          );
        }
      }

      const child = spawn(binToRun, cliArgs, {
        cwd: executionCwd,
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
      let idleTimer;
      let hardTimer;
      let killTimer;
      const piParser = useCmd ? null : createPiEventParser();
      const cmdParser = useCmd ? createCmdEventParser() : null;

      const finish = async (error, code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        clearTimeout(killTimer);

        const engineLabel = useCmd ? "Command Code" : "Pi Coding Agent CLI";
        let responseText = stdout.trim();
        let jsonError = null;
        let cmdParsed = null;

        if (useCmd && cmdParser) {
          cmdParser.flush();
          cmdParsed = cmdParser.getResult();
          responseText = cmdParsed.text || "";
          jsonError = cmdParsed.error;
          if (cmdParsed.sessionId) {
            await setCmdSessionId(convId, executionCwd, cmdParsed.sessionId).catch(() => {});
          }
        } else if (piParser) {
          const parsedText = piParser.getText();
          jsonError = piParser.getError();
          if (parsedText) {
            responseText = parsedText;
          } else if (stdout.trim().startsWith("{")) {
            // Output JSON tanpa pesan assistant final (mis. proses terhenti)
            responseText = "";
          }
        }

        // Pemulihan context window: susutkan riwayat sesi lalu ulangi sekali.
        if (
          !useCmd &&
          !task.cancelled &&
          !contextRecoveryAttempted &&
          isContextOverflowMessage(`${jsonError || ""} ${stderr || ""}`)
        ) {
          console.warn("[Dispatcher] Sesi Pi melewati context window. Menyusutkan riwayat lalu mengulang permintaan...");
          const shrunk = await shrinkPiSessionForContext(executionCwd, scopedPiSessionId, { aggressive: true }).catch(() => null);
          if (shrunk) {
            console.warn(
              `[Dispatcher] Pemulihan konteks: ${shrunk.changed} pesan disusutkan, ${Math.round(shrunk.bytesBefore / 1024)}KB -> ${Math.round(shrunk.bytesAfter / 1024)}KB${shrunk.pruned ? `, ${shrunk.pruned} pesan lama dipangkas` : ""}.`
            );
          }
          return executeCli({
            continuationCount,
            freshRetryAttempted,
            accumulatedText,
            emptyRetryAttempted,
            fallbackAttempted,
            contextRecoveryAttempted: true,
            modelOverride,
          });
        }

        // Jika --resume sesi lama Command Code gagal karena sesi tidak ditemukan, bersihkan dan ulangi sesi baru 1x
        if (
          useCmd &&
          !task.cancelled &&
          activeResumeId &&
          !freshRetryAttempted &&
          continuationCount === 0 &&
          (jsonError || (code !== 0 && !responseText))
        ) {
          const combinedErr = `${jsonError || ""} ${stderr || ""}`.toLowerCase();
          if (
            combinedErr.includes("session") &&
            (combinedErr.includes("not found") || combinedErr.includes("no such") || combinedErr.includes("does not exist") || combinedErr.includes("invalid") || combinedErr.includes("unknown"))
          ) {
            console.warn(`[Dispatcher] Session Command Code ${activeResumeId} tidak ditemukan, memulai sesi baru...`);
            await clearCmdSessionId(convId, executionCwd).catch(() => {});
            existingCmdSessionId = null;
            return executeCli({
              promptOverride: null,
              resumeSessionId: "",
              continuationCount: 0,
              freshRetryAttempted: true,
              accumulatedText,
            });
          }
        }

        // Auto-continue Command Code jika mencapai --max-turns (exit code 8 / subtype max_turns) dan masih punya jatah lanjutan
        const hitMaxTurns = Boolean(
          useCmd &&
          !task.cancelled &&
          !task.timedOut &&
          (cmdParsed?.isMaxTurns || code === 8)
        );
        const maxContinuations = getCmdMaxContinuations();
        if (hitMaxTurns && cmdParsed?.sessionId && continuationCount < maxContinuations) {
          const nextCount = continuationCount + 1;
          const partialChunk = (cmdParsed.partialText || "").trim();
          const nextAccumulated = partialChunk
            ? (accumulatedText ? `${accumulatedText}\n\n${partialChunk}` : partialChunk)
            : accumulatedText;
          console.log(
            `[Dispatcher] Command Code mencapai max_turns (${getCmdMaxTurns()}), auto-resume sesi ${cmdParsed.sessionId} (lanjutan ${nextCount}/${maxContinuations})...`
          );
          return executeCli({
            promptOverride: "Lanjutkan pengerjaan tugas yang belum selesai sampai tuntas, lalu berikan ringkasan hasil akhirnya.",
            resumeSessionId: cmdParsed.sessionId,
            continuationCount: nextCount,
            freshRetryAttempted: true,
            accumulatedText: nextAccumulated,
          });
        }

        if (!useCmd && code === 0) {
          await markPiSessionStarted(convId, true, sessionScope);
        }

        clearInterval(typingInterval);

        if (accumulatedText && responseText) {
          responseText = `${accumulatedText}\n\n${responseText}`;
        } else if (accumulatedText && !responseText && !hitMaxTurns) {
          responseText = accumulatedText;
        }

        // Process autonomous tags (Memory & Skills) jika response ada
        if (responseText) {
          const { cleanedText } = await processAutonomousOutput(responseText);
          responseText = cleanedText;
        }

        // Wajib: verifikasi perubahan setelah task development selesai.
        deliveryResult = await finalizeDelivery({
          searchDir: executionCwd,
          baseline: deliveryBaseline,
          userMessage,
          queueLength: getQueueLength(),
        }).catch((err) => ({ repos: [], restartRequired: false, error: err.message }));
        const deliveryReport = formatDeliveryReport(deliveryResult);
        if (deliveryReport) {
          responseText = responseText ? `${responseText.trim()}\n\n${deliveryReport}` : deliveryReport;
        }

        const isEmptyPiResponse =
          !useCmd &&
          !task.cancelled &&
          !task.timedOut &&
          !error &&
          !jsonError &&
          code === 0 &&
          !responseText.trim();

        if (isEmptyPiResponse) {
          if (!emptyRetryAttempted) {
            const repaired = await repairPiSession(executionCwd, scopedPiSessionId).catch(() => ({ repaired: 0, truncated: 0 }));
            if (repaired.repaired > 0 || repaired.truncated > 0) {
              console.warn(
                `[Dispatcher] Pi membalas kosong. Membersihkan sesi (kosong: ${repaired.repaired}, giliran gagal: ${repaired.truncated}) lalu mengulang permintaan...`
              );
              return executeCli({
                continuationCount,
                freshRetryAttempted,
                accumulatedText,
                emptyRetryAttempted: true,
              });
            }
          }

          if (!fallbackAttempted) {
            const activeModel = modelOverride || userModel || process.env.PI_MODEL || DEFAULT_PI_MODEL;
            const isGroqModel =
              activeModel.startsWith("groq/") ||
              activeModel === "openai/gpt-oss-120b" ||
              activeModel === "llama-3.1-8b-instant";
            const fallbackModel = process.env.PI_FALLBACK_MODEL || "gemini-3.8-flash-tiered";
            if (!isGroqModel && fallbackModel && fallbackModel !== activeModel) {
              console.warn(
                `[Dispatcher] Model ${activeModel} terus membalas kosong. Beralih ke fallback ${fallbackModel}...`
              );
              return executeCli({
                continuationCount,
                freshRetryAttempted,
                accumulatedText,
                emptyRetryAttempted: true,
                fallbackAttempted: true,
                modelOverride: fallbackModel,
              });
            }
          }
        }

        const result = {
          taskId,
          userId,
          cancelled: task.cancelled,
          exitCode: code,
          signal,
          error: error?.message || jsonError || null,
          output: truncate(responseText || cmdParsed?.partialText || stdout.trim(), MAX_OUTPUT),
          stderr: truncate(stderr.trim(), 2500),
        };

        await appendLog(taskId, JSON.stringify(result, null, 2) + "\n");
        clearActiveTask(taskId);

        if (task.cancelled) {
          await ctx.reply("⚠️ Proses dihentikan.", buildReplyOptions(ctx));
          processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
          return;
        }

        const isTimedOut = Boolean(task.timedOut) || signal === "SIGTERM" || signal === "SIGKILL" || stderr.includes("print timeout") || stderr.includes("timed out");
        const hasError = error || jsonError || (code !== 0 && !responseText.trim()) || (!responseText.trim() && stderr.trim());

        if (hasError) {
          let errText = jsonError || stderr.trim() || error?.message || (code !== null ? `Exit code ${code}` : "");

          if (isTimedOut) {
            const elapsed = formatDurationShort(Date.now() - (task.startedAt || Date.now()));
            const partialText = cmdParser
              ? (cmdParsed?.partialText || "")
              : (piParser ? piParser.getText() : stdout.trim());
            const lastOutput = truncate(
              partialText.trim().split("\n").filter(Boolean).slice(-3).join("\n").replace(/```/g, "'''"),
              400
            );
            if (task.timeoutReason === "max") {
              errText = `⏱️ *Batas Maksimal Durasi Tugas Tercapai*\n\nTugas berjalan ~${elapsed} lalu dihentikan karena melewati batas maksimal (${formatDurationShort(MAX_TIMEOUT_MS)}).\n\n💡 Naikkan *Maks. Durasi Tugas* di Web UI → Izin & Batas Waktu, atau pecah instruksi menjadi beberapa langkah.`;
            } else {
              errText = `⏱️ *Tugas Dihentikan: Tidak Ada Aktivitas*\n\n${engineLabel} tidak mengeluarkan output selama ${formatDurationShort(TIMEOUT_MS)} (idle timeout). Total berjalan ~${elapsed}.\n\n💡 Naikkan *Idle Timeout* di Web UI → Izin & Batas Waktu jika tugas memang lama tanpa output (mis. install dependency besar).`;
            }
            if (lastOutput) {
              errText += `\n\n📄 *Output terakhir:*\n\`\`\`\n${lastOutput}\n\`\`\``;
            }
          } else if (hitMaxTurns) {
            const turnsPerRun = getCmdMaxTurns();
            const totalRuns = continuationCount + 1;
            const partialProgress = truncate((cmdParsed?.partialText || accumulatedText || "").trim(), 900);
            errText =
              `⚠️ *Batas Turn Command Code Tercapai (${turnsPerRun} turn × ${totalRuns} sesi)*\n\n` +
              `Tugas ini membutuhkan lebih banyak langkah/tool-call dari batas \`CMD_MAX_TURNS=${turnsPerRun}\`.\n` +
              (cmdParsed?.sessionId
                ? `💡 Balas \`lanjutkan\` untuk meneruskan sesi yang tersimpan, atau naikkan *Max Turns Command Code* di Web UI / \`.env\` (\`CMD_MAX_TURNS\`).`
                : `💡 Naikkan *Max Turns Command Code* di Web UI / \`.env\` (\`CMD_MAX_TURNS\`) atau pecah instruksi menjadi lebih spesifik.`);
            if (partialProgress) {
              errText += `\n\n📄 *Progres terakhir:*\n${partialProgress}`;
            }
          } else if (isContextOverflowMessage(errText)) {
            errText =
              `🧠 *Riwayat Percakapan Terlalu Panjang untuk Model Ini*\n\n` +
              `${engineLabel} sudah mencoba memadatkan riwayat otomatis, tetapi permintaan masih melebihi context window model \`${modelOverride || userModel || process.env.PI_MODEL || DEFAULT_PI_MODEL}\`.\n\n` +
              `💡 *Solusi:* pilih model dengan context window lebih besar via /model, mulai percakapan baru dengan /reset, atau pecah tugas menjadi bagian yang lebih kecil.`;
          } else if (errText.includes("permission that headless mode cannot prompt for") || errText.includes("permission")) {
            errText = `🔒 *Izin Akses File / Terminal Ditolak*\n\n${truncate(errText, 700)}\n\n💡 Pastikan Pi CLI dijalankan dengan flag \`--approve\`.`;
          } else if (errText.includes("ENOENT")) {
            const installHint = useCmd
              ? "Install Command Code CLI secara global:\n`npm install -g command-code` lalu `cmd login`"
              : "Install binary Pi CLI secara global:\n`npm install -g @earendil-works/pi-coding-agent`";
            errText = `❌ *Kendala Eksekusi Engine (${engineLabel})*\n\n${truncate(errText, 500)}\n\n💡 *Solusi:* ${installHint}`;
          } else {
            errText = `❌ Maaf, ${engineLabel} mengalami kendala:\n${truncate(errText, 1000)}`;
          }

          await ctx
            .reply(errText, buildReplyOptions(ctx, { parse_mode: "Markdown" }))
            .catch(() => ctx.reply(truncate(errText, 1000), buildReplyOptions(ctx)));
          processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
          return;
        }

        if (!responseText.trim()) {
          responseText = `ℹ️ ${engineLabel} telah selesai memproses instruksi, namun tidak ada teks balasan yang dihasilkan.`;
        }

        responseText = stripAnsi(responseText);
        const claimWarnings = detectUnverifiedClaims(responseText, deliveryResult);
        if (claimWarnings.length) {
          responseText += `\n\n⚠️ *Verifikasi Delivery:*\n• ${claimWarnings.join("\n• ")}`;
        }
        if (deliveryResult?.error) {
          responseText += `\n\n⚠️ Delivery check gagal: ${deliveryResult.error}`;
        }
        await sendSmartReply(ctx, responseText);

        // Kirim laporan dahulu, baru restart agar status Telegram tidak hilang.
        if (deliveryResult?.restartRequired) scheduleAgentRestart();

        // Lanjutkan antrean tugas berikutnya
        processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
      };

      const fireTimeout = (reason) => {
        if (settled || task.cancelled) return;
        task.timedOut = true;
        task.timeoutReason = reason;
        killProcessTree(child, "SIGTERM");
        killTimer = setTimeout(() => {
          if (!settled) killProcessTree(child, "SIGKILL");
        }, 5000);
        killTimer.unref();
      };

      // Timer hanya di-reset saat ada output. Tugas yang masih aktif bekerja
      // tidak akan dipotong hanya karena berjalan lama.
      const armIdleTimeout = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fireTimeout("idle"), TIMEOUT_MS);
      };
      armIdleTimeout();
      hardTimer = setTimeout(() => fireTimeout("max"), Math.max(MAX_TIMEOUT_MS, TIMEOUT_MS));

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (stdout.length > MAX_OUTPUT * 2) {
          stdout = stdout.slice(-MAX_OUTPUT * 2);
        }
        if (piParser) piParser.push(text);
        if (cmdParser) cmdParser.push(text);
        armIdleTimeout();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 5000) stderr = stderr.slice(-5000);
        armIdleTimeout();
      });

      child.on("error", (error) => finish(error, null, null));
      child.on("close", (code, signal) => finish(null, code, signal));
    };

    await executeCli();
  } catch (err) {
    clearInterval(typingInterval);
    clearActiveTask(taskId);
    await ctx.reply(`❌ Terjadi error: ${err.message}`, buildReplyOptions(ctx));
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
 * Entry point utama menerima pesan/file untuk TH Agent.
 * Mendukung concurrency per percakapan (chat + forum topic): chat berbeda
 * berjalan paralel, sedangkan pesan beruntun di percakapan yang sama diantrekan.
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

  const threadId = ctx.message?.message_thread_id || null;
  const conversationKey = buildConversationKey(ctx.chat?.id, threadId);
  const reserved = tryReserveConversation(conversationKey);
  let targetProject = null;

  try {
    targetProject = await detectTargetProject(userMessage, fileInfo);
    const maxConcurrent = MAX_CONCURRENT_TASKS; // Bisa diatur melalui MAX_CONCURRENT_TASKS
    const totalActive = getActiveTaskCount() + getActiveWorkers().length;
    const lockedProjects = getLockedProjects();
    const isTargetBusy = Boolean(targetProject && lockedProjects.has(targetProject));

    // Jalankan langsung jika percakapan ini bebas, proyeknya tidak dipakai
    // percakapan lain, dan kapasitas server masih tersedia.
    if (reserved && !isTargetBusy && totalActive < maxConcurrent) {
      await executeTaskInternal({ userMessage, ctx, fileInfo, targetProject });
      return;
    }
  } finally {
    if (reserved) releaseConversationReservation(conversationKey);
  }

  // Percakapan masih sibuk / proyek sama sedang dikerjakan / kapasitas penuh
  const queueItem = enqueueTask({ userMessage, ctx, fileInfo, targetProject });
  const position = getQueuePosition(queueItem.id);

  console.log(
    `[Queue] Tugas ${queueItem.id} masuk antrean senyap (#${position})${targetProject ? ` [${targetProject}]` : ""}`
  );

  processNextQueue().catch((err) => console.error("[Queue] Error next:", err));

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
  modelOverride = null,
  disableTools = false,
  signal = null,
}) {
  const actualConvId = convId || `auto-${randomUUID().slice(0, 8)}`;
  const useCmd = isCommandCodeEngine(engineOverride || getEngine());

  // Engine CLI tidak punya flag system prompt terpisah, jadi identitas sub-agent
  // dan aturan otonomi disatukan ke dalam prompt yang dikirim.
  const autonomy = await getAutonomyConfig();
  prompt = [
    systemPrompt ? systemPrompt.trim() : "",
    buildAutonomyDirective(autonomy.mode),
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Background agent juga mewarisi environment penuh service agar dapat menangani
  // tugas konfigurasi/secret yang diotorisasi developer.
  const sanitizedEnv = { ...process.env };

  // Flag environment agar child process & tools (npm, git, apt, bash) berjalan non-interactive tanpa prompt
  sanitizedEnv.CI = "true";
  sanitizedEnv.NONINTERACTIVE = "1";
  sanitizedEnv.DEBIAN_FRONTEND = "noninteractive";

  if (process.env.GITHUB_TOKEN) {
    sanitizedEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.GROQ_API_KEY) {
    sanitizedEnv.GROQ_API_KEY = process.env.GROQ_API_KEY;
  }

  let safeCwd = cwd || process.cwd();
  try {
    if (!fs.existsSync(safeCwd)) {
      await mkdir(safeCwd, { recursive: true });
    }
  } catch (_) {
    safeCwd = fs.existsSync(PROJECTS_DIR) ? PROJECTS_DIR : process.cwd();
  }
  if (!fs.existsSync(safeCwd)) {
    safeCwd = process.cwd();
  }

  if (useCmd) {
    const binToRun = resolveCmdBin();
    const maxContinuations = Math.min(2, getCmdMaxContinuations());
    let currentPrompt = prompt;
    let resumeSessionId = null;
    let accumulatedOutput = "";

    for (let attempt = 0; attempt <= maxContinuations; attempt++) {
      const cliArgs = buildCmdArgs(currentPrompt, { resumeSessionId });
      const cmdParser = createCmdEventParser();
      const res = await runProcess({
        command: binToRun,
        args: cliArgs,
        cwd: safeCwd,
        timeoutMs,
        env: sanitizedEnv,
        signal,
        onSpawn,
        onStdout: (chunk) => cmdParser.push(chunk),
      });

      cmdParser.flush();
      const parsed = cmdParser.getResult();
      const hitMaxTurns = !res.timedOut && !res.cancelled && (parsed.isMaxTurns || res.code === 8);

      if (hitMaxTurns && parsed.sessionId && attempt < maxContinuations) {
        if (parsed.partialText) {
          accumulatedOutput = accumulatedOutput
            ? `${accumulatedOutput}\n\n${parsed.partialText}`
            : parsed.partialText;
        }
        resumeSessionId = parsed.sessionId;
        currentPrompt = "Lanjutkan pengerjaan tugas yang belum selesai sampai tuntas, lalu berikan ringkasan hasilnya.";
        continue;
      }

      if (parsed.error) {
        if (hitMaxTurns) {
          const hint = `Command Code mencapai batas ${getCmdMaxTurns()} turn (${attempt + 1} sesi). Naikkan CMD_MAX_TURNS jika tugas sangat panjang.`;
          throw new Error(parsed.partialText ? `${hint}\n\nProgres terakhir:\n${truncate(parsed.partialText, 600)}` : hint);
        }
        throw new Error(parsed.error);
      }

      const finalOut = [accumulatedOutput, parsed.text || res.stdout || ""].filter(Boolean).join("\n\n").trim();
      if (res.code === 0 || finalOut.length > 0) {
        return { ok: true, output: finalOut, sessionId: parsed.sessionId, usage: parsed.usage || null };
      }

      const errMsg = res.stderr || res.stdout || `CLI exit code ${res.code}`;
      throw new Error(`Eksekusi Command Code gagal: ${errMsg}`);
    }
  }

  const binToRun = PI_BIN;
  const piModel = modelOverride || (userId ? await getUserPiModel(userId) : (process.env.PI_MODEL || DEFAULT_PI_MODEL));
  const buildPiArgs = (promptText, modelId = piModel) => {
    const args = ["--mode", "json", "-p", promptText, "--approve"];
    if (disableTools) args.push("--no-session", "--no-tools", "--no-mcp", "--no-extensions", "--no-skills", "--no-prompt-templates");
    else args.unshift("--session-id", actualConvId);
    if (modelId) {
      const isGroqModel =
        modelId === "openai/gpt-oss-120b" ||
        modelId === "llama-3.1-8b-instant" ||
        modelId.startsWith("groq/");

      if (isGroqModel) {
        args.unshift("--provider", "groq", "--model", modelId.replace(/^groq\//, ""));
      } else {
        args.unshift("--provider", process.env.PI_PROVIDER || "local-pi", "--model", modelId);
      }
    }
    return args;
  };

  await sanitizePiSession(safeCwd, actualConvId).catch(() => {});
  await repairPiSession(safeCwd, actualConvId).catch(() => {});

  let piParser = createPiEventParser();
  let res = await runProcess({
    command: binToRun,
    args: buildPiArgs(prompt),
    cwd: safeCwd,
    timeoutMs,
    env: sanitizedEnv,
    signal,
    onSpawn,
    onStdout: (chunk) => piParser.push(chunk),
  });

  if (isContextOverflowMessage(piParser.getError())) {
    console.warn("[Dispatcher] Subagent Pi melewati context window. Menyusutkan riwayat lalu mengulang...");
    await shrinkPiSessionForContext(safeCwd, actualConvId, { aggressive: true }).catch(() => null);
    piParser = createPiEventParser();
    res = await runProcess({
      command: binToRun,
      args: buildPiArgs(prompt),
      cwd: safeCwd,
      timeoutMs,
      env: sanitizedEnv,
      signal,
      onSpawn,
      onStdout: (chunk) => piParser.push(chunk),
    });
  }

  const isEmptyPiOutput = () =>
    res.code === 0 && !res.timedOut && !res.cancelled && !piParser.getText() && !piParser.getError();

  if (isEmptyPiOutput()) {
    const repaired = await repairPiSession(safeCwd, actualConvId).catch(() => ({ repaired: 0, truncated: 0 }));
    if (repaired.repaired > 0 || repaired.truncated > 0) {
      console.warn(
        `[Dispatcher] Subagent Pi membalas kosong. Membersihkan sesi (kosong: ${repaired.repaired}, giliran gagal: ${repaired.truncated}) lalu mengulang permintaan...`
      );
      piParser = createPiEventParser();
      res = await runProcess({
        command: binToRun,
        args: buildPiArgs(prompt),
        cwd: safeCwd,
        timeoutMs,
        env: sanitizedEnv,
        signal,
        onSpawn,
        onStdout: (chunk) => piParser.push(chunk),
      });
    }
  }

  if (isEmptyPiOutput() && !modelOverride && piModel && !piModel.startsWith("groq/")) {
    const fallbackModel = process.env.PI_FALLBACK_MODEL || "gemini-3.8-flash-tiered";
    if (fallbackModel && fallbackModel !== piModel) {
      console.warn(`[Dispatcher] Subagent Pi terus membalas kosong. Beralih ke fallback ${fallbackModel}...`);
      piParser = createPiEventParser();
      res = await runProcess({
        command: binToRun,
        args: buildPiArgs(prompt, fallbackModel),
        cwd: safeCwd,
        timeoutMs,
        env: sanitizedEnv,
        signal,
        onSpawn,
        onStdout: (chunk) => piParser.push(chunk),
      });
    }
  }

  if (piParser) {
    const text = piParser.getText();
    const parserError = piParser.getError();
    if (text) {
      return { ok: true, output: text };
    }
    if (parserError) {
      throw new Error(parserError);
    }
  }

  if (res.code === 0 && res.stdout) {
    return { ok: true, output: res.stdout };
  }

  // Jika ada output dari CLI meskipun exit non-nol (misal warning)
  if (res.stdout && res.stdout.length > 50) {
    return { ok: true, output: res.stdout };
  }

  const errMsg = res.stderr || res.stdout || `CLI exit code ${res.code}`;
  throw new Error(`Eksekusi Agent CLI gagal: ${errMsg}`);
}

