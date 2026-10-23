import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const VOICE_CONFIG_FILE = path.join(DATA_DIR, "voice_config.json");

let voiceConfigCache = null;

/**
 * Muat konfigurasi voice transcription
 */
export async function getVoiceConfig() {
  if (voiceConfigCache) return voiceConfigCache;
  try {
    const raw = await readFile(VOICE_CONFIG_FILE, "utf8");
    voiceConfigCache = JSON.parse(raw);
  } catch {
    voiceConfigCache = {
      provider: "groq", // "groq" atau "openai"
      groqApiKey: process.env.GROQ_API_KEY || "",
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      model: "whisper-large-v3-turbo",
      language: "id", // default Indonesia
    };
  }
  return voiceConfigCache;
}

/**
 * Simpan konfigurasi API key Whisper
 */
export async function saveVoiceConfig(newConfig) {
  const current = await getVoiceConfig();
  voiceConfigCache = { ...current, ...newConfig };
  await writeFile(VOICE_CONFIG_FILE, JSON.stringify(voiceConfigCache, null, 2), "utf8");
  return voiceConfigCache;
}

/**
 * Atur API Key Whisper dari Telegram command (/setwhisper <provider> <key>)
 */
export async function setWhisperApiKey(key, provider = "groq") {
  const cleanKey = key.trim();
  const cleanProvider = provider.toLowerCase().includes("openai") ? "openai" : "groq";

  const update = {
    provider: cleanProvider,
    ...(cleanProvider === "groq" ? { groqApiKey: cleanKey } : { openaiApiKey: cleanKey }),
  };

  return await saveVoiceConfig(update);
}

/**
 * Transkripsi audio buffer menggunakan Whisper API (Groq atau OpenAI)
 */
export async function transcribeAudio(audioBuffer, options = {}) {
  const {
    fileName = "voice_note.oga",
    mimeType = "audio/ogg",
    language = "id",
  } = options;

  const config = await getVoiceConfig();

  const isGroq = config.provider === "groq" || Boolean(config.groqApiKey);
  const apiKey = isGroq ? (config.groqApiKey || process.env.GROQ_API_KEY) : (config.openaiApiKey || process.env.OPENAI_API_KEY);

  if (!apiKey) {
    return {
      success: false,
      error: "NO_API_KEY",
      message: "API Key Whisper belum dikonfigurasi.",
    };
  }

  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";

  const model = isGroq ? "whisper-large-v3-turbo" : "whisper-1";

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("model", model);
  if (language) {
    formData.append("language", language);
  }
  formData.append("response_format", "json");

  const startedAt = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const json = await res.json();
    const durationSec = Number(((Date.now() - startedAt) / 1000).toFixed(2));

    return {
      success: true,
      text: (json.text || "").trim(),
      durationSec,
      provider: isGroq ? "Groq (Whisper-v3-turbo)" : "OpenAI (Whisper-1)",
    };
  } catch (err) {
    return {
      success: false,
      error: "TRANSCRIPTION_FAILED",
      message: err.message,
    };
  }
}
