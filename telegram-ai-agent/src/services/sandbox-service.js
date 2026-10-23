import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const SANDBOX_CONFIG_FILE = path.join(DATA_DIR, "sandbox_config.json");
let sandboxCache = null;

/**
 * Mendapatkan konfigurasi scope / role akses workspace engine
 * Default role: "root" (akses penuh seluruh folder projects)
 * Default customFolders: "" (kosong)
 */
export async function getSandboxConfig() {
  if (sandboxCache) return sandboxCache;
  try {
    const raw = await readFile(SANDBOX_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    sandboxCache = {
      role: parsed.role || (parsed.piSandbox ? "custom" : "root"),
      customFolders: parsed.customFolders ?? (parsed.restrictedDir || ""),
      piSandbox: parsed.role === "custom" || Boolean(parsed.piSandbox),
      restrictedDir: parsed.restrictedDir || "",
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    sandboxCache = {
      role: "root", // Default: root (akses penuh semua folder)
      customFolders: "", // Default: kosong
      piSandbox: false, // Backwards compatibility
      restrictedDir: "",
      updatedAt: new Date().toISOString(),
    };
  }
  return sandboxCache;
}

/**
 * Memeriksa apakah mode custom scope (akses dibatasi ke folder tertentu) sedang aktif
 */
export async function isCustomScopeActive() {
  const cfg = await getSandboxConfig();
  return cfg.role === "custom" || Boolean(cfg.piSandbox);
}

// Alias untuk backwards compatibility
export const isPiSandboxActive = isCustomScopeActive;

/**
 * Mendapatkan daftar folder yang diizinkan untuk mode custom
 */
export async function getAllowedFolders() {
  const cfg = await getSandboxConfig();
  if (cfg.role !== "custom" && !cfg.piSandbox) return [];
  const raw = cfg.customFolders || cfg.restrictedDir || "";
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
 * Mengubah role engine ('root' atau 'custom') dan daftar folder yang diizinkan
 */
export async function setEngineAccessRole(role = "root", customFolders = "") {
  const cleanRole = role === "custom" ? "custom" : "root";
  return await saveSandboxConfig({
    role: cleanRole,
    customFolders: typeof customFolders === "string" ? customFolders.trim() : "",
    piSandbox: cleanRole === "custom",
  });
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
