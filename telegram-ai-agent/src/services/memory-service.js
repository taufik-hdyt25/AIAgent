import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../config/env.js";

const MEMORY_FILE = path.join(DATA_DIR, "memories.json");
const VECTOR_DIM = 128;

let memoryCache = null;

/**
 * Mengubah teks menjadi dense vector (128 dimensi) menggunakan subword n-gram hashing
 * dan normalisasi L2 untuk cosine similarity yang cepat dan akurat tanpa dependensi eksternal.
 */
export function textToVector(text, dim = VECTOR_DIM) {
  const vec = new Float32Array(dim);
  if (!text || typeof text !== "string") return Array.from(vec);

  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = clean.split(/\s+/).filter((t) => t.length > 1);

  for (const token of tokens) {
    // 1. Word hashing (bobot 1.5)
    let h1 = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h1 ^= token.charCodeAt(i);
      h1 = Math.imul(h1, 16777619);
    }
    const idx1 = Math.abs(h1) % dim;
    vec[idx1] += 1.5;

    // 2. Character 3-gram hashing (bobot 0.5) untuk mentoleransi typo & variasi kata
    for (let i = 0; i <= token.length - 3; i++) {
      const gram = token.slice(i, i + 3);
      let h2 = 2166136261;
      for (let j = 0; j < 3; j++) {
        h2 ^= gram.charCodeAt(j);
        h2 = Math.imul(h2, 16777619);
      }
      const idx2 = Math.abs(h2) % dim;
      vec[idx2] += 0.5;
    }
  }

  // L2 Normalization
  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;

  return Array.from(vec);
}

/**
 * Menghitung cosine similarity antara dua unit vector (dot product)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * Muat seluruh memori dari storage lokal
 */
export async function loadMemories() {
  if (memoryCache) return memoryCache;
  try {
    const raw = await readFile(MEMORY_FILE, "utf8");
    memoryCache = JSON.parse(raw);
  } catch {
    memoryCache = [];
    await seedDefaultMemories();
  }
  return memoryCache;
}

/**
 * Simpan memori ke storage lokal secara persisten
 */
export async function saveMemories(memories) {
  memoryCache = memories;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2) + "\n", "utf8");
}

/**
 * Isi memori awal sistem jika file belum ada
 */
async function seedDefaultMemories() {
  const defaults = [
    {
      id: "mem-seed-1",
      content: "Developer mewajibkan penggunaan Node.js versi 26 (Current) untuk semua container Docker di server.",
      category: "preference",
      tags: ["docker", "nodejs", "node26", "version"],
      importance: 5,
      createdAt: new Date().toISOString(),
      recallCount: 1,
      lastRecalledAt: new Date().toISOString(),
      vector: textToVector("Developer mewajibkan penggunaan Node.js versi 26 Current untuk semua container Docker di server"),
    },
    {
      id: "mem-seed-2",
      content: "Arsitektur container: wa-chat-bot menggunakan port 3001 (bot) & 3333 (dashboard), ai-podcast-live menggunakan port 3005, th-blog menggunakan port 3000.",
      category: "architecture",
      tags: ["port", "docker", "wa-chat-bot", "ai-podcast-live", "th-blog"],
      importance: 5,
      createdAt: new Date().toISOString(),
      recallCount: 1,
      lastRecalledAt: new Date().toISOString(),
      vector: textToVector("Arsitektur container wa-chat-bot port 3001 bot 3333 dashboard ai-podcast-live 3005 th-blog 3000"),
    },
    {
      id: "mem-seed-3",
      content: "Prinsip eksekusi adalah Zero-Confirmation: eksekusi langsung perintah terminal, git rebase, compile, dan deploy tanpa bertanya balik minta izin.",
      category: "workflow",
      tags: ["zero-confirmation", "execution", "git", "deploy"],
      importance: 5,
      createdAt: new Date().toISOString(),
      recallCount: 1,
      lastRecalledAt: new Date().toISOString(),
      vector: textToVector("Prinsip eksekusi Zero Confirmation langsung eksekusi tanpa bertanya balik konfirmasi"),
    },
  ];

  await saveMemories(defaults);
}

/**
 * Tambah memori baru ke persistent vector memory
 */
export async function addMemory({
  content,
  category = "general",
  tags = [],
  importance = 3,
}) {
  if (!content || !content.trim()) return null;
  const memories = await loadMemories();

  // Cek duplikasi konten mirip
  const queryVec = textToVector(content);
  const existing = memories.find((m) => {
    const sim = cosineSimilarity(m.vector, queryVec);
    return sim > 0.88; // 88% mirip dianggap duplikat
  });

  if (existing) {
    existing.content = content.trim();
    existing.tags = Array.from(new Set([...(existing.tags || []), ...tags]));
    existing.importance = Math.max(existing.importance || 3, importance);
    existing.updatedAt = new Date().toISOString();
    existing.vector = queryVec;
    await saveMemories(memories);
    return existing;
  }

  const newMem = {
    id: `mem-${randomUUID().slice(0, 8)}`,
    content: content.trim(),
    category,
    tags,
    importance: Math.min(5, Math.max(1, Number(importance) || 3)),
    createdAt: new Date().toISOString(),
    recallCount: 0,
    lastRecalledAt: null,
    vector: queryVec,
  };

  memories.push(newMem);
  await saveMemories(memories);
  return newMem;
}

/**
 * Cari memori relevan menggunakan vector semantic search (cosine similarity + tag boost)
 */
export async function searchMemories(queryText, options = {}) {
  const { limit = 5, minScore = 0.18 } = options;
  if (!queryText || typeof queryText !== "string") return [];

  const memories = await loadMemories();
  if (memories.length === 0) return [];

  const queryVec = textToVector(queryText);
  const queryWords = queryText.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = memories.map((mem) => {
    let score = cosineSimilarity(mem.vector, queryVec);

    // Keyword & Tag Boost: jika ada tag atau kata penting yang cocok langsung
    let matchBonus = 0;
    if (Array.isArray(mem.tags)) {
      for (const tag of mem.tags) {
        if (queryWords.includes(tag.toLowerCase())) {
          matchBonus += 0.08;
        }
      }
    }

    // Importance weighting (bobot 1-5 menambah hingga 0.1)
    const importanceBoost = ((mem.importance || 3) - 3) * 0.02;

    const finalScore = score + matchBonus + importanceBoost;
    return { memory: mem, score: finalScore };
  });

  // Filter threshold & sort descending
  const results = scored
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => {
      // Update recall stats
      item.memory.recallCount = (item.memory.recallCount || 0) + 1;
      item.memory.lastRecalledAt = new Date().toISOString();
      return { ...item.memory, score: Number(item.score.toFixed(4)) };
    });

  if (results.length > 0) {
    // Simpan pembaruan recallCount secara async
    saveMemories(memories).catch(() => {});
  }

  return results;
}

/**
 * Format memori untuk disuntikkan ke dalam prompt AI
 */
export function formatMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) return "";

  let md = `\n[Memori Jangka Panjang & Preferensi Developer (Persistent Vector Memory)]:\n`;
  md += `> PENTING: Informasi di bawah adalah fakta persisten dan preferensi yang sudah diingat dari masa lalu:\n`;
  for (const m of memories) {
    const tagStr = m.tags && m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    md += `• [${m.category.toUpperCase()}] ${m.content}${tagStr}\n`;
  }
  return md;
}

/**
 * Hapus memori berdasarkan ID
 */
export async function deleteMemory(id) {
  const memories = await loadMemories();
  const initialLen = memories.length;
  const filtered = memories.filter((m) => m.id !== id);
  if (filtered.length !== initialLen) {
    await saveMemories(filtered);
    return true;
  }
  return false;
}
