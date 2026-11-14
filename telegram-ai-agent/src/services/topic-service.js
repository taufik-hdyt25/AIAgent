import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const TOPIC_MAPPINGS_FILE = path.join(DATA_DIR, "topic_mappings.json");
let topicCache = null;

/**
 * Struktur topic_mappings.json:
 * {
 *   "-100123456789:42": {
 *      "chatId": -100123456789,
 *      "threadId": 42,
 *      "project": "th-blog",        // nama project di projects/ atau "root"
 *      "role": "project",           // "project" | "root"
 *      "title": "TH Blog Development",
 *      "updatedAt": "2026-11-11T..."
 *   }
 * }
 */

export async function loadTopicMappings() {
  if (topicCache) return topicCache;
  try {
    const raw = await readFile(TOPIC_MAPPINGS_FILE, "utf8");
    topicCache = JSON.parse(raw);
  } catch {
    topicCache = {};
  }
  return topicCache;
}

export async function saveTopicMappings(mappings) {
  topicCache = { ...mappings };
  await writeFile(TOPIC_MAPPINGS_FILE, JSON.stringify(topicCache, null, 2), "utf8");
  return topicCache;
}

export function buildTopicConversationId(baseId, chatId, threadId) {
  return chatId && threadId ? `${baseId}-chat-${chatId}-thread-${threadId}` : baseId;
}

export function buildTopicKey(chatId, threadId) {
  if (!chatId || !threadId) return null;
  return `${chatId}:${threadId}`;
}

/**
 * Mendapatkan mapping project untuk suatu Telegram topic/thread
 */
export async function getTopicBinding(chatId, threadId) {
  if (!chatId || !threadId) return null;
  const mappings = await loadTopicMappings();
  const key = buildTopicKey(chatId, threadId);
  return mappings[key] || null;
}

/**
 * Menghubungkan suatu thread topic ke project tertentu
 */
export async function setTopicBinding(chatId, threadId, project, options = {}) {
  if (!chatId || !threadId) return null;
  const mappings = await loadTopicMappings();
  const key = buildTopicKey(chatId, threadId);

  const cleanProject = project === "root" || project === "all" ? "root" : project.trim();
  const role = cleanProject === "root" ? "root" : "project";

  mappings[key] = {
    chatId: Number(chatId),
    threadId: Number(threadId),
    project: cleanProject,
    role,
    title: options.title || mappings[key]?.title || "",
    updatedAt: new Date().toISOString(),
  };

  await saveTopicMappings(mappings);
  return mappings[key];
}

/**
 * Menghapus hubungan topic
 */
export async function removeTopicBinding(chatId, threadId) {
  if (!chatId || !threadId) return false;
  const mappings = await loadTopicMappings();
  const key = buildTopicKey(chatId, threadId);
  if (mappings[key]) {
    delete mappings[key];
    await saveTopicMappings(mappings);
    return true;
  }
  return false;
}

/**
 * Mengambil semua topic yang terhubung untuk sebuah grup
 */
export async function getGroupTopics(chatId) {
  const mappings = await loadTopicMappings();
  const res = [];
  for (const item of Object.values(mappings)) {
    if (Number(item.chatId) === Number(chatId)) {
      res.push(item);
    }
  }
  return res;
}
