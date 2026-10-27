import { InlineKeyboard } from "grammy";
import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
  fetchRemoteModels,
  getModelList,
} from "../../config/models.js";
import {
  getUserEngine,
  getUserAgyModel,
  setUserAgyModel,
  getUserClaudeModel,
  setUserClaudeModel,
  getUserUniversalModel,
  setUserUniversalModel,
} from "../../services/context-store.js";
import { updateEnvFile } from "../../services/env-service.js";

export function registerModelHandlers(bot) {
  bot.command(["model", "models"], async (ctx) => {
    const arg = ctx.match?.trim();
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    let modelList = await getModelList(currentEngine);
    const currentModel = isClaude
      ? await getUserClaudeModel(userId)
      : isUniversal
      ? await getUserUniversalModel(userId)
      : await getUserAgyModel(userId);
    const engineLabel = isClaude
      ? "Claude Code CLI"
      : isUniversal
      ? "Universal API (Zero-CLI)"
      : "Antigravity CLI";

    let detectedCount = 0;
    if (isUniversal) {
      const uniUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
      const uniKey = process.env.UNIVERSAL_API_KEY || "";
      const remote = await fetchRemoteModels(uniUrl, uniKey);
      if (remote.length > 0) {
        detectedCount = remote.length;
        const remoteIds = new Set(remote.map((r) => r.id));
        const filteredDefault = modelList.filter((d) => !remoteIds.has(d.id));
        modelList = [...remote, ...filteredDefault];
      }
    }

    if (arg) {
      if (isUniversal && ["auto", "dynamic", "reset", "clear", "default"].includes(arg.toLowerCase())) {
        await setUserUniversalModel(userId, "");
        await updateEnvFile({ UNIVERSAL_MODEL: "" });
        await ctx.reply(
          `✅ Model untuk *${engineLabel}* diatur ke: *⚡ Auto-Detect (Dynamic)*\nModel akan diambil secara otomatis dari endpoint server saat instruksi dijalankan.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const matched = modelList.find(
        (m) => m.id.toLowerCase() === arg.toLowerCase()
      );
      // Fleksibel: Izinkan model kustom (seperti 'litellm')
      const chosenId = matched ? matched.id : arg;

      if (isClaude) {
        await setUserClaudeModel(userId, chosenId);
      } else if (isUniversal) {
        await setUserUniversalModel(userId, chosenId);
        await updateEnvFile({ UNIVERSAL_MODEL: chosenId });
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
    if (isUniversal) {
      const isAuto = !currentModel || currentModel === "auto";
      keyboard.text(`${isAuto ? "🔘 " : "⚪ "}⚡ Auto-Detect (Dynamic dari Server)`, "set_model:auto").row();
    }

    const displayModels = modelList.slice(0, 15);
    for (const model of displayModels) {
      const isCurrent = model.id === currentModel;
      const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}${model.badge ? ` [${model.badge}]` : ""}`;
      keyboard.text(label, `set_model:${model.id}`).row();
    }

    const activeName =
      (isUniversal && (!currentModel || currentModel === "auto"))
        ? "⚡ Auto-Detect (Dynamic dari Server)"
        : (modelList.find((m) => m.id === currentModel)?.name || currentModel || "⚡ Auto-Detect");
    const activeModelId = currentModel || "auto";

    const detectedInfo =
      detectedCount > 0
        ? `\n🔍 *Auto-Detect Server:* \`${detectedCount}\` model ditemukan di \`${process.env.UNIVERSAL_BASE_URL || ""}\`\n`
        : "";

    const moreHint =
      modelList.length > 15
        ? `\n_Menampilkan 15 dari ${modelList.length} model. Ketik /model <id> untuk memilih model lainnya._\n`
        : "";

    await ctx.reply(
      `🤖 *Pilihan Model AI*\n\n` +
        `⚙️ Engine aktif: *${engineLabel}*\n` +
        `👉 Model aktif saat ini:\n*${activeName}* (\`${activeModelId}\`)\n` +
        detectedInfo +
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
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    let modelList = await getModelList(currentEngine);
    const engineLabel = isClaude
      ? "Claude Code CLI"
      : isUniversal
      ? "Universal API (Zero-CLI)"
      : "Antigravity CLI";

    if (isUniversal) {
      const uniUrl = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
      const uniKey = process.env.UNIVERSAL_API_KEY || "";
      const remote = await fetchRemoteModels(uniUrl, uniKey);
      if (remote.length > 0) {
        const remoteIds = new Set(remote.map((r) => r.id));
        const filteredDefault = modelList.filter((d) => !remoteIds.has(d.id));
        modelList = [...remote, ...filteredDefault];
      }

      if (modelId === "auto") {
        await setUserUniversalModel(userId, "");
        await updateEnvFile({ UNIVERSAL_MODEL: "" });
        await ctx.answerCallbackQuery({
          text: "Model diatur ke Auto-Detect (Dynamic)",
        });

        const keyboard = new InlineKeyboard();
        keyboard.text("🔘 ⚡ Auto-Detect (Dynamic dari Server)", "set_model:auto").row();
        for (const model of modelList.slice(0, 15)) {
          keyboard.text(`⚪ ${model.name}`, `set_model:${model.id}`).row();
        }

        try {
          await ctx.editMessageText(
            `🤖 *Pilihan Model AI*\n\n` +
              `⚙️ Engine aktif: *${engineLabel}*\n` +
              `✅ Model aktif sekarang:\n👉 *⚡ Auto-Detect (Dynamic)* (\`auto\`)\n\n` +
              `Model akan dideteksi dan diambil secara dinamis dari server saat eksekusi.\nSilakan klik tombol di bawah jika ingin mengganti ke model lain:`,
            {
              reply_markup: keyboard,
              parse_mode: "Markdown",
            }
          );
        } catch {}
        return;
      }
    }

    const matched = modelList.find((m) => m.id === modelId);
    const chosenId = matched ? matched.id : modelId;
    const chosenName = matched ? matched.name : modelId;

    if (isClaude) {
      await setUserClaudeModel(userId, chosenId);
    } else if (isUniversal) {
      await setUserUniversalModel(userId, chosenId);
      await updateEnvFile({ UNIVERSAL_MODEL: chosenId });
    } else {
      await setUserAgyModel(userId, chosenId);
    }

    await ctx.answerCallbackQuery({
      text: `Model diubah ke ${chosenName}`,
    });

    const keyboard = new InlineKeyboard();
    if (isUniversal) {
      keyboard.text("⚪ ⚡ Auto-Detect (Dynamic dari Server)", "set_model:auto").row();
    }
    for (const model of modelList.slice(0, 15)) {
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
