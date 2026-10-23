import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { PROJECTS_DIR } from "../config/env.js";

const execAsync = promisify(exec);

/**
 * Ekstrak informasi mendalam dari suatu direktori proyek
 */
export async function analyzeProject(projectName, projectPath) {
  const info = {
    name: projectName,
    path: `projects/${projectName}`,
    framework: "Unknown",
    stack: [],
    containers: [],
    ports: [],
    gitBranch: null,
    gitRemote: null,
    entrypoints: [],
    scripts: {},
  };

  // 1. Analisis package.json (jika proyek Node/JS/TS)
  try {
    const pkgRaw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (deps.next) {
      const ver = deps.next.replace(/[^0-9.]/g, "").split(".")[0] || "";
      info.stack.push(`Next.js${ver ? ` ${ver}` : ""} (App Router)`);
    }
    if (deps.react) info.stack.push("React");
    if (deps.typescript) info.stack.push("TypeScript");
    if (deps.tailwindcss) info.stack.push("Tailwind CSS");
    if (deps.three || deps["@types/three"]) info.stack.push("Three.js");
    if (deps["@tanstack/react-query"]) info.stack.push("TanStack Query");
    if (deps.prisma || deps["@prisma/client"]) info.stack.push("Prisma ORM");
    if (deps["drizzle-orm"]) info.stack.push("Drizzle ORM");
    if (deps["@whiskeysockets/baileys"] || deps["baileys"]) info.stack.push("Baileys (WA Bot)");
    if (deps["tiktok-live-connector"]) info.stack.push("TikTok Live Connector");
    if (deps.express) info.stack.push("Express.js");
    if (deps.fastify) info.stack.push("Fastify");
    if (deps.grammy) info.stack.push("grammY (Telegram)");

    if (pkg.scripts) {
      if (pkg.scripts.dev) info.scripts.dev = pkg.scripts.dev;
      if (pkg.scripts.build) info.scripts.build = pkg.scripts.build;
      if (pkg.scripts.deploy) info.scripts.deploy = pkg.scripts.deploy;
      if (pkg.scripts.start) info.scripts.start = pkg.scripts.start;
    }
  } catch (_) {}

  // 2. Analisis Docker (docker-compose.yml & Dockerfile)
  try {
    const composeRaw = await readFile(path.join(projectPath, "docker-compose.yml"), "utf8");
    const containerMatches = composeRaw.match(/container_name:\s*([^\s\n]+)/g);
    if (containerMatches) {
      containerMatches.forEach((m) => {
        const val = m.replace("container_name:", "").trim();
        if (!info.containers.includes(val)) info.containers.push(val);
      });
    }

    const portMatches = composeRaw.match(/-\s*["']?(\d+:\d+)["']?/g);
    if (portMatches) {
      portMatches.forEach((m) => {
        const val = m.replace(/[-\s"']/g, "").trim();
        if (!info.ports.includes(val)) info.ports.push(val);
      });
    }
  } catch (_) {}

  try {
    const dockerfileRaw = await readFile(path.join(projectPath, "Dockerfile"), "utf8");
    const exposeMatches = dockerfileRaw.match(/EXPOSE\s+(\d+)/g);
    if (exposeMatches) {
      exposeMatches.forEach((m) => {
        const val = m.replace("EXPOSE", "").trim();
        if (!info.ports.includes(val)) info.ports.push(val);
      });
    }
  } catch (_) {}

  // 3. Analisis Git (Branch & Remote)
  try {
    const { stdout: branchOut } = await execAsync("git branch --show-current", { cwd: projectPath });
    info.gitBranch = branchOut.trim() || null;
  } catch (_) {}

  try {
    const { stdout: remoteOut } = await execAsync("git remote get-url origin", { cwd: projectPath });
    info.gitRemote = remoteOut.trim() || null;
  } catch (_) {}

  // 4. Deteksi File Utama / Entrypoints
  const potentialEntrypoints = [
    "src/app/page.tsx",
    "src/app/studio/page.tsx",
    "src/app/page.js",
    "src/app/layout.tsx",
    "src/pages/index.tsx",
    "src/bot.js",
    "src/index.ts",
    "src/index.js",
    "index.js",
    "server.js",
    "app.py",
    "main.py",
  ];

  for (const ep of potentialEntrypoints) {
    try {
      await stat(path.join(projectPath, ep));
      info.entrypoints.push(ep);
    } catch (_) {}
  }

  return info;
}

/**
 * Sinkronisasi seluruh proyek di ./projects ke ./projects/PROJECTS_SUMMARY.md
 */
export async function syncProjectsSummary() {
  const summaryFile = path.join(PROJECTS_DIR, "PROJECTS_SUMMARY.md");

  let entries = [];
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  const projectSummaries = [];

  for (const name of projectDirs) {
    const fullPath = path.join(PROJECTS_DIR, name);

    // Abaikan folder yang kosong (jangan di-init otomatis)
    try {
      const folderContents = await readdir(fullPath);
      if (folderContents.length === 0) {
        continue;
      }
    } catch {
      continue;
    }

    const info = await analyzeProject(name, fullPath);
    projectSummaries.push(info);

    // Buat juga PROJECT_INFO.md lokal di masing-masing folder project yang aktif
    const localInfoMd = formatSingleProjectMarkdown(info);
    await writeFile(path.join(fullPath, "PROJECT_INFO.md"), localInfoMd, "utf8").catch(() => {});
  }

  // Bentuk file induk PROJECTS_SUMMARY.md
  let content = `# Projects Summary & Architecture Registry\n\n`;
  content += `> ⚡ *Dokumen ini otomatis diperbarui oleh TH Agent Project Indexer.*\n`;
  content += `> Berfungsi sebagai peta arsitektur instan agar AI tidak perlu membaca proyek dari nol.\n\n`;
  content += `---\n\n`;

  projectSummaries.forEach((info, idx) => {
    content += `## ${idx + 1}. ${info.name}\n`;
    content += `* **Direktori:** \`${info.path}\`\n`;
    content += `* **Stack:** ${info.stack.length > 0 ? info.stack.join(", ") : "Node.js / Web Application"}\n`;
    if (info.containers.length > 0) {
      content += `* **Docker Containers:** ${info.containers.map((c) => `\`${c}\``).join(", ")}`;
      if (info.ports.length > 0) {
        content += ` (Port: ${info.ports.map((p) => `\`${p}\``).join(", ")})`;
      }
      content += `\n`;
    } else if (info.ports.length > 0) {
      content += `* **Port Terbuka:** ${info.ports.map((p) => `\`${p}\``).join(", ")}\n`;
    }
    if (info.gitBranch) {
      content += `* **Git:** Branch \`${info.gitBranch}\`${info.gitRemote ? ` (${info.gitRemote})` : ""}\n`;
    }
    if (info.entrypoints.length > 0) {
      content += `* **File Utama:** ${info.entrypoints.map((e) => `\`${e}\``).join(", ")}\n`;
    }
    if (Object.keys(info.scripts).length > 0) {
      const scriptList = Object.entries(info.scripts)
        .map(([k, v]) => `\`npm run ${k}\``)
        .join(", ");
      content += `* **Perintah Penting:** ${scriptList}\n`;
    }
    content += `\n---\n\n`;
  });

  content += `*Terakhir diperbarui: ${new Date().toISOString()}*\n`;

  await writeFile(summaryFile, content, "utf8");
  return projectSummaries;
}

function formatSingleProjectMarkdown(info) {
  let md = `# ${info.name} - Project Architecture\n\n`;
  md += `* **Direktori:** \`${info.path}\`\n`;
  md += `* **Stack:** ${info.stack.join(", ") || "Standard Application"}\n`;
  if (info.containers.length > 0) {
    md += `* **Docker:** ${info.containers.join(", ")} (Port: ${info.ports.join(", ")})\n`;
  }
  if (info.entrypoints.length > 0) {
    md += `* **Entrypoints:**\n${info.entrypoints.map((e) => `  - \`${e}\``).join("\n")}\n`;
  }
  return md;
}

/**
 * Cek cepat: Apakah ada proyek di ./projects yang belum tercatat di PROJECTS_SUMMARY.md?
 * Jika ada, jalankan sinkronisasi otomatis secara instan.
 */
export async function ensureProjectsIndexed() {
  const summaryFile = path.join(PROJECTS_DIR, "PROJECTS_SUMMARY.md");

  try {
    const summaryText = await readFile(summaryFile, "utf8");
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const currentDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);

    // Filter hanya direktori proyek yang memiliki isi / file
    const activeDirs = [];
    for (const d of currentDirs) {
      try {
        const contents = await readdir(path.join(PROJECTS_DIR, d));
        if (contents.length > 0) activeDirs.push(d);
      } catch (_) {}
    }

    // Cek apakah ada folder aktif yang belum terdaftar di summary
    const missing = activeDirs.some((dir) => !summaryText.includes(`## `) || !summaryText.includes(dir));

    if (missing) {
      console.log("[Project Indexer] Terdeteksi proyek baru! Memperbarui PROJECTS_SUMMARY.md...");
      return await syncProjectsSummary();
    }
  } catch {
    // Jika file belum ada, langsung buat
    return await syncProjectsSummary();
  }
}
