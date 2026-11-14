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
