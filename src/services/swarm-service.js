import { randomUUID } from "node:crypto";
import {
  setActiveTask,
  clearActiveTask,
  getActiveTask,
  registerWorker,
  unregisterWorker,
  getActiveWorkers,
  killAllWorkers,
} from "./cli-runner.js";
import { runAgentAutonomous, processAutonomousOutput } from "../bot/dispatcher.js";
import { searchMemories, formatMemoriesForPrompt } from "./memory-service.js";
import { findMatchingSkills, formatSkillsForPrompt } from "./skill-service.js";
import { processNextQueue } from "./queue-service.js";
import { truncate } from "./telegram-files.js";
import { IS_PI } from "../config/env.js";

export const WORKER_PROFILES = [
  { name: "Alpha", emoji: "🐺", label: "Worker 1" },
  { name: "Beta", emoji: "⚡", label: "Worker 2" },
  { name: "Gamma", emoji: "🛡️", label: "Worker 3" },
  { name: "Delta", emoji: "🚀", label: "Worker 4" },
  { name: "Omega", emoji: "🎯", label: "Worker 5" },
];

const MAX_SWARM_WORKERS = 4;

/**
 * Mendekomposisi pesan instruksi menjadi beberapa tugas independen
 */
export function decomposeTasks(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  let text = rawText
    .replace(/^\/(swarm|parallel|multitask)(@\w+)?\s*/i, "")
    .replace(/^(kerjakan secara paralel|jalankan bersamaan|bagi tugas|multi task):\s*/i, "")
    .trim();

  // 1. Pemisahan menggunakan karakter pipa "|"
  if (text.includes("|")) {
    const parts = text
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p.length > 2);
    if (parts.length >= 2) {
      return parts.slice(0, MAX_SWARM_WORKERS).map((p, i) => ({
        id: `task-${i + 1}`,
        index: i,
        title: truncate(p.split("\n")[0], 60),
        instruction: p,
      }));
    }
  }

  // 2. Pemisahan berdasarkan baris bernomor atau bullet point
  // Contoh:
  // 1. Cek container podcast
  // 2. Periksa disk space
  // 3. Analisis issue github
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const taskLines = [];

  const itemRegex = /^(?:[0-9]+[\.\)]|[-*•]|\b(?:tugas|task|step)\s*[0-9]+:?)\s*(.+)$/i;

  for (const line of lines) {
    const match = line.match(itemRegex);
    if (match) {
      taskLines.push(match[1].trim());
    } else if (taskLines.length > 0) {
      // Baris lanjutan dari task sebelumnya
      taskLines[taskLines.length - 1] += `\n${line}`;
    }
  }

  if (taskLines.length >= 2) {
    return taskLines.slice(0, MAX_SWARM_WORKERS).map((p, i) => ({
      id: `task-${i + 1}`,
      index: i,
      title: truncate(p.split("\n")[0], 60),
      instruction: p,
    }));
  }

  return null;
}

/**
 * Mengecek apakah input pengguna merupakan permintaan multi-task / swarm
 */
export function isMultiTaskRequest(rawText) {
  if (!rawText || typeof rawText !== "string") return false;

  const trimmed = rawText.trim();
  if (/^\/(swarm|parallel|multitask)(@\w+)?/i.test(trimmed)) {
    return true;
  }

  if (/^(kerjakan secara paralel|jalankan bersamaan|bagi tugas ke sub-agent|multi task):/i.test(trimmed)) {
    return true;
  }

  const tasks = decomposeTasks(rawText);
  return Boolean(tasks && tasks.length >= 2);
}

/**
 * Eksekusi Multi-Agent Swarm secara paralel
 */
export async function executeSwarm({
  userMessage,
  ctx,
  tasks = null,
  fileInfo = null,
  userId = null,
  engine = null,
}) {
  const actualUserId = userId || ctx.from?.id;
  const parsedTasks = tasks || decomposeTasks(userMessage);

  if (!parsedTasks || parsedTasks.length === 0) {
    await ctx.reply("⚠️ Tidak dapat mendeteksi daftar tugas multi-agent. Gunakan format:\n`/swarm Tugas 1 | Tugas 2 | Tugas 3`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const swarmId = `SWARM-${Date.now().toString().slice(-4)}`;
  const startTime = Date.now();

  const workerStates = parsedTasks.map((t, idx) => {
    const profile = WORKER_PROFILES[idx % WORKER_PROFILES.length];
    return {
      id: `w-${idx + 1}`,
      index: idx,
      name: profile.name,
      emoji: profile.emoji,
      task: t,
      status: "running", // running, success, error
      startedAt: Date.now(),
      finishedAt: null,
      output: null,
      error: null,
    };
  });

  // Daftarkan task utama sebagai Swarm aktif
  setActiveTask({
    id: swarmId,
    startedAt: startTime,
    preview: `🐝 Swarm (${workerStates.length} Sub-Agents)`,
    userId: actualUserId,
    chatId: ctx.chat?.id,
    isSwarm: true,
  });

  // Kirim status awal ke Telegram
  const buildStatusText = () => {
    let msg = `🐝 *Multi-Agent Swarm Diaktifkan!* (\`${swarmId}\`)\n`;
    msg += `Lead Orchestrator (TH Agent) mendelegasikan *${workerStates.length} tugas* ke Sub-Agent:\n\n`;

    for (const w of workerStates) {
      let icon = "⏳";
      let statusLabel = "(Sedang memproses...)";
      if (w.status === "success") {
        const sec = Math.round((w.finishedAt - w.startedAt) / 1000);
        icon = "✅";
        statusLabel = `*[SELESAI ${sec}s]*`;
      } else if (w.status === "error") {
        icon = "❌";
        statusLabel = "*[ERROR]*";
      }

      msg += `${icon} *[Agent-${w.index + 1}: ${w.name} ${w.emoji}]*\n`;
      msg += `   📌 _"${truncate(w.task.title, 55)}"_\n`;
      msg += `   Status: ${statusLabel}\n\n`;
    }

    msg += `⏱ _Sub-agent bekerja secara independen & paralel di server._`;
    return msg;
  };

  let dashboardMsg = null;
  try {
    dashboardMsg = await ctx.reply(buildStatusText(), { parse_mode: "Markdown" });
  } catch {
    dashboardMsg = await ctx.reply(buildStatusText());
  }

  // Throttled dashboard updater untuk menghindari Telegram 429
  let lastUpdate = 0;
  const updateDashboard = async (force = false) => {
    const now = Date.now();
    if (!dashboardMsg || (!force && now - lastUpdate < 2500)) return;
    lastUpdate = now;
    try {
      await ctx.api.editMessageText(ctx.chat.id, dashboardMsg.message_id, buildStatusText(), {
        parse_mode: "Markdown",
      });
    } catch (_) {}
  };

  // Jalankan seluruh worker secara paralel
  const workerPromises = workerStates.map(async (worker) => {
    const workerTag = `Agent-${worker.index + 1} (${worker.name})`;
    const workerConvId = `${swarmId.toLowerCase()}-${worker.name.toLowerCase()}`;

    try {
      // 1. Retrieval memory & skill khusus tugas worker ini
      const [memories, skills] = await Promise.all([
        searchMemories(worker.task.instruction, { limit: 2, minScore: 0.2 }).catch(() => []),
        findMatchingSkills(worker.task.instruction, { limit: 2, minScore: 0.25 }).catch(() => []),
      ]);

      const memPrompt = formatMemoriesForPrompt(memories);
      const skillPrompt = formatSkillsForPrompt(skills);

      let fileContext = "";
      if (fileInfo) {
        fileContext = `\nLampiran File: ${fileInfo.fileName} (${fileInfo.relativePath})\n`;
      }

      const workerPrompt = `
TUGAS KHUSUS KAMU:
${worker.task.instruction}
${fileContext}${memPrompt ? `\n${memPrompt}\n` : ""}${skillPrompt ? `\n${skillPrompt}\n` : ""}
PANDUAN EKSEKUSI OTONOM:
1. Kamu fokus 100% menyelesaikan HANYA tugas spesifik kamu di atas.
2. Gunakan tools terminal, git, dan manajemen file server secara nyata (Zero-Confirmation).
${IS_PI ? "3. Aturan Sandbox Intiva (Khusus Raspberry Pi): Seluruh pengerjaan dan eksekusi proyek coding dibatasi HANYA di dalam folder './projects/intiva/'. Dilarang mengeksekusi di luar folder tersebut." : "3. Akses Penuh: Kamu memiliki akses penuh ke seluruh proyek di './projects/'."}
4. Setelah selesai, berikan laporan hasil eksekusi yang jelas, ringkas, terstruktur, dan to the point.
`.trim();

      const systemPrompt = `Kamu adalah Sub-Agent ${worker.name} (${worker.emoji}) yang bekerja di bawah TH Agent (Lead Orchestrator).
Kamu memiliki AKSES PENUH ke tools mandiri server (terminal shell, file system, docker, git).
Eksekusi tugas khususmu secara nyata, tuntas, dan berikan laporan ringkas.`;

      const res = await runAgentAutonomous({
        prompt: workerPrompt,
        convId: workerConvId,
        userId: actualUserId,
        systemPrompt,
        engineOverride: engine,
        onSpawn: (child) => {
          registerWorker(worker.id, {
            process: child,
            name: worker.name,
            title: worker.task.title,
          });
        },
      });

      unregisterWorker(worker.id);
      worker.finishedAt = Date.now();
      worker.status = "success";

      // Ekstraksi tag otonom jika worker menyimpan memori / skill
      const processed = await processAutonomousOutput(res.output || "");
      worker.output = processed.cleanedText || "Tugas berhasil diselesaikan.";

      await updateDashboard();
    } catch (err) {
      unregisterWorker(worker.id);
      worker.finishedAt = Date.now();
      worker.status = "error";
      worker.error = err.message;
      worker.output = `❌ Terjadi kendala saat eksekusi: ${err.message}`;
      await updateDashboard();
    }
  });

  // Tunggu semua worker selesai
  await Promise.allSettled(workerPromises);
  await updateDashboard(true);

  clearActiveTask(swarmId);
  const totalDurationSec = Math.round((Date.now() - startTime) / 1000);

  // Buat laporan akhir teragregasi
  let headerReport = `🏁 *Laporan Eksekusi Multi-Agent Swarm Selesai*\n`;
  headerReport += `⏱ *Total Waktu:* ${totalDurationSec} detik | 🤖 *Worker Aktif:* ${workerStates.length} Sub-Agent\n\n`;

  // Cek apakah output gabungan muat dalam 1 pesan Telegram (maks 3800 char)
  let combinedReport = headerReport;
  for (const w of workerStates) {
    combinedReport += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    combinedReport += `${w.emoji} *[Agent-${w.index + 1}: ${w.name}]* — _${w.task.title}_\n\n`;
    combinedReport += `${w.output}\n\n`;
  }
  combinedReport += `🎯 *Rangkuman Lead Orchestrator:*\n`;
  combinedReport += `Semua ${workerStates.length} sub-agent telah menyelesaikan pekerjaannya secara paralel.`;

  if (combinedReport.length <= 3800) {
    try {
      await ctx.reply(combinedReport, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(combinedReport);
    }
  } else {
    // Jika output terlalu panjang, kirim header lalu kirim laporan per worker agar rapi dan tidak terpotong
    try {
      await ctx.reply(headerReport, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(headerReport);
    }

    for (const w of workerStates) {
      let workerMsg = `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      workerMsg += `${w.emoji} *[Agent-${w.index + 1}: ${w.name}]* — _${w.task.title}_\n\n`;
      workerMsg += `${w.output}`;
      try {
        await ctx.reply(truncate(workerMsg, 3800), { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(truncate(workerMsg, 3800));
      }
    }

    await ctx.reply(`🎯 *Semua ${workerStates.length} sub-agent selesai bekerja secara paralel.*`);
  }

  // Lanjutkan antrean tugas berikutnya
  processNextQueue().catch((err) => console.error("[Queue] Error next:", err));
}
