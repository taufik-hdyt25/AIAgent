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
    return custom?.universalModels || AVAILABLE_UNIVERSAL_MODELS;
  }
  return custom?.agyModels || AVAILABLE_AGY_MODELS;
}

// Fetch model real-time dari provider OpenAI-compatible (misal OpenRouter / v1/models)
export async function fetchRemoteModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) return [];
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${cleanUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map((item) => ({
    id: item.id,
    name: item.name || item.id,
    description: item.description || "",
  }));
}
