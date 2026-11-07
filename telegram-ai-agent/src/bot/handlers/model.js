import { InlineKeyboard } from "grammy";
import { getModelList } from "../../config/models.js";
import {
  getUserEngine,
  getUserAgyModel,
  setUserAgyModel,
  getUserPiModel,
  setUserPiModel,
} from "../../services/context-store.js";

export function registerModelHandlers(bot) {
  bot.command(["model", "models"], async (ctx) => {
    const arg = ctx.match?.trim();
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isPi = currentEngine === "pi";
    const modelList = await getModelList(currentEngine);
    const currentModel = isPi
      ? await getUserPiModel(userId)
      : await getUserAgyModel(userId);
    const engineLabel = isPi ? "Pi Coding Agent CLI" : "Antigravity CLI";

    if (arg) {
      const matched = modelList.find(
        (m) => m.id.toLowerCase() === arg.toLowerCase()
      );
      // Fleksibel: Izinkan model kustom (seperti 'litellm')
      const chosenId = matched ? matched.id : arg;

      if (isPi) {
        await setUserPiModel(userId, chosenId);
      } else {
        await setUserAgyModel(userId, chosenId);
      }

      const modelName = matched ? matched.name : chosenId;
      await ctx.reply(
        `✅ Model untuk *${engineLabel}* berhasil diubah ke: *${modelName}*\nID: \`${chosenId}\``,
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
        `⚙️ Engine aktif: *${engineLabel}*\n` +
        `👉 Model aktif saat ini:\n*${activeName}* (\`${activeModelId}\`)\n` +
        moreHint +
        `\nSilakan pilih model khusus *${engineLabel}* di bawah ini:`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  });

  bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
    const modelId = ctx.match[1];
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isPi = currentEngine === "pi";
    const modelList = await getModelList(currentEngine);
    const engineLabel = isPi ? "Pi Coding Agent CLI" : "Antigravity CLI";

    const matched = modelList.find((m) => m.id === modelId);
    const chosenId = matched ? matched.id : modelId;
    const chosenName = matched ? matched.name : modelId;

    if (isPi) {
      await setUserPiModel(userId, chosenId);
    } else {
      await setUserAgyModel(userId, chosenId);
    }

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
          `⚙️ Engine aktif: *${engineLabel}*\n` +
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
