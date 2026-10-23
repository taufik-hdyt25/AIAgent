import { readFile } from "node:fs/promises";
import { downloadTelegramFile, truncate } from "../../services/telegram-files.js";
import { sendToAgent } from "../dispatcher.js";
import { transcribeAudio } from "../../services/voice-service.js";

export function registerMessageHandlers(bot) {
  // Handler untuk menerima dokumen/file dari Telegram chat
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc) return;

    const caption = (ctx.message.caption || "").trim();
    if (caption.startsWith("/")) return;

    let statusMsg = null;
    try {
      statusMsg = await ctx.reply(
        `📥 *Mengunduh file: \`${doc.file_name || "dokumen"}\`*...`,
        { parse_mode: "Markdown" }
      );

      const fileInfo = await downloadTelegramFile(
        ctx,
        doc.file_id,
        doc.file_name,
        false,
        doc.mime_type
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
      console.error("Gagal memproses dokumen:", err);
      await ctx.reply(`❌ Gagal memproses file: ${err.message}`);
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
      console.error("Gagal memproses gambar:", err);
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
    const originalName = audio?.file_name || (isVoiceNote ? `voice_${Date.now()}.oga` : `audio_${Date.now()}.mp3`);
    const mimeType = targetMedia.mime_type || (isVoiceNote ? "audio/ogg" : "audio/mpeg");

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
      console.error("[Voice Handler] Gagal memproses pesan suara:", err);
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

  // Setiap chat yang masuk langsung diteruskan 100% ke TH Agent!
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    if (text.length > 5000) {
      await ctx.reply("Pesan terlalu panjang (maksimal 5000 karakter).");
      return;
    }

    await sendToAgent(text, ctx);
  });
}
