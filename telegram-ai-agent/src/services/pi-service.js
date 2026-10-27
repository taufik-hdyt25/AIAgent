import { fetchRemoteModels, normalizePiUrl, loadCustomModels, saveCustomModels } from "../config/models.js";
import { updateEnvFile, maskSecret } from "./env-service.js";
import {
  setUserEngine,
  setUserUniversalModel,
  getUserUniversalModel,
  setGlobalUniversalModel,
} from "./context-store.js";

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

  // Simpan daftar model dari Pi ke data/models.json (universalModels)
  try {
    const custom = (await loadCustomModels()) || {};
    custom.universalModels = models;
    await saveCustomModels(custom);
  } catch (err) {
    console.error("[PiService] Gagal menyimpan remote models ke models.json:", err.message);
  }

  // Pilih model langsung sesuai yang di-declare di server Pi:
  // 1. Cek parameter selectModel jika ada
  let chosenModel = null;
  if (selectModel) {
    chosenModel = models.find((m) => m.id.toLowerCase() === selectModel.toLowerCase());
  }

  // 2. Cek apakah ada model yang sudah dikonfigurasi pengguna di UNIVERSAL_MODEL
  if (!chosenModel) {
    const configured = (process.env.UNIVERSAL_MODEL || "").trim().toLowerCase();
    if (configured && configured !== "auto") {
      chosenModel = models.find((m) => m.id.toLowerCase() === configured);
    }
  }

  // 3. Jika tidak ada atau belum diatur khusus, gunakan model pertama dari server Pi
  if (!chosenModel) {
    chosenModel = models[0];
  }

  const chosenId = chosenModel.id;

  // Simpan ke .env & update process.env
  const envUpdates = {
    UNIVERSAL_BASE_URL: targetUrl,
    UNIVERSAL_MODEL: chosenId,
    CLI_ENGINE: "universal",
  };
  if (apiKey) {
    envUpdates.UNIVERSAL_API_KEY = apiKey;
  }
  await updateEnvFile(envUpdates);

  // Update secara global ke context untuk seluruh user
  await setGlobalUniversalModel(chosenId);

  if (userId) {
    await setUserEngine(userId, "universal");
    await setUserUniversalModel(userId, chosenId);
  }

  return {
    ok: true,
    activeModel: chosenId,
    activeName: chosenModel.name || chosenId,
    allModels: models,
    serverUrl: targetUrl,
  };
}
