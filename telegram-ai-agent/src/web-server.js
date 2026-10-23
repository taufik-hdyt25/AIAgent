import http from "node:http";
import fs from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePublicDir() {
  if (process.env.PUBLIC_DIR && fs.existsSync(process.env.PUBLIC_DIR)) {
    return process.env.PUBLIC_DIR;
  }
  const candidates = [
    path.join(__dirname, "public"),
    path.join(process.cwd(), "public"),
    path.resolve(__dirname, "..", "public"),
    path.resolve(process.cwd(), "telegram-ai-agent", "public"),
    path.join(os.homedir(), ".th-agent", "public"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return candidates[0];
}

import {
  AVAILABLE_AGY_MODELS,
  AVAILABLE_CLAUDE_MODELS,
  AVAILABLE_UNIVERSAL_MODELS,
  getModelList,
  fetchRemoteModels,
} from "./config/models.js";
import { loadWatchConfig, saveWatchConfig } from "./services/github-service.js";
import {
  getDeployConfig,
  saveDeployConfig,
  executeDeployment,
} from "./services/deploy-service.js";
import { getActiveTask } from "./services/cli-runner.js";
import {
  getQueue,
  getQueueLength,
  clearQueue,
  isQueuePaused,
} from "./services/queue-service.js";
import {
  getVoiceConfig,
  saveVoiceConfig,
} from "./services/voice-service.js";
import {
  getSentryConfig,
  saveSentryConfig,
  checkServerHealth,
  formatSentryStatus,
  getDockerContainers,
  addWatchedContainer,
  removeWatchedContainer,
  setWatchedContainers,
} from "./services/sentry-service.js";
import {
  getSandboxConfig,
  togglePiSandbox,
} from "./services/sandbox-service.js";
import {
  readEnvFile,
  updateEnvFile,
} from "./services/env-service.js";

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
        const voiceConfig = await getVoiceConfig();
        const sentryConfig = await getSentryConfig();
        const sandboxConfig = await getSandboxConfig();
        const dockerStatus = await getDockerContainers();

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
            UNIVERSAL_BASE_URL: parsed.UNIVERSAL_BASE_URL || process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1",
            UNIVERSAL_API_KEY: parsed.UNIVERSAL_API_KEY || process.env.UNIVERSAL_API_KEY || "",
            UNIVERSAL_MODEL: parsed.UNIVERSAL_MODEL ?? process.env.UNIVERSAL_MODEL ?? "",
            GITHUB_TOKEN: parsed.GITHUB_TOKEN || process.env.GITHUB_TOKEN || "",
            DEPLOY_COMMAND: parsed.DEPLOY_COMMAND || process.env.DEPLOY_COMMAND || "git pull && npm install && pm2 reload all || pm2 reload ecosystem.config.cjs",
            GROQ_API_KEY: parsed.GROQ_API_KEY || process.env.GROQ_API_KEY || voiceConfig.groqApiKey || "",
            OPENAI_API_KEY: parsed.OPENAI_API_KEY || process.env.OPENAI_API_KEY || voiceConfig.openaiApiKey || "",
          },
          sandboxConfig,
          authStatus: {
            claudeSessionActive,
            agySessionActive,
            hasAnthropicKey: Boolean(parsed.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
            hasGeminiKey: Boolean(parsed.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
            hasUniversalKey: Boolean(parsed.UNIVERSAL_API_KEY || process.env.UNIVERSAL_API_KEY),
            hasGithubToken: Boolean(parsed.GITHUB_TOKEN || process.env.GITHUB_TOKEN),
            hasGroqKey: Boolean(parsed.GROQ_API_KEY || process.env.GROQ_API_KEY || voiceConfig.groqApiKey),
            hasOpenaiKey: Boolean(parsed.OPENAI_API_KEY || process.env.OPENAI_API_KEY || voiceConfig.openaiApiKey),
          },
          voiceConfig,
          sentryConfig,
          dockerStatus,
          options: {
            agyModels: await getModelList("agy"),
            claudeModels: await getModelList("claude"),
            universalModels: await getModelList("universal"),
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

    // API: Tarik remote models dari provider (DeepSeek / OpenAI-compatible / custom server)
    if (pathname === "/api/models/remote" && req.method === "GET") {
      try {
        const { parsed } = await readEnvFile();
        const baseUrl =
          urlObj.searchParams.get("baseUrl") ||
          parsed.UNIVERSAL_BASE_URL ||
          process.env.UNIVERSAL_BASE_URL ||
          "https://api.deepseek.com/v1";
        const apiKey =
          urlObj.searchParams.get("apiKey") !== null
            ? urlObj.searchParams.get("apiKey")
            : (parsed.UNIVERSAL_API_KEY || process.env.UNIVERSAL_API_KEY || "");

        const models = await fetchRemoteModels(baseUrl, apiKey);
        return sendJson(200, { ok: true, models, count: models.length });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Ambil Status Antrean Tugas
    if (pathname === "/api/queue" && req.method === "GET") {
      try {
        const active = getActiveTask();
        return sendJson(200, {
          ok: true,
          activeTask: active
            ? {
                id: active.id,
                startedAt: active.startedAt,
                preview: active.preview || null,
                userId: active.userId || null,
              }
            : null,
          queue: getQueue(),
          queueLength: getQueueLength(),
          isPaused: isQueuePaused(),
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Kosongkan Seluruh Antrean Tugas
    if (pathname === "/api/queue/clear" && req.method === "POST") {
      try {
        const clearedCount = clearQueue();
        return sendJson(200, {
          ok: true,
          message: `Berhasil mengosongkan ${clearedCount} instruksi di antrean.`,
          clearedCount,
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Ambil Status & Pengaturan Otomasi (GitHub Watcher & Deploy)
    if (pathname === "/api/automation" && req.method === "GET") {
      try {
        const watchConfig = await loadWatchConfig();
        const deployConfig = await getDeployConfig();
        return sendJson(200, {
          ok: true,
          watchConfig,
          deployConfig,
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Simpan Status & Pengaturan Otomasi
    if (pathname === "/api/automation" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 100 * 1024) req.destroy();
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const watchConfig = await loadWatchConfig();
          const deployConfig = await getDeployConfig();

          if (payload.enabled !== undefined) {
            watchConfig.enabled = Boolean(payload.enabled);
          }
          if (payload.autoAnalyze !== undefined) {
            watchConfig.autoAnalyze = Boolean(payload.autoAnalyze);
          }
          if (payload.autoFix !== undefined) {
            watchConfig.autoFix = Boolean(payload.autoFix);
          }
          if (payload.pollIntervalMinutes !== undefined) {
            watchConfig.pollIntervalMinutes = Number(payload.pollIntervalMinutes) || 5;
          }
          if (payload.watchedRepos !== undefined && Array.isArray(payload.watchedRepos)) {
            watchConfig.watchedRepos = payload.watchedRepos;
          }

          if (payload.deployCommand !== undefined) {
            deployConfig.defaultCommand = String(payload.deployCommand).trim();
            await updateEnvFile({ DEPLOY_COMMAND: deployConfig.defaultCommand });
          }

          await saveWatchConfig(watchConfig);
          await saveDeployConfig(deployConfig);

          return sendJson(200, {
            ok: true,
            message: "Pengaturan otomasi berhasil diperbarui!",
            watchConfig,
            deployConfig,
          });
        } catch (err) {
          return sendError(400, `Gagal menyimpan otomasi: ${err.message}`);
        }
      });
      return;
    }

    // API: Jalankan Deploy dari Web UI
    if (pathname === "/api/deploy/run" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 50 * 1024) req.destroy();
      });

      req.on("end", async () => {
        try {
          const { target, customCommand } = JSON.parse(body || "{}");
          const result = await executeDeployment({
            target: target || "default",
            customCommand,
            triggeredBy: "Web Control Panel",
          });
          return sendJson(200, { ok: true, result });
        } catch (err) {
          return sendError(500, `Deployment error: ${err.message}`);
        }
      });
      return;
    }

    // API: Audit Kesehatan Server Sentry Langsung
    if (pathname === "/api/sentry/check" && req.method === "POST") {
      try {
        const health = await checkServerHealth(null, true);
        const config = await getSentryConfig();
        const dockerStatus = await getDockerContainers();
        return sendJson(200, {
          ok: true,
          health,
          config,
          dockerStatus,
          summary: formatSentryStatus(config, health),
        });
      } catch (err) {
        return sendError(500, `Gagal audit Sentry: ${err.message}`);
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
          if (payload.GITHUB_TOKEN !== undefined) {
            updates.GITHUB_TOKEN = String(payload.GITHUB_TOKEN).trim();
          }
          if (payload.piSandbox !== undefined) {
            await togglePiSandbox(Boolean(payload.piSandbox));
          }
          if (payload.DEPLOY_COMMAND !== undefined) {
            updates.DEPLOY_COMMAND = String(payload.DEPLOY_COMMAND).trim();
          }
          if (payload.GROQ_API_KEY !== undefined) {
            updates.GROQ_API_KEY = String(payload.GROQ_API_KEY).trim();
          }
          if (payload.OPENAI_API_KEY !== undefined) {
            updates.OPENAI_API_KEY = String(payload.OPENAI_API_KEY).trim();
          }

          // Simpan konfigurasi file .env
          await updateEnvFile(updates);

          // Simpan konfigurasi Voice Whisper jika ada
          if (payload.voiceConfig) {
            await saveVoiceConfig(payload.voiceConfig);
          } else if (payload.GROQ_API_KEY !== undefined || payload.VOICE_PROVIDER !== undefined) {
            await saveVoiceConfig({
              provider: payload.VOICE_PROVIDER || "groq",
              groqApiKey: payload.GROQ_API_KEY || updates.GROQ_API_KEY || "",
              openaiApiKey: payload.OPENAI_API_KEY || updates.OPENAI_API_KEY || "",
              language: payload.VOICE_LANGUAGE || "id",
            });
          }

          // Simpan konfigurasi Sentry jika ada
          if (payload.sentryConfig) {
            await saveSentryConfig(payload.sentryConfig);
          } else {
            const sentryUpdates = {};
            if (payload.sentryEnabled !== undefined) sentryUpdates.enabled = Boolean(payload.sentryEnabled);
            if (payload.sentryAutoHeal !== undefined) sentryUpdates.autoHeal = Boolean(payload.sentryAutoHeal);
            if (payload.sentryIntervalMinutes !== undefined) sentryUpdates.checkIntervalMinutes = Number(payload.sentryIntervalMinutes) || 5;
            if (payload.sentryDiskThreshold !== undefined) sentryUpdates.diskThresholdPercent = Number(payload.sentryDiskThreshold) || 88;
            if (payload.targetContainers !== undefined && Array.isArray(payload.targetContainers)) {
              sentryUpdates.targetContainers = payload.targetContainers;
            }
            if (Object.keys(sentryUpdates).length > 0) {
              await saveSentryConfig(sentryUpdates);
            }
          }

          return sendJson(200, {
            ok: true,
            message: "Pengaturan & konfigurasi Agent berhasil disimpan!",
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
    const currentPublicDir = resolvePublicDir();
    let safePath = pathname === "/" ? "/index.html" : pathname;
    safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(currentPublicDir, safePath);

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
