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
 * Scan seluruh transcript historical dari Antigravity CLI (.gemini/antigravity-cli/brain)
 * dan masukkan ke usage-stats.json agar pemakaian akumulasi token langsung terdata akurat.
 */
export async function backfillUsageFromBrainTranscripts(existingStats = null) {
  const brainDir = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
  const stats = existingStats || {
    daily: {},
    totals: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, requests: 0 },
    sessions: {},
    recentHistory: [],
    backfilled: false,
  };

  if (!stats.sessions) stats.sessions = {};
  if (!stats.daily) stats.daily = {};
  if (!stats.totals) {
    stats.totals = { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, requests: 0 };
  }

  if (!fs.existsSync(brainDir)) {
    stats.backfilled = true;
    return stats;
  }

  try {
    const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const convId = ent.name;
      const tf = path.join(brainDir, convId, ".system_generated", "logs", "transcript.jsonl");
      if (!fs.existsSync(tf)) continue;

      let sessionInput = 0;
      let sessionOutput = 0;

      try {
        const stream = fs.createReadStream(tf, { encoding: "utf8" });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (typeof item.input_tokens === "number" || typeof item.output_tokens === "number") {
              const inp = item.input_tokens || 0;
              const out = item.output_tokens || 0;
              const tot = inp + out;
              if (tot <= 0) continue;

              sessionInput += inp;
              sessionOutput += out;

              const dateStr = item.created_at
                ? new Date(item.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
                : getTodayKey();

              if (!stats.daily[dateStr]) {
                stats.daily[dateStr] = {
                  totalInputTokens: 0,
                  totalOutputTokens: 0,
                  totalTokens: 0,
                  requests: 0,
                  byEngine: {},
                  byModel: {},
                };
              }

              const d = stats.daily[dateStr];
              d.totalInputTokens += inp;
              d.totalOutputTokens += out;
              d.totalTokens += tot;
              d.requests = (d.requests || 0) + 1;

              if (!d.byEngine["agy"]) {
                d.byEngine["agy"] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
              }
              d.byEngine["agy"].inputTokens += inp;
              d.byEngine["agy"].outputTokens += out;
              d.byEngine["agy"].totalTokens += tot;
              d.byEngine["agy"].requests += 1;

              stats.totals.totalInputTokens += inp;
              stats.totals.totalOutputTokens += out;
              stats.totals.totalTokens += tot;
              stats.totals.requests += 1;
            }
          } catch {}
        }
      } catch (err) {
        console.warn(`[Usage Service] Gagal scan transcript ${convId}:`, err.message);
      }

      stats.sessions[convId] = {
        inputTokens: sessionInput,
        outputTokens: sessionOutput,
        totalTokens: sessionInput + sessionOutput,
      };
    }

    stats.backfilled = true;
    await saveUsageStats(stats);
  } catch (err) {
    console.warn("[Usage Service] Gagal backfill brain transcripts:", err.message);
  }

  return stats;
}

/**
 * Muat data statistik penggunaan token
 */
export async function loadUsageStats() {
  let stats;
  try {
    const raw = await readFile(USAGE_FILE, "utf8");
    stats = JSON.parse(raw);
  } catch {
    stats = {
      daily: {},
      totals: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        requests: 0,
      },
      sessions: {},
      recentHistory: [],
      backfilled: false,
    };
  }

  if (!stats.sessions) stats.sessions = {};
  if (!stats.daily) stats.daily = {};
  if (!stats.totals) {
    stats.totals = { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, requests: 0 };
  }

  // Auto-backfill jika belum pernah dilakukan atau data kosong
  if (!stats.backfilled || stats.totals.totalTokens === 0) {
    stats = await backfillUsageFromBrainTranscripts(stats);
  }

  return stats;
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
 * Catat pemakaian token sesi agy secara cerdas (hanya menghitung delta agar tidak dobel hitung)
 */
export async function recordAgySessionUsage({ convId, userId = null, model = "gemini-3.8-flash-high" }) {
  if (!convId) return null;
  const currentSessionTokens = await getAgySessionTokens(convId);
  if (!currentSessionTokens || currentSessionTokens.totalTokens <= 0) return null;

  const stats = await loadUsageStats();
  if (!stats.sessions) stats.sessions = {};

  const prev = stats.sessions[convId] || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const deltaInput = Math.max(0, currentSessionTokens.inputTokens - (prev.inputTokens || 0));
  const deltaOutput = Math.max(0, currentSessionTokens.outputTokens - (prev.outputTokens || 0));
  const deltaTotal = deltaInput + deltaOutput;

  stats.sessions[convId] = {
    inputTokens: currentSessionTokens.inputTokens,
    outputTokens: currentSessionTokens.outputTokens,
    totalTokens: currentSessionTokens.totalTokens,
  };

  if (deltaTotal > 0) {
    return await recordUsage({
      userId,
      engine: "agy",
      model,
      inputTokens: deltaInput,
      outputTokens: deltaOutput,
      totalTokens: deltaTotal,
      convId,
    });
  } else {
    await saveUsageStats(stats);
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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

  let text = `📊 *Statistik & Kuota Penggunaan Token AI*\n\n`;

  // Sesi Aktif
  if (sessionStats && sessionStats.totalTokens > 0) {
    text += `💬 *Sesi Chat Ini (${activeModel}):*\n`;
    text += `• Input Tokens: \`${formatTokenCount(sessionStats.inputTokens)}\`\n`;
    text += `• Output Tokens: \`${formatTokenCount(sessionStats.outputTokens)}\`\n`;
    text += `• Total Sesi Ini: *${formatTokenCount(sessionStats.totalTokens)} token*\n\n`;
  }

  // Hari Ini
  text += `📅 *Pemakaian Hari Ini (${today}):*\n`;
  text += `• Input Tokens: \`${formatTokenCount(day.totalInputTokens)}\`\n`;
  text += `• Output Tokens: \`${formatTokenCount(day.totalOutputTokens)}\`\n`;
  text += `• Total Hari Ini: *${formatTokenCount(day.totalTokens)} token*\n`;
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

  // Total Akumulasi
  text += `📈 *Total Akumulasi (Semua Waktu):*\n`;
  text += `• Total Input: \`${formatTokenCount(stats.totals?.totalInputTokens || 0)}\`\n`;
  text += `• Total Output: \`${formatTokenCount(stats.totals?.totalOutputTokens || 0)}\`\n`;
  text += `• *TOTAL TOKEN:* *${formatTokenCount(stats.totals?.totalTokens || 0)} token*\n`;
  text += `• Total Tugas AI: \`${stats.totals?.requests || 0} tugas\`\n\n`;

  // Penjelasan Kuota
  text += `ℹ️ *Status Batas / Kuota Token:*\n`;
  text += `• Bot tidak menerapkan batasan kuota hard cap (unmetered by bot).\n`;
  text += `• Pemakaian berjalan mengikuti kuota & rate limit akun provider (${activeEngine === "agy" ? "Google AI Antigravity" : activeEngine}).\n\n`;
  text += `💡 _Gunakan \`/model\` untuk memilih model atau \`/engine\` untuk mengganti engine._`;

  return text;
}
