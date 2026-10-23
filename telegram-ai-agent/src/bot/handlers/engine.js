import { InlineKeyboard } from "grammy";
import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
} from "../../config/models.js";
import {
  getUserEngine,
  setUserEngine,
  getUserAgyModel,
  getUserClaudeModel,
  getUserUniversalModel,
} from "../../services/context-store.js";

export function registerEngineHandlers(bot) {
  bot.command(["engine", "cli"], async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();
    const userId = ctx.from?.id;
    const currentEngine = await getUserEngine(userId);

    if (arg === "agy" || arg === "antigravity") {
      await setUserEngine(userId, "agy");
      await ctx.reply("✅ Engine berhasil diubah ke: *Antigravity CLI* (`agy`)", {
        parse_mode: "Markdown",
      });
      return;
    }
    if (arg === "claude" || arg === "claudecode") {
      await setUserEngine(userId, "claude");
      await ctx.reply("✅ Engine berhasil diubah ke: *Claude Code CLI* (`claude`)", {
        parse_mode: "Markdown",
      });
      return;
    }
    if (arg === "universal" || arg === "zero" || arg === "api") {
      await setUserEngine(userId, "universal");
      await ctx.reply("✅ Engine berhasil diubah ke: *Universal API* (`Zero-CLI`)", {
        parse_mode: "Markdown",
      });
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(
        `${currentEngine === "agy" ? "🔘 " : "⚪ "}Antigravity CLI (agy)`,
        "set_engine:agy"
      )
      .row()
      .text(
        `${currentEngine === "claude" ? "🔘 " : "⚪ "}Claude Code CLI (claude)`,
        "set_engine:claude"
      )
      .row()
      .text(
        `${currentEngine === "universal" ? "🔘 " : "⚪ "}Universal API (Zero-CLI / OpenRouter)`,
        "set_engine:universal"
      );

    const engineLabel =
      currentEngine === "claude"
        ? "Claude Code CLI (claude)"
        : currentEngine === "universal"
        ? "Universal API (Zero-CLI)"
        : "Antigravity CLI (agy)";

    await ctx.reply(
      `⚙️ *Pilihan Engine Eksekusi*\n\nEngine aktif saat ini:\n👉 *${engineLabel}*\n\nSilakan pilih engine eksekusi yang ingin digunakan:`,
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      }
    );
  });

  bot.callbackQuery(/^set_engine:(.+)$/, async (ctx) => {
    const engineId = ctx.match[1];
    const userId = ctx.from?.id;

    if (engineId !== "agy" && engineId !== "claude" && engineId !== "universal") {
      await ctx.answerCallbackQuery({ text: "Engine tidak valid!" });
      return;
    }

    await setUserEngine(userId, engineId);
    const engineLabel =
      engineId === "claude"
        ? "Claude Code CLI (claude)"
        : engineId === "universal"
        ? "Universal API (Zero-CLI)"
        : "Antigravity CLI (agy)";

    await ctx.answerCallbackQuery({
      text: `Engine diubah ke ${engineLabel}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${engineId === "agy" ? "🔘 " : "⚪ "}Antigravity CLI (agy)`,
        "set_engine:agy"
      )
      .row()
      .text(
        `${engineId === "claude" ? "🔘 " : "⚪ "}Claude Code CLI (claude)`,
        "set_engine:claude"
      )
      .row()
      .text(
        `${engineId === "universal" ? "🔘 " : "⚪ "}Universal API (Zero-CLI / OpenRouter)`,
        "set_engine:universal"
      );

    let engineModel = "";
    let matchedModel = "";
    if (engineId === "claude") {
      engineModel = await getUserClaudeModel(userId);
      matchedModel =
        AVAILABLE_CLAUDE_MODELS.find((m) => m.id === engineModel)?.name || engineModel;
    } else if (engineId === "universal") {
      engineModel = (await getUserUniversalModel(userId)) || "auto";
      matchedModel = engineModel !== "auto"
        ? (AVAILABLE_UNIVERSAL_MODELS.find((m) => m.id === engineModel)?.name || engineModel)
        : "⚡ Auto-Detect (Dynamic dari Server)";
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
          `💡 _Ketik /model untuk memilih daftar model khusus ${engineId === "claude" ? "Claude" : engineId === "universal" ? "Universal" : "Antigravity"}._`,
        {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        }
      );
    } catch {
      // Abaikan jika pesan tidak berubah
    }
  });
}
