import { ALLOWED_IDS } from "../config/env.js";

export function isAuthorized(ctx) {
  if (!ctx.from) return false;
  const idStr = String(ctx.from.id);
  if (ALLOWED_IDS.has(idStr)) return true;
  // Dynamic sync jika baru diupdate via Web UI / .env
  const currentEnv = (process.env.ALLOWED_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (currentEnv.includes(idStr)) {
    ALLOWED_IDS.add(idStr);
    return true;
  }
  return false;
}

export function registerMiddleware(bot) {
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      const summary =
        ctx.message?.text ||
        (ctx.message?.caption ? `[Caption] ${ctx.message.caption}` : "") ||
        (ctx.message?.photo ? "[Foto/Gambar]" : "") ||
        (ctx.message?.document
          ? `[Dokumen: ${ctx.message.document.file_name || "file"}]`
          : "") ||
        "[Pesan Lain]";
      console.log(
        `[Pesan Masuk] Dari ID: ${ctx.from.id} (@${ctx.from.username || "tanpa_username"}): "${summary}"`
      );
    }

    if (!isAuthorized(ctx)) {
      if (ctx.from) {
        console.warn(
          `[Akses Ditolak] Pesan dari Telegram ID tidak terdaftar: ${ctx.from.id}`
        );
        try {
          await ctx.reply(
            `⛔ *Akses Ditolak*\n\nUser ID Telegram Anda: \`${ctx.from.id}\`\n\nID Anda belum terdaftar di \`ALLOWED_TELEGRAM_IDS\` pada file \`.env\`.`,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          console.error("Gagal mengirim pesan penolakan:", err.message);
        }
      }
      return;
    }
    await next();
  });
}
