import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./env.js";

const MODELS_FILE = path.join(DATA_DIR, "models.json");

export const DEFAULT_AGY_MODELS = [
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium Thinking)", badge: "Rekomendasi" },
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High Thinking)", badge: "Maksimal" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low Thinking)", badge: "Cepat" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", badge: "Populer" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", badge: "Kuat" },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", badge: "Open" },
];

export const DEFAULT_CLAUDE_MODELS = [
  { id: "sonnet", name: "Claude Sonnet (Default - Cepat & Cerdas)", badge: "Default" },
  { id: "opus", name: "Claude Opus (Penalaran Kompleks & Mendalam)", badge: "Kuat" },
  { id: "haiku", name: "Claude Haiku (Ultra Cepat & Ringan)", badge: "Cepat" },
  { id: "fable", name: "Claude Fable (Experimental Creative Agent)", badge: "Eksperimental" },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Hybrid Reasoning)", badge: "Thinking" },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Coding Specialist)", badge: "Populer" },
  { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku (Fast & Cost Efficient)", badge: "Hemat" },
  { id: "claude-3-opus", name: "Claude 3 Opus (Deep Analysis)", badge: "Maksimal" },
];

export const DEFAULT_UNIVERSAL_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek Chat (V3 / V4 - Cepat & Cerdas)", badge: "Official" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1 - Penalaran Mendalam)", badge: "Official" },
  { id: "deepseek/deepseek-v4", name: "DeepSeek V4 (OpenRouter)", badge: "Terbaru" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (OpenRouter)", badge: "Rekomendasi" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (OpenRouter)", badge: "Thinking" },
  { id: "deepseek/deepseek-coder", name: "DeepSeek Coder (OpenRouter)", badge: "Koding" },
  { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Hybrid Reasoning)", badge: "Thinking" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Coding Specialist)", badge: "Populer" },
  { id: "openai/gpt-4o", name: "GPT-4o (Omni Flagship)", badge: "Flagship" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Cepat & Ringkas)", badge: "Cepat" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (Super Cepat)", badge: "Kilat" },
  { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B (Spesialis Koding)", badge: "Open" },
  { id: "inflection/inflection-3-pi", name: "Inflection 3 Pi (Conversational Assistant)", badge: "Pi AI" },
  { id: "inflection/inflection-3-productivity", name: "Inflection 3 Productivity (Pi Code & Task)", badge: "Pi AI" },
];

export const AVAILABLE_AGY_MODELS = DEFAULT_AGY_MODELS;
export const AVAILABLE_CLAUDE_MODELS = DEFAULT_CLAUDE_MODELS;
export const AVAILABLE_UNIVERSAL_MODELS = DEFAULT_UNIVERSAL_MODELS;
export const AVAILABLE_MODELS = AVAILABLE_AGY_MODELS;

// Helper membaca model kustom jika disimpan di data/models.json
export async function loadCustomModels() {
  try {
    const raw = await readFile(MODELS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Helper mendapatkan daftar model berdasarkan engine aktif
export async function getModelList(engine) {
  const custom = await loadCustomModels();
  if (engine === "claude") {
    return custom?.claudeModels || AVAILABLE_CLAUDE_MODELS;
  }
  if (engine === "universal") {
    const uniUrl = process.env.UNIVERSAL_BASE_URL;
    const uniKey = process.env.UNIVERSAL_API_KEY || "";
    if (uniUrl) {
      try {
        const remote = await fetchRemoteModels(uniUrl, uniKey);
        if (remote.length > 0) {
          const remoteIds = new Set(remote.map((r) => r.id));
          const filtered = (custom?.universalModels || AVAILABLE_UNIVERSAL_MODELS).filter(
            (d) => !remoteIds.has(d.id)
          );
          return [...remote, ...filtered];
        }
      } catch {
        // Fallback ke default
      }
    }
    return custom?.universalModels || AVAILABLE_UNIVERSAL_MODELS;
  }
  return custom?.agyModels || AVAILABLE_AGY_MODELS;
}

/**
 * Mengambil model pertama yang aktif dari remote server (dynamic fallback)
 */
export async function resolveDynamicUniversalModel(baseUrl, apiKey) {
  const targetUrl = baseUrl || process.env.UNIVERSAL_BASE_URL || "";
  const targetKey = apiKey !== undefined ? apiKey : (process.env.UNIVERSAL_API_KEY || "");
  if (!targetUrl) return "";

  try {
    const list = await fetchRemoteModels(targetUrl, targetKey);
    if (list && list.length > 0) {
      // 1. Cek apakah model yang dikonfigurasi pengguna ada di daftar server Pi
      const configuredModel = (process.env.UNIVERSAL_MODEL || "").trim().toLowerCase();
      if (configuredModel && configuredModel !== "auto") {
        const foundConfigured = list.find((m) => m.id.toLowerCase() === configuredModel);
        if (foundConfigured) return foundConfigured.id;
      }

      // 2. Ambil langsung model yang di-declare di server Pi (urutan pertama)
      return list[0].id;
    }
  } catch (_) {}

  return "";
}

// Fetch model real-time dari provider OpenAI-compatible (misal LiteLLM / OpenRouter / Ollama / custom server)
export async function fetchRemoteModels(baseUrl, apiKey) {
  if (!baseUrl) return [];
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const headers = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Coba beberapa variasi endpoint yang umum pada OpenAI-compatible & local LLM server
  const candidateEndpoints = [];
  if (cleanUrl.endsWith("/v1")) {
    const rootUrl = cleanUrl.slice(0, -3);
    candidateEndpoints.push(`${cleanUrl}/models`);
    candidateEndpoints.push(`${rootUrl}/models`);
    candidateEndpoints.push(`${rootUrl}/model_list`);
    candidateEndpoints.push(`${cleanUrl}/model_list`);
    candidateEndpoints.push(`${rootUrl}/api/tags`); // Format Ollama
  } else {
    candidateEndpoints.push(`${cleanUrl}/models`);
    candidateEndpoints.push(`${cleanUrl}/v1/models`);
    candidateEndpoints.push(`${cleanUrl}/model_list`);
    candidateEndpoints.push(`${cleanUrl}/v1/model_list`);
    candidateEndpoints.push(`${cleanUrl}/api/tags`);
  }

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
      } else if (Array.isArray(data?.data?.models)) {
        list = data.data.models;
      } else if (Array.isArray(data)) {
        list = data;
      } else if (data?.id || data?.name || data?.model || data?.model_name) {
        list = [data];
      }

      if (list.length > 0) {
        const mapped = list
          .map((item) => {
            const id =
              typeof item === "string"
                ? item
                : (item.id || item.model_name || item.model || item.name || "unknown");
            const name =
              typeof item === "object"
                ? (item.name || item.model_name || item.model || item.id || "Unknown")
                : String(item);
            return {
              id,
              name,
              badge: "Server",
              description: (typeof item === "object" && item.description) || "",
            };
          })
          .filter((m) => m.id && m.id !== "unknown");

        if (mapped.length > 0) {
          return mapped;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }

  return [];
}
