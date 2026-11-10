import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const SANDBOX_CONFIG_FILE = path.join(DATA_DIR, "sandbox_config.json");
let sandboxCache = null;

/**
 * Mendapatkan konfigurasi scope / role akses workspace engine
 * Role options:
 * - "auto": Auto-Key Langsung (Default - Deteksi proyek otomatis via key/keyword tanpa perlu /workspace)
 * - "project": Project-Level Jail (Terkunci ketat di 1 proyek aktif)
 * - "custom": Custom Folder List (Dibatasi ke daftar folder tertentu)
 * - "root": Root Access (Akses penuh seluruh ./projects)
 */
export async function getSandboxConfig() {
  if (sandboxCache) return sandboxCache;
  try {
    const raw = await readFile(SANDBOX_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const validRoles = new Set(["auto", "project", "custom", "root"]);
    const resolvedRole = validRoles.has(parsed.role)
      ? parsed.role
      : (parsed.piSandbox ? "custom" : "auto");
    sandboxCache = {
      role: resolvedRole,
      customFolders: parsed.customFolders ?? (parsed.restrictedDir || ""),
      activeProject: parsed.activeProject || "",
      piSandbox: resolvedRole === "custom" || Boolean(parsed.piSandbox),
      restrictedDir: parsed.restrictedDir || "",
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    sandboxCache = {
      role: "auto", // Default: Auto-Key langsung tanpa perlu /workspace
      customFolders: "",
      activeProject: "",
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
 * Memeriksa apakah mode Project-Level Jail (ketat) sedang aktif.
 */
export async function isProjectJailActive() {
  const cfg = await getSandboxConfig();
  return cfg.role === "project";
}

/**
 * Memeriksa apakah mode Auto-Key Workspace sedang aktif.
 */
export async function isAutoKeyActive() {
  const cfg = await getSandboxConfig();
  return cfg.role === "auto";
}

// Alias untuk backwards compatibility
export const isPiSandboxActive = isCustomScopeActive;

/**
 * Deteksi sinkron dasar nama proyek dari teks (untuk kompatibilitas pemanggil sinkron)
 */
export function detectProjectFromText(text = "", availableProjects = []) {
  if (!text || !availableProjects.length) return null;
  const lower = text.toLowerCase();

  for (const proj of availableProjects) {
    const cleanProj = proj.toLowerCase();
    const regex = new RegExp(`(^|[^a-zA-Z0-9_-])${cleanProj}([^a-zA-Z0-9_-]|$)`, "i");
    if (regex.test(lower)) {
      return proj;
    }
  }

  for (const proj of availableProjects) {
    const spaced = proj.replace(/[-_]/g, " ");
    if (lower.includes(spaced)) {
      return proj;
    }
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
  const validRoles = new Set(["auto", "project", "custom", "root"]);
  let role = current.role;
  if (newConfig.role && validRoles.has(newConfig.role)) {
    role = newConfig.role;
  } else if (newConfig.piSandbox !== undefined) {
    role = newConfig.piSandbox ? "custom" : "auto";
  }

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
 * Mengubah role engine ('auto', 'project', 'root', atau 'custom') dan daftar folder yang diizinkan
 */
export async function setEngineAccessRole(role = "auto", customFolders = "", activeProject = "") {
  const validRoles = new Set(["auto", "project", "custom", "root"]);
  const cleanRole = validRoles.has(role) ? role : "auto";

  const payload = {
    role: cleanRole,
    customFolders: typeof customFolders === "string" ? customFolders.trim() : "",
    piSandbox: cleanRole === "custom",
  };
  if (activeProject !== undefined && activeProject !== null && activeProject !== "") {
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
  const newRole = enabled !== null ? (enabled ? "custom" : "auto") : (isCustom ? "auto" : "custom");
  return await saveSandboxConfig({
    role: newRole,
    piSandbox: newRole === "custom",
  });
}
