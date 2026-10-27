import { fetchRemoteModels } from "../config/models.js";
import { updateEnvFile, maskSecret } from "./env-service.js";
import {
  setUserEngine,
  setUserUniversalModel,
  getUserUniversalModel,
} from "./context-store.js";

/**
 * Mengambil model langsung dari server Pi (GET /models, /v1/models, atau /api/tags)
 * dan langsung mengaktifkannya sebagai model default
 */
export async function syncPiModelDirectly(baseUrl, apiKey, userId) {
  const targetUrl = baseUrl || process.env.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
  const targetKey = apiKey !== undefined ? apiKey : (process.env.UNIVERSAL_API_KEY || "");

  const models = await fetchRemoteModels(targetUrl, targetKey);
  if (!models || models.length === 0) {
    return {
      ok: false,
      error: `Tidak ada model ditemukan di endpoint server Pi (${targetUrl})`,
      allModels: [],
    };
  }

  // Pilih model langsung sesuai yang di-declare di server Pi:
  // 1. Cek apakah ada model yang sudah dikonfigurasi pengguna di UNIVERSAL_MODEL
  const configured = (process.env.UNIVERSAL_MODEL || "").trim().toLowerCase();
  let chosenModel = null;
  if (configured && configured !== "auto" && configured !== "deepseek-chat") {
    chosenModel = models.find((m) => m.id.toLowerCase() === configured);
  }

  // 2. Jika tidak ada atau belum diatur khusus, gunakan langsung model pertama yang di-declare di server Pi
  if (!chosenModel) {
    chosenModel = models[0];
  }

  const chosenId = chosenModel.id;

  // Simpan ke .env & update process.env
  await updateEnvFile({
    UNIVERSAL_MODEL: chosenId,
    CLI_ENGINE: "universal",
  });

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
