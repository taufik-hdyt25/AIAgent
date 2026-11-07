import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
 * Dapatkan informasi kapasitas context window (total token yang tersedia dari model)
 */
export function getModelCapacity(modelId = "") {
  const m = String(modelId || "").toLowerCase();
  if (m.includes("flash")) {
    return {
      contextWindow: 1_048_576,
      contextDisplay: "1.05M (1.048.576 token)",
      maxOutput: "65.5k token",
      type: "Ultra Large Context Window",
    };
  }
  if (m.includes("pro")) {
    return {
      contextWindow: 2_097_152,
      contextDisplay: "2.10M (2.097.152 token)",
      maxOutput: "65.5k token",
      type: "Extreme Large Context Window",
    };
  }
  if (m.includes("claude-3-7") || m.includes("claude-3.7")) {
    return {
      contextWindow: 200_000,
      contextDisplay: "200k (200.000 token)",
      maxOutput: "64k token",
      type: "Hybrid Reasoning Context Window",
    };
  }
  if (m.includes("claude") || m.includes("sonnet") || m.includes("opus") || m.includes("haiku")) {
    return {
      contextWindow: 200_000,
      contextDisplay: "200k (200.000 token)",
      maxOutput: "8.19k token",
      type: "Standard Long Context Window",
    };
  }
  if (m.includes("gpt-oss") || m.includes("qwen") || m.includes("deepseek")) {
    return {
      contextWindow: 131_072,
      contextDisplay: "131k (131.072 token)",
      maxOutput: "8.19k token",
      type: "Open Model Context Window",
    };
  }
  return {
    contextWindow: 1_048_576,
    contextDisplay: "1.05M (1.048.576 token)",
    maxOutput: "65.5k token",
    type: "Default Context Window",
  };
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
 * Catat penambahan pemakaian token
 */
export async function recordUsage({
  userId = null,
  engine = "pi",
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
 * Format nama model yang ramah dibaca
 */
export function getModelDisplayName(modelId) {
  if (!modelId || modelId === "default") return "Default Model";
  const id = String(modelId).toLowerCase();
  if (id === "gemini-3.8-flash-high") return "Gemini 3.8 Flash (High Thinking)";
  if (id === "gemini-3.8-flash-medium") return "Gemini 3.8 Flash (Medium Thinking)";
  if (id === "gemini-3.8-flash-low") return "Gemini 3.8 Flash (Low Thinking)";
  if (id.includes("claude-3-7-sonnet") || id.includes("claude-3.7-sonnet")) return "Claude 3.7 Sonnet (Hybrid Reasoning)";
  if (id.includes("claude-3-5-sonnet") || id.includes("claude-3.5-sonnet")) return "Claude 3.5 Sonnet (Coding Specialist)";
  if (id.includes("claude-sonnet-4-6")) return "Claude Sonnet 4.6 (Thinking)";
  if (id.includes("claude-opus-4-6")) return "Claude Opus 4.6 (Thinking)";
  if (id.includes("gpt-oss-120b")) return "GPT-OSS 120B (Medium)";
  if (id.includes("qwen")) return "Qwen 2.5 Coder (Pi)";
  if (id.includes("deepseek")) return "DeepSeek R1 (Pi)";
  return modelId;
}

/**
 * Format laporan ringkasan penggunaan token untuk chat Telegram
 */
export async function getUsageReport({ activeModel = "default" } = {}) {
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

  const modelName = getModelDisplayName(activeModel);
  const capacity = getModelCapacity(activeModel);
  const engineLabel = "Pi Coding Agent CLI (pi)";

  let text = `📊 *Statistik Token (Current Model)*\n\n`;

  // Info Langsung Current Model & Kapasitasnya
  text += `🤖 *Current Model:* *${modelName}*\n`;
  text += `⚙️ *Engine:* ${engineLabel} (\`${activeModel}\`)\n`;
  text += `🧠 *Total Kapasitas (Context Window):* *${capacity.contextDisplay}*\n`;
  text += `⚡ *Batas Output per Turn:* \`${capacity.maxOutput}\`\n\n`;

  // Hari Ini
  text += `📅 *Pemakaian Hari Ini (${today}):*\n`;
  text += `• Total Hari Ini: *${formatTokenCount(day.totalTokens)} token* (\`${day.requests || 0} tugas\`)\n`;
  text += `• Rincian: \`${formatTokenCount(day.totalInputTokens)}\` in / \`${formatTokenCount(day.totalOutputTokens)}\` out\n\n`;

  // Total Akumulasi
  text += `📈 *Akumulasi Semua Waktu:*\n`;
  text += `• TOTAL TOKEN: *${formatTokenCount(stats.totals?.totalTokens || 0)} token* (\`${stats.totals?.requests || 0} tugas\`)\n\n`;

  // Penjelasan Kuota
  text += `ℹ️ *Status Kuota Token:*\n`;
  text += `• Bot tidak menerapkan batasan kuota hard cap (unmetered by bot).\n`;
  text += `• Berjalan sesuai kapasitas kuota & rate limit akun provider (${engineLabel}).\n\n`;
  text += `💡 _Gunakan \`/model\` untuk memilih model._`;

  return text;
}
