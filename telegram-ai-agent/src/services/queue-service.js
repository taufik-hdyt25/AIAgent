import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, MAX_CONCURRENT_TASKS } from "../config/env.js";
import { truncate } from "./telegram-files.js";
import {
  buildConversationKey,
  getActiveTaskCount,
  getActiveWorkers,
  getLockedProjects,
  getReservedConversationCount,
  isConversationBusy,
  releaseConversationReservation,
  tryReserveConversation,
} from "./cli-runner.js";

// Antrean tugas AI yang menunggu giliran eksekusi (FIFO Queue)
const taskQueue = [];
let isPaused = false;
let executorFn = null;
const deferredProjects = new Set();

const QUEUE_STATUS_FILE = path.join(DATA_DIR, "queue-status.json");

/**
 * Menandai sebuah proyek memiliki perubahan tertunda yang belum dibuild/deploy
 */
export function markProjectDeferred(projectName) {
  if (projectName) {
    deferredProjects.add(projectName);
    syncQueueStatusToFile().catch(() => {});
  }
}

/**
 * Menghapus proyek dari daftar build/deploy tertunda setelah berhasil dideploy
 */
export function clearDeferredProjects(projectName = null) {
  if (projectName) {
    deferredProjects.delete(projectName);
  } else {
    deferredProjects.clear();
  }
  syncQueueStatusToFile().catch(() => {});
}

/**
 * Mendapatkan daftar nama proyek yang tertunda dibuild/deploy
 */
export function getDeferredProjects() {
  return Array.from(deferredProjects);
}

/**
 * Menyimpan status antrean saat ini ke data/queue-status.json
 * agar proses build/deploy di semua proyek dapat mendeteksi apakah antrean sedang sibuk.
 */
export async function syncQueueStatusToFile() {
  try {
    const qLen = taskQueue.length;
    const statusData = {
      queueLength: qLen,
      hasPending: qLen > 0,
      shouldBuildAndDeploy: qLen === 0,
      deferredProjects: Array.from(deferredProjects),
      updatedAt: new Date().toISOString(),
      queue: taskQueue.map((item, index) => ({
        position: index + 1,
        id: item.id,
        preview: item.preview,
        targetProject: item.targetProject || null,
        username: item.username,
        enqueuedAt: item.enqueuedAt,
      })),
    };
    await writeFile(QUEUE_STATUS_FILE, JSON.stringify(statusData, null, 2), "utf8");
  } catch (_) {}
}

// Inisialisasi awal file status antrean
syncQueueStatusToFile().catch(() => {});

/**
 * Mendaftarkan fungsi eksekutor utama (sendToAgentInternal / executeTask)
 * Signature: async (queueItem) => void
 */
export function registerQueueExecutor(fn) {
  executorFn = fn;
}

/**
 * Menambahkan instruksi baru ke dalam antrean
 */
export function enqueueTask({ userMessage, ctx, fileInfo = null, targetProject = null }) {
  // Generate ID antrean yang mudah dibaca, contoh: Q-1042
  const qId = `Q-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
  const threadId = ctx.message?.message_thread_id || null;
  const item = {
    id: qId,
    userMessage,
    ctx,
    fileInfo,
    targetProject: targetProject || null,
    conversationKey: buildConversationKey(ctx.chat?.id, threadId),
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    threadId,
    username: ctx.from?.username || ctx.from?.first_name || "User",
    messageId: ctx.message?.message_id,
    preview: truncate(userMessage, 120),
    enqueuedAt: Date.now(),
  };

  taskQueue.push(item);
  syncQueueStatusToFile().catch(() => {});
  return item;
}

/**
 * Mendapatkan nomor urutan antrean saat ini (1-indexed)
 */
export function getQueuePosition(id) {
  const index = taskQueue.findIndex((it) => it.id === id);
  return index === -1 ? null : index + 1;
}

/**
 * Mendapatkan daftar antrean saat ini (shallow copy untuk dibaca/ditampilkan)
 */
export function getQueue() {
  return taskQueue.map((item, index) => ({
    position: index + 1,
    id: item.id,
    userMessage: item.userMessage,
    preview: item.preview,
    targetProject: item.targetProject || null,
    userId: item.userId,
    chatId: item.chatId,
    username: item.username,
    enqueuedAt: item.enqueuedAt,
    hasFile: Boolean(item.fileInfo),
    fileName: item.fileInfo?.fileName || null,
  }));
}

/**
 * Mendapatkan jumlah tugas yang sedang mengantre
 */
export function getQueueLength() {
  return taskQueue.length;
}

/**
 * Mengosongkan seluruh antrean
 */
export function clearQueue() {
  const count = taskQueue.length;
  taskQueue.length = 0;
  isPaused = false;
  syncQueueStatusToFile().catch(() => {});
  return count;
}

/**
 * Menghapus tugas tertentu dari antrean berdasarkan ID
 */
export function removeQueueItem(id) {
  const index = taskQueue.findIndex((it) => it.id === id);
  if (index !== -1) {
    const [removed] = taskQueue.splice(index, 1);
    syncQueueStatusToFile().catch(() => {});
    return removed;
  }
  return null;
}

/**
 * Mengecek apakah antrean sedang di-pause (misal setelah /cancel)
 */
export function isQueuePaused() {
  return isPaused;
}

/**
 * Mem-pause pemrosesan antrean otomatis
 */
export function pauseQueue() {
  isPaused = true;
}

/**
 * Melanjutkan pemrosesan antrean otomatis
 */
export function resumeQueue() {
  isPaused = false;
  return processNextQueue();
}

/**
 * Memproses antrean: satu tugas per percakapan, percakapan berbeda boleh
 * berjalan paralel (dibatasi kapasitas global).
 */
export async function processNextQueue() {
  if (isPaused) {
    return false;
  }
  if (taskQueue.length === 0) {
    return false;
  }
  if (typeof executorFn !== "function") {
    console.warn("[Queue Service] Belum ada queue executor yang terdaftar.");
    return false;
  }

  const maxConcurrent = MAX_CONCURRENT_TASKS;
  let startedAny = false;

  for (let i = 0; i < taskQueue.length; ) {
    const totalActive =
      getActiveTaskCount() + getActiveWorkers().length + getReservedConversationCount();
    if (totalActive >= maxConcurrent) break;

    const item = taskQueue[i];
    const conversationKey = item.conversationKey || buildConversationKey(item.chatId, item.threadId);
    const lockedProjects = getLockedProjects();
    const conversationBusy = isConversationBusy(conversationKey);
    const projectBusy = Boolean(item.targetProject && lockedProjects.has(item.targetProject));

    if (conversationBusy || projectBusy || !tryReserveConversation(conversationKey)) {
      i++;
      continue;
    }

    taskQueue.splice(i, 1);
    syncQueueStatusToFile().catch(() => {});
    startedAny = true;

    Promise.resolve()
      .then(() => executorFn(item))
      .catch((err) => console.error("[Queue Service] Error saat memproses antrean:", err))
      .finally(() => {
        releaseConversationReservation(conversationKey);
        processNextQueue().catch(() => {});
      });
    // Array bergeser: periksa item berikutnya pada indeks yang sama.
  }

  return startedAny;
}
