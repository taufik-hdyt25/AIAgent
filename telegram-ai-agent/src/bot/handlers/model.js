import { InlineKeyboard } from "grammy";
import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
  fetchRemoteModels,
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

export function registerModelHandlers(bot) {
  bot.command("model", async (ctx) => {
    const arg = ctx.match?.trim();
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);
    const isClaude = currentEngine === "claude";
    const isUniversal = currentEngine === "universal";
    let modelList = isClaude
      ? AVAILABLE_CLAUDE_MODELS
      : isUniversal
      ? AVAILABLE_UNIVERSAL_MODELS
      : AVAILABLE_AGY_MODELS;
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
        const filteredDefault = AVAILABLE_UNIVERSAL_MODELS.filter((d) => !remoteIds.has(d.id));
        modelList = [...remote, ...filteredDefault];
      }
    }

    if (arg) {
      const matched = modelList.find(
        (m) => m.id.toLowerCase() === arg.toLowerCase()
      );
      const chosenId = matched ? matched.id : (isUniversal || isClaude) ? arg : null;

      if (!chosenId) {
        const listStr = modelList
          .slice(0, 15)
          .map((m) => `• \`${m.id}\` (${m.name})`)
          .join("\n");
        await ctx.reply(
          `❌ Model \`${arg}\` tidak dikenali untuk engine *${engineLabel}*.\n\nPilihan yang tersedia:\n${listStr}`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      if (isClaude) {
        await setUserClaudeModel(userId, chosenId);
      } else if (isUniversal) {
        await setUserUniversalModel(userId, chosenId);
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
    const displayModels = modelList.slice(0, 15);
    for (const model of displayModels) {
      const isCurrent = model.id === currentModel;
      const label = `${isCurrent ? "🔘 " : "⚪ "}${model.name}${model.badge ? ` [${model.badge}]` : ""}`;
      keyboard.text(label, `set_model:${model.id}`).row();
    }

    const activeName =
      modelList.find((m) => m.id === currentModel)?.name || currentModel;

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
        `👉 Model aktif saat ini:\n*${activeName}* (\`${currentModel}\`)\n` +
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
    let modelList = isClaude
      ? AVAILABLE_CLAUDE_MODELS
      : isUniversal
      ? AVAILABLE_UNIVERSAL_MODELS
      : AVAILABLE_AGY_MODELS;
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
        const filteredDefault = AVAILABLE_UNIVERSAL_MODELS.filter((d) => !remoteIds.has(d.id));
        modelList = [...remote, ...filteredDefault];
      }
    }

    const matched = modelList.find((m) => m.id === modelId);

    if (!matched && !isUniversal && !isClaude) {
      await ctx.answerCallbackQuery({
        text: "Model tidak dikenali untuk engine ini!",
      });
      return;
    }

    const chosenId = matched ? matched.id : modelId;
    const chosenName = matched ? matched.name : modelId;

    if (isClaude) {
      await setUserClaudeModel(userId, chosenId);
    } else if (isUniversal) {
      await setUserUniversalModel(userId, chosenId);
    } else {
      await setUserAgyModel(userId, chosenId);
    }

    await ctx.answerCallbackQuery({
      text: `Model diubah ke ${chosenName}`,
    });

    const keyboard = new InlineKeyboard();
    for (const model of modelList) {
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
