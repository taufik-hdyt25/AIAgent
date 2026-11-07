import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DATA_DIR } from "./env.js";
import { getPiProviderRaw } from "../services/pi-provider-service.js";

const MODELS_FILE = path.join(DATA_DIR, "models.json");

export const DEFAULT_PI_MODELS = [
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq - Ultra Cepat)", badge: "Rekomendasi" },
  { id: "pi-deepseek-r1-7b", name: "DeepSeek R1 7B (Local Pi Server)", badge: "Lokal" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant (Groq)", badge: "Cepat" },
];

export const AVAILABLE_PI_MODELS = DEFAULT_PI_MODELS;

// Helper membaca model kustom jika disimpan di data/models.json
export async function loadCustomModels() {
  try {
    const raw = await readFile(MODELS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Helper menyimpan model kustom ke data/models.json
export async function saveCustomModels(customData) {
  try {
    await writeFile(MODELS_FILE, JSON.stringify(customData, null, 2) + "\n", "utf8");
    const altPath = path.join(os.homedir(), ".th-agent", "data", "models.json");
    if (altPath !== MODELS_FILE) {
      await writeFile(altPath, JSON.stringify(customData, null, 2) + "\n", "utf8").catch(() => {});
    }
    return true;
  } catch (err) {
    console.error("[Models] Gagal menyimpan custom models:", err.message);
    return false;
  }
}

// Helper mendapatkan daftar model berdasarkan engine aktif
// Jika pengguna mengonfigurasi daftar model kustom untuk engine ini,
// HANYA MODEL YANG DITAMBAHKAN YANG BOLEH MUNCUL!
function normalizeModelEntry(model, badge) {
  const id = (typeof model === "string" ? model : model?.id || "").trim();
  if (!id) return null;
  const name = (typeof model === "object" && model?.name ? String(model.name) : id).trim() || id;
  return { id, name, ...(badge ? { badge } : {}) };
}

export async function getActivePiProviderModels() {
  const providerId = process.env.PI_PROVIDER || "local-pi";
  const provider = await getPiProviderRaw(providerId).catch(() => null);

  // Daftar kustom/whitelist hanya berlaku untuk provider tempat ia dibuat.
  // Jika provider berganti, daftar milik provider lama tidak ikut tampil.
  const custom = await loadCustomModels();
  if (custom && custom.piProvider === providerId && Array.isArray(custom.piModels)) {
    return custom.piModels
      .map((m) => normalizeModelEntry(m, m?.badge))
      .filter(Boolean);
  }

  if (provider && Array.isArray(provider.models) && provider.models.length > 0) {
    const badge = provider.name && provider.name !== providerId ? provider.name : providerId;
    return provider.models.map((m) => normalizeModelEntry(m, badge)).filter(Boolean);
  }

  return [];
}

export async function getModelList() {
  // Model selalu mengikuti provider yang sedang aktif (PI_PROVIDER).
  const providerModels = await getActivePiProviderModels();
  if (providerModels.length > 0) {
    return providerModels;
  }

  const custom = await loadCustomModels();
  if (custom && Array.isArray(custom.piModels) && custom.piModels.length > 0) {
    return custom.piModels;
  }

  const serverUrl = process.env.PI_SERVER_URL;
  const serverKey = process.env.PI_SERVER_API_KEY || "";
  if (serverUrl) {
    try {
      const remote = await fetchRemoteModels(serverUrl, serverKey);
      if (remote.length > 0) {
        return remote;
      }
    } catch {}
  }
  return AVAILABLE_PI_MODELS;
}

/**
 * Normalisasi URL server Pi / OpenAI-compatible endpoint
 */
export function normalizePiUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url = rawUrl.trim();
  if (!url) return "";

  // Auto-tambahkan http:// jika belum ada skema
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = (url.includes(":") || url.includes("localhost") || /^(\d{1,3}\.){3}\d{1,3}/.test(url))
      ? "http://" + url
      : "https://" + url;
  }

  // Bersihkan trailing slash
  url = url.replace(/\/+$/, "");

  // Bersihkan path endpoint spesifik jika pengguna memasukkan link lengkap
  const suffixesToStrip = [
    "/chat/completions",
    "/v1/chat/completions",
    "/models",
    "/v1/models",
    "/model_list",
    "/v1/model_list",
    "/model/info",
    "/v1/model/info",
    "/api/tags",
  ];
  for (const suffix of suffixesToStrip) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }

  return url;
}

// Fetch model real-time dari provider OpenAI-compatible (misal Pi Server / LiteLLM / OpenRouter / Ollama)
export async function fetchRemoteModels(baseUrl, apiKey) {
  if (!baseUrl) return [];
  const cleanUrl = normalizePiUrl(baseUrl);
  if (!cleanUrl) return [];

  const headers = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Coba beberapa variasi endpoint yang umum pada OpenAI-compatible & local LLM server di Pi
  const candidateEndpoints = [];
  if (cleanUrl.endsWith("/v1")) {
    const rootUrl = cleanUrl.slice(0, -3);
    candidateEndpoints.push(`${cleanUrl}/models`);
    candidateEndpoints.push(`${rootUrl}/models`);
    candidateEndpoints.push(`${cleanUrl}/model_list`);
    candidateEndpoints.push(`${rootUrl}/model_list`);
    candidateEndpoints.push(`${cleanUrl}/model/info`);
    candidateEndpoints.push(`${rootUrl}/model/info`);
    candidateEndpoints.push(`${rootUrl}/api/tags`); // Format Ollama
    candidateEndpoints.push(`${cleanUrl}/api/tags`);
  } else {
    candidateEndpoints.push(`${cleanUrl}/v1/models`);
    candidateEndpoints.push(`${cleanUrl}/models`);
    candidateEndpoints.push(`${cleanUrl}/v1/model_list`);
    candidateEndpoints.push(`${cleanUrl}/model_list`);
    candidateEndpoints.push(`${cleanUrl}/v1/model/info`);
    candidateEndpoints.push(`${cleanUrl}/model/info`);
    candidateEndpoints.push(`${cleanUrl}/api/tags`);
  }

  // Tambahkan juga link mentah jika pengguna memasukkan endpoint langsung
  const rawClean = baseUrl.trim().replace(/\/+$/, "");
  if (rawClean && !candidateEndpoints.includes(rawClean)) {
    candidateEndpoints.push(rawClean);
  }

  const allFoundModels = new Map();

  for (const endpoint of candidateEndpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(endpoint, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) continue;

      const data = await res.json();
      let list = [];
      if (Array.isArray(data?.data)) {
        list = data.data;
      } else if (Array.isArray(data?.models)) {
        list = data.models;
      } else if (Array.isArray(data?.model_list)) {
        list = data.model_list;
      } else if (Array.isArray(data?.data?.models)) {
        list = data.data.models;
      } else if (Array.isArray(data?.data?.model_list)) {
        list = data.data.model_list;
      } else if (Array.isArray(data?.result)) {
        list = data.result;
      } else if (Array.isArray(data?.items)) {
        list = data.items;
      } else if (Array.isArray(data?.data?.items)) {
        list = data.data.items;
      } else if (Array.isArray(data)) {
        list = data;
      } else if (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) {
        // Format dictionary LiteLLM /model/info: { data: { "claude-3-5-sonnet": { ... } } }
        list = Object.entries(data.data).map(([key, val]) => {
          if (typeof val === "object" && val !== null) {
            return { id: val.model_name || val.id || val.model || key, ...val };
          }
          return { id: key, name: String(val) };
        });
      } else if (data?.id || data?.name || data?.model || data?.model_name) {
        list = [data];
      }

      if (list.length > 0) {
        for (const item of list) {
          const id = (
            typeof item === "string"
              ? item
              : (item?.id || item?.model_name || item?.model || item?.name || "")
          ).trim();
          const name = (
            typeof item === "object"
              ? (item?.name || item?.model_name || item?.model || item?.id || id)
              : String(item)
          ).trim();

          if (id && id !== "unknown") {
            const key = id.toLowerCase();
            if (!allFoundModels.has(key)) {
              allFoundModels.set(key, {
                id,
                name: name || id,
                badge: "Pi",
                description: (typeof item === "object" && item?.description) || "",
              });
            }
          }
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }

  return Array.from(allFoundModels.values());
}
