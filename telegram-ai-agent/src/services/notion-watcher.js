import path from "node:path";
import { PROJECTS_DIR } from "../config/env.js";
import { getActiveTask } from "./cli-runner.js";
import { runAgentAutonomous } from "../bot/dispatcher.js";
import { notifyUsers } from "./github-watcher.js";
import {
  getNotionConfig,
  fetchPendingTasks,
  updateTaskStatus,
} from "./notion-service.js";

let watcherInterval = null;
let isChecking = false;

export async function checkNotionTasks(bot, specificChatId = null, isManual = false) {
  if (isChecking) {
    if (specificChatId) {
      await bot.api.sendMessage(specificChatId, "⏳ Pengecekan task Notion sedang berlangsung...");
    }
    return;
  }

  const activeTask = getActiveTask();
  if (activeTask) {
    // Sedang ada task aktif di terminal/AI, tunda eksekusi otomatis
    return;
  }

  isChecking = true;
  try {
    const config = await getNotionConfig();
    if (!config.enabled && !isManual) return;

    const pendingTasks = await fetchPendingTasks();
    if (pendingTasks.length === 0) {
      if (isManual && specificChatId) {
        await bot.api.sendMessage(
          specificChatId,
          "✅ Tidak ada kartu *TODO* yang menunggu di database Notion.",
          { parse_mode: "Markdown" }
        );
      }
      return;
    }

    // Ambil task pertama yang antre
    const task = pendingTasks[0];
    const projectDir = path.join(PROJECTS_DIR, task.projectName);

    // 1. Notifikasi ke Telegram
    const startMsg =
      `📋 *[Notion Auto-Task Ditemukan]*\n\n` +
      `📦 *Proyek:* \`${task.projectName}\`\n` +
      `🎯 *Task:* *${task.title}*\n` +
      `⚡ *Prioritas:* \`${task.priority}\`\n` +
      (task.details ? `📝 *Catatan Tambahan:*\n_${task.details.slice(0, 300)}_\n\n` : "\n") +
      `⏳ _Memulai pengerjaan otomatis sekarang..._`;

    await notifyUsers(bot, startMsg, specificChatId);

    // 2. Tandai status di Notion jadi 'In progress'
    await updateTaskStatus(task.pageId, "In progress");

    // 3. Susun prompt untuk Autonomous Agent
    const prompt = `
Kamu adalah TH Agent, asisten software engineer senior otonom.
Bos telah menambahkan tugas baru dari Notion untuk proyek: ${task.projectName}.

TUGAS:
${task.title}

DETAIL & CATATAN DARI NOTION:
${task.details || "(Tidak ada catatan tambahan)"}

PANDUAN EKSEKUSI OTONOM:
1. Periksa kode yang relevan di direktori proyek ini (${projectDir}).
2. Lakukan koding, perbaikan bug, atau penambahan fitur yang diminta sampai tuntas.
3. Jalankan testing atau pengecekan jika diperlukan.
4. Di akhir, berikan laporan hasil eksekusi (report) yang ringkas, padat, dan to-the-point mengenai apa yang telah diubah dan status akhirnya.
`.trim();

    // 4. Jalankan AI Agent otonom
    const result = await runAgentAutonomous({
      prompt,
      cwd: projectDir,
    });

    const outputText = result.output || "Tugas berhasil diselesaikan oleh TH Agent.";

    // 5. Update status di Notion jadi 'Done' + sertakan laporan
    await updateTaskStatus(task.pageId, "Done", outputText);

    // 6. Kirim laporan akhir ke Telegram
    const finishMsg =
      `✅ *[Notion Task Selesai]*\n\n` +
      `📦 *Proyek:* \`${task.projectName}\`\n` +
      `🎯 *Task:* *${task.title}*\n\n` +
      `📋 *Laporan Hasil:*\n${outputText.slice(0, 1500)}\n\n` +
      `🔗 [Buka di Notion](${task.url})`;

    await notifyUsers(bot, finishMsg, specificChatId);
  } catch (err) {
    console.error("[Notion Watcher] Error eksekusi task:", err.message);
    if (specificChatId) {
      await bot.api.sendMessage(
        specificChatId,
        `❌ Kendala eksekusi task Notion: ${err.message}`
      );
    }
  } finally {
    isChecking = false;
  }
}

export function initNotionWatcher(bot) {
  if (watcherInterval) clearInterval(watcherInterval);

  getNotionConfig().then((cfg) => {
    const intervalMinutes = cfg.checkIntervalMinutes || 3;
    console.log(`[Notion Watcher] Aktif - interval ${intervalMinutes} menit.`);

    // Delay awal 30 detik setelah startup
    setTimeout(() => {
      checkNotionTasks(bot).catch((err) =>
        console.warn("[Notion Watcher] Initial check error:", err.message)
      );
    }, 30000);

    watcherInterval = setInterval(() => {
      checkNotionTasks(bot).catch((err) =>
        console.warn("[Notion Watcher] Interval check error:", err.message)
      );
    }, intervalMinutes * 60 * 1000);
  });
}

export function stopNotionWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}
