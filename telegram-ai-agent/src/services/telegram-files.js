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
 * Membagi atau meringkas teks panjang agar SELURUH poin penting & kesimpulan
 * tampil utuh di chat Telegram tanpa terpotong mendadak di tengah jalan.
 *
 * - Jika <= 3800 karakter: Kembalikan 1 pesan utuh.
 * - Jika 3800 - 7600 karakter: Bagi secara rapi di batas paragraf (2 pesan bersambung).
 * - Jika > 7600 karakter: Ambil poin awal (~3500 char) dan kesimpulan akhir (~3500 char)
 *   sehingga intisari awal dan kesimpulan akhir TIDAK HILANG.
 */
export function smartSummaryOrSplit(text, maxPerMessage = 3800) {
  if (!text) return [""];
  const clean = stripAnsi(text).trim();
  if (clean.length <= maxPerMessage) return [clean];

  // Jika pesan muat dalam 2 bubble chat Telegram (<= 7600 karakter)
  if (clean.length <= maxPerMessage * 2) {
    let splitIdx = clean.lastIndexOf("\n\n", maxPerMessage);
    if (splitIdx === -1 || splitIdx < maxPerMessage * 0.4) {
      splitIdx = clean.lastIndexOf("\n", maxPerMessage);
    }
    if (splitIdx === -1 || splitIdx < maxPerMessage * 0.4) {
      splitIdx = clean.lastIndexOf(" ", maxPerMessage);
    }
    if (splitIdx === -1) splitIdx = maxPerMessage;

    const part1 = clean.slice(0, splitIdx).trim();
    const part2 = clean.slice(splitIdx).trim();
    return [part1, part2].filter(Boolean);
  }

  // Jika teks sangat panjang (> 7600 karakter, misal log terminal tebal)
  // Pertahankan pembuka/poin perubahan di awal dan KESIMPULAN di bagian akhir
  const part1Limit = Math.floor(maxPerMessage * 0.9);
  let p1Split = clean.lastIndexOf("\n\n", part1Limit);
  if (p1Split === -1 || p1Split < part1Limit * 0.4) {
    p1Split = clean.lastIndexOf("\n", part1Limit);
  }
  if (p1Split === -1) p1Split = part1Limit;

  const part1 = clean.slice(0, p1Split).trim();

  const part2Limit = Math.floor(maxPerMessage * 0.9);
  const endSlice = clean.slice(-part2Limit);
  let p2Split = endSlice.indexOf("\n\n");
  if (p2Split === -1 || p2Split > part2Limit * 0.4) {
    p2Split = endSlice.indexOf("\n");
  }
  if (p2Split === -1) p2Split = 0;

  const part2 = "💡 *[Kesimpulan & Poin Akhir]*:\n\n" + endSlice.slice(p2Split).trim();
  return [part1, part2];
}

/**
 * Mengirim pesan ke Telegram secara cerdas dan elegan:
 * Mencoba parse Markdown terlebih dahulu, fallback ke plain text jika ada formatting error.
 * Jika teks panjang, dikirim berurutan (maksimal 2 bagian) dengan delay 200ms.
 */
export async function sendSmartReply(ctx, text) {
  if (!text || !text.trim()) {
    return ctx.reply("ℹ️ Tugas telah selesai diproses.");
  }

  const parts = smartSummaryOrSplit(text, 3800);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    try {
      await ctx.reply(part, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(part);
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
