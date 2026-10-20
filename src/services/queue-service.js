import { getActiveTask } from "./cli-runner.js";
import { truncate } from "./telegram-files.js";

// Antrean tugas AI yang menunggu giliran eksekusi (FIFO Queue)
const taskQueue = [];
let isPaused = false;
let executorFn = null;
let isProcessing = false;

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
export function enqueueTask({ userMessage, ctx, fileInfo = null }) {
  // Generate ID antrean yang mudah dibaca, contoh: Q-1042
  const qId = `Q-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
  const item = {
    id: qId,
    userMessage,
    ctx,
    fileInfo,
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    username: ctx.from?.username || ctx.from?.first_name || "User",
    messageId: ctx.message?.message_id,
    preview: truncate(userMessage, 120),
    enqueuedAt: Date.now(),
  };

  taskQueue.push(item);
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
  return count;
}

/**
 * Menghapus tugas tertentu dari antrean berdasarkan ID
 */
export function removeQueueItem(id) {
  const index = taskQueue.findIndex((it) => it.id === id);
  if (index !== -1) {
    const [removed] = taskQueue.splice(index, 1);
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
 * Memproses instruksi berikutnya dari antrean jika AI sedang idle
 */
export async function processNextQueue() {
  if (isPaused) {
    return false;
  }
  if (getActiveTask()) {
    return false;
  }
  if (taskQueue.length === 0) {
    return false;
  }
  if (isProcessing) {
    return false;
  }
  if (typeof executorFn !== "function") {
    console.warn("[Queue Service] Belum ada queue executor yang terdaftar.");
    return false;
  }

  isProcessing = true;
  const nextItem = taskQueue.shift();
  if (!nextItem) {
    isProcessing = false;
    return false;
  }

  // Kirim notifikasi ke Telegram bahwa antrean ini sekarang mulai dieksekusi
  try {
    if (nextItem.ctx?.chat?.id) {
      const remaining = taskQueue.length;
      const remainingText =
        remaining > 0 ? `\n_(${remaining} instruksi lain masih menunggu di antrean)_` : "";

      await nextItem.ctx
        .reply(
          `▶️ *Memulai Eksekusi Antrean* (ID: \`${nextItem.id}\`)${remainingText}\n\n` +
            `💬 _"${truncate(nextItem.userMessage, 120)}"_${
              nextItem.fileInfo ? `\n📎 *File:* \`${nextItem.fileInfo.fileName}\`` : ""
            }`,
          { parse_mode: "Markdown" }
        )
        .catch(() => {});
    }
  } catch (_) {}

  // Lepaskan flag lock sebelum memanggil executorFn agar pemanggilan berikutnya tidak terhalang
  isProcessing = false;

  try {
    await executorFn(nextItem);
    return true;
  } catch (err) {
    console.error("[Queue Service] Error saat memproses antrean:", err);
    if (!getActiveTask()) {
      setTimeout(() => {
        processNextQueue().catch(() => {});
      }, 500);
    }
    return false;
  }
}
