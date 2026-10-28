import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const SANDBOX_CONFIG_FILE = path.join(DATA_DIR, "sandbox_config.json");
let sandboxCache = null;

/**
 * Mendapatkan konfigurasi scope / role akses workspace engine
 * Role options:
 * - "project": Project-Level Jail (Opsi 1 - Terkunci ketat di 1 proyek aktif)
 * - "custom": Custom Folder List (Dibatasi ke daftar folder tertentu)
 * - "root": Root Access (Akses penuh seluruh ./projects)
 */
export async function getSandboxConfig() {
  if (sandboxCache) return sandboxCache;
  try {
    const raw = await readFile(SANDBOX_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    sandboxCache = {
      role: parsed.role || (parsed.piSandbox ? "custom" : "project"),
      customFolders: parsed.customFolders ?? (parsed.restrictedDir || ""),
      activeProject: parsed.activeProject || "th-blog",
      piSandbox: parsed.role === "custom" || Boolean(parsed.piSandbox),
      restrictedDir: parsed.restrictedDir || "",
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    sandboxCache = {
      role: "project", // Default ke Opsi 1: Project-Level Jail
      customFolders: "",
      activeProject: "th-blog",
      piSandbox: false,
      restrictedDir: "",
      updatedAt: new Date().toISOString(),
    };
  }
  return sandboxCache;
}

/**
 * Memeriksa apakah mode custom scope atau project jail sedang aktif.
 */
export async function isCustomScopeActive(modelId = "") {
  const cfg = await getSandboxConfig();
  return cfg.role === "custom" || cfg.role === "project" || Boolean(cfg.piSandbox);
}

/**
 * Memeriksa apakah mode Project-Level Jail (Opsi 1) sedang aktif.
 */
export async function isProjectJailActive() {
  const cfg = await getSandboxConfig();
  return cfg.role === "project";
}

// Alias untuk backwards compatibility
export const isPiSandboxActive = isCustomScopeActive;

/**
 * Deteksi nama proyek dari teks percakapan pengguna
 */
export function detectProjectFromText(text = "", availableProjects = []) {
  if (!text || !availableProjects.length) return null;
  const lower = text.toLowerCase();

  // 1. Direct regex match
  for (const proj of availableProjects) {
    const cleanProj = proj.toLowerCase();
    const regex = new RegExp(`(^|[^a-zA-Z0-9_-])${cleanProj}([^a-zA-Z0-9_-]|$)`, "i");
    if (regex.test(lower)) {
      return proj;
    }
  }

  // 2. Space/delimiter tolerant match (misal "th blog" -> "th-blog", "th admin" -> "th-admin-app")
  for (const proj of availableProjects) {
    const spaced = proj.replace(/[-_]/g, " ");
    if (lower.includes(spaced)) {
      return proj;
    }
    // Alias khusus
    if (proj === "th-admin-app" && (lower.includes("th-admin") || lower.includes("th admin"))) {
      return proj;
    }
    if (proj === "wa-chat-bot" && (lower.includes("wa bot") || lower.includes("wa-bot") || lower.includes("whatsapp bot"))) {
      return proj;
    }
  }
  return null;
}

/**
 * Mendapatkan daftar folder yang diizinkan untuk mode custom / project
 */
export async function getAllowedFolders(modelId = "", activeProject = "") {
  const cfg = await getSandboxConfig();
  if (cfg.role === "project") {
    const target = activeProject || cfg.activeProject || "th-blog";
    return [`projects/${target}`];
  }
  if (cfg.role !== "custom" && !cfg.piSandbox) return [];
  const raw = cfg.customFolders || cfg.restrictedDir || "";
  const folders = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (folders.length === 0 && (cfg.role === "custom" || cfg.piSandbox)) {
    return ["projects/intiva"];
  }
  return folders;
}

/**
 * Simpan konfigurasi sandbox & role akses
 */
export async function saveSandboxConfig(newConfig) {
  const current = await getSandboxConfig();
  const role = newConfig.role || (newConfig.piSandbox !== undefined ? (newConfig.piSandbox ? "custom" : "root") : current.role);
  const customFolders = newConfig.customFolders !== undefined ? newConfig.customFolders : current.customFolders;

  sandboxCache = {
    ...current,
    ...newConfig,
    role,
    customFolders,
    piSandbox: role === "custom",
    updatedAt: new Date().toISOString(),
  };

  await writeFile(SANDBOX_CONFIG_FILE, JSON.stringify(sandboxCache, null, 2), "utf8");
  return sandboxCache;
}

/**
 * Mengubah role engine ('project', 'root', atau 'custom') dan daftar folder yang diizinkan
 */
export async function setEngineAccessRole(role = "project", customFolders = "", activeProject = "") {
  let cleanRole = "project";
  if (role === "root") cleanRole = "root";
  else if (role === "custom") cleanRole = "custom";

  const payload = {
    role: cleanRole,
    customFolders: typeof customFolders === "string" ? customFolders.trim() : "",
    piSandbox: cleanRole === "custom",
  };
  if (activeProject) {
    payload.activeProject = activeProject;
  }
  return await saveSandboxConfig(payload);
}

/**
 * Toggle Mode Pi Sandbox On / Off (backwards compatibility)
 */
export async function togglePiSandbox(enabled = null) {
  const current = await getSandboxConfig();
  const isCustom = current.role === "custom" || current.piSandbox;
  const newRole = enabled !== null ? (enabled ? "custom" : "root") : (isCustom ? "root" : "custom");
  return await saveSandboxConfig({
    role: newRole,
    piSandbox: newRole === "custom",
  });
}
