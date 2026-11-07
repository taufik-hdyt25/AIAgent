import { InlineKeyboard } from "grammy";
import { AVAILABLE_AGY_MODELS } from "../../config/models.js";
import {
  getUserEngine,
  setUserEngine,
  getUserAgyModel,
  getUserPiModel,
} from "../../services/context-store.js";

const ENGINE_LABELS = {
  pi: "Pi Coding Agent CLI (pi)",
  agy: "Antigravity CLI (agy)",
};

function buildEngineKeyboard(currentEngine) {
  return new InlineKeyboard()
    .text(
      `${currentEngine === "pi" ? "🔘 " : "⚪ "}${ENGINE_LABELS.pi}`,
      "set_engine:pi"
    )
    .row()
    .text(
      `${currentEngine === "agy" ? "🔘 " : "⚪ "}${ENGINE_LABELS.agy}`,
      "set_engine:agy"
    );
}

export function registerEngineHandlers(bot) {
  bot.command(["engine", "cli"], async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);

    if (arg === "pi" || arg === "picli") {
      await setUserEngine(userId, "pi");
      await ctx.reply("✅ Engine berhasil diubah ke: *Pi Coding Agent CLI* (`pi`)", {
        parse_mode: "Markdown",
      });
      return;
    }
    if (arg === "agy" || arg === "antigravity") {
      await setUserEngine(userId, "agy");
      await ctx.reply("✅ Engine berhasil diubah ke: *Antigravity CLI* (`agy`)", {
        parse_mode: "Markdown",
      });
      return;
    }

    const engineLabel = ENGINE_LABELS[currentEngine] || ENGINE_LABELS.agy;

    await ctx.reply(
      `⚙️ *Pilihan Engine Eksekusi*\n\nEngine aktif saat ini:\n👉 *${engineLabel}*\n\nSilakan pilih engine eksekusi yang ingin digunakan:`,
      {
        reply_markup: buildEngineKeyboard(currentEngine),
        parse_mode: "Markdown",
      }
    );
  });

  bot.callbackQuery(/^set_engine:(.+)$/, async (ctx) => {
    const engineId = ctx.match[1];
    const userId = ctx.from?.id;

    if (!ENGINE_LABELS[engineId]) {
      await ctx.answerCallbackQuery({ text: "Engine tidak valid!" });
      return;
    }

    await setUserEngine(userId, engineId);
    const engineLabel = ENGINE_LABELS[engineId];

    await ctx.answerCallbackQuery({
      text: `Engine diubah ke ${engineLabel}`,
    });

    let engineModel = "";
    let matchedModel = "";
    if (engineId === "pi") {
      engineModel = await getUserPiModel(userId);
      matchedModel = `Pi Model (${engineModel})`;
    } else {
      engineModel = await getUserAgyModel(userId);
      matchedModel =
        AVAILABLE_AGY_MODELS.find((m) => m.id === engineModel)?.name || engineModel;
    }

    try {
      await ctx.editMessageText(
        `⚙️ *Pilihan Engine CLI*\n\n` +
          `✅ Engine aktif sekarang:\n👉 *${engineLabel}*\n\n` +
          `🤖 Model aktif untuk engine ini:\n👉 *${matchedModel}* (\`${engineModel}\`)\n\n` +
          `💡 _Ketik /model untuk memilih daftar model khusus ${engineId === "pi" ? "Pi CLI" : "Antigravity"}._`,
        {
          reply_markup: buildEngineKeyboard(engineId),
          parse_mode: "Markdown",
        }
      );
    } catch {
      // Abaikan jika pesan tidak berubah
    }
  });
}
