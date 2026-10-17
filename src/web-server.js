import http from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const AVAILABLE_AGY_MODELS = [
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium Thinking)", badge: "Rekomendasi" },
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High Thinking)", badge: "Maksimal" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low Thinking)", badge: "Cepat" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", badge: "Populer" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", badge: "Kuat" },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", badge: "Open" },
];

const AVAILABLE_CLAUDE_MODELS = [
  { id: "sonnet", name: "Claude Sonnet (Default - Cepat & Cerdas)", badge: "Default" },
  { id: "opus", name: "Claude Opus (Penalaran Kompleks & Mendalam)", badge: "Kuat" },
  { id: "haiku", name: "Claude Haiku (Ultra Cepat & Ringan)", badge: "Cepat" },
  { id: "fable", name: "Claude Fable (Experimental Creative Agent)", badge: "Eksperimental" },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Hybrid Reasoning)", badge: "Thinking" },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Coding Specialist)", badge: "Populer" },
  { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku (Fast & Cost Efficient)", badge: "Hemat" },
  { id: "claude-3-opus", name: "Claude 3 Opus (Deep Analysis)", badge: "Maksimal" },
];

const AVAILABLE_UNIVERSAL_MODELS = [
  { id: "deepseek/deepseek-v4", name: "DeepSeek V4 (Generasi Terbaru - Flagship)", badge: "Terbaru" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (Sangat Cerdas & Hemat - Rekomendasi)", badge: "Rekomendasi" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (Penalaran Ekstrem / Thinking)", badge: "Thinking" },
  { id: "deepseek/deepseek-coder", name: "DeepSeek Coder (Spesialis Koding)", badge: "Koding" },
  { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Hybrid Reasoning)", badge: "Thinking" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Coding Specialist)", badge: "Populer" },
  { id: "openai/gpt-4o", name: "GPT-4o (Omni Flagship)", badge: "Flagship" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (Cepat & Ringkas)", badge: "Cepat" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (Super Cepat)", badge: "Kilat" },
  { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B (Spesialis Koding)", badge: "Open" },
];

// Helper membaca dan parse file .env
async function readEnvFile() {
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
  } catch (err) {
    return { raw: "", parsed: {} };
  }
}

// Helper memperbarui nilai .env dengan mempertahankan komentar dan format
async function updateEnvFile(updates) {
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

  // Tambahkan key baru yang belum ada di file
  for (const [key, value] of Object.entries(updates)) {
    if (!processedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
      process.env[key] = String(value);
    }
  }

  const finalContent = newLines.join("\n") + "\n";
  await writeFile(ENV_PATH, finalContent, { mode: 0o600 });
}

// MIME Types untuk file statis
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Buat server HTTP native Node.js
export function createWebServer() {
  const server = http.createServer(async (req, res) => {
    // Helper response JSON
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };

    // Helper kirim error
    const sendError = (statusCode, message) => {
      sendJson(statusCode, { ok: false, error: message });
    };

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // API: Ambil Pengaturan
    if (pathname === "/api/settings" && req.method === "GET") {
      try {
        const { parsed } = await readEnvFile();
        const claudeSessionActive = await stat(path.join(os.homedir(), ".claude")).then(() => true).catch(() => false);
        const agySessionActive = await stat(path.join(os.homedir(), ".gemini")).then(() => true).catch(() => false);

        return sendJson(200, {
          ok: true,
          settings: {
            BOT_TOKEN: parsed.BOT_TOKEN || process.env.BOT_TOKEN || "",
            ALLOWED_TELEGRAM_IDS: parsed.ALLOWED_TELEGRAM_IDS || process.env.ALLOWED_TELEGRAM_IDS || "",
            AGY_MODEL: parsed.AGY_MODEL || process.env.AGY_MODEL || "gemini-3.8-flash-medium",
            CLAUDE_MODEL: parsed.CLAUDE_MODEL || process.env.CLAUDE_MODEL || "sonnet",
            CLI_ENGINE: parsed.CLI_ENGINE || process.env.CLI_ENGINE || "agy",
            AGY_AUTO_APPROVE_PERMISSIONS:
              parsed.AGY_AUTO_APPROVE_PERMISSIONS ?? process.env.AGY_AUTO_APPROVE_PERMISSIONS ?? "true",
            TASK_TIMEOUT_MS: parsed.TASK_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || "900000",
            WEB_PORT: parsed.WEB_PORT || process.env.WEB_PORT || "3030",
            ANTHROPIC_API_KEY: parsed.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "",
            GEMINI_API_KEY: parsed.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
            CLAUDE_AUTH_TYPE: parsed.CLAUDE_AUTH_TYPE || (parsed.ANTHROPIC_API_KEY ? "api_key" : "oauth"),
            AGY_AUTH_TYPE: parsed.AGY_AUTH_TYPE || (parsed.GEMINI_API_KEY ? "api_key" : "oauth"),
            UNIVERSAL_BASE_URL: parsed.UNIVERSAL_BASE_URL || process.env.UNIVERSAL_BASE_URL || "https://openrouter.ai/api/v1",
            UNIVERSAL_API_KEY: parsed.UNIVERSAL_API_KEY || process.env.UNIVERSAL_API_KEY || "",
            UNIVERSAL_MODEL: parsed.UNIVERSAL_MODEL || process.env.UNIVERSAL_MODEL || "deepseek/deepseek-chat",
          },
          authStatus: {
            claudeSessionActive,
            agySessionActive,
            hasAnthropicKey: Boolean(parsed.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
            hasGeminiKey: Boolean(parsed.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
            hasUniversalKey: Boolean(parsed.UNIVERSAL_API_KEY || process.env.UNIVERSAL_API_KEY),
          },
          options: {
            agyModels: AVAILABLE_AGY_MODELS,
            claudeModels: AVAILABLE_CLAUDE_MODELS,
            universalModels: AVAILABLE_UNIVERSAL_MODELS,
          },
          system: {
            platform: os.platform(),
            nodeVersion: process.version,
            uptime: Math.floor(process.uptime()),
            hostname: os.hostname(),
          },
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Simpan Pengaturan
    if (pathname === "/api/settings" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 100 * 1024) req.destroy();
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const updates = {};

          if (payload.BOT_TOKEN !== undefined) {
            updates.BOT_TOKEN = String(payload.BOT_TOKEN).trim();
          }
          if (payload.ALLOWED_TELEGRAM_IDS !== undefined) {
            updates.ALLOWED_TELEGRAM_IDS = String(payload.ALLOWED_TELEGRAM_IDS).trim();
          }
          if (payload.AGY_MODEL !== undefined) {
            updates.AGY_MODEL = String(payload.AGY_MODEL).trim();
          }
          if (payload.CLAUDE_MODEL !== undefined) {
            updates.CLAUDE_MODEL = String(payload.CLAUDE_MODEL).trim();
          }
          if (payload.CLI_ENGINE !== undefined) {
            updates.CLI_ENGINE = String(payload.CLI_ENGINE).trim();
          }
          if (payload.AGY_AUTO_APPROVE_PERMISSIONS !== undefined) {
            updates.AGY_AUTO_APPROVE_PERMISSIONS = String(payload.AGY_AUTO_APPROVE_PERMISSIONS);
          }
          if (payload.TASK_TIMEOUT_MS !== undefined) {
            updates.TASK_TIMEOUT_MS = String(payload.TASK_TIMEOUT_MS).trim();
          }
          if (payload.ANTHROPIC_API_KEY !== undefined) {
            updates.ANTHROPIC_API_KEY = String(payload.ANTHROPIC_API_KEY).trim();
          }
          if (payload.GEMINI_API_KEY !== undefined) {
            updates.GEMINI_API_KEY = String(payload.GEMINI_API_KEY).trim();
          }
          if (payload.CLAUDE_AUTH_TYPE !== undefined) {
            updates.CLAUDE_AUTH_TYPE = String(payload.CLAUDE_AUTH_TYPE).trim();
          }
          if (payload.AGY_AUTH_TYPE !== undefined) {
            updates.AGY_AUTH_TYPE = String(payload.AGY_AUTH_TYPE).trim();
          }
          if (payload.UNIVERSAL_MODEL !== undefined) {
            updates.UNIVERSAL_MODEL = String(payload.UNIVERSAL_MODEL).trim();
          }
          if (payload.UNIVERSAL_API_KEY !== undefined) {
            updates.UNIVERSAL_API_KEY = String(payload.UNIVERSAL_API_KEY).trim();
          }
          if (payload.UNIVERSAL_BASE_URL !== undefined) {
            updates.UNIVERSAL_BASE_URL = String(payload.UNIVERSAL_BASE_URL).trim();
          }

          await updateEnvFile(updates);

          return sendJson(200, {
            ok: true,
            message: "Pengaturan berhasil disimpan ke .env!",
            savedSettings: updates,
          });
        } catch (err) {
          return sendError(400, `Gagal menyimpan pengaturan: ${err.message}`);
        }
      });
      return;
    }

    // API: Test Koneksi Token Telegram (@BotFather getMe)
    if (pathname === "/api/test-token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 100 * 1024) req.destroy();
      });

      req.on("end", async () => {
        try {
          const { token } = JSON.parse(body || "{}");
          const targetToken = token || process.env.BOT_TOKEN;
          if (!targetToken) {
            return sendError(400, "BOT_TOKEN belum disediakan.");
          }

          const response = await fetch(`https://api.telegram.org/bot${targetToken}/getMe`);
          const data = await response.json();

          if (data.ok) {
            return sendJson(200, {
              ok: true,
              bot: {
                id: data.result.id,
                name: data.result.first_name,
                username: data.result.username,
                canJoinGroups: data.result.can_join_groups,
              },
            });
          } else {
            return sendJson(400, {
              ok: false,
              error: `Telegram API Error: ${data.description || "Token tidak valid"}`,
            });
          }
        } catch (err) {
          return sendError(500, `Gagal menghubungi server Telegram: ${err.message}`);
        }
      });
      return;
    }

    // Sajikan File Statis dari folder public/
    let safePath = pathname === "/" ? "/index.html" : pathname;
    safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, safePath);

    try {
      const stats = await stat(filePath);
      if (stats.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const content = await readFile(filePath);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        });
        res.end(content);
        return;
      }
    } catch {
      // Jika file tidak ada, kirim 404
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  });

  return server;
}

export function startWebServer(port = process.env.WEB_PORT || 3030) {
  const server = createWebServer();
  const PORT = Number(port);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web UI Settings aktif di: http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[Web UI] Port ${PORT} sedang dipakai. Mencoba port ${PORT + 1}...`);
      startWebServer(PORT + 1);
    } else {
      console.error("[Web UI Server Error]:", err.message);
    }
  });

  return server;
}

// Jika dijalankan langsung via node src/web-server.js
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startWebServer(process.env.WEB_PORT || 3030);
}
