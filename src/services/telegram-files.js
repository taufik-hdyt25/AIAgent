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

export function truncate(text, max = 3500) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...[output dipotong]";
}

export async function downloadTelegramFile(
  ctx,
  fileId,
  originalName,
  isPhoto = false,
  mimeType = null
) {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram tidak mengembalikan file_path.");
  }

  // Cek batas ukuran 20MB bot Telegram
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

  let ext = path.extname(originalName || file.file_path || "");
  if (!ext && isPhoto) ext = ".jpg";

  const rawBase = path.basename(originalName || `media_${Date.now()}`, ext);
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
