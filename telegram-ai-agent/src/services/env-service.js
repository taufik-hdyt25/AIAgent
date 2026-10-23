import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getEnvPath() {
  if (process.env.ENV_FILE && fs.existsSync(process.env.ENV_FILE)) {
    return process.env.ENV_FILE;
  }
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env"),
    path.resolve(__dirname, "../..", ".env"),
    path.resolve(process.cwd(), "telegram-ai-agent", ".env"),
    path.join(os.homedir(), ".th-agent", ".env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return file;
    }
  }
  return candidates[0];
}

/**
 * Membaca dan mem-parse file .env
 */
export async function readEnvFile() {
  const envPath = getEnvPath();
  try {
    const raw = await readFile(envPath, "utf8");
    const parsed = {};
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        parsed[key] = val;
      }
    }
    return { raw, parsed };
  } catch {
    return { raw: "", parsed: {} };
  }
}

/**
 * Memperbarui nilai file .env secara atomik dengan mempertahankan komentar
 */
export async function updateEnvFile(updates) {
  const envPath = getEnvPath();
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch {
    content = "";
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const processedKeys = new Set();
  const newLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      newLines.push(line);
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      newLines.push(line);
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      newLines.push(`${key}=${updates[key]}`);
      processedKeys.add(key);
      process.env[key] = String(updates[key]);
    } else {
      newLines.push(line);
    }
  }

  // Tambahkan key baru jika belum ada
  for (const [key, value] of Object.entries(updates)) {
    if (!processedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
      process.env[key] = String(value);
    }
  }

  const finalContent = newLines.join("\n") + "\n";
  await writeFile(envPath, finalContent, { mode: 0o600 });

  // Sinkronkan ke workspace/telegram-ai-agent/.env jika berbeda agar file project juga up-to-date
  if (process.env.WORKSPACE_DIR) {
    const wsEnv = path.join(process.env.WORKSPACE_DIR, "telegram-ai-agent", ".env");
    if (wsEnv !== envPath && fs.existsSync(path.dirname(wsEnv))) {
      await writeFile(wsEnv, finalContent, { mode: 0o600 }).catch(() => {});
    }
  }
}

/**
 * Masking string sensitif (misal API key) untuk tampilan aman di chat
 */
export function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 8) return "••••••••";
  return secret.slice(0, 4) + "••••••••" + secret.slice(-4);
}
