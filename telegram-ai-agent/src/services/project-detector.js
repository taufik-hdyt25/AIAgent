import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PROJECTS_DIR } from "../config/env.js";

const PROJECT_KEYS_FILE = path.join(DATA_DIR, "project_keys.json");

// Cache daftar proyek & metadata agar tidak melakukan I/O disk di setiap pesan
let cachedIndex = null;
let lastIndexTime = 0;
let customKeysCache = null;

/**
 * Peta alias & kata kunci bawaan per proyek agar langsung dikenali tanpa /workspace.
 */
const BUILTIN_PROJECT_ALIASES = {
  "AIAgent": [
    "aiagent",
    "ai-agent",
    "ai_agent",
    "telegram-ai-agent",
    "telegram ai agent",
    "th-agent",
    "th agent",
    "thagent",
    "agent kita",
    "bot telegram",
    "command code",
    "commandcode",
    "cliproxy",
  ],
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
    "wa bot",
    "wa-dashboard",
    "whatsapp",
    "wa chat",
    "baileys",
  ],
  "th-admin-app": [
    "th-admin-app",
    "th-admin",
    "th admin",
    "thadmin",
    "admin-app",
    "admin app",
  ],
  "dompet-bulanan": [
    "dompet-bulanan",
    "dompet bulanan",
    "dompet",
    "artosku",
  ],
  "portofolio-web": [
    "portofolio-web",
    "portofolio web",
    "portofolio",
    "portfolio",
    "taufikh.my.id",
    "taufikh",
  ],
  "thquiz-admin": [
    "thquiz-admin",
    "thquiz",
    "th-quiz",
    "quiz",
    "kuis",
    "thquiz.thstudio.web.id",
  ],
  "thdownloader": [
    "thdownloader",
    "th-downloader",
    "th-downloader-new",
    "downloader",
    "downloader.thstudio.web.id",
  ],
  "wd": [
    "wd",
    "th-tagih",
    "th tagih",
    "thtagih",
    "tagih",
    "tagih.thstudio.web.id",
    "wedding",
    "wedding-invitation",
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

// Kata umum yang tidak boleh dijadikan auto-token tunggal dari nama folder
const GENERIC_TOKENS = new Set([
  "app",
  "web",
  "bot",
  "chat",
  "api",
  "live",
  "new",
  "dev",
  "src",
  "pro",
  "my",
  "the",
  "for",
  "and",
  "admin",
  "bulanan",
  "project",
  "projects",
  "system",
  "server",
  "agent",
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeyRegex(key) {
  const escaped = escapeRegex(key.toLowerCase()).replace(/[-_\s]+/g, "[-_\\s]?");
  return new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`, "i");
}

export async function getKnownProjects() {
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export async function loadCustomProjectKeys() {
  if (customKeysCache) return customKeysCache;
  try {
    const raw = await readFile(PROJECT_KEYS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    customKeysCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    customKeysCache = {};
  }
  return customKeysCache;
}

async function saveCustomProjectKeys(map) {
  customKeysCache = map;
  await writeFile(PROJECT_KEYS_FILE, JSON.stringify(map, null, 2) + "\n", "utf8");
  cachedIndex = null;
}

export async function setCustomProjectKeys(projectName, keys = []) {
  const map = await loadCustomProjectKeys();
  const normalized = Array.from(
    new Set(
      (Array.isArray(keys) ? keys : String(keys).split(/[\n,;]+/))
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length >= 2)
    )
  );
  if (normalized.length === 0) {
    delete map[projectName];
  } else {
    map[projectName] = normalized;
  }
  await saveCustomProjectKeys(map);
  return map[projectName] || [];
}

export async function addCustomProjectKeys(projectName, keys = []) {
  const map = await loadCustomProjectKeys();
  const existing = Array.isArray(map[projectName]) ? map[projectName] : [];
  const incoming = (Array.isArray(keys) ? keys : String(keys).split(/[\n,;]+/))
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);
  return setCustomProjectKeys(projectName, [...existing, ...incoming]);
}

export async function removeCustomProjectKey(projectName, keyToRemove) {
  const map = await loadCustomProjectKeys();
  const existing = Array.isArray(map[projectName]) ? map[projectName] : [];
  const target = String(keyToRemove || "").trim().toLowerCase();
  return setCustomProjectKeys(
    projectName,
    existing.filter((k) => k !== target)
  );
}

/**
 * Ekstrak kata kunci tambahan dari PROJECTS_SUMMARY.md (nama repo Git, domain, PM2, container, judul)
 */
async function parseSummaryKeys(knownProjects) {
  const summaryKeys = new Map();
  for (const p of knownProjects) summaryKeys.set(p, new Set());

  try {
    const raw = await readFile(path.join(PROJECTS_DIR, "PROJECTS_SUMMARY.md"), "utf8");
    const sections = raw.split(/^##\s+/m).slice(1);
    for (const sec of sections) {
      const lines = sec.split("\n");
      const heading = (lines[0] || "").replace(/^\d+\.\s*/, "").trim();
      const dirMatch = sec.match(/Direktori:\*\*?\s*`?projects\/([^`\s\n]+)`?/i);
      const proj = dirMatch?.[1]?.trim() || knownProjects.find((p) => heading.toLowerCase().includes(p.toLowerCase()));
      if (!proj || !summaryKeys.has(proj)) continue;

      const keys = summaryKeys.get(proj);
      // Judul section (mis. "th-tagih (TH Tagih)")
      const cleanHeading = heading.replace(/\([^)]*\)/g, "").trim().toLowerCase();
      if (cleanHeading.length >= 2) keys.add(cleanHeading);

      // Git repo name (mis. git@github.com:user/artosku.git -> artosku)
      const gitMatch = sec.match(/\/([a-zA-Z0-9._-]+?)(?:\.git)?(?:\s|\)|$)/);
      if (gitMatch?.[1] && gitMatch[1].length >= 2) {
        keys.add(gitMatch[1].toLowerCase());
      }

      // Domain / subdomain (mis. tagih.thstudio.web.id -> tagih.thstudio.web.id, tagih)
      const urlMatches = sec.match(/https?:\/\/([a-zA-Z0-9.-]+)/g) || [];
      for (const u of urlMatches) {
        const host = u.replace(/^https?:\/\//i, "").toLowerCase();
        keys.add(host);
        const sub = host.split(".")[0];
        if (sub && sub.length >= 3 && sub !== "www") keys.add(sub);
      }

      // Container / PM2 name
      const pm2Match = sec.match(/PM2:\s*`?([a-zA-Z0-9._-]+)`?/i);
      if (pm2Match?.[1]) keys.add(pm2Match[1].toLowerCase());
    }
  } catch (_) {}

  return summaryKeys;
}

/**
 * Bangun indeks kunci seluruh proyek (cache 15 detik).
 */
async function getProjectKeyIndex() {
  const now = Date.now();
  if (cachedIndex && now - lastIndexTime < 15000) {
    return cachedIndex;
  }

  const knownProjects = await getKnownProjects();
  const customKeysMap = await loadCustomProjectKeys();
  const summaryKeysMap = await parseSummaryKeys(knownProjects);

  const projectKeys = new Map();
  const tokenFrequency = new Map();

  // Hitung frekuensi sub-token nama folder agar token generik/bentrok tidak salah tebak
  for (const proj of knownProjects) {
    const tokens = proj.toLowerCase().split(/[-_]+/).filter(Boolean);
    for (const tok of tokens) {
      tokenFrequency.set(tok, (tokenFrequency.get(tok) || 0) + 1);
    }
  }

  for (const proj of knownProjects) {
    const keys = new Set();
    const lower = proj.toLowerCase();
    keys.add(lower);

    const spaced = lower.replace(/[-_]+/g, " ");
    if (spaced !== lower) keys.add(spaced);

    const compact = lower.replace(/[-_]+/g, "");
    if (compact.length >= 3 && compact !== lower) keys.add(compact);

    // Token unik dari nama folder (mis. "dompet" dari "dompet-bulanan", "portofolio" dari "portofolio-web")
    const tokens = lower.split(/[-_]+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.length >= 4 && !GENERIC_TOKENS.has(tok) && tokenFrequency.get(tok) === 1) {
        keys.add(tok);
      }
    }

    // Aliases bawaan (case-insensitive match key)
    const builtinEntry = Object.entries(BUILTIN_PROJECT_ALIASES).find(
      ([k]) => k.toLowerCase() === lower
    );
    if (builtinEntry) {
      for (const alias of builtinEntry[1]) {
        keys.add(alias.toLowerCase());
      }
    }

    // Keys dari PROJECTS_SUMMARY.md
    const fromSummary = summaryKeysMap.get(proj);
    if (fromSummary) {
      for (const k of fromSummary) keys.add(k.toLowerCase());
    }

    // Keys dari package.json name
    try {
      const pkgRaw = await readFile(path.join(PROJECTS_DIR, proj, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      if (pkg?.name && typeof pkg.name === "string") {
        const cleanPkg = pkg.name.replace(/^@[^/]+\//, "").trim().toLowerCase();
        if (cleanPkg.length >= 3 && !GENERIC_TOKENS.has(cleanPkg)) {
          keys.add(cleanPkg);
        }
      }
    } catch (_) {}

    // Custom keys dari user (/key)
    const customList = customKeysMap[proj] || customKeysMap[lower] || [];
    for (const ck of customList) {
      if (ck && ck.length >= 2) keys.add(ck.toLowerCase());
    }

    projectKeys.set(proj, Array.from(keys).sort((a, b) => b.length - a.length));
  }

  cachedIndex = { knownProjects, projectKeys };
  lastIndexTime = now;
  return cachedIndex;
}

export async function getAllProjectKeysSummary() {
  const { knownProjects, projectKeys } = await getProjectKeyIndex();
  const customKeysMap = await loadCustomProjectKeys();
  return knownProjects.map((proj) => ({
    project: proj,
    keys: projectKeys.get(proj) || [proj.toLowerCase()],
    customKeys: customKeysMap[proj] || [],
  }));
}

/**
 * Ekstrak explicit key prefix / tag dari pesan pengguna:
 * - #key, @key
 * - key:value / key value
 * - [key] ...
 * - key: ... di awal kalimat/baris
 */
function extractExplicitKeyCandidates(text) {
  const candidates = [];
  if (!text) return candidates;

  // #key atau @key
  const tagMatches = text.matchAll(/(?:^|\s)[#@]([a-zA-Z0-9._-]{2,})/g);
  for (const m of tagMatches) {
    candidates.push({ key: m[1].toLowerCase(), source: "tag" });
  }

  // [key] di awal pesan
  const bracketMatch = text.match(/^\s*\[([a-zA-Z0-9._\s-]{2,32})\]/);
  if (bracketMatch) {
    candidates.push({ key: bracketMatch[1].trim().toLowerCase(), source: "bracket" });
  }

  // key:nama atau key nama di awal pesan
  const keyDirective = text.match(/^\s*key\s*[:= ]\s*([a-zA-Z0-9._-]{2,})/i);
  if (keyDirective) {
    candidates.push({ key: keyDirective[1].toLowerCase(), source: "directive" });
  }

  // <key>: instruksi di awal pesan (hindari URL http:/https:)
  const colonPrefix = text.match(/^\s*([a-zA-Z0-9._-]{2,32}):(?!\/)/);
  if (colonPrefix) {
    candidates.push({ key: colonPrefix[1].toLowerCase(), source: "prefix" });
  }

  return candidates;
}

/**
 * Deteksi proyek beserta alasan/key yang cocok.
 * Mengembalikan { project: string|null, matchedKey: string|null, source: string|null, isCrossProject: boolean }
 */
export async function detectProjectWithReason(userMessage = "", fileInfo = null) {
  if (!userMessage && !fileInfo) {
    return { project: null, matchedKey: null, source: null, isCrossProject: false };
  }

  const rawText = String(userMessage || "");
  const text = rawText.toLowerCase();
  const { knownProjects, projectKeys } = await getProjectKeyIndex();
  if (knownProjects.length === 0) {
    return { project: null, matchedKey: null, source: null, isCrossProject: false };
  }

  // 1. Cek path file upload jika ada
  if (fileInfo) {
    const fPath = `${fileInfo.relativePath || ""} ${fileInfo.absolutePath || ""} ${fileInfo.fileName || ""}`.toLowerCase();
    for (const proj of knownProjects) {
      if (fPath.includes(`projects/${proj.toLowerCase()}`) || fPath.includes(proj.toLowerCase())) {
        return { project: proj, matchedKey: proj, source: "file", isCrossProject: false };
      }
    }
  }

  // 2. Cek explicit key candidates (#key, @key, [key], key:..., <key>:)
  const explicitCandidates = extractExplicitKeyCandidates(rawText);
  for (const cand of explicitCandidates) {
    const matches = [];
    for (const proj of knownProjects) {
      const keys = projectKeys.get(proj) || [];
      if (keys.includes(cand.key)) {
        matches.push(proj);
      }
    }
    if (matches.length === 1) {
      return {
        project: matches[0],
        matchedKey: cand.key,
        source: `explicit-${cand.source}`,
        isCrossProject: false,
      };
    }
  }

  // 3. Cek penyebutan eksplisit path folder: projects/<nama-project>
  const pathMatches = new Set();
  for (const proj of knownProjects) {
    const cleanProj = proj.toLowerCase();
    if (
      text.includes(`projects/${cleanProj}`) ||
      text.includes(`./projects/${cleanProj}`) ||
      text.includes(`folder ${cleanProj}`) ||
      text.includes(`proyek ${cleanProj}`) ||
      text.includes(`project ${cleanProj}`)
    ) {
      pathMatches.add(proj);
    }
  }
  if (pathMatches.size === 1) {
    const p = Array.from(pathMatches)[0];
    return { project: p, matchedKey: p, source: "path", isCrossProject: false };
  }
  if (pathMatches.size > 1) {
    return { project: null, matchedKey: null, source: "multi-path", isCrossProject: true };
  }

  // 4. Skor kecocokan key/alias di seluruh pesan
  const scoredMatches = [];
  for (const proj of knownProjects) {
    const keys = projectKeys.get(proj) || [];
    let bestScore = 0;
    let bestKey = null;

    for (const key of keys) {
      if (!key || key.length < 2) continue;
      const regex = buildKeyRegex(key);
      if (regex.test(text)) {
        const isExactFolder = key === proj.toLowerCase();
        const score = (isExactFolder ? 100 : 50) + key.length;
        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
        }
      }
    }

    if (bestScore > 0) {
      scoredMatches.push({ project: proj, key: bestKey, score: bestScore });
    }
  }

  if (scoredMatches.length === 1) {
    return {
      project: scoredMatches[0].project,
      matchedKey: scoredMatches[0].key,
      source: "key",
      isCrossProject: false,
    };
  }

  if (scoredMatches.length > 1) {
    scoredMatches.sort((a, b) => b.score - a.score);
    // Jika skor tertinggi jelas unggul jauh (mis. nama folder persis vs alias pendek yang kebetulan muncul)
    if (scoredMatches[0].score - scoredMatches[1].score >= 45) {
      return {
        project: scoredMatches[0].project,
        matchedKey: scoredMatches[0].key,
        source: "key-priority",
        isCrossProject: false,
      };
    }
    // Cross-project / multi-project
    return { project: null, matchedKey: null, source: "multi-key", isCrossProject: true };
  }

  return { project: null, matchedKey: null, source: null, isCrossProject: false };
}

/**
 * Mendeteksi secara cerdas apakah sebuah pesan / file menargetkan proyek tertentu di ./projects/
 * Mengembalikan nama folder proyek (misal "th-blog") atau null jika global / tidak spesifik.
 */
export async function detectTargetProject(userMessage = "", fileInfo = null) {
  const res = await detectProjectWithReason(userMessage, fileInfo);
  return res.project;
}

/**
 * Deteksi apakah pesan meminta operasi global/server/multi-proyek
 */
export function isGlobalServerRequest(userMessage = "") {
  const text = String(userMessage || "").toLowerCase();
  return /\b(semua\s+pro[jy]e[ck]|all\s+projects|seluruh\s+pro[jy]e[ck]|daftar\s+pro[jy]e[ck]|list\s+projects|docker\s+ps|semua\s+container|all\s+containers|pm2\s+(list|status)|df\s+-h|disk\s+space|cek\s+server|status\s+vps)\b/i.test(text);
}

export function invalidateProjectDetectorCache() {
  cachedIndex = null;
  lastIndexTime = 0;
}
