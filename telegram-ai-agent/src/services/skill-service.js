import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR } from "../config/env.js";
import { textToVector, cosineSimilarity } from "./memory-service.js";

const execAsync = promisify(exec);
const SKILLS_DIR = path.join(DATA_DIR, "skills");

let skillsCache = null;

/**
 * Pastikan direktori skills ada dan seed skill bawaan
 */
export async function initSkillStore() {
  await mkdir(SKILLS_DIR, { recursive: true });
  const list = await loadAllSkills();
  if (list.length === 0) {
    await seedDefaultSkills();
  }
}

/**
 * Muat semua skill dari data/skills/<id>/SKILL.md
 */
export async function loadAllSkills() {
  await mkdir(SKILLS_DIR, { recursive: true });
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));

    const skills = [];
    for (const dir of skillDirs) {
      const skillPath = path.join(SKILLS_DIR, dir.name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf8");
        const parsed = parseSkillMarkdown(dir.name, content);
        if (parsed) {
          skills.push(parsed);
        }
      } catch {}
    }

    skillsCache = skills;
    return skills;
  } catch {
    return [];
  }
}

/**
 * Parsing file SKILL.md dengan frontmatter sederhana
 */
function parseSkillMarkdown(id, raw) {
  const frontmatterMatch = raw.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      id,
      name: id,
      description: "Skill tanpa metadata",
      triggers: [id],
      instructions: raw.trim(),
      source: "learned",
    };
  }

  const [, yamlBlock, body] = frontmatterMatch;
  const metadata = {};
  yamlBlock.split("\n").forEach((line) => {
    const [k, ...v] = line.split(":");
    if (k && v.length) {
      const key = k.trim();
      let val = v.join(":").trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      metadata[key] = val;
    }
  });

  return {
    id: metadata.id || id,
    name: metadata.name || id,
    description: metadata.description || "",
    triggers: Array.isArray(metadata.triggers) ? metadata.triggers : [id],
    source: metadata.source || "learned",
    instructions: body.trim(),
  };
}

/**
 * Simpan atau buat skill baru secara otonom
 */
export async function saveSkill({
  id,
  name,
  description = "",
  triggers = [],
  instructions = "",
  code = null,
  codeFilename = "exec.sh",
  source = "learned",
}) {
  const safeId = (id || name || "skill")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");

  const skillDirPath = path.join(SKILLS_DIR, safeId);
  await mkdir(skillDirPath, { recursive: true });

  const triggerList = Array.from(new Set([safeId, ...(Array.isArray(triggers) ? triggers : [triggers])]))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  let md = `---\n`;
  md += `id: ${safeId}\n`;
  md += `name: "${name || safeId}"\n`;
  md += `description: "${description.replace(/"/g, '\\"')}"\n`;
  md += `triggers: [${triggerList.map((t) => `"${t}"`).join(", ")}]\n`;
  md += `source: ${source}\n`;
  md += `---\n\n`;
  md += `${instructions.trim()}\n`;

  await writeFile(path.join(skillDirPath, "SKILL.md"), md, "utf8");

  if (code && typeof code === "string") {
    const scriptPath = path.join(skillDirPath, codeFilename);
    await writeFile(scriptPath, code, "utf8");
    await execAsync(`chmod +x "${scriptPath}"`).catch(() => {});
  }

  // Refresh cache
  skillsCache = null;
  return await loadAllSkills();
}

/**
 * Seed skill bawaan sistem (DevOps & Server Workflow)
 */
async function seedDefaultSkills() {
  await saveSkill({
    id: "vps-docker-deploy",
    name: "VPS Docker DooD Deployment",
    description: "Prosedur build & deploy container ke VPS menggunakan Docker daemon host",
    triggers: ["deploy", "vps deploy", "rebuild container", "deploy docker"],
    source: "system",
    instructions: `
Langkah Deployment Container di Server:
1. Pastikan port host tidak konflik (ai-podcast-live: 3005, wa-bot: 3001, wa-dashboard: 3333, th-blog: 3000).
2. Jika ada Dockerfile standalone (seperti di ai-podcast-live), jalankan npm run build dulu sebelum docker build.
3. Gunakan Docker socket host atau chroot host untuk memastikan path volume binding teresolusi ke /home/AIAgent/projects/..., bukan /app/...
4. Setelah start, selalu uji konektivitas via curl atau wget dan verifikasi logs.
`.trim(),
  });

  await saveSkill({
    id: "git-zero-confirm-sync",
    name: "Git Zero-Confirmation Sync & Push",
    description: "Prosedur commit, rebase, dan push otomatis tanpa konfirmasi berbelit",
    triggers: ["push git", "commit git", "push github", "sync git"],
    source: "system",
    instructions: `
Langkah Sinkronisasi Git Otonom:
1. Periksa 'git status -s -b' pada repositori target.
2. Jika ada file yang belum ter-stage, lakukan 'git add <files>'.
3. Buat commit deskriptif dengan konvensi conventional commits (feat:, fix:, docs:, build:).
4. Lakukan 'git pull --rebase origin <branch>' untuk mengantisipasi konflik commit remote.
5. Push ke origin dengan credential SSH host (/home/ubuntu/.ssh/id_ed25519).
`.trim(),
  });

  await saveSkill({
    id: "container-security-audit",
    name: "Node Container Security & Version Audit",
    description: "Audit versi Node.js seluruh container terhadap CVE dan celah keamanan",
    triggers: ["audit node", "cek security", "node cve", "cek versi node"],
    source: "system",
    instructions: `
Langkah Audit Keamanan Node.js:
1. Jalankan loop 'docker ps' dan eksekusi 'docker exec <container> node -v'.
2. Pastikan versi Node.js minimal Node 24 (LTS) atau Node 26 (Current) untuk menghindari CVE-2026-111497 (Brotli RCE) dan buffer leak CVE-2025-55131.
3. Jika container masih di Node 20 (EOL), segera perbarui Dockerfile ke node:26-alpine atau node:26-slim dan rebuild container.
`.trim(),
  });
}

/**
 * Cari skill yang cocok dengan pesan pengguna (berdasarkan triggers & semantic vector similarity)
 */
export async function findMatchingSkills(promptText, options = {}) {
  const { limit = 3, minScore = 0.22 } = options;
  if (!promptText || typeof promptText !== "string") return [];

  const skills = await loadAllSkills();
  if (skills.length === 0) return [];

  const lowerText = promptText.toLowerCase();
  const queryVec = textToVector(promptText);

  const scored = [];

  for (const s of skills) {
    let matchedTrigger = false;
    // 1. Cek kecocokan langsung pada trigger keywords
    for (const t of s.triggers || []) {
      if (lowerText.includes(t.toLowerCase())) {
        matchedTrigger = true;
        break;
      }
    }

    // 2. Vector semantic similarity terhadap description & instructions
    const skillText = `${s.name} ${s.description} ${(s.triggers || []).join(" ")}`;
    const skillVec = textToVector(skillText);
    const sim = cosineSimilarity(queryVec, skillVec);

    const finalScore = matchedTrigger ? Math.max(0.65, sim + 0.35) : sim;

    if (finalScore >= minScore) {
      scored.push({ skill: s, score: finalScore });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.skill);
}

/**
 * Format skill yang relevan untuk disuntikkan ke dalam prompt AI
 */
export function formatSkillsForPrompt(skills) {
  if (!skills || skills.length === 0) return "";

  let md = `\n[Skill & Prosedur Relevan yang Dipelajari (Dynamic Skills)]:\n`;
  for (const s of skills) {
    md += `\n### ⚡ Skill: ${s.name} (${s.id})\n`;
    if (s.description) md += `*Deskripsi:* ${s.description}\n`;
    md += `${s.instructions}\n`;
  }
  return md;
}

/**
 * Eksekusi script yang tersimpan di dalam skill jika ada (run.sh / run.js)
 */
export async function executeSkill(skillId, args = "") {
  const skillDirPath = path.join(SKILLS_DIR, skillId);
  const possibleScripts = ["exec.sh", "run.sh", "index.js", "exec.js"];

  for (const script of possibleScripts) {
    const fullPath = path.join(skillDirPath, script);
    try {
      const runner = script.endsWith(".js") ? `node "${fullPath}"` : `bash "${fullPath}"`;
      const { stdout, stderr } = await execAsync(`${runner} ${args}`);
      return { success: true, output: stdout || stderr };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: `Tidak ada script eksekusi di skill '${skillId}'.` };
}

/**
 * Hapus skill berdasarkan ID
 */
export async function deleteSkill(skillId) {
  const skillDirPath = path.join(SKILLS_DIR, skillId);
  try {
    await rm(skillDirPath, { recursive: true, force: true });
    skillsCache = null;
    return true;
  } catch {
    return false;
  }
}
