import os from "node:os";
import { runProcess } from "./cli-runner.js";
import { createPiEventParser } from "./pi-event-parser.js";

const TIMEZONE = "Asia/Jakarta";
let weeklyTimer = null;

function getMsUntilNextMonday9AM() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[parts.weekday] ?? 1;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  let daysUntilMon = (1 - day + 7) % 7;
  const secsToday = hour * 3600 + minute * 60 + second;
  if (daysUntilMon === 0 && secsToday >= 9 * 3600 - 60) {
    daysUntilMon = 7;
  }
  const msTodayTo9AM = (9 * 3600 - secsToday) * 1000;
  return daysUntilMon * 24 * 3600 * 1000 + msTodayTo9AM;
}

export async function generateWeeklyContentBrief(bot = null) {
  const provider = process.env.PI_WRITER_PROVIDER || "a2-codex";
  const model = process.env.PI_WRITER_MODEL || "gemini-3-flash";
  console.log(`[SpecialistRouter] role=writer provider=${provider} model=${model}`);

  const parser = createPiEventParser();
  const prompt = [
    "Buatkan rencana konten mingguan berbahasa Indonesia yang ringkas & siap eksekusi untuk ekosistem aplikasi TH Studio (Kataku, My Weton, TH AI Prompt, TH Quiz, TH Blog, Artosku):",
    "1) 3 Ide Judul Artikel SEO untuk TH Blog (sertakan keyword utama).",
    "2) 2 Ide Konten Promo Video Pendek 9:16 (hook 3 detik pertama + CTA singkat).",
  ].join("\n");

  const res = await runProcess({
    command: process.env.PI_BIN || "pi",
    args: [
      "--mode", "json", "--print", prompt,
      "--no-session", "--no-tools", "--no-mcp", "--no-extensions",
      "--no-skills", "--no-prompt-templates", "--no-context-files",
      "--thinking", "off",
      "--provider", provider, "--model", model,
    ],
    cwd: os.homedir(),
    timeoutMs: 55_000,
    maxTimeoutMs: 55_000,
    maxOutput: 24_000,
    env: { ...process.env, CI: "true", NONINTERACTIVE: "1" },
    onStdout: (c) => parser.push(c),
  });

  if (res.error || res.code !== 0) {
    throw new Error(String(res.stderr || res.error || "Writer gagal").slice(0, 200));
  }

  const content = (parser.getFinalText?.() || res.stdout || "").trim();
  console.log("[Agent] Dispatch selesai weekly-content");

  if (bot) {
    const targetId =
      process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() ||
      String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
    if (targetId) {
      const msg = `✍️ *Ide Konten & Promo Mingguan (Writer)*\n\n${content}`;
      await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
        await bot.api.sendMessage(targetId, msg).catch(() => {});
      });
    }
  }

  return content;
}

export function initWeeklyContentPlanner(bot) {
  if (process.env.WEEKLY_CONTENT_ENABLED === "false") return;
  if (weeklyTimer) clearTimeout(weeklyTimer);

  const scheduleNext = () => {
    const ms = getMsUntilNextMonday9AM();
    const days = (ms / (1000 * 3600 * 24)).toFixed(2);
    console.log(`[WeeklyContent] Terjadwal dalam ${days} hari (Senin 09:00 ${TIMEZONE}).`);
    weeklyTimer = setTimeout(async () => {
      await generateWeeklyContentBrief(bot).catch(() => {});
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}
