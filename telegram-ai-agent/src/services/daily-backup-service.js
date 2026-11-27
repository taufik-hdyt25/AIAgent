import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEZONE = "Asia/Jakarta";
const BACKUP_SCRIPT = "/home/ubuntu/th-agent/telegram-ai-agent/scripts/db-backup-runner.cjs";
let backupTimer = null;

function getMsUntilNext2AM() {
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
  const targetSecs = 2 * 3600;
  let diffSecs = targetSecs - secsSinceMidnight;
  if (diffSecs <= 60) diffSecs += 24 * 3600;
  return diffSecs * 1000;
}

export async function runDailyBackup({ force = false, dryRun = false, bot = null } = {}) {
  if (!fs.existsSync(BACKUP_SCRIPT)) {
    return { ok: false, error: `Script backup tidak ditemukan: ${BACKUP_SCRIPT}` };
  }

  const args = [BACKUP_SCRIPT];
  if (force) args.push("--force");
  if (dryRun) args.push("--dry-run");

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });

    const lines = String(stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const summaryLines = lines.filter((l) =>
      /^(📋|✅|🔍|ℹ️|⚠️|\[Auto-Rotate\])/.test(l)
    );
    const summary = summaryLines.slice(0, 8).join("\n") || lines.slice(-5).join("\n");

    console.log(`[Agent] Dispatch selesai daily-backup dryRun=${dryRun} force=${force}`);

    if (bot && !dryRun) {
      const targetId = String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
      if (targetId) {
        const msg = `💾 *Daily Backup Selesai*\n\n${summary}`;
        await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
          await bot.api.sendMessage(targetId, msg).catch(() => {});
        });
      }
    }

    return { ok: true, dryRun, force, summary, stderr: stderr?.trim() || "" };
  } catch (err) {
    const errMsg = err?.stderr?.trim() || err?.message || "Backup gagal dijalankan";
    console.error(`[DailyBackup] Error: ${errMsg}`);
    if (bot && !dryRun) {
      const targetId = String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
      if (targetId) {
        await bot.api
          .sendMessage(targetId, `⚠️ *Daily Backup Gagal*\n\n${errMsg.slice(0, 1200)}`)
          .catch(() => {});
      }
    }
    return { ok: false, error: errMsg };
  }
}

export function initDailyBackup(bot) {
  if (backupTimer) clearTimeout(backupTimer);
  const scheduleNext = () => {
    const delayMs = getMsUntilNext2AM();
    const hrs = (delayMs / 3600000).toFixed(2);
    console.log(`[DailyBackup] Terjadwal dalam ${hrs} jam (02:00 ${TIMEZONE}).`);
    backupTimer = setTimeout(async () => {
      await runDailyBackup({ bot }).catch(() => {});
      scheduleNext();
    }, delayMs);
  };
  scheduleNext();
}
