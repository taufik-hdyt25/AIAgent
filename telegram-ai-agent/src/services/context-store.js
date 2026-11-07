import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { CONTEXT_FILE, DEFAULT_PI_MODEL } from "../config/env.js";

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

  if (context.piSessions && oldConvId) {
    delete context.piSessions[oldConvId];
  }
  await saveContext(context);
}

export async function isPiSessionStarted(convId) {
  if (!convId) return false;
  const context = await loadContext();
  return Boolean(context.piSessions?.[convId]);
}

export async function markPiSessionStarted(convId, started = true) {
  if (!convId) return;
  const context = await loadContext();
  if (!context.piSessions) context.piSessions = {};
  if (started) {
    context.piSessions[convId] = true;
  } else {
    delete context.piSessions[convId];
  }
  await saveContext(context);
}

export async function getUserPiModel(userId) {
  const envModel = process.env.PI_MODEL;
  if (!userId) return envModel || DEFAULT_PI_MODEL;
  const context = await loadContext();
  return context.piModels?.[String(userId)] || envModel || DEFAULT_PI_MODEL;
}

export async function setUserPiModel(userId, modelId) {
  if (!userId) return;
  const context = await loadContext();
  if (!context.piModels) context.piModels = {};
  context.piModels[String(userId)] = modelId;
  await saveContext(context);
}

export async function getUserModel(userId) {
  return getUserPiModel(userId);
}

export async function setUserModel(userId, modelId) {
  return setUserPiModel(userId, modelId);
}

export async function getUserActiveProject(userId) {
  if (!userId) return null;
  const context = await loadContext();
  return context.activeProjects?.[String(userId)] || null;
}

export async function setUserActiveProject(userId, projectName) {
  if (!userId || !projectName) return;
  const context = await loadContext();
  if (!context.activeProjects) context.activeProjects = {};
  context.activeProjects[String(userId)] = projectName;
  await saveContext(context);
}
