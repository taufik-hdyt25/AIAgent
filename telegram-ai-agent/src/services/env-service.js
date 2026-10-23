import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const ENV_PATH = path.join(ROOT_DIR, ".env");

/**
 * Membaca dan mem-parse file .env
 */
export async function readEnvFile() {
  try {
    const raw = await readFile(ENV_PATH, "utf8");
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
  let content = "";
  try {
    content = await readFile(ENV_PATH, "utf8");
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
  await writeFile(ENV_PATH, finalContent, { mode: 0o600 });
}

/**
 * Masking string sensitif (misal API key) untuk tampilan aman di chat
 */
export function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 8) return "••••••••";
  return secret.slice(0, 4) + "••••••••" + secret.slice(-4);
}
