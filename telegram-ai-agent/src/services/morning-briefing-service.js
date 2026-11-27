import os from "node:os";
import { execSync } from "node:child_process";

const TIMEZONE = "Asia/Jakarta";
let briefingTimer = null;

function getMsUntilNext8AM() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, Number(p.value)]));
  const secsSinceMidnight = (parts.hour % 24) * 3600 + parts.minute * 60 + parts.second;
  const targetSecs = 8 * 3600;
  let diffSecs = targetSecs - secsSinceMidnight;
  if (diffSecs <= 60) diffSecs += 24 * 3600;
  return diffSecs * 1000;
}

export async function buildMorningBriefing() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const load = os.loadavg()[0].toFixed(2);

  let diskUsage = "-";
  try {
    diskUsage = execSync("df -h / | awk 'NR==2 {print $5 \" (\" $4 \" bebas)\"}'", { encoding: "utf8" }).trim();
  } catch {}

  let pm2Summary = "-";
  try {
    const raw = execSync("pm2 jlist 2>/dev/null", { encoding: "utf8" });
    const list = JSON.parse(raw);
    const online = list.filter((a) => a.pm2_env?.status === "online").map((a) => a.name);
    const bad = list.filter((a) => a.pm2_env?.status !== "online" && a.pm2_env?.status !== "stopped").map((a) => `${a.name}(${a.pm2_env?.status})`);
    pm2Summary = `${online.length} online` + (bad.length ? ` | ⚠️ ${bad.join(", ")}` : "");
  } catch {}

  const checkUrl = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return r.ok ? "OK" : `HTTP ${r.status}`;
    } catch {
      return "DOWN";
    }
  };

  const [piProxy, thStudio] = await Promise.all([
    checkUrl("http://127.0.0.1:3099/healthz"),
    checkUrl("https://thstudio.web.id/api/healthz"),
  ]);

  return [
    "☀️ *Morning Briefing — TH Studio & VPS*",
    "",
    `• *RAM:* ${usedPct}% terpakai | *Load:* ${load}`,
    `• *Disk /:* ${diskUsage}`,
    `• *PM2:* ${pm2Summary}`,
    `• *pi-openai-proxy:* ${piProxy} | *TH Studio:* ${thStudio}`,
  ].join("\n");
}

export async function sendMorningBriefing(bot) {
  if (!bot) return;
  const targetId =
    process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() ||
    String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
  if (!targetId) return;

  const text = await buildMorningBriefing();
  console.log("[Server Sentry] Morning Briefing harian dikirim ke Telegram.");
  await bot.api.sendMessage(targetId, text, { parse_mode: "Markdown" }).catch((err) => {
    console.warn("[Morning Briefing] Gagal kirim:", err?.message || err);
  });
}

export function initMorningBriefing(bot) {
  if (process.env.MORNING_BRIEFING_ENABLED === "false") return;
  if (briefingTimer) clearTimeout(briefingTimer);

  const scheduleNext = () => {
    const ms = getMsUntilNext8AM();
    const hours = (ms / (1000 * 3600)).toFixed(2);
    console.log(`[Morning Briefing] Terjadwal dalam ${hours} jam (jam 08:00 ${TIMEZONE}).`);
    briefingTimer = setTimeout(async () => {
      await sendMorningBriefing(bot);
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}
