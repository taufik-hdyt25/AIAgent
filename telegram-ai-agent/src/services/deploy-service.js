import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { DATA_DIR, ROOT_DIR, PROJECTS_DIR } from "../config/env.js";
import { truncate } from "./telegram-files.js";
import {
  getQueueLength,
  markProjectDeferred,
  clearDeferredProjects,
} from "./queue-service.js";

const execAsync = promisify(exec);
const DEPLOY_CONFIG_FILE = path.join(DATA_DIR, "deploy-config.json");

// Default command deploy
const DEFAULT_DEPLOY_COMMAND =
  process.env.DEPLOY_COMMAND || "git pull && npm install && pm2 reload all || pm2 reload ecosystem.config.cjs || echo 'Deploy selesai'";

export async function getDeployConfig() {
  try {
    const raw = await readFile(DEPLOY_CONFIG_FILE, "utf8");
    const data = JSON.parse(raw);
    return {
      defaultCommand: data.defaultCommand || DEFAULT_DEPLOY_COMMAND,
      projectCommands: data.projectCommands && typeof data.projectCommands === "object" ? data.projectCommands : {},
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return {
      defaultCommand: DEFAULT_DEPLOY_COMMAND,
      projectCommands: {},
      history: [],
    };
  }
}

export async function saveDeployConfig(config) {
  await writeFile(DEPLOY_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export async function setProjectDeployCommand(targetKey, command) {
  const config = await getDeployConfig();
  if (targetKey === "default" || targetKey === "root") {
    config.defaultCommand = command;
  } else {
    config.projectCommands[targetKey] = command;
  }
  await saveDeployConfig(config);
  return config;
}

// Menjalankan proses deployment di server
export async function executeDeployment({
  target = "default",
  customCommand = null,
  specificCwd = null,
  triggeredBy = "Telegram User",
  force = false,
}) {
  const queueLen = getQueueLength();
  const repoName = target && target !== "default" && target !== "root"
    ? (target.includes("/") ? target.split("/")[1] : target)
    : "root";

  // Jika masih ada antrean chat dan tidak dipaksa (force), tunda deployment
  if (!force && queueLen > 0) {
    markProjectDeferred(repoName);
    return {
      success: true,
      deferred: true,
      code: 0,
      command: customCommand || "(ditunda)",
      workDir: specificCwd || ROOT_DIR,
      durationSec: 0,
      output: `⏸️ [QUEUE GUARD] Proses deploy untuk '${target}' ditunda karena terdapat ${queueLen} tugas lain di antrean chat.\nBuild & Deploy akan otomatis dieksekusi saat antrean kosong.`,
    };
  }

  const config = await getDeployConfig();
  
  let cmdToRun = customCommand;
  let workDir = specificCwd || ROOT_DIR;

  if (!cmdToRun) {
    if (target && target !== "default" && target !== "root") {
      // Cek apakah target ada di projectCommands
      if (config.projectCommands[target]) {
        cmdToRun = config.projectCommands[target];
      } else {
        // Cek folder projects/<target>
        const repoName = target.includes("/") ? target.split("/")[1] : target;
        const projectPath = path.resolve(PROJECTS_DIR, repoName);
        workDir = projectPath;
        cmdToRun = "git pull origin main || git pull origin master && npm install && npm run build --if-present";
      }
    } else {
      cmdToRun = config.defaultCommand;
    }
  }

  const startTime = Date.now();
  const sanitizedEnv = { ...process.env };
  delete sanitizedEnv.BOT_TOKEN;
  delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;
  if (process.env.GITHUB_TOKEN) {
    sanitizedEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  try {
    const { stdout, stderr } = await execAsync(cmdToRun, {
      cwd: workDir,
      env: sanitizedEnv,
      timeout: 300000, // 5 menit batas deployment
      maxBuffer: 4 * 1024 * 1024,
    });

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const combinedOutput = ((stdout || "") + (stderr ? `\n[STDERR]:\n${stderr}` : "")).trim();

    // Catat ke riwayat
    const logEntry = {
      timestamp: Date.now(),
      target,
      command: cmdToRun,
      workDir,
      success: true,
      durationSec,
      triggeredBy,
      outputSnippet: truncate(combinedOutput, 500),
    };
    config.history = [logEntry, ...(config.history || [])].slice(0, 20);
    await saveDeployConfig(config).catch(() => {});
    clearDeferredProjects(repoName);

    return {
      success: true,
      code: 0,
      command: cmdToRun,
      workDir,
      durationSec,
      output: combinedOutput || "(Deploy berhasil tanpa output)",
    };
  } catch (err) {
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const errOutput = (err.stdout || "") + "\n" + (err.stderr || err.message || "");

    const logEntry = {
      timestamp: Date.now(),
      target,
      command: cmdToRun,
      workDir,
      success: false,
      durationSec,
      triggeredBy,
      outputSnippet: truncate(errOutput.trim(), 500),
    };
    config.history = [logEntry, ...(config.history || [])].slice(0, 20);
    await saveDeployConfig(config).catch(() => {});

    return {
      success: false,
      code: err.code || 1,
      command: cmdToRun,
      workDir,
      durationSec,
      output: errOutput.trim() || err.message,
    };
  }
}
