import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fetchRemoteModels, normalizePiUrl, loadCustomModels, saveCustomModels } from "../config/models.js";
import { updateEnvFile } from "./env-service.js";
import { setUserPiModel, clearUserPiModels, pruneUserPiModels } from "./context-store.js";
import { getPiProviderRaw } from "./pi-provider-service.js";

/**
 * Sinkronisasi konfigurasi models.json untuk Pi CLI
 * agar Pi CLI bisa langsung menggunakan model-model dari URL server Pi
 */
export async function syncPiCliConfig(baseUrl, apiKey, models) {
  const piAgentDirs = [
    path.join(os.homedir(), ".pi", "agent"),
  ];

  for (const dir of piAgentDirs) {
    try {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, "models.json");

      // Pertahankan provider lain yang sudah dikelola lewat Web UI.
      let providers = {};
      try {
        const existing = JSON.parse(await readFile(file, "utf8"));
        if (existing && typeof existing.providers === "object" && existing.providers) {
          providers = existing.providers;
        }
      } catch (_) {}

      const providerId = process.env.PI_PROVIDER || "local-pi";
      providers[providerId] = {
        ...providers[providerId],
        baseUrl: baseUrl,
        api: providers[providerId]?.api || "openai-completions",
        apiKey: apiKey || "sk-local",
        models: (models || []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
        })),
      };

      const configContent = {
        $schema: "https://pi.dev/schemas/models.schema.json",
        providers,
      };

      await writeFile(file, JSON.stringify(configContent, null, 2) + "\n", "utf8");
    } catch (err) {
      throw new Error(`Gagal menyimpan konfigurasi Pi CLI: ${err.message}`);
    }
  }
}

/**
 * Folder penyimpanan sesi Pi untuk sebuah working directory.
 * Contoh: /home/ubuntu/.th-agent -> --home-ubuntu-.th-agent--
 */
function getPiSessionDir(cwd) {
  const normalized = path.resolve(cwd).replace(/^[/\\]+/, "").replace(/[/\\]/g, "-");
  return path.join(os.homedir(), ".pi", "agent", "sessions", `--${normalized}--`);
}

function isEmptyAssistantEntry(entry) {
  if (!entry || entry.type !== "message" || entry.message?.role !== "assistant") return false;
  const content = entry.message.content;
  if (typeof content === "string") return !content.trim();
  if (!Array.isArray(content)) return true;
  const hasText = content.some((part) => part?.type === "text" && String(part?.text || "").trim());
  const hasToolCall = content.some((part) => part?.type === "toolCall" || part?.type === "tool_call");
  return !hasText && !hasToolCall;
}

function hasTextContent(content) {
  if (typeof content === "string") return Boolean(content.trim());
  if (!Array.isArray(content)) return false;
  return content.some((part) => part?.type === "text" && String(part?.text || "").trim());
}

/**
 * Membersihkan sesi Pi dari dua kondisi yang membuat model terus membalas kosong:
 * 1. Entri assistant dengan content kosong (rantai parentId disambung ulang).
 * 2. Giliran user yang tidak pernah mendapat jawaban setelah balasan terakhir.
 */
export async function repairPiSession(cwd, sessionId) {
  if (!cwd || !sessionId) return { repaired: 0, truncated: 0, file: null };

  const sessionDir = getPiSessionDir(cwd);
  let files = [];
  try {
    files = await readdir(sessionDir);
  } catch {
    return { repaired: 0, truncated: 0, file: null };
  }

  const fileName = files.find((name) => name.endsWith(`_${sessionId}.jsonl`));
  if (!fileName) return { repaired: 0, truncated: 0, file: null };

  const file = path.join(sessionDir, fileName);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { repaired: 0, truncated: 0, file: null };
  }

  const lines = raw.split("\n");
  const entries = lines.map((line) => {
    if (!line.trim()) return { line, entry: null };
    try {
      return { line, entry: JSON.parse(line) };
    } catch {
      return { line, entry: null };
    }
  });

  const removed = new Map();
  for (const { entry } of entries) {
    if (isEmptyAssistantEntry(entry) && entry.id) {
      removed.set(entry.id, entry.parentId ?? null);
    }
  }

  const resolveParent = (parentId) => {
    let current = parentId;
    const seen = new Set();
    while (current && removed.has(current) && !seen.has(current)) {
      seen.add(current);
      current = removed.get(current);
    }
    return current ?? null;
  };

  const kept = [];
  for (const item of entries) {
    const { entry } = item;
    if (entry) {
      if (removed.has(entry.id)) continue;
      if (Object.prototype.hasOwnProperty.call(entry, "parentId")) {
        const nextParent = resolveParent(entry.parentId);
        if (nextParent !== entry.parentId) entry.parentId = nextParent;
      }
    }
    kept.push(item);
  }

  let lastAnswerIndex = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    const entry = kept[i].entry;
    if (
      entry &&
      entry.type === "message" &&
      entry.message?.role === "assistant" &&
      hasTextContent(entry.message.content)
    ) {
      lastAnswerIndex = i;
      break;
    }
  }

  let truncated = 0;
  if (lastAnswerIndex !== -1) {
    const tail = kept.slice(lastAnswerIndex + 1);
    const hasUserTurn = tail.some(
      ({ entry }) => entry && entry.type === "message" && entry.message?.role === "user"
    );
    const hasToolResult = tail.some(
      ({ entry }) => entry && entry.type === "message" && entry.message?.role === "toolResult"
    );
    if (hasUserTurn && !hasToolResult) {
      truncated = tail.filter(({ entry }) => entry).length;
      kept.length = lastAnswerIndex + 1;
    }
  }

  if (removed.size === 0 && truncated === 0) {
    return { repaired: 0, truncated: 0, file };
  }

  const output = kept.map(({ line, entry }) => (entry ? JSON.stringify(entry) : line));
  const content = `${output.join("\n").replace(/\n+$/, "")}\n`;

  try {
    const tempFile = `${file}.tmp-${process.pid}`;
    await writeFile(tempFile, content, "utf8");
    await rename(tempFile, file);
  } catch (err) {
    console.warn("[PiService] Gagal memperbaiki sesi Pi:", err.message);
    return { repaired: 0, truncated: 0, file };
  }

  return { repaired: removed.size, truncated, file };
}

const DATA_URI_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi;
const SAFE_LIMITS = { text: 12000, thinking: 4000, toolCall: 20000 };
const AGGRESSIVE_LIMITS = { text: 4000, thinking: 1500, toolCall: 6000 };
const MIN_SANITIZE_BYTES = 64 * 1024;
const PRUNE_ABOVE_BYTES = 2.5 * 1024 * 1024;

export function isContextOverflowMessage(text) {
  if (!text) return false;
  return /exceeds the context window|context[ _-]?length[ _-]?(exceeded|exceeds|limit)|maximum context length|input is too long|prompt is too long|too many tokens/i.test(
    String(text)
  );
}

function stripInlineData(text) {
  if (typeof text !== "string" || !text.includes("base64,")) return text;
  return text.replace(DATA_URI_PATTERN, "[gambar inline base64 dihapus otomatis untuk menghemat context window]");
}

function clipText(text, limit) {
  if (typeof text !== "string" || text.length <= limit) return text;
  const head = Math.max(1, Math.floor(limit * 0.7));
  const tail = Math.max(0, limit - head);
  const removed = text.length - limit;
  const marker = `\n\n[... ${removed} karakter dipotong otomatis agar konteks tidak overflow ...]\n\n`;
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(-tail) : ""}`;
}

function sanitizeContent(content, limits) {
  if (typeof content === "string") {
    const next = clipText(stripInlineData(content), limits.text);
    return { content: next, changed: next !== content };
  }
  if (!Array.isArray(content)) return { content, changed: false };

  let changed = false;
  const next = content.map((part) => {
    if (!part || typeof part !== "object") return part;

    if (part.type === "image" || part.type === "image_url") {
      changed = true;
      return { type: "text", text: "[gambar lama dihapus dari riwayat agar konteks tidak overflow]" };
    }

    let partChanged = false;
    const clone = { ...part };

    for (const field of ["text", "thinking"]) {
      if (typeof clone[field] === "string") {
        const limit = field === "thinking" ? limits.thinking : limits.text;
        const value = clipText(stripInlineData(clone[field]), limit);
        if (value !== clone[field]) {
          clone[field] = value;
          partChanged = true;
        }
      }
    }

    if (clone.arguments !== undefined && (clone.type === "toolCall" || clone.type === "tool_call")) {
      const asString = typeof clone.arguments === "string";
      let raw = null;
      try {
        raw = asString ? clone.arguments : JSON.stringify(clone.arguments);
      } catch {
        raw = null;
      }
      if (raw && raw.length > limits.toolCall) {
        clone.arguments = { _truncated: true, note: `Argumen tool dipotong otomatis (${raw.length} karakter)` };
        partChanged = true;
      } else if (raw) {
        const cleaned = stripInlineData(raw);
        if (cleaned !== raw) {
          if (asString) {
            clone.arguments = cleaned;
          } else {
            try {
              clone.arguments = JSON.parse(cleaned);
            } catch {
              clone.arguments = cleaned;
            }
          }
          partChanged = true;
        }
      }
    }

    if (!partChanged) return part;
    changed = true;
    return clone;
  });

  return { content: next, changed };
}

function findPiSessionFile(files, sessionId) {
  return files.find((name) => name.endsWith(`_${sessionId}.jsonl`)) || null;
}

/**
 * Menyusutkan pesan raksasa di file sesi Pi (mis. gambar base64 inline atau
 * output tool yang sangat panjang) agar request tidak melewati context window.
 */
export async function sanitizePiSession(cwd, sessionId, { aggressive = false, force = false } = {}) {
  const empty = { changed: 0, bytesBefore: 0, bytesAfter: 0, file: null };
  if (!cwd || !sessionId) return empty;

  const sessionDir = getPiSessionDir(cwd);
  let fileName = null;
  try {
    fileName = findPiSessionFile(await readdir(sessionDir), sessionId);
  } catch {
    return empty;
  }
  if (!fileName) return empty;

  const file = path.join(sessionDir, fileName);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return empty;
  }

  const bytesBefore = Buffer.byteLength(raw);
  if (!force && bytesBefore < MIN_SANITIZE_BYTES) {
    return { changed: 0, bytesBefore, bytesAfter: bytesBefore, file };
  }

  const limits = aggressive ? AGGRESSIVE_LIMITS : SAFE_LIMITS;
  let changed = 0;
  const output = raw.split("\n").map((line) => {
    if (!line.trim()) return line;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return line;
    }
    if (!entry || entry.type !== "message" || !entry.message) return line;

    const result = sanitizeContent(entry.message.content, limits);
    if (!result.changed) return line;
    entry.message = { ...entry.message, content: result.content };
    changed += 1;
    return JSON.stringify(entry);
  });

  if (changed === 0) {
    return { changed: 0, bytesBefore, bytesAfter: bytesBefore, file };
  }

  const text = `${output.join("\n").replace(/\n+$/, "")}\n`;
  try {
    const tempFile = `${file}.tmp-${process.pid}`;
    await writeFile(tempFile, text, "utf8");
    await rename(tempFile, file);
  } catch (err) {
    console.warn("[PiService] Gagal menyusutkan sesi Pi:", err.message);
    return { changed: 0, bytesBefore, bytesAfter: bytesBefore, file };
  }

  return { changed, bytesBefore, bytesAfter: Buffer.byteLength(text), file };
}

/**
 * Pemulihan terakhir: buang riwayat lama, sisakan ringkasan compaction terakhir
 * plus beberapa pesan terbaru. Dipakai hanya saat sesi tetap overflow.
 */
export async function prunePiSessionHistory(cwd, sessionId, { keepMessages = 16 } = {}) {
  const empty = { pruned: 0, bytesBefore: 0, bytesAfter: 0, file: null };
  if (!cwd || !sessionId) return empty;

  const sessionDir = getPiSessionDir(cwd);
  let fileName = null;
  try {
    fileName = findPiSessionFile(await readdir(sessionDir), sessionId);
  } catch {
    return empty;
  }
  if (!fileName) return empty;

  const file = path.join(sessionDir, fileName);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return empty;
  }

  const parsed = raw
    .split("\n")
    .map((line) => {
      if (!line.trim()) return null;
      try {
        return { line, entry: JSON.parse(line) };
      } catch {
        return { line, entry: null };
      }
    })
    .filter(Boolean);

  const valid = parsed.filter((item) => item.entry);
  const header = valid.find((item) => item.entry.type === "session") || null;
  const lastCompaction = valid.filter((item) => item.entry.type === "compaction").pop();
  const messages = valid.filter((item) => item.entry.type === "message");
  if (messages.length <= keepMessages) return empty;

  const keptMessages = messages.slice(-keepMessages);
  const keptIds = new Set(keptMessages.map((item) => item.entry.id).filter(Boolean));
  const anchorId = lastCompaction?.entry?.id ?? null;

  for (const { entry } of keptMessages) {
    if (entry.parentId && !keptIds.has(entry.parentId)) entry.parentId = anchorId;
  }
  if (lastCompaction?.entry) {
    lastCompaction.entry.parentId = null;
    if (lastCompaction.entry.firstKeptEntryId && !keptIds.has(lastCompaction.entry.firstKeptEntryId)) {
      lastCompaction.entry.firstKeptEntryId = keptMessages[0]?.entry?.id ?? lastCompaction.entry.firstKeptEntryId;
    }
  }
  const kept = [];
  if (header) kept.push(header);
  if (lastCompaction) kept.push(lastCompaction);
  kept.push(...keptMessages);

  const text = `${kept.map((item) => JSON.stringify(item.entry)).join("\n")}\n`;
  try {
    const tempFile = `${file}.tmp-${process.pid}`;
    await writeFile(tempFile, text, "utf8");
    await rename(tempFile, file);
  } catch (err) {
    console.warn("[PiService] Gagal memangkas riwayat sesi Pi:", err.message);
    return empty;
  }

  return {
    pruned: messages.length - keptMessages.length,
    bytesBefore: Buffer.byteLength(raw),
    bytesAfter: Buffer.byteLength(text),
    file,
  };
}

export async function shrinkPiSessionForContext(cwd, sessionId, { aggressive = true, pruneAboveBytes = PRUNE_ABOVE_BYTES } = {}) {
  const result = await sanitizePiSession(cwd, sessionId, { aggressive, force: true });
  if (result.bytesAfter > pruneAboveBytes) {
    const pruned = await prunePiSessionHistory(cwd, sessionId);
    if (pruned.pruned > 0) {
      return { ...result, ...pruned, changed: result.changed + pruned.pruned };
    }
  }
  return { ...result, pruned: 0 };
}

// Sync only when the active Pi provider points to this CLIProxy instance.
// An explicitly curated allowlist must never be replaced automatically.
export async function syncCpaModelsIfActive(cpaUrl, models) {
  const providerId = process.env.PI_PROVIDER || "local-pi";
  const provider = await getPiProviderRaw(providerId);
  const activeUrl = process.env.PI_SERVER_URL || provider?.baseUrl || "";
  const canonical = (url) => normalizePiUrl(url).replace(/\/v1$/, "");
  if (!activeUrl || canonical(activeUrl) !== canonical(cpaUrl)) {
    return { synced: false, skipped: true, message: "Provider Pi aktif tidak menggunakan endpoint CLIProxy ini." };
  }
  if (!Array.isArray(models) || !models.length) {
    return { synced: false, message: "CLIProxy belum menyediakan daftar model; konfigurasi lama dipertahankan." };
  }
  const custom = await loadCustomModels();
  if (custom?.piProvider === providerId && Array.isArray(custom.piModels)) {
    const ids = (list) => list.map((m) => typeof m === "string" ? m : m.id).filter(Boolean).sort();
    if (JSON.stringify(ids(custom.piModels)) !== JSON.stringify(ids(provider?.models || []))) {
      return { synced: false, message: "Daftar model kustom dipertahankan. Gunakan Get Model untuk menggantinya." };
    }
  }
  const result = await syncPiModelDirectly(activeUrl, process.env.PI_SERVER_API_KEY || provider?.apiKey || "", null, null, models);
  return { synced: result.ok, activeModel: result.activeModel, count: models.length, message: result.error };
}

/**
 * Mengambil model langsung dari server Pi (GET /models, /v1/models, atau /api/tags)
 * dan langsung mengaktifkannya sebagai model default
 */
export async function syncPiModelDirectly(baseUrl, apiKey, userId, selectModel = null, suppliedModels = null) {
  const targetUrl = normalizePiUrl(baseUrl || process.env.PI_SERVER_URL || "http://127.0.0.1:46315/v1");
  const targetKey = apiKey !== undefined ? apiKey : (process.env.PI_SERVER_API_KEY || "");

  const models = suppliedModels || await fetchRemoteModels(targetUrl, targetKey);
  if (!models || models.length === 0) {
    return {
      ok: false,
      error: `Tidak ada model ditemukan di endpoint server Pi (${targetUrl})`,
      allModels: [],
    };
  }

  // Simpan daftar model dari Pi ke data/models.json
  try {
    const custom = (await loadCustomModels()) || {};
    custom.piModels = models;
    custom.piProvider = process.env.PI_PROVIDER || "local-pi";
    if (!await saveCustomModels(custom)) throw new Error("Gagal menyimpan daftar model.");
  } catch (err) {
    throw new Error(`Gagal menyimpan model: ${err.message}`);
  }

  // Sinkronkan model ke provider Pi yang sedang aktif.
  await syncPiCliConfig(targetUrl, targetKey, models);

  // Pilih model langsung sesuai yang di-declare di server Pi:
  // 1. Cek parameter selectModel jika ada
  let chosenModel = null;
  if (selectModel) {
    chosenModel = models.find((m) => m.id.toLowerCase() === selectModel.toLowerCase());
  }

  // 2. Cek apakah ada model yang sudah dikonfigurasi pengguna di PI_MODEL
  if (!chosenModel) {
    const configured = (process.env.PI_MODEL || "").trim().toLowerCase();
    if (configured && configured !== "auto") {
      chosenModel = models.find((m) => m.id.toLowerCase() === configured);
    }
  }

  // 3. Jika tidak ada atau belum diatur khusus, gunakan model pertama dari server Pi
  if (!chosenModel) {
    chosenModel = models[0];
  }

  const chosenId = chosenModel.id;

  // Simpan ke .env & update process.env
  const envUpdates = {
    PI_SERVER_URL: targetUrl,
    PI_MODEL: chosenId,
  };
  if (apiKey) {
    envUpdates.PI_SERVER_API_KEY = apiKey;
  }
  await updateEnvFile(envUpdates);
  if (suppliedModels) await pruneUserPiModels(models.map((m) => m.id));
  else await clearUserPiModels();

  if (userId) {
    await setUserPiModel(userId, chosenId);
  }

  return {
    ok: true,
    activeModel: chosenId,
    activeName: chosenModel.name || chosenId,
    allModels: models,
    serverUrl: targetUrl,
  };
}
