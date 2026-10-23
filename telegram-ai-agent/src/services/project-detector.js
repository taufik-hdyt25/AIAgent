import { readdir } from "node:fs/promises";
import path from "node:path";
import { PROJECTS_DIR } from "../config/env.js";

// Cache daftar proyek agar tidak perlu I/O disk setiap pesan
let cachedProjects = null;
let lastCacheTime = 0;

export async function getKnownProjects() {
  const now = Date.now();
  if (cachedProjects && now - lastCacheTime < 15000) {
    return cachedProjects;
  }
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    cachedProjects = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
    lastCacheTime = now;
  } catch {
    cachedProjects = [];
  }
  return cachedProjects;
}

/**
 * Peta alias & kata kunci populer per proyek untuk meningkatkan akurasi deteksi konteks
 */
const PROJECT_ALIASES = {
  "th-blog": [
    "th-blog",
    "th_blog",
    "thblog",
    "blog",
    "th blogs",
    "th-blogs",
    "next-blog",
  ],
  "wa-chat-bot": [
    "wa-chat-bot",
    "wa_chat_bot",
    "wa-bot",
    "wabot",
    "whatsapp",
    "wa chat",
    "baileys",
  ],
  "ai-podcast-live": [
    "ai-podcast-live",
    "ai_podcast_live",
    "ai-podcast",
    "podcast",
    "tiktok live",
    "tiktok-live",
    "podcast live",
  ],
  "intiva": [
    "intiva",
    "projects/intiva",
  ],
};

/**
 * Mendeteksi secara cerdas apakah sebuah pesan / file menargetkan proyek tertentu di ./projects/
 * Mengembalikan nama folder proyek (misal "th-blog") atau null jika global / tidak spesifik.
 */
export async function detectTargetProject(userMessage = "", fileInfo = null) {
  if (!userMessage && !fileInfo) return null;

  const text = (userMessage || "").toLowerCase();
  const knownProjects = await getKnownProjects();
  if (knownProjects.length === 0) return null;

  const matches = new Set();

  // 1. Cek path file upload jika ada
  if (fileInfo) {
    const fPath = `${fileInfo.relativePath || ""} ${fileInfo.absolutePath || ""} ${fileInfo.fileName || ""}`.toLowerCase();
    for (const proj of knownProjects) {
      if (fPath.includes(`projects/${proj.toLowerCase()}`) || fPath.includes(proj.toLowerCase())) {
        matches.add(proj);
      }
    }
  }

  // 2. Cek penyebutan eksplisit path folder: projects/<nama-project> atau ./projects/<nama-project>
  for (const proj of knownProjects) {
    const cleanProj = proj.toLowerCase();
    if (
      text.includes(`projects/${cleanProj}`) ||
      text.includes(`./projects/${cleanProj}`) ||
      text.includes(`folder ${cleanProj}`) ||
      text.includes(`proyek ${cleanProj}`) ||
      text.includes(`project ${cleanProj}`)
    ) {
      matches.add(proj);
    }
  }

  // 3. Cek nama folder proyek langsung (word boundary check)
  for (const proj of knownProjects) {
    const cleanProj = proj.toLowerCase();
    const regex = new RegExp(`(^|[^a-z0-9_-])${cleanProj.replace(/-/g, "[-_]?")}([^a-z0-9_-]|$)`, "i");
    if (regex.test(text)) {
      matches.add(proj);
    }
  }

  // 4. Cek alias / kata kunci spesifik
  for (const [proj, aliases] of Object.entries(PROJECT_ALIASES)) {
    if (knownProjects.includes(proj)) {
      for (const alias of aliases) {
        const aliasRegex = new RegExp(`(^|[^a-z0-9_-])${alias.replace(/[-\s]/g, "[-_\\s]?")}([^a-z0-9_-]|$)`, "i");
        if (aliasRegex.test(text)) {
          matches.add(proj);
          break;
        }
      }
    }
  }

  // Jika terdeteksi tepat 1 proyek:
  if (matches.size === 1) {
    return Array.from(matches)[0];
  }

  // Jika terdeteksi lebih dari 1 proyek (cross-project, misal integrasi 2 app):
  // Return null agar diperlakukan sebagai global / multi-project task aman
  if (matches.size > 1) {
    return null;
  }

  return null;
}
