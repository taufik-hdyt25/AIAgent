import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const STATE_FILE = path.join(os.homedir(), ".th-agent", "data", "play-console-state.json");
const STUDIO_ENV = "/home/th-agent/projects/th-studio/.env";
let watcherTimer = null;

function readStudioDbUrl() {
  try {
    const raw = fs.readFileSync(STUDIO_ENV, "utf8");
    const m = raw.match(/^DATABASE_URL=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

export async function checkPlayConsoleStatus(bot = null) {
  const dbUrl = readStudioDbUrl();
  if (!dbUrl) return { ok: false, error: "DATABASE_URL TH Studio tidak ditemukan" };

  const sql = `SELECT json_agg(t) FROM (SELECT name, "packageName", version, "playStoreStatus" FROM "App" WHERE "isActive" = true ORDER BY name ASC) t;`;
  const raw = execSync(`PGSSLROOTCERT=system psql "${dbUrl}" -t -A -c '${sql}'`, {
    encoding: "utf8",
    timeout: 15_000,
  }).trim();

  const apps = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(apps)) return { ok: true, apps: [], changes: [] };

  const prev = loadState();
  const isFirstRun = Object.keys(prev).length === 0;
  const changes = [];
  const next = {};

  for (const app of apps) {
    const sig = `${app.version || "-"}|${app.playStoreStatus || "-"}`;
    next[app.packageName] = sig;
    if (!isFirstRun && prev[app.packageName] && prev[app.packageName] !== sig) {
      changes.push({
        name: app.name,
        packageName: app.packageName,
        before: prev[app.packageName],
        version: app.version || "-",
        status: app.playStoreStatus || "-",
      });
    }
  }

  saveState(next);

  if (changes.length && bot) {
    console.log(`[Agent] Dispatch selesai play-console-sync changes=${changes.length}`);
    const targetId =
      process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() ||
      String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
    if (targetId) {
      const lines = changes.map((c) => `• *${c.name}* (\`${c.packageName}\`): v${c.version} — ${c.status}`);
      const msg = `📱 *Update Status Play Console (TH Studio)*\n\n${lines.join("\n")}`;
      await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
        await bot.api.sendMessage(targetId, msg).catch(() => {});
      });
    }
  }

  return { ok: true, total: apps.length, changes };
}

export function initPlayConsoleWatcher(bot) {
  if (watcherTimer) clearInterval(watcherTimer);
  checkPlayConsoleStatus(null).catch(() => {});
  watcherTimer = setInterval(() => {
    checkPlayConsoleStatus(bot).catch(() => {});
  }, 6 * 60 * 60 * 1000);
  console.log("[PlayConsoleWatcher] Aktif (cek status Play Console TH Studio tiap 6 jam).");
}
