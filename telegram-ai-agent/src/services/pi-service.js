import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fetchRemoteModels, normalizePiUrl, loadCustomModels, saveCustomModels } from "../config/models.js";
import { updateEnvFile, maskSecret } from "./env-service.js";
import {
  getUserEngine,
  setUserEngine,
  setUserUniversalModel,
  getUserUniversalModel,
  setUserPiModel,
  setGlobalUniversalModel,
} from "./context-store.js";

/**
 * Sinkronisasi konfigurasi models.json untuk Pi CLI
 * agar Pi CLI bisa langsung menggunakan model-model dari URL server Pi
 */
export async function syncPiCliConfig(baseUrl, apiKey, models) {
  const piAgentDirs = [
    path.join(os.homedir(), ".pi", "agent"),
    "/home/ubuntu/.pi/agent",
    "/home/th-agent/.pi/agent",
  ];

  const configContent = {
    $schema: "https://pi.dev/schemas/models.schema.json",
    providers: {
      "local-pi": {
        baseUrl: baseUrl,
        api: "openai-completions",
        apiKey: apiKey || "sk-local",
        models: (models || []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
        })),
      },
    },
  };

  for (const dir of piAgentDirs) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "models.json"), JSON.stringify(configContent, null, 2) + "\n", "utf8");
    } catch (_) {}
  }
}

/**
 * Mengambil model langsung dari server Pi (GET /models, /v1/models, atau /api/tags)
 * dan langsung mengaktifkannya sebagai model default
 */
export async function syncPiModelDirectly(baseUrl, apiKey, userId, selectModel = null) {
  const targetUrl = normalizePiUrl(baseUrl || process.env.UNIVERSAL_BASE_URL || "http://127.0.0.1:46315/v1");
  const targetKey = apiKey !== undefined ? apiKey : (process.env.UNIVERSAL_API_KEY || "");

  const models = await fetchRemoteModels(targetUrl, targetKey);
  if (!models || models.length === 0) {
    return {
      ok: false,
      error: `Tidak ada model ditemukan di endpoint server Pi (${targetUrl})`,
      allModels: [],
    };
  }

  // Simpan daftar model dari Pi ke data/models.json (baik untuk universalModels dan piModels)
  try {
    const custom = (await loadCustomModels()) || {};
    custom.universalModels = models;
    custom.piModels = models;
    await saveCustomModels(custom);
  } catch (err) {
    console.error("[PiService] Gagal menyimpan remote models ke models.json:", err.message);
  }

  // Sinkronkan langsung ke Pi CLI config (~/.pi/agent/models.json)
  await syncPiCliConfig(targetUrl, targetKey, models).catch((e) =>
    console.warn("[PiService] Gagal sync Pi CLI config:", e.message)
  );

  // Pilih model langsung sesuai yang di-declare di server Pi:
  // 1. Cek parameter selectModel jika ada
  let chosenModel = null;
  if (selectModel) {
    chosenModel = models.find((m) => m.id.toLowerCase() === selectModel.toLowerCase());
  }

  // 2. Cek apakah ada model yang sudah dikonfigurasi pengguna di UNIVERSAL_MODEL atau PI_MODEL
  if (!chosenModel) {
    const configured = (process.env.PI_MODEL || process.env.UNIVERSAL_MODEL || "").trim().toLowerCase();
    if (configured && configured !== "auto") {
      chosenModel = models.find((m) => m.id.toLowerCase() === configured);
    }
  }

  // 3. Jika tidak ada atau belum diatur khusus, gunakan model pertama dari server Pi
  if (!chosenModel) {
    chosenModel = models[0];
  }

  const chosenId = chosenModel.id;

  // Cek engine aktif pengguna
  const currentEngine = userId ? await getUserEngine(userId) : (process.env.CLI_ENGINE || "pi");
  const isPiActive = currentEngine === "pi";

  // Simpan ke .env & update process.env
  const envUpdates = {
    UNIVERSAL_BASE_URL: targetUrl,
    UNIVERSAL_MODEL: chosenId,
    PI_MODEL: chosenId,
  };
  if (isPiActive) {
    envUpdates.CLI_ENGINE = "pi";
  } else if (currentEngine === "universal") {
    envUpdates.CLI_ENGINE = "universal";
  }
  if (apiKey) {
    envUpdates.UNIVERSAL_API_KEY = apiKey;
  }
  await updateEnvFile(envUpdates);

  // Update secara global ke context untuk seluruh user
  await setGlobalUniversalModel(chosenId);

  if (userId) {
    if (isPiActive) {
      await setUserPiModel(userId, chosenId);
    } else {
      await setUserUniversalModel(userId, chosenId);
    }
  }

  return {
    ok: true,
    activeModel: chosenId,
    activeName: chosenModel.name || chosenId,
    allModels: models,
    serverUrl: targetUrl,
  };
}
