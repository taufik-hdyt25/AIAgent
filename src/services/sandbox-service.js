import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, IS_PI } from "../config/env.js";

const SANDBOX_CONFIG_FILE = path.join(DATA_DIR, "sandbox_config.json");
let sandboxCache = null;

/**
 * Mendapatkan konfigurasi sandbox Pi
 */
export async function getSandboxConfig() {
  if (sandboxCache) return sandboxCache;
  try {
    const raw = await readFile(SANDBOX_CONFIG_FILE, "utf8");
    sandboxCache = JSON.parse(raw);
  } catch {
    sandboxCache = {
      piSandbox: IS_PI, // Default aktif jika hardware Pi terdeteksi, atau nonaktif jika di VPS/Mac
      restrictedDir: "projects/intiva",
      updatedAt: new Date().toISOString(),
    };
  }
  return sandboxCache;
}

/**
 * Memeriksa apakah mode Sandbox Pi (hanya projects/intiva) sedang aktif
 */
export async function isPiSandboxActive() {
  const cfg = await getSandboxConfig();
  return Boolean(cfg.piSandbox);
}

/**
 * Simpan konfigurasi sandbox
 */
export async function saveSandboxConfig(newConfig) {
  const current = await getSandboxConfig();
  sandboxCache = { ...current, ...newConfig, updatedAt: new Date().toISOString() };
  await writeFile(SANDBOX_CONFIG_FILE, JSON.stringify(sandboxCache, null, 2), "utf8");
  return sandboxCache;
}

/**
 * Toggle Mode Pi Sandbox On / Off
 */
export async function togglePiSandbox(enabled = null) {
  const current = await getSandboxConfig();
  const newState = enabled !== null ? Boolean(enabled) : !current.piSandbox;
  return await saveSandboxConfig({ piSandbox: newState });
}
