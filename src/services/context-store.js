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

export async function resetUserConversation(userId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.conversations) context.conversations = {};
  const oldConvId = context.conversations[String(userId)];
  const newConvId = randomUUID();
  context.conversations[String(userId)] = newConvId;

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
  context.agyModels[String(userId)] = modelId;
  if (!context.models) context.models = {};
  context.models[String(userId)] = modelId;
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
  context.claudeModels[String(userId)] = modelId;
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
  context.universalModels[String(userId)] = modelId;
  await saveContext(context);
}

export async function getUserModel(userId) {
  const engine = await getUserEngine(userId);
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
