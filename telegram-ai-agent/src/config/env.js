import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { mkdir } from "node:fs/promises";

export const ROOT_DIR = (() => {
  if (fs.existsSync(path.resolve(process.cwd(), "src/bot.js"))) {
    return process.cwd();
  }
  if (fs.existsSync(path.resolve(process.cwd(), "telegram-ai-agent/src/bot.js"))) {
    return path.resolve(process.cwd(), "telegram-ai-agent");
  }
  return process.cwd();
})();

export const DATA_DIR = (() => {
  const candidate = fs.existsSync(path.resolve(ROOT_DIR, "data"))
    ? path.resolve(ROOT_DIR, "data")
    : (fs.existsSync(path.resolve(process.cwd(), "telegram-ai-agent/data"))
        ? path.resolve(process.cwd(), "telegram-ai-agent/data")
        : path.resolve(ROOT_DIR, "data"));
  try {
    fs.mkdirSync(candidate, { recursive: true });
  } catch {}
  return candidate;
})();

export const LOG_DIR = (() => {
  const candidate = path.resolve(ROOT_DIR, "logs");
  try {
    fs.mkdirSync(candidate, { recursive: true });
  } catch {}
  return candidate;
})();
export const PROJECTS_DIR = (() => {
  if (process.env.PROJECTS_DIR) {
    const candidate = path.resolve(process.env.PROJECTS_DIR);
    if (fs.existsSync(candidate)) {
      try {
        const dirs = fs.readdirSync(candidate).filter((d) => !d.startsWith(".") && d !== "PROJECTS_SUMMARY.md");
        if (dirs.length > 0) return candidate;
      } catch (_) {}
    }
  }
  if (fs.existsSync("/home/th-agent/projects")) {
    return "/home/th-agent/projects";
  }
  if (fs.existsSync(path.resolve(ROOT_DIR, "../projects"))) {
    return path.resolve(ROOT_DIR, "../projects");
  }
  if (fs.existsSync(path.resolve(ROOT_DIR, "projects"))) {
    return path.resolve(ROOT_DIR, "projects");
  }
  if (fs.existsSync("/home/node/projects")) {
    return "/home/node/projects";
  }
  return process.env.PROJECTS_DIR ? path.resolve(process.env.PROJECTS_DIR) : path.resolve(ROOT_DIR, "projects");
})();
export const UPLOADS_DIR = path.resolve(ROOT_DIR, process.env.UPLOADS_DIR || "uploads");
export const CONTEXT_FILE = path.join(DATA_DIR, "context.json");

// Deteksi apakah bot berjalan di perangkat model Raspberry Pi
export const IS_PI = (() => {
  if (
    process.env.IS_PI === "true" ||
    process.env.DEVICE_MODEL === "pi" ||
    process.env.TARGET_ENV === "pi"
  ) {
    return true;
  }
  try {
    if (fs.existsSync("/proc/device-tree/model")) {
      const model = fs.readFileSync("/proc/device-tree/model", "utf8");
      if (/Raspberry Pi/i.test(model)) return true;
    }
    if (fs.existsSync("/proc/cpuinfo")) {
      const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
      if (/Raspberry Pi/i.test(cpuinfo)) return true;
    }
    if (fs.existsSync("/etc/rpi-issue")) return true;
  } catch (_) {}
  return false;
})();

export const IS_WINDOWS = process.platform === "win32";

function findDefaultBin(binName, unixDefaultRel) {
  if (IS_WINDOWS) {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const candidates = [
      path.join(appData, "npm", `${binName}.cmd`),
      path.join(appData, "npm", `${binName}.exe`),
      path.join(localAppData, "Programs", binName, `${binName}.exe`),
      path.join(os.homedir(), ".local", "bin", `${binName}.cmd`),
      path.join(os.homedir(), ".local", "bin", binName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return binName;
  }
  const unixCandidates = [
    path.join(os.homedir(), unixDefaultRel),
    path.join("/home/ubuntu/.local/bin", binName),
    path.join("/usr/local/bin", binName),
    path.join("/usr/bin", binName),
  ];
  for (const c of unixCandidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(os.homedir(), unixDefaultRel);
}

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const AGY_BIN = process.env.AGY_BIN || findDefaultBin("agy", ".local/bin/agy");
export const CLAUDE_BIN = process.env.CLAUDE_BIN || findDefaultBin("claude", ".local/bin/claude");

export const DEFAULT_ENGINE = process.env.CLI_ENGINE || "agy";
export const DEFAULT_AGY_MODEL = process.env.AGY_MODEL || "gemini-3.8-flash-medium";
export const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
export const DEFAULT_UNIVERSAL_MODEL = process.env.UNIVERSAL_MODEL || "";
export const DEFAULT_UNIVERSAL_BASE_URL = process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";

export const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 900000);
export const MAX_OUTPUT = Number(process.env.MAX_TASK_OUTPUT || 12000);
export const AUTO_APPROVE_PERMISSIONS = process.env.AGY_AUTO_APPROVE_PERMISSIONS !== "false";

export const ALLOWED_IDS = new Set(
  (process.env.ALLOWED_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

export async function ensureDirectories() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(PROJECTS_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
}
