import { readFile } from "node:fs/promises";
import { downloadTelegramFile, truncate } from "../../services/telegram-files.js";
import { sendToAgent } from "../dispatcher.js";
import { transcribeAudio } from "../../services/voice-service.js";
import { sendUsageResponse } from "./commands.js";

/**
 * Respon instan untuk sapaan ringan, ping/test, atau ungkapan terima kasih
 * Menghindari beban token dan latensi CLI jika pesan bukan instruksi koding/eksekusi.
 */
export function getQuickReply(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const text = rawText.trim().toLowerCase();
  const clean = text.replace(/^[!?,.:;\s~]+|[!?,.:;\s~]+$/g, "").trim();

  // 1. Ping / Test
  if (/^(ping|tes|test|p)$/i.test(clean)) {
    return "Pong! 🏓 TH Agent aktif dan siap menerima instruksi koding bro. Mau ngerjain apa hari ini?";
  }

  // 2. Greetings (murni sapaan pendek tanpa instruksi lanjutan)
  const greetingPattern = /^(halo+|hallo+|hai+|hi+|hey+|helo+|assalamu['’]?alaikum|selamat (pagi|siang|sore|malam))(\s+(bro|mas|bang|gan|min|agent|th|kawan|teman|semua))?$/i;
  if (greetingPattern.test(clean)) {
    return "Halo bro! 👋 TH Agent siap bantu. Ada proyek coding, fitur baru, fix bug, atau cek server yang mau dikerjakan?";
  }

  // 3. Gratitude / Ucapan terima kasih
  const thanksPattern = /^(makasih|terima\s*kasih|thanks|thank\s*you|tq|maturnuwun|nuhun)(\s+(banyak|banget|ya|bro|mas|bang|gan|min|th))?$/i;
  if (thanksPattern.test(clean)) {
    return "Sama-sama bro! Senang bisa bantu. Kalau butuh bantuan coding atau deploy lagi, langsung chat aja ya! 🚀";
  }

  // 4. Affirmations / Konfirmasi singkat
  const ackPattern = /^(oke+|ok+|siap+|mantap+|sip+|noted|siap\s*komandan)(\s+(bro|mas|bang|gan|min|th))?$/i;
  if (ackPattern.test(clean)) {
    return "Siap bro! Beritahu saya kalau ada instruksi atau tugas selanjutnya yang mau dieksekusi. 🫡";
  }

  return null;
}

export function registerMessageHandlers(bot) {
  // Handler untuk menerima dokumen/file dari Telegram chat
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc) return;

    const caption = (ctx.message.caption || "").trim();
    if (caption.startsWith("/")) return;

    // Cek batas ukuran 20MB bot Telegram sebelum download (Telegram Bot API getFile maks 20MB)
    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
      const sizeMB = (doc.file_size / (1024 * 1024)).toFixed(1);
      const limitMsg = `⚠️ *File Terlalu Besar*\n\nUkuran file \`${(doc.file_name || "dokumen").replace(/[`*_\\]/g, " ")}\` (${sizeMB} MB) melebihi batas 20 MB yang diizinkan oleh Telegram Bot API.\n\n💡 *Solusi:* Salin file langsung ke folder proyek atau kirim via Git.`;
      try {
        await ctx.reply(limitMsg, { parse_mode: "Markdown" });
      } catch (_) {
        await ctx.reply(`⚠️ File terlalu besar (${sizeMB} MB). Batas bot Telegram adalah 20 MB.`);
      }
      return;
    }

    let statusMsg = null;
    const cleanFileName = (doc.file_name || "dokumen").replace(/[`*_\\[\\]()]/g, " ");
    try {
      try {
        statusMsg = await ctx.reply(
          `📥 *Mengunduh file: \`${cleanFileName}\`*...`,
          { parse_mode: "Markdown" }
        );
      } catch (_) {
        statusMsg = await ctx.reply(`📥 Mengunduh file: ${cleanFileName}...`).catch(() => null);
      }

      const fileInfo = await downloadTelegramFile(
        ctx,
        doc.file_id,
        doc.file_name,
        false,
        doc.mime_type,
        doc.file_size
      );

      try {
        if (statusMsg) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `📥 *File tersimpan:* \`${fileInfo.savedFileName}\` (${fileInfo.fileSizeFormatted})\n📂 Lokasi: \`${fileInfo.relativePath}\`\n⏳ *Mengirim instruksi ke AI Agent...*`,
            { parse_mode: "Markdown" }
          );
        }
      } catch {
        // Abaikan jika tidak bisa edit pesan
      }

      const defaultInstruction = `Pengguna mengirim file "${fileInfo.fileName}". Analisis file ini, jelaskan isi atau fungsinya, dan jika diminta dieksekusi atau berupa skrip/program, jalankan perintah eksekusinya dan laporkan hasilnya.`;
      const promptMessage = caption || defaultInstruction;

      await sendToAgent(promptMessage, ctx, fileInfo);
    } catch (err) {
      console.error("Gagal memproses dokumen:", err.message || err);
      try {
        await ctx.reply(`❌ Gagal memproses file: ${err.message}`);
      } catch (_) {}
    }
  });

  // Handler untuk menerima gambar / foto dari Telegram chat
  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;

    const caption = (ctx.message.caption || "").trim();
    if (caption.startsWith("/")) return;

    const highestPhoto = photos[photos.length - 1];

    let statusMsg = null;
    try {
      statusMsg = await ctx.reply(`📸 *Mengunduh gambar...*`, {
        parse_mode: "Markdown",
      });

      const fileInfo = await downloadTelegramFile(
        ctx,
        highestPhoto.file_id,
        `image_${highestPhoto.file_unique_id}.jpg`,
        true,
        "image/jpeg"
      );

      try {
        if (statusMsg) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `📸 *Gambar tersimpan:* \`${fileInfo.savedFileName}\` (${fileInfo.fileSizeFormatted})\n📂 Lokasi: \`${fileInfo.relativePath}\`\n⏳ *Menganalisis bersama AI Agent...*`,
            { parse_mode: "Markdown" }
          );
        }
      } catch {
        // Abaikan jika tidak bisa edit pesan
      }

      const defaultInstruction = `Pengguna mengirim gambar ini tanpa pesan teks tambahan. Analisis gambar ini (misalnya jika berupa screenshot error koding, diagram sistem, UI mockup, atau log terminal), jelaskan temuanmu, dan berikan solusi atau langkah konkrit untuk menindaklanjutinya.`;
      const promptMessage = caption || defaultInstruction;

      await sendToAgent(promptMessage, ctx, fileInfo);
    } catch (err) {
      console.error("Gagal memproses gambar:", err.message || err);
      await ctx.reply(`❌ Gagal memproses gambar: ${err.message}`);
    }
  });

  // Handler untuk menerima pesan suara (Voice Note) atau Audio dari Telegram chat
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const voice = ctx.message.voice;
    const audio = ctx.message.audio;
    const targetMedia = voice || audio;
    if (!targetMedia) return;

    const isVoiceNote = Boolean(voice);
    let originalName = audio?.file_name || (isVoiceNote ? `voice_${Date.now()}.ogg` : `audio_${Date.now()}.mp3`);
    if (originalName.toLowerCase().endsWith(".oga")) {
      originalName = originalName.slice(0, -4) + ".ogg";
    }
    let mimeType = targetMedia.mime_type || (isVoiceNote ? "audio/ogg" : "audio/mpeg");
    if (mimeType === "audio/oga") {
      mimeType = "audio/ogg";
    }

    let statusMsg = null;
    try {
      statusMsg = await ctx.reply("🎙️ *Mendengarkan pesan suara...*", {
        parse_mode: "Markdown",
      });

      const fileInfo = await downloadTelegramFile(
        ctx,
        targetMedia.file_id,
        originalName,
        false,
        mimeType
      );

      const buffer = await readFile(fileInfo.absolutePath);
      const transcription = await transcribeAudio(buffer, {
        fileName: fileInfo.savedFileName,
        mimeType: fileInfo.mimeType,
      });

      if (!transcription.success) {
        if (transcription.error === "NO_API_KEY") {
          const helpMsg =
            `🎙️ *Pesan Suara / Voice Note Diterima!*\n\n` +
            `Fitur transkripsi audio otomatis memerlukan API Key Whisper (disarankan **Groq Cloud** gratis & kilat <0.5s, atau OpenAI).\n\n` +
            `💡 *Cara Mengaktifkan:*\n` +
            `1. Ambil API Key gratis di [console.groq.com/keys](https://console.groq.com/keys)\n` +
            `2. Ketik perintah:\n` +
            `\`/setwhisper groq gsk_...\`\n\n` +
            `_Setelah diisi, pesan suara apa pun akan langsung otomatis dijalankan jadi perintah koding!_`;

          try {
            await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, helpMsg, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          } catch {
            await ctx.reply(helpMsg, { parse_mode: "Markdown", disable_web_page_preview: true });
          }
          return;
        }

        throw new Error(transcription.message || "Gagal mentranskripsi audio.");
      }

      const voiceText = transcription.text;
      if (!voiceText) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          "⚠️ Suara tidak terdeteksi atau terlalu sunyi. Coba kirim ulang ya bro."
        );
        return;
      }

      const infoMsg =
        `🗣️ *Voice Command Diterima:* _"${truncate(voiceText, 180)}"_\n` +
        `⚡ Transkripsi: \`${transcription.provider}\` (${transcription.durationSec}s)\n` +
        `⏳ *Mengeksekusi instruksi...*`;

      try {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, infoMsg, {
          parse_mode: "Markdown",
        });
      } catch {
        await ctx.reply(infoMsg, { parse_mode: "Markdown" });
      }

      // Kirim teks hasil transkripsi ke agent
      await sendToAgent(voiceText, ctx, fileInfo);
    } catch (err) {
      console.error("[Voice Handler] Gagal memproses pesan suara:", err.message || err);
      if (statusMsg) {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Gagal memproses voice note: ${err.message}`
          );
          return;
        } catch (_) {}
      }
      await ctx.reply(`❌ Gagal memproses voice note: ${err.message}`);
    }
  });

  // Setiap chat yang masuk diproses dengan cerdas
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    if (text.length > 5000) {
      await ctx.reply("Pesan terlalu panjang (maksimal 5000 karakter).");
      return;
    }

    // Deteksi cepat jika meminta statistik pemakaian token (contoh: "usage", "cek token", "kuota")
    const cleanLower = text.toLowerCase().replace(/^[!?,.:;\s~]+|[!?,.:;\s~]+$/g, "").trim();
    if (/^(usage|cek\s+usage|cek\s+token|cek\s+kuota|token\s+usage|tokens|kuota|token|info\s+token|info\s+usage)$/i.test(cleanLower)) {
      await sendUsageResponse(ctx);
      return;
    }

    // Deteksi cepat jika hanya sapaan murni, ping/test, atau terima kasih (respon seketika <50ms)
    const quickReply = getQuickReply(text);
    if (quickReply) {
      await ctx.reply(quickReply);
      return;
    }

    await sendToAgent(text, ctx);
  });
}
