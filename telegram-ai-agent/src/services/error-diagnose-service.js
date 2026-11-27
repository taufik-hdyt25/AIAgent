import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { runProcess } from "./cli-runner.js";
import { createPiEventParser } from "./pi-event-parser.js";

const CRITICAL_PM2 = new Set(["th-studio", "artosku", "thquiz-admin", "folio-pdf-studio", "shopee-caption-ai"]);
const COOLDOWN_MS = 30 * 60 * 1000;
const lastAlertAt = new Map();
let diagnoseTimer = null;

async function diagnoseWithCoder(title, logSnippet) {
  const provider = process.env.PI_CODER_PROVIDER || "a2-codex";
  const model = process.env.PI_CODER_MODEL || "gemini-4-hydrogen-xhigh";
  console.log(`[SpecialistRouter] role=coder provider=${provider} model=${model}`);
  const parser = createPiEventParser();
  const prompt = `Diagnosa singkat (maks 4 poin) penyebab error pada "${title}" dan langkah perbaikannya dari log berikut:\n\n${logSnippet}`;
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
    timeoutMs: 45_000,
    maxTimeoutMs: 45_000,
    maxOutput: 24_000,
    env: { ...process.env, CI: "true", NONINTERACTIVE: "1" },
    onStdout: (c) => parser.push(c),
  });
  if (res.error || res.code !== 0) return "Tidak dapat menjalankan diagnosa Coder otomatis.";
  return (parser.getFinalText?.() || res.stdout || "").trim();
}

export async function runErrorDiagnoseCheck(bot = null) {
  const issues = [];

  for (const [name, url] of [
    ["pi-openai-proxy", "http://127.0.0.1:3099/healthz"],
    ["th-studio", "https://thstudio.web.id/api/healthz"],
  ]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) issues.push({ key: `http:${name}`, title: `${name} (HTTP ${r.status})`, log: `Endpoint ${url} mengembalikan HTTP ${r.status}` });
    } catch (err) {
      issues.push({ key: `http:${name}`, title: `${name} unreachable`, log: `${url}: ${err?.message || err}` });
    }
  }

  try {
    const raw = execSync("pm2 jlist 2>/dev/null", { encoding: "utf8" });
    for (const app of JSON.parse(raw)) {
      const name = app.name;
      const status = app.pm2_env?.status;
      if (CRITICAL_PM2.has(name) && status !== "online") {
        let log = `PM2 status=${status}`;
        try {
          const errLog = app.pm2_env?.pm_err_log_path;
          if (errLog && fs.existsSync(errLog)) {
            log = fs.readFileSync(errLog, "utf8").trim().split(/\r?\n/).slice(-20).join("\n");
          }
        } catch {}
        issues.push({ key: `pm2:${name}`, title: `PM2 ${name} (${status})`, log });
      }
    }
  } catch {}

  const now = Date.now();
  const actionable = issues.filter((it) => now - (lastAlertAt.get(it.key) || 0) > COOLDOWN_MS);
  if (!actionable.length) return { ok: true, issuesCount: 0 };

  const targetId =
    process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() ||
    String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();

  for (const it of actionable) {
    lastAlertAt.set(it.key, now);
    console.log(`[Server Sentry] Gangguan terdeteksi: ${it.title}, meminta diagnosa Coder...`);
    const diagnosis = await diagnoseWithCoder(it.title, it.log);
    console.log(`[Agent] Dispatch selesai error-diagnose target=${it.key}`);

    if (bot && targetId) {
      const msg = `🚨 *Sentry Alert & Auto-Diagnose*\n*Target:* ${it.title}\n\n${diagnosis}`;
      await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
        await bot.api.sendMessage(targetId, msg).catch(() => {});
      });
    }
  }

  return { ok: false, issuesCount: actionable.length };
}

export function initErrorDiagnoseWatcher(bot) {
  if (diagnoseTimer) clearInterval(diagnoseTimer);
  diagnoseTimer = setInterval(() => {
    runErrorDiagnoseCheck(bot).catch(() => {});
  }, 5 * 60 * 1000);
  console.log("[ErrorDiagnose] Watcher aktif (interval 5 menit, cooldown 30 menit).");
}
