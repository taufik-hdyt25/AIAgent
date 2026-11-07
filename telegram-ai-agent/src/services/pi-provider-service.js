import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PI_SCHEMA = "https://pi.dev/schemas/models.schema.json";

export function getPiModelsPath() {
  return path.join(os.homedir(), ".pi", "agent", "models.json");
}

function maskKey(key) {
  if (!key) return "";
  const str = String(key);
  if (str.length <= 8) return "••••";
  return `${str.slice(0, 4)}••••${str.slice(-4)}`;
}

export async function loadPiProviders() {
  const file = getPiModelsPath();
  try {
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data.providers === "object" && data.providers
      ? data.providers
      : {};
  } catch {
    return {};
  }
}

async function writePiProviders(providers) {
  const file = getPiModelsPath();
  await mkdir(path.dirname(file), { recursive: true });
  const content = {
    $schema: PI_SCHEMA,
    providers,
  };
  await writeFile(file, JSON.stringify(content, null, 2) + "\n", { mode: 0o600 });
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return [];
  const out = [];
  const seen = new Set();
  for (const m of models) {
    const id = (typeof m === "string" ? m : m?.id || "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = (typeof m === "object" && m?.name ? String(m.name) : id).trim();
    out.push({ id, name: name || id });
  }
  return out;
}

export async function listPiProviders() {
  const providers = await loadPiProviders();
  const defaultProvider = process.env.PI_PROVIDER || "local-pi";
  return Object.entries(providers).map(([id, cfg]) => ({
    id,
    name: cfg?.name || id,
    baseUrl: cfg?.baseUrl || "",
    api: cfg?.api || "openai-completions",
    hasApiKey: Boolean(cfg?.apiKey),
    apiKeyMasked: maskKey(cfg?.apiKey),
    models: Array.isArray(cfg?.models) ? cfg.models : [],
    isDefault: id === defaultProvider,
  }));
}

export async function getPiProviderRaw(id) {
  const providerId = String(id || "").trim();
  if (!providerId) return null;
  const providers = await loadPiProviders();
  const cfg = providers[providerId];
  if (!cfg) return null;
  return {
    id: providerId,
    name: cfg.name || providerId,
    baseUrl: cfg.baseUrl || "",
    api: cfg.api || "openai-completions",
    apiKey: cfg.apiKey || "",
    models: Array.isArray(cfg.models) ? cfg.models : [],
  };
}

export async function savePiProvider({ id, name, baseUrl, api, apiKey, models }) {
  const providerId = String(id || "").trim();
  if (!providerId) throw new Error("ID provider wajib diisi.");
  if (!baseUrl || !String(baseUrl).trim()) throw new Error("Base URL wajib diisi.");

  const providers = await loadPiProviders();
  const existing = providers[providerId] || {};

  const entry = {
    ...existing,
    name: (name || providerId).trim(),
    baseUrl: String(baseUrl).trim(),
    api: api || existing.api || "openai-completions",
    models: normalizeModels(models !== undefined ? models : existing.models),
  };

  // Hanya ganti API key jika dikirim nilai baru; kosong = pertahankan yang lama.
  if (apiKey !== undefined && apiKey !== null && String(apiKey).trim() !== "") {
    entry.apiKey = String(apiKey).trim();
  } else if (apiKey === false) {
    delete entry.apiKey;
  } else if (!entry.apiKey) {
    entry.apiKey = "sk-local";
  }

  providers[providerId] = entry;
  await writePiProviders(providers);
  return providerId;
}

export async function deletePiProvider(id) {
  const providerId = String(id || "").trim();
  if (!providerId) throw new Error("ID provider wajib diisi.");
  const providers = await loadPiProviders();
  if (!providers[providerId]) throw new Error(`Provider '${providerId}' tidak ditemukan.`);
  delete providers[providerId];
  await writePiProviders(providers);
  return providerId;
}
