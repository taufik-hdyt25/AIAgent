import http from "node:http";
import crypto from "node:crypto";
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
  getModelList,
  fetchRemoteModels,
  loadCustomModels,
  saveCustomModels,
  normalizePiUrl,
} from "./config/models.js";
import { syncPiModelDirectly } from "./services/pi-service.js";
import {
  listPiProviders,
  savePiProvider,
  deletePiProvider,
  getPiProviderRaw,
} from "./services/pi-provider-service.js";
import {
  getCpaStatus,
  startCpaOAuth,
  getCpaOAuthStatus,
  submitCpaOAuthCallback,
  listCpaCredentials,
  setCpaCredentialDisabled,
  deleteCpaCredential,
  refreshCpaCredentials,
} from "./services/cliproxy-service.js";
import { loadWatchConfig, saveWatchConfig } from "./services/github-service.js";
import {
  getDeployConfig,
  saveDeployConfig,
  executeDeployment,
} from "./services/deploy-service.js";
import { getActiveTask, getActiveWorkers } from "./services/cli-runner.js";
import {
  getQueue,
  getQueueLength,
  clearQueue,
  isQueuePaused,
} from "./services/queue-service.js";
import { loadUsageStats } from "./services/usage-service.js";
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
  saveSandboxConfig,
  setEngineAccessRole,
  togglePiSandbox,
} from "./services/sandbox-service.js";
import {
  readEnvFile,
  updateEnvFile,
} from "./services/env-service.js";
import { handleWebhookPush } from "./services/auto-update-watcher.js";

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

    // Basic Auth (aktif jika WEB_AUTH_PASS diset). Webhook GitHub dikecualikan
    // karena punya verifikasi signature sendiri.
    const authPass = process.env.WEB_AUTH_PASS || "";
    const authUser = process.env.WEB_AUTH_USER || "admin";
    const authExempt = pathname === "/webhook/update";
    if (authPass && !authExempt) {
      const provided = req.headers.authorization || "";
      const expected = "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64");
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!valid) {
        res.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="TH Agent", charset="UTF-8"',
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("401 Unauthorized");
        return;
      }
    }

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
        const voiceConfig = await getVoiceConfig();
        const sentryConfig = await getSentryConfig();
        const sandboxConfig = await getSandboxConfig();
        const dockerStatus = await getDockerContainers();
        const customModels = (await loadCustomModels()) || {};
        const activeProviderId = process.env.PI_PROVIDER || "local-pi";
        const piModelOptions = await getModelList();
        const activeCustomPiModels =
          customModels.piProvider === activeProviderId && Array.isArray(customModels.piModels)
            ? customModels.piModels
            : piModelOptions;

        return sendJson(200, {
          ok: true,
          settings: {
            BOT_TOKEN: parsed.BOT_TOKEN || process.env.BOT_TOKEN || "",
            ALLOWED_TELEGRAM_IDS: parsed.ALLOWED_TELEGRAM_IDS || process.env.ALLOWED_TELEGRAM_IDS || "",
            PI_MODEL: parsed.PI_MODEL || process.env.PI_MODEL || "openai/gpt-oss-120b",
            CLI_ENGINE: parsed.CLI_ENGINE || process.env.CLI_ENGINE || "pi",
            CMD_MAX_TURNS: parsed.CMD_MAX_TURNS || process.env.CMD_MAX_TURNS || "300",
            TASK_TIMEOUT_MS: parsed.TASK_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || "900000",
            TASK_MAX_TIMEOUT_MS: parsed.TASK_MAX_TIMEOUT_MS || process.env.TASK_MAX_TIMEOUT_MS || "14400000",
            WEB_PORT: parsed.WEB_PORT || process.env.WEB_PORT || "3030",
            PI_SERVER_URL: parsed.PI_SERVER_URL || process.env.PI_SERVER_URL || "",
            PI_SERVER_API_KEY: parsed.PI_SERVER_API_KEY || process.env.PI_SERVER_API_KEY || "",
            GITHUB_TOKEN: parsed.GITHUB_TOKEN || process.env.GITHUB_TOKEN || "",
            DEPLOY_COMMAND: parsed.DEPLOY_COMMAND || process.env.DEPLOY_COMMAND || "git pull && npm install && (launchctl kickstart -k gui/$(id -u)/com.taufik.th-agent 2>/dev/null || systemctl --user restart th-agent 2>/dev/null)",
            GROQ_API_KEY: parsed.GROQ_API_KEY || process.env.GROQ_API_KEY || voiceConfig.groqApiKey || "",
            OPENAI_API_KEY: parsed.OPENAI_API_KEY || process.env.OPENAI_API_KEY || voiceConfig.openaiApiKey || "",
          },
          sandboxConfig,
          authStatus: {
            hasPiServerKey: Boolean(parsed.PI_SERVER_API_KEY || process.env.PI_SERVER_API_KEY),
            hasGithubToken: Boolean(parsed.GITHUB_TOKEN || process.env.GITHUB_TOKEN),
            hasGroqKey: Boolean(parsed.GROQ_API_KEY || process.env.GROQ_API_KEY || voiceConfig.groqApiKey),
            hasOpenaiKey: Boolean(parsed.OPENAI_API_KEY || process.env.OPENAI_API_KEY || voiceConfig.openaiApiKey),
          },
          voiceConfig,
          sentryConfig,
          dockerStatus,
          customModels: {
            piModels: activeCustomPiModels,
          },
          options: {
            piModels: piModelOptions,
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

    // API: Ambil statistik penggunaan token AI
    if (pathname === "/api/usage" && req.method === "GET") {
      try {
        const stats = await loadUsageStats();
        return sendJson(200, { ok: true, stats });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Tarik remote models dari provider (OpenAI-compatible / custom server)
    if (pathname === "/api/models/remote" && req.method === "GET") {
      try {
        const { parsed } = await readEnvFile();
        const baseUrl =
          url.searchParams.get("baseUrl") ||
          parsed.PI_SERVER_URL ||
          process.env.PI_SERVER_URL ||
          "http://127.0.0.1:8317/v1";
        const apiKey =
          url.searchParams.get("apiKey") !== null
            ? url.searchParams.get("apiKey")
            : (parsed.PI_SERVER_API_KEY || process.env.PI_SERVER_API_KEY || "");

        const models = await fetchRemoteModels(baseUrl, apiKey);
        return sendJson(200, { ok: true, models, count: models.length });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Sinkronisasi dan Ambil Model langsung dari Link Pi
    if (pathname === "/api/models/sync-pi" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const { parsed } = await readEnvFile();
        const baseUrl = payload.baseUrl || parsed.PI_SERVER_URL || process.env.PI_SERVER_URL || "";
        const apiKey = payload.apiKey !== undefined ? payload.apiKey : (parsed.PI_SERVER_API_KEY || process.env.PI_SERVER_API_KEY || "");
        const selectModel = payload.selectModel || null;

        if (!baseUrl) {
          return sendJson(400, { ok: false, error: "Link / URL server Pi belum diisi." });
        }

        const res = await syncPiModelDirectly(baseUrl, apiKey, null, selectModel);
        if (!res.ok) {
          return sendJson(400, { ok: false, error: res.error, allModels: [] });
        }

        return sendJson(200, {
          ok: true,
          models: res.allModels,
          activeModel: res.activeModel,
          activeName: res.activeName,
          baseUrl: res.serverUrl,
          message: `Berhasil mengambil ${res.allModels.length} model dari Pi! Model aktif: ${res.activeModel}`,
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Kelola Provider Pi (multi-provider, ~/.pi/agent/models.json)
    if (pathname === "/api/pi-providers" && req.method === "GET") {
      try {
        const providers = await listPiProviders();
        return sendJson(200, {
          ok: true,
          defaultProvider: process.env.PI_PROVIDER || "local-pi",
          providers,
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    if (pathname === "/api/pi-providers" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const action = payload.action || "save";

        if (action === "delete") {
          const removed = await deletePiProvider(payload.id);
          if ((process.env.PI_PROVIDER || "local-pi") === removed) {
            await updateEnvFile({ PI_PROVIDER: "local-pi" });
            process.env.PI_PROVIDER = "local-pi";
          }
          const custom = (await loadCustomModels()) || {};
          if (custom.piProvider === removed) {
            delete custom.piModels;
            delete custom.piProvider;
            await saveCustomModels(custom);
          }
          return sendJson(200, {
            ok: true,
            message: `Provider '${removed}' dihapus.`,
            providers: await listPiProviders(),
            defaultProvider: process.env.PI_PROVIDER || "local-pi",
            piModels: await getModelList(),
            piModel: process.env.PI_MODEL || "",
          });
        }

        if (action === "set-default") {
          const id = String(payload.id || "").trim();
          const providers = await listPiProviders();
          if (!providers.some((p) => p.id === id)) {
            return sendError(400, `Provider '${id}' tidak ditemukan.`);
          }

          const provider = await getPiProviderRaw(id);
          const updates = { PI_PROVIDER: id };

          // Selaraskan endpoint & key bot dengan provider yang dipilih.
          if (provider?.baseUrl) {
            updates.PI_SERVER_URL = normalizePiUrl(provider.baseUrl);
          }
          if (provider?.apiKey) {
            updates.PI_SERVER_API_KEY = provider.apiKey;
          }
          // Selaraskan daftar model bot dengan model provider yang dipilih.
          const custom = (await loadCustomModels()) || {};
          custom.piProvider = id;
          if (provider?.models?.length) {
            custom.piModels = provider.models;
            const firstId = typeof provider.models[0] === "string"
              ? provider.models[0]
              : provider.models[0]?.id;
            if (firstId) updates.PI_MODEL = firstId;
          } else {
            delete custom.piModels;
          }
          await saveCustomModels(custom);

          await updateEnvFile(updates);
          Object.assign(process.env, updates);

          return sendJson(200, {
            ok: true,
            message: `Provider default diubah ke '${id}' dan disinkronkan ke bot.`,
            providers: await listPiProviders(),
            defaultProvider: id,
            piModels: await getModelList(),
            piModel: process.env.PI_MODEL || "",
          });
        }

        const savedId = await savePiProvider(payload);
        const activeId = process.env.PI_PROVIDER || "local-pi";
        if (savedId === activeId) {
          const saved = await getPiProviderRaw(savedId);
          const savedModels = Array.isArray(saved?.models) ? saved.models : [];
          const custom = (await loadCustomModels()) || {};
          custom.piProvider = savedId;
          if (savedModels.length > 0) {
            custom.piModels = savedModels;
            const firstId = typeof savedModels[0] === "string" ? savedModels[0] : savedModels[0]?.id;
            const currentId = process.env.PI_MODEL || "";
            const stillExists = savedModels.some(
              (m) => (typeof m === "string" ? m : m?.id) === currentId
            );
            if (firstId && !stillExists) {
              await updateEnvFile({ PI_MODEL: firstId });
              process.env.PI_MODEL = firstId;
            }
          } else {
            delete custom.piModels;
          }
          await saveCustomModels(custom);
        }
        return sendJson(200, {
          ok: true,
          message: `Provider '${savedId}' disimpan.`,
          providers: await listPiProviders(),
          defaultProvider: activeId,
          piModels: await getModelList(),
          piModel: process.env.PI_MODEL || "",
        });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    // API: Status CLIProxyAPI (server 8317)
    if (pathname === "/api/cliproxy/status" && req.method === "GET") {
      try {
        return sendJson(200, await getCpaStatus());
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Mulai OAuth provider lewat CLIProxyAPI
    if (pathname === "/api/cliproxy/oauth/start" && req.method === "GET") {
      try {
        const provider = url.searchParams.get("provider") || "antigravity";
        return sendJson(200, { ok: true, ...(await startCpaOAuth(provider)) });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    // API: Cek status OAuth
    if (pathname === "/api/cliproxy/oauth/status" && req.method === "GET") {
      try {
        const state = url.searchParams.get("state") || "";
        return sendJson(200, { ok: true, ...(await getCpaOAuthStatus(state)) });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    // API: Kirim URL callback OAuth (untuk browser remote / loopback gagal)
    if (pathname === "/api/cliproxy/oauth/callback" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const result = await submitCpaOAuthCallback({
          provider: payload.provider,
          redirectUrl: payload.redirectUrl || payload.redirect_url,
          state: payload.state,
          code: payload.code,
          error: payload.error,
        });
        return sendJson(200, { ok: true, ...result });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    // API: Kelola kredensial CLIProxyAPI
    if (pathname === "/api/cliproxy/credentials" && req.method === "GET") {
      try {
        const credentials = await listCpaCredentials();
        return sendJson(200, { ok: true, credentials });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    if (pathname === "/api/cliproxy/credentials/status" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        await setCpaCredentialDisabled(payload.name, payload.disabled);
        return sendJson(200, { ok: true, credentials: await listCpaCredentials() });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    if (pathname === "/api/cliproxy/credentials/delete" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        await deleteCpaCredential(payload.name);
        return sendJson(200, { ok: true, credentials: await listCpaCredentials() });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    if (pathname === "/api/cliproxy/credentials/refresh" && req.method === "POST") {
      try {
        await refreshCpaCredentials();
        return sendJson(200, { ok: true, credentials: await listCpaCredentials() });
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    // API: Kelola Daftar Model yang Diizinkan Muncul (Allowed / Custom Models)
    if (pathname === "/api/custom-models" && req.method === "GET") {
      try {
        const custom = (await loadCustomModels()) || {};
        return sendJson(200, {
          ok: true,
          customModels: {
            piModels: custom.piModels || [],
          },
        });
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    if (pathname === "/api/custom-models" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const existing = (await loadCustomModels()) || {
          piModels: [],
        };
        const engineKey = "piModels";

        if (payload.action === "reset") {
          delete existing[engineKey];
          delete existing.piProvider;
          await saveCustomModels(existing);
          return sendJson(200, {
            ok: true,
            message: "Daftar model berhasil direset ke default.",
            customModels: existing,
            options: await getModelList(),
          });
        }

        if (payload.action === "sync_remote" && Array.isArray(payload.models)) {
          existing[engineKey] = payload.models;
          existing.piProvider = process.env.PI_PROVIDER || "local-pi";
          await saveCustomModels(existing);
          return sendJson(200, {
            ok: true,
            message: `Berhasil menyinkronkan ${payload.models.length} model dari server Pi.`,
            customModels: existing,
            options: existing[engineKey],
          });
        }

        if (payload.action === "add" && payload.modelId) {
          existing.piProvider = process.env.PI_PROVIDER || "local-pi";
          if (!Array.isArray(existing[engineKey])) {
            const currentList = await getModelList();
            existing[engineKey] = [...currentList];
          }
          const id = payload.modelId.trim();
          const name = payload.name ? payload.name.trim() : id;
          if (!existing[engineKey].some((m) => ((m.id || m) + "").trim().toLowerCase() === id.toLowerCase())) {
            existing[engineKey].push({ id, name, badge: "Custom" });
          }
          await saveCustomModels(existing);
          return sendJson(200, {
            ok: true,
            message: `Model '${id}' berhasil ditambahkan ke daftar yang diizinkan.`,
            customModels: existing,
            options: await getModelList(),
          });
        }

        if (payload.action === "remove" && payload.modelId) {
          existing.piProvider = process.env.PI_PROVIDER || "local-pi";
          if (!Array.isArray(existing[engineKey])) {
            const currentList = await getModelList();
            existing[engineKey] = [...currentList];
          }
          const targetId = payload.modelId.trim().toLowerCase();
          existing[engineKey] = existing[engineKey].filter(
            (m) => ((m.id || m) + "").trim().toLowerCase() !== targetId
          );
          await saveCustomModels(existing);

          // Jika model yang dihapus sedang aktif di env, reset ke model pertama yang valid
          const current = (process.env.PI_MODEL || "").trim().toLowerCase();
          if (current === targetId) {
            const nextModel = existing.piModels?.[0]?.id || "openai/gpt-oss-120b";
            await updateEnvFile({ PI_MODEL: nextModel });
            process.env.PI_MODEL = nextModel;
          }

          return sendJson(200, {
            ok: true,
            message: `Model '${payload.modelId}' berhasil dihapus dari daftar.`,
            customModels: existing,
            options: await getModelList(),
          });
        }

        if (payload.customModels) {
          await saveCustomModels(payload.customModels);
          return sendJson(200, {
            ok: true,
            message: "Daftar model kustom berhasil disimpan.",
            customModels: payload.customModels,
          });
        }

        return sendError(400, "Payload aksi tidak valid");
      } catch (err) {
        return sendError(500, err.message);
      }
    }

    // API: Ambil Status Antrean Tugas
    if (pathname === "/api/queue" && req.method === "GET") {
      try {
        const active = getActiveTask();
        const workers = getActiveWorkers();
        return sendJson(200, {
          ok: true,
          activeTask: active
            ? {
                id: active.id,
                startedAt: active.startedAt,
                preview: active.preview || null,
                targetProject: active.targetProject || null,
                userId: active.userId || null,
              }
            : null,
          activeWorkers: workers.map((w) => ({
            id: w.id,
            name: w.name,
            emoji: w.emoji,
            title: w.title,
            targetProject: w.targetProject || null,
            startedAt: w.startedAt,
          })),
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
          if (payload.PI_MODEL !== undefined) {
            updates.PI_MODEL = String(payload.PI_MODEL).trim();
          }
          if (payload.CLI_ENGINE !== undefined) {
            const rawEngine = String(payload.CLI_ENGINE).trim().toLowerCase();
            const engine = rawEngine === "commandcode" || rawEngine === "command-code" || rawEngine === "cmd"
              ? "commandcode"
              : "pi";
            updates.CLI_ENGINE = engine;
            process.env.CLI_ENGINE = engine;
          }
          if (payload.CMD_MAX_TURNS !== undefined) {
            const maxTurns = Number.parseInt(String(payload.CMD_MAX_TURNS).trim(), 10);
            if (Number.isFinite(maxTurns) && maxTurns > 0) {
              updates.CMD_MAX_TURNS = String(maxTurns);
              process.env.CMD_MAX_TURNS = String(maxTurns);
            }
          }
          if (payload.TASK_TIMEOUT_MS !== undefined) {
            updates.TASK_TIMEOUT_MS = String(payload.TASK_TIMEOUT_MS).trim();
          }
          if (payload.TASK_MAX_TIMEOUT_MS !== undefined) {
            const maxMs = Number(String(payload.TASK_MAX_TIMEOUT_MS).trim());
            if (Number.isFinite(maxMs) && maxMs > 0) {
              updates.TASK_MAX_TIMEOUT_MS = String(maxMs);
            }
          }
          if (payload.PI_SERVER_API_KEY !== undefined) {
            updates.PI_SERVER_API_KEY = String(payload.PI_SERVER_API_KEY).trim();
          }
          if (payload.PI_SERVER_URL !== undefined) {
            updates.PI_SERVER_URL = normalizePiUrl(String(payload.PI_SERVER_URL).trim());
          }
          if (payload.GITHUB_TOKEN !== undefined) {
            updates.GITHUB_TOKEN = String(payload.GITHUB_TOKEN).trim();
          }
          if (payload.sandboxConfig) {
            await saveSandboxConfig(payload.sandboxConfig);
          } else if (payload.scopeRole !== undefined || payload.customFolders !== undefined) {
            await setEngineAccessRole(payload.scopeRole || "auto", payload.customFolders || "");
          } else if (payload.piSandbox !== undefined) {
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

    // Webhook: GitHub Auto-Update (Push Event & Status Check)
    if (pathname === "/webhook/update") {
      if (req.method === "GET") {
        return sendJson(200, {
          ok: true,
          service: "TH Agent Auto-Update Webhook",
          status: "listening",
          description: "Endpoint ini siap menerima GitHub webhook push event untuk auto-update.",
        });
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 500 * 1024) req.destroy();
        });

        req.on("end", async () => {
          try {
            const result = await handleWebhookPush(body, req.headers);
            return sendJson(result.ok ? 200 : 403, result);
          } catch (err) {
            return sendError(500, `Webhook error: ${err.message}`);
          }
        });
        return;
      }
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

export function startWebServer(
  port = process.env.WEB_PORT || 3030,
  host = process.env.WEB_HOST || "0.0.0.0"
) {
  const server = createWebServer();
  const PORT = Number(port);
  const HOST = host || "0.0.0.0";

  server.listen(PORT, HOST, () => {
    const shown = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
    console.log(`🌐 Web UI Settings aktif di: http://${shown}:${PORT} (bind ${HOST})`);
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
// (jangan aktif saat file ini ikut dibundel ke binary utama)
if (process.argv[1] && path.basename(process.argv[1]) === "web-server.js") {
  startWebServer(process.env.WEB_PORT || 3030);
}
