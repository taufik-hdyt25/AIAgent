import { InlineKeyboard } from "grammy";
import { getModelList } from "../../config/models.js";
import {
  getUserPiModel,
  setUserPiModel,
} from "../../services/context-store.js";

const ENGINE_LABEL = "Pi Coding Agent CLI";

export function registerModelHandlers(bot) {
  bot.command(["model", "models"], async (ctx) => {
    const arg = ctx.match?.trim();
    const userId = ctx.from?.id;
    const modelList = await getModelList();
    const currentModel = await getUserPiModel(userId);

    if (arg) {
      const matched = modelList.find(
        (m) => m.id.toLowerCase() === arg.toLowerCase()
      );
      // Fleksibel: Izinkan model kustom (seperti 'litellm')
      const chosenId = matched ? matched.id : arg;

      await setUserPiModel(userId, chosenId);

      const modelName = matched ? matched.name : chosenId;
      await ctx.reply(
        `✅ Model untuk *${ENGINE_LABEL}* berhasil diubah ke: *${modelName}*\nID: \`${chosenId}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    const displayModels = modelList.slice(0, 30);
    for (const model of displayModels) {
      const isCurrent = model.id === currentModel;
      const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}${model.badge ? ` [${model.badge}]` : ""}`;
      keyboard.text(label, `set_model:${model.id}`).row();
    }

    const activeName =
      modelList.find((m) => m.id === currentModel)?.name || currentModel || "Default";
    const activeModelId = currentModel || "default";

    const moreHint =
      modelList.length > 30
        ? `\n_Menampilkan 30 dari ${modelList.length} model. Ketik /model <id> untuk memilih model lainnya._\n`
        : "";

    await ctx.reply(
      `🤖 *Pilihan Model AI*\n\n` +
        `⚙️ Engine aktif: *${ENGINE_LABEL}*\n` +
        `👉 Model aktif saat ini:\n*${activeName}* (\`${activeModelId}\`)\n` +
        moreHint +
        `\nSilakan pilih model khusus *${ENGINE_LABEL}* di bawah ini:`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  });

  bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
    const modelId = ctx.match[1];
    const userId = ctx.from?.id;
    const modelList = await getModelList();

    const matched = modelList.find((m) => m.id === modelId);
    const chosenId = matched ? matched.id : modelId;
    const chosenName = matched ? matched.name : modelId;

    await setUserPiModel(userId, chosenId);

    await ctx.answerCallbackQuery({
      text: `Model diubah ke ${chosenName}`,
    });

    const keyboard = new InlineKeyboard();
    for (const model of modelList.slice(0, 30)) {
      const isCurrent = model.id === chosenId;
      const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}`;
      keyboard.text(label, `set_model:${model.id}`).row();
    }

    try {
      await ctx.editMessageText(
        `🤖 *Pilihan Model AI*\n\n` +
          `⚙️ Engine aktif: *${ENGINE_LABEL}*\n` +
          `✅ Model aktif sekarang:\n👉 *${chosenName}* (\`${chosenId}\`)\n\n` +
          `Silakan klik tombol di bawah jika ingin mengganti ke model lain:`,
        {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        }
      );
    } catch {
      // Abaikan jika tidak ada perubahan tampilan
    }
  });
}
