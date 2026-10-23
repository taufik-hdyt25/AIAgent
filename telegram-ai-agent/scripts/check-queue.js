#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const STATUS_FILE = path.join(ROOT_DIR, "data", "queue-status.json");

function readStatus() {
  if (!existsSync(STATUS_FILE)) {
    return {
      queueLength: 0,
      hasPending: false,
      shouldBuildAndDeploy: true,
      deferredProjects: [],
      updatedAt: new Date().toISOString(),
      queue: [],
    };
  }
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return {
      queueLength: 0,
      hasPending: false,
      shouldBuildAndDeploy: true,
      deferredProjects: [],
      updatedAt: new Date().toISOString(),
      queue: [],
    };
  }
}

function saveStatus(status) {
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf8");
  } catch (err) {
    console.error("Gagal menyimpan status antrean:", err.message);
  }
}

const args = process.argv.slice(2);

if (args.includes("--json")) {
  const status = readStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.hasPending ? 1 : 0);
}

if (args.includes("--defer")) {
  const idx = args.indexOf("--defer");
  const project = args[idx + 1];
  if (project) {
    const status = readStatus();
    const set = new Set(status.deferredProjects || []);
    set.add(project);
    status.deferredProjects = Array.from(set);
    status.updatedAt = new Date().toISOString();
    saveStatus(status);
    console.log(`📌 Ditandai: '${project}' tertunda untuk build & deploy.`);
  }
  process.exit(0);
}

if (args.includes("--cleared") || args.includes("--deployed")) {
  const flag = args.includes("--cleared") ? "--cleared" : "--deployed";
  const idx = args.indexOf(flag);
  const project = args[idx + 1];
  if (project) {
    const status = readStatus();
    if (status.deferredProjects) {
      status.deferredProjects = status.deferredProjects.filter((p) => p !== project);
      status.updatedAt = new Date().toISOString();
      saveStatus(status);
      console.log(`✅ Dibersihkan: '${project}' telah selesai dibuild & deploy.`);
    }
  }
  process.exit(0);
}

// Pemeriksaan default
const status = readStatus();
const queueLen = status.queueLength || 0;
const deferred = (status.deferredProjects || []).join(", ") || "none";

if (status.hasPending) {
  console.log(`⏸️ QUEUE_BUSY (Antrean: ${queueLen}, Tertunda: [${deferred}])`);
  process.exit(1); // Exit code 1 jika antrean masih sibuk
} else {
  console.log(`🟢 QUEUE_CLEAR (Antrean: 0, Tertunda: [${deferred}])`);
  process.exit(0); // Exit code 0 jika antrean kosong & siap build/deploy
}
