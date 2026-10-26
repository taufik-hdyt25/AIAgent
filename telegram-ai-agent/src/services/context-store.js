import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  CONTEXT_FILE,
  DEFAULT_ENGINE,
  DEFAULT_AGY_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_UNIVERSAL_MODEL,
} from "../config/env.js";
import { resetSessionHistory } from "../universal-agent.js";

export async function loadContext() {
  try {
    const data = await readFile(CONTEXT_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveContext(context) {
  await writeFile(CONTEXT_FILE, JSON.stringify(context, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function getUserConversationId(userId) {
  if (!userId) return randomUUID();
  const context = await loadContext();
  if (!context.conversations) context.conversations = {};
  if (!context.conversations[String(userId)]) {
    context.conversations[String(userId)] = randomUUID();
    await saveContext(context);
  }
  return context.conversations[String(userId)];
}

export async function getUserAgyConversationId(userId) {
  if (!userId) return null;
  const context = await loadContext();
  return context.agyConversations?.[String(userId)] || null;
}

export async function setUserAgyConversationId(userId, agyConvId) {
  if (!userId || !agyConvId) return;
  const context = await loadContext();
  if (!context.agyConversations) context.agyConversations = {};
  context.agyConversations[String(userId)] = agyConvId;
  await saveContext(context);
}

export async function resetUserConversation(userId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.conversations) context.conversations = {};
  const oldConvId = context.conversations[String(userId)];
  const newConvId = randomUUID();
  context.conversations[String(userId)] = newConvId;

  if (context.agyConversations && context.agyConversations[String(userId)]) {
    delete context.agyConversations[String(userId)];
  }

  if (context.claudeSessions && oldConvId) {
    delete context.claudeSessions[oldConvId];
  }
  if (oldConvId) resetSessionHistory(oldConvId);
  resetSessionHistory(newConvId);
  await saveContext(context);
}

export async function isClaudeSessionStarted(convId) {
  if (!convId) return false;
  const context = await loadContext();
  return Boolean(context.claudeSessions?.[convId]);
}

export async function markClaudeSessionStarted(convId, started = true) {
  if (!convId) return;
  const context = await loadContext();
  if (!context.claudeSessions) context.claudeSessions = {};
  if (started) {
    context.claudeSessions[convId] = true;
  } else {
    delete context.claudeSessions[convId];
  }
  await saveContext(context);
}

export async function getUserAgyModel(userId) {
  if (!userId) return DEFAULT_AGY_MODEL;
  const context = await loadContext();
  return (
    context.agyModels?.[String(userId)] ||
    context.models?.[String(userId)] ||
    DEFAULT_AGY_MODEL
  );
}

export async function setUserAgyModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.agyModels) context.agyModels = {};
  const prevModel = context.agyModels[String(userId)];
  context.agyModels[String(userId)] = modelId;
  if (!context.models) context.models = {};
  context.models[String(userId)] = modelId;

  // Jika berganti model, reset SEMUA session agar model baru
  // tidak mewarisi riwayat token / rate-limit dari model lama
  if (prevModel && prevModel !== modelId) {
    // Reset AGY conversation ID
    if (context.agyConversations) {
      delete context.agyConversations[String(userId)];
    }
    // Reset general conversation UUID untuk fresh session penuh
    if (context.conversations) {
      context.conversations[String(userId)] = randomUUID();
    }
    // Reset Claude session flag jika ada (cross-engine sync)
    if (context.claudeSessions) {
      const oldConvId = context.conversations?.[String(userId)];
      if (oldConvId) delete context.claudeSessions[oldConvId];
    }
    console.log(`[Context] Model switch: ${prevModel} → ${modelId} for user ${userId}. All sessions reset.`);
  }

  await saveContext(context);
}

export async function getUserClaudeModel(userId) {
  if (!userId) return DEFAULT_CLAUDE_MODEL;
  const context = await loadContext();
  return context.claudeModels?.[String(userId)] || DEFAULT_CLAUDE_MODEL;
}

export async function setUserClaudeModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.claudeModels) context.claudeModels = {};
  const prevModel = context.claudeModels[String(userId)];
  context.claudeModels[String(userId)] = modelId;

  if (prevModel && prevModel !== modelId) {
    // Reset conversation UUID untuk fresh session
    const newConvId = randomUUID();
    if (context.conversations) {
      const oldConvId = context.conversations[String(userId)];
      context.conversations[String(userId)] = newConvId;
      // Reset Claude session flag
      if (oldConvId && context.claudeSessions) {
        delete context.claudeSessions[oldConvId];
      }
    }
    // Reset session history di memory
    resetSessionHistory(newConvId);
    console.log(`[Context] Claude model switch: ${prevModel} → ${modelId} for user ${userId}. Session reset.`);
  }

  await saveContext(context);
}

export async function getUserUniversalModel(userId) {
  if (!userId) return DEFAULT_UNIVERSAL_MODEL;
  const context = await loadContext();
  return context.universalModels?.[String(userId)] || DEFAULT_UNIVERSAL_MODEL;
}

export async function setUserUniversalModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.universalModels) context.universalModels = {};
  const prevModel = context.universalModels[String(userId)];
  context.universalModels[String(userId)] = modelId;

  // Reset session jika model berubah agar tidak mewarisi rate-limit / context lama
  if (prevModel && prevModel !== modelId && modelId) {
    const convId = context.conversations?.[String(userId)];
    if (convId) {
      resetSessionHistory(convId);
    }
    console.log(`[Context] Universal model switch: ${prevModel} → ${modelId} for user ${userId}. Session history reset.`);
  }

  await saveContext(context);
}

export async function getUserModel(userId, engineOverride = null) {
  const engine = engineOverride || await getUserEngine(userId);
  if (engine === "claude") return getUserClaudeModel(userId);
  if (engine === "universal") return getUserUniversalModel(userId);
  return getUserAgyModel(userId);
}

export async function setUserModel(userId, modelId) {
  const engine = await getUserEngine(userId);
  if (engine === "claude") return setUserClaudeModel(userId, modelId);
  if (engine === "universal") return setUserUniversalModel(userId, modelId);
  return setUserAgyModel(userId, modelId);
}

export async function getUserEngine(userId) {
  if (!userId) return DEFAULT_ENGINE;
  const context = await loadContext();
  return context.engines?.[String(userId)] || DEFAULT_ENGINE;
}

export async function setUserEngine(userId, engine) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.engines) context.engines = {};
  context.engines[String(userId)] = engine;
  await saveContext(context);
}
