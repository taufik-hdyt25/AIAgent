import { downloadTelegramFile } from "../../services/telegram-files.js";
import { sendToAgent } from "../dispatcher.js";

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
