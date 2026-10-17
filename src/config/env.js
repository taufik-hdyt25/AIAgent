import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(ROOT_DIR, "data");
export const LOG_DIR = path.resolve(ROOT_DIR, "logs");
export const PROJECTS_DIR = path.resolve(ROOT_DIR, "projects");
export const UPLOADS_DIR = path.resolve(ROOT_DIR, process.env.UPLOADS_DIR || "uploads");
export const CONTEXT_FILE = path.join(DATA_DIR, "context.json");

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const AGY_BIN = process.env.AGY_BIN || path.join(os.homedir(), ".local/bin/agy");
export const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(os.homedir(), ".local/bin/claude");

export const DEFAULT_ENGINE = process.env.CLI_ENGINE || "agy";
export const DEFAULT_AGY_MODEL = process.env.AGY_MODEL || "gemini-3.8-flash-medium";
export const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
export const DEFAULT_UNIVERSAL_MODEL = process.env.UNIVERSAL_MODEL || "deepseek-chat";
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
