import { writeFile } from "node:fs/promises";
import path from "node:path";
import { BOT_TOKEN, UPLOADS_DIR } from "../config/env.js";

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Menghapus ANSI escape sequences (warna terminal, cursor controls, spinner codes)
 */
export function stripAnsi(str) {
  if (!str || typeof str !== "string") return "";
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

const INLINE_DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi;

/**
 * Membuang gambar inline base64 dari teks balasan agar chat tidak dibanjiri
 * payload raksasa yang tidak terbaca.
 */
export function sanitizeReplyText(text) {
  if (!text || typeof text !== "string" || !text.includes("base64,")) return text || "";
  return text.replace(INLINE_DATA_URI, "[gambar inline base64 tidak ditampilkan di chat]");
}

/**
 * Memotong teks secara aman tanpa merusak tampilan.
 */
export function truncate(text, max = 3500) {
  if (!text) return "";
  const clean = stripAnsi(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trim() + "\n\n_...[poin lanjutan diringkas agar rapi]_";
}

/**
 * Batas keras satu pesan Telegram adalah 4096 karakter. Sisakan margin agar
 * aman saat Markdown/emoji ikut dihitung.
 */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Membagi teks panjang menjadi beberapa pesan Telegram tanpa membuang isi.
 *
 * - Jika <= maxPerMessage: Kembalikan 1 pesan utuh.
 * - Jika lebih panjang: Pecah berurutan sebanyak yang dibutuhkan, memilih
 *   batas paragraf/baris/spasi terdekat agar tidak terpotong di tengah kata.
 *   SELURUH teks tetap terkirim; tidak ada bagian tengah yang diringkas.
 */
export function smartSummaryOrSplit(text, maxPerMessage = 3800) {
  if (!text) return [""];
  const clean = stripAnsi(text).trim();
  if (!clean) return [""];

  const limit = Math.max(1, Math.min(maxPerMessage, TELEGRAM_MESSAGE_LIMIT));
  if (clean.length <= limit) return [clean];

  const parts = [];
  let rest = clean;
  while (rest.length > limit) {
    let splitIdx = rest.lastIndexOf("\n\n", limit);
    if (splitIdx < limit * 0.5) splitIdx = rest.lastIndexOf("\n", limit);
    if (splitIdx < limit * 0.5) splitIdx = rest.lastIndexOf(" ", limit);
    if (splitIdx <= 0) splitIdx = limit;

    const chunk = rest.slice(0, splitIdx).trim();
    if (chunk) parts.push(chunk);
    rest = rest.slice(splitIdx).trimStart();
  }
  if (rest) parts.push(rest.trim());

  return parts.length ? parts : [clean];
}

/**
 * Membangun opsi reply_parameters agar balasan Telegram mengutip (quote) pesan asal user
 * dan meneruskan message_thread_id jika chat berada di Telegram Forum Topic.
 */
export function buildReplyOptions(ctx, extra = {}) {
  const messageId = ctx?.message?.message_id;
  const threadId = ctx?.message?.message_thread_id;
  const opts = { ...extra };

  if (threadId && !opts.message_thread_id) {
    opts.message_thread_id = threadId;
  }

  if (messageId && !opts.reply_parameters) {
    opts.reply_parameters = {
      message_id: messageId,
      allow_sending_without_reply: true,
    };
  }

  return opts;
}

/**
 * Mengirim pesan ke Telegram secara cerdas dan elegan:
 * Mencoba parse Markdown terlebih dahulu, fallback ke plain text jika ada formatting error.
 * Jika teks panjang, dikirim berurutan (maksimal 2 bagian) dengan delay 200ms.
 * Bagian pertama otomatis me-reply pesan asli user jika message_id tersedia.
 */
export async function sendSmartReply(ctx, text) {
  text = sanitizeReplyText(text);
  if (!text || !text.trim()) {
    return ctx.reply("ℹ️ Tugas telah selesai diproses.", buildReplyOptions(ctx));
  }

  const parts = smartSummaryOrSplit(text, 3800);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const threadOptions = ctx?.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    const mdOpts = i === 0 ? buildReplyOptions(ctx, { parse_mode: "Markdown" }) : { ...threadOptions, parse_mode: "Markdown" };
    const plainOpts = i === 0 ? buildReplyOptions(ctx) : threadOptions;
    try {
      await ctx.reply(part, mdOpts);
    } catch {
      await (plainOpts ? ctx.reply(part, plainOpts) : ctx.reply(part));
    }
    if (i < parts.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export async function downloadTelegramFile(
  ctx,
  fileId,
  originalName,
  isPhoto = false,
  mimeType = null,
  fileSize = null
) {
  // Cek batas ukuran 20MB bot Telegram sebelum memanggil getFile
  if (fileSize && fileSize > 20 * 1024 * 1024) {
    throw new Error(
      `Ukuran file (${formatBytes(fileSize)}) melebihi batas maksimum 20MB Telegram Bot API.`
    );
  }

  let file;
  try {
    file = await ctx.api.getFile(fileId);
  } catch (err) {
    if (String(err?.message || err).includes("file is too big")) {
      throw new Error(
        `Ukuran file melebihi batas maksimum 20MB yang diizinkan Telegram Bot API.`
      );
    }
    throw err;
  }

  if (!file.file_path) {
    throw new Error("Telegram tidak mengembalikan file_path.");
  }

  // Cek batas ukuran 20MB bot Telegram dari respon file
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

  const originalExt = path.extname(originalName || file.file_path || "");
  let ext = originalExt.toLowerCase();
  if (!ext && isPhoto) ext = ".jpg";
  if (ext === ".oga") ext = ".ogg";

  const rawBase = path.basename(originalName || `media_${Date.now()}`, originalExt);
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
