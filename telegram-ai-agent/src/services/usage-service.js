import fs from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import os from "node:os";
import { DATA_DIR } from "../config/env.js";

const USAGE_FILE = path.join(DATA_DIR, "usage-stats.json");

/**
 * Format angka token jadi string ramah baca (contoh: 12.4k, 1.2M, 520)
 */
export function formatTokenCount(num) {
  if (typeof num !== "number" || isNaN(num)) return "0";
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  }
  if (num >= 10_000) {
    return (num / 1_000).toFixed(1) + "k";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + "k";
  }
  return num.toLocaleString("id-ID");
}

/**
 * Dapatkan tanggal lokal hari ini (Asia/Jakarta, YYYY-MM-DD)
 */
export function getTodayKey() {
  const d = new Date();
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/**
 * Muat data statistik penggunaan token
 */
export async function loadUsageStats() {
  try {
    const raw = await readFile(USAGE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      daily: {},
      totals: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        requests: 0,
      },
      recentHistory: [],
    };
  }
}

/**
 * Simpan data statistik penggunaan token
 */
export async function saveUsageStats(stats) {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(USAGE_FILE, JSON.stringify(stats, null, 2), "utf8");
  } catch (err) {
    console.warn("[Usage Service] Gagal menyimpan usage stats:", err.message);
  }
}

/**
 * Hitung total token dari file transcript Antigravity CLI (.gemini/antigravity-cli/brain/<convId>)
 */
export async function getAgySessionTokens(convId) {
  if (!convId) return null;
  const brainDir = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain", convId);
  const candidates = [
    path.join(brainDir, ".system_generated", "logs", "transcript.jsonl"),
    path.join(brainDir, ".system_generated", "logs", "transcript_full.jsonl"),
  ];

  let targetFile = null;
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      targetFile = f;
      break;
    }
  }

  if (!targetFile) return null;

  try {
    const stream = fs.createReadStream(targetFile, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (typeof item.input_tokens === "number") inputTokens += item.input_tokens;
        if (typeof item.output_tokens === "number") outputTokens += item.output_tokens;
        if (typeof item.cache_read_tokens === "number") cacheReadTokens += item.cache_read_tokens;
      } catch {}
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens: inputTokens + outputTokens,
    };
  } catch (err) {
    console.warn(`[Usage Service] Gagal parse transcript ${convId}:`, err.message);
    return null;
  }
}

/**
 * Catat penambahan pemakaian token
 */
export async function recordUsage({
  userId = null,
  engine = "agy",
  model = "unknown",
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = null,
  convId = null,
}) {
  const actualInput = Math.max(0, Number(inputTokens) || 0);
  const actualOutput = Math.max(0, Number(outputTokens) || 0);
  const actualTotal = totalTokens !== null ? Number(totalTokens) : actualInput + actualOutput;

  if (actualTotal <= 0 && actualInput <= 0 && actualOutput <= 0) {
    return;
  }

  const today = getTodayKey();
  const stats = await loadUsageStats();

  if (!stats.daily[today]) {
    stats.daily[today] = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      requests: 0,
      byEngine: {},
      byModel: {},
    };
  }

  const day = stats.daily[today];
  day.totalInputTokens += actualInput;
  day.totalOutputTokens += actualOutput;
  day.totalTokens += actualTotal;
  day.requests = (day.requests || 0) + 1;

  // Breakdown by Engine
  if (!day.byEngine[engine]) {
    day.byEngine[engine] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
  }
  day.byEngine[engine].inputTokens += actualInput;
  day.byEngine[engine].outputTokens += actualOutput;
  day.byEngine[engine].totalTokens += actualTotal;
  day.byEngine[engine].requests += 1;

  // Breakdown by Model
  if (!day.byModel[model]) {
    day.byModel[model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
  }
  day.byModel[model].inputTokens += actualInput;
  day.byModel[model].outputTokens += actualOutput;
  day.byModel[model].totalTokens += actualTotal;
  day.byModel[model].requests += 1;

  // Totals All-Time
  stats.totals.totalInputTokens = (stats.totals.totalInputTokens || 0) + actualInput;
  stats.totals.totalOutputTokens = (stats.totals.totalOutputTokens || 0) + actualOutput;
  stats.totals.totalTokens = (stats.totals.totalTokens || 0) + actualTotal;
  stats.totals.requests = (stats.totals.requests || 0) + 1;

  // Recent History (maks 50)
  if (!Array.isArray(stats.recentHistory)) stats.recentHistory = [];
  stats.recentHistory.unshift({
    timestamp: new Date().toISOString(),
    userId,
    engine,
    model,
    inputTokens: actualInput,
    outputTokens: actualOutput,
    totalTokens: actualTotal,
    convId,
  });
  if (stats.recentHistory.length > 50) {
    stats.recentHistory = stats.recentHistory.slice(0, 50);
  }

  await saveUsageStats(stats);
  return { inputTokens: actualInput, outputTokens: actualOutput, totalTokens: actualTotal };
}

/**
 * Format laporan ringkasan penggunaan token untuk chat Telegram
 */
export async function getUsageReport({ activeEngine = "agy", activeModel = "default", convId = null }) {
  const stats = await loadUsageStats();
  const today = getTodayKey();
  const day = stats.daily[today] || {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    requests: 0,
    byEngine: {},
    byModel: {},
  };

  // Cek apakah ada session aktif agy untuk info real-time sesi ini
  let sessionStats = null;
  if (convId) {
    sessionStats = await getAgySessionTokens(convId);
  }

  let text = `📊 *Statistik Penggunaan Token AI*\n\n`;

  if (sessionStats && sessionStats.totalTokens > 0) {
    text += `💬 *Sesi Chat Ini (${activeModel}):*\n`;
    text += `• Input Tokens: \`${formatTokenCount(sessionStats.inputTokens)}\`\n`;
    text += `• Output Tokens: \`${formatTokenCount(sessionStats.outputTokens)}\`\n`;
    text += `• Total Sesi Ini: \`${formatTokenCount(sessionStats.totalTokens)}\`\n\n`;
  }

  text += `📅 *Pemakaian Hari Ini (${today}):*\n`;
  text += `• Input Tokens: \`${formatTokenCount(day.totalInputTokens)}\`\n`;
  text += `• Output Tokens: \`${formatTokenCount(day.totalOutputTokens)}\`\n`;
  text += `• Total Hari Ini: *${formatTokenCount(day.totalTokens)}*\n`;
  text += `• Total Request: \`${day.requests || 0} tugas\`\n\n`;

  // Engine Breakdown
  const engines = Object.keys(day.byEngine || {});
  if (engines.length > 0) {
    text += `⚙️ *Rincian per Engine (Hari Ini):*\n`;
    for (const eng of engines) {
      const e = day.byEngine[eng];
      const label =
        eng === "agy" ? "Antigravity CLI (agy)" :
        eng === "claude" ? "Claude Code CLI" :
        eng === "universal" ? "Universal / Pi Server" : eng;
      text += `• ${label}: \`${formatTokenCount(e.totalTokens)}\` (${e.requests}x)\n`;
    }
    text += "\n";
  }

  // Model Breakdown (jika ada lebih dari 1)
  const models = Object.keys(day.byModel || {});
  if (models.length > 1) {
    text += `🤖 *Rincian per Model:*\n`;
    for (const m of models) {
      const mod = day.byModel[m];
      text += `• \`${m}\`: \`${formatTokenCount(mod.totalTokens)}\`\n`;
    }
    text += "\n";
  }

  text += `📈 *Akumulasi Semua Waktu:*\n`;
  text += `• Total Token: \`${formatTokenCount(stats.totals?.totalTokens || 0)}\`\n`;
  text += `• Total Request: \`${stats.totals?.requests || 0} tugas\`\n\n`;
  text += `💡 _Gunakan \`/model\` untuk memilih model atau \`/engine\` untuk mengganti engine._`;

  return text;
}
