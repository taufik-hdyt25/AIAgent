import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runProcess } from "./cli-runner.js";
import { createPiEventParser } from "./pi-event-parser.js";

const STATE_FILE = path.join(os.homedir(), ".th-agent", "data", "release-promo-state.json");
let watcherTimer = null;

async function runPiOneShot({ provider, model, prompt }) {
  const parser = createPiEventParser();
  const args = [
    "--mode", "json",
    "--print", prompt,
    "--no-session", "--no-tools", "--no-mcp", "--no-extensions",
    "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--thinking", "off",
    "--provider", provider,
    "--model", model,
  ];
  const res = await runProcess({
    command: process.env.PI_BIN || "pi",
    args,
    cwd: os.homedir(),
    timeoutMs: 55_000,
    maxTimeoutMs: 55_000,
    maxOutput: 48_000,
    env: { ...process.env, CI: "true", NONINTERACTIVE: "1" },
    onStdout: (c) => parser.push(c),
  });
  if (res.error || res.code !== 0) {
    throw new Error(String(res.stderr || res.error || "pi failed").slice(0, 200));
  }
  return (parser.getFinalText?.() || res.stdout || "").trim();
}

export async function runReleasePromoPipeline({ repoName, commitsText, bot = null }) {
  const coderProvider = process.env.PI_CODER_PROVIDER || "a2-codex";
  const coderModel = process.env.PI_CODER_MODEL || "gemini-4-hydrogen-xhigh";
  const writerProvider = process.env.PI_WRITER_PROVIDER || "a2-antigravity";
  const writerModel = process.env.PI_WRITER_MODEL || "gemini-2.5-flash";

  console.log(`[SpecialistRouter] role=coder provider=${coderProvider} model=${coderModel}`);
  const summary = await runPiOneShot({
    provider: coderProvider,
    model: coderModel,
    prompt: `Rangkum perubahan commit repo "${repoName}" berikut menjadi 3-5 poin manfaat user-facing yang singkat dalam Bahasa Indonesia:\n\n${commitsText}`,
  });

  console.log(`[SpecialistRouter] role=writer provider=${writerProvider} model=${writerModel}`);
  const promo = await runPiOneShot({
    provider: writerProvider,
    model: writerModel,
    prompt: `Dari ringkasan update aplikasi "${repoName}" berikut, buat:\n1) Release Notes Google Play (maks 400 karakter, ramah pengguna)\n2) Caption Promo IG/TikTok (singkat, menarik, + 5 hashtag)\n\nRingkasan:\n${summary}`,
  });

  console.log(`[Agent] Dispatch selesai release-promo repo=${repoName}`);

  if (bot) {
    const targetId =
      process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() ||
      String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
    if (targetId) {
      const msg = `🚀 *Auto-Release Notes & Promo (${repoName})*\n\n${promo}`;
      await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
        await bot.api.sendMessage(targetId, msg).catch(() => {});
      });
    }
  }

  return { repoName, summary, promo };
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

export async function pollTrackedReposForRelease(bot) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const reposRaw = process.env.RELEASE_PROMO_REPOS?.trim();
  if (!token || !reposRaw) return;

  const state = loadState();
  const repos = reposRaw.split(",").map((r) => r.trim()).filter(Boolean);

  for (const fullRepo of repos) {
    try {
      const res = await fetch(`https://api.github.com/repos/${fullRepo}/commits?per_page=3`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const commits = await res.json();
      if (!Array.isArray(commits) || !commits.length) continue;

      const latestSha = commits[0].sha;
      if (!state[fullRepo]) {
        state[fullRepo] = latestSha;
        saveState(state);
        continue;
      }
      if (state[fullRepo] !== latestSha) {
        state[fullRepo] = latestSha;
        saveState(state);
        const commitsText = commits.map((c) => `- ${c.commit?.message?.split("\n")[0] || c.sha.slice(0, 7)}`).join("\n");
        await runReleasePromoPipeline({ repoName: fullRepo.split("/").pop(), commitsText, bot });
      }
    } catch {}
  }
}

export function initReleasePromoWatcher(bot) {
  if (watcherTimer) clearInterval(watcherTimer);
  watcherTimer = setInterval(() => {
    pollTrackedReposForRelease(bot).catch(() => {});
  }, 10 * 60 * 1000);
  console.log("[ReleasePromo] Watcher aktif (interval 10 menit, plus endpoint /api/office/release-promo).");
}
