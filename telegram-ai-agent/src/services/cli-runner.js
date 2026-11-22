import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { LOG_DIR, MAX_OUTPUT, TIMEOUT_MS, MAX_TIMEOUT_MS } from "../config/env.js";
import { truncate } from "./telegram-files.js";

// Satu task utama per percakapan (chat + forum topic). Percakapan berbeda
// boleh berjalan paralel tanpa saling menimpa.
const activeTasks = new Map();
const reservedConversations = new Set();
const activeWorkers = new Map();

export function buildConversationKey(chatId, threadId = null) {
  return `${chatId == null ? "unknown" : chatId}:${threadId || 0}`;
}

function resolveTaskKey(task) {
  return task.conversationKey || buildConversationKey(task.chatId, task.threadId);
}

export function getActiveTask() {
  let latest = null;
  for (const task of activeTasks.values()) {
    if (!latest || (task.startedAt || 0) >= (latest.startedAt || 0)) {
      latest = task;
    }
  }
  return latest;
}

export function getActiveTasks() {
  return Array.from(activeTasks.values());
}

export function getActiveTaskCount() {
  return activeTasks.size;
}

export function getActiveTaskForConversation(conversationKey) {
  if (!conversationKey) return null;
  return activeTasks.get(conversationKey) || null;
}

export function isConversationBusy(conversationKey) {
  if (!conversationKey) return false;
  return activeTasks.has(conversationKey) || reservedConversations.has(conversationKey);
}

// Reservasi sinkron agar dua pesan dari percakapan yang sama tidak lolos
// pengecekan "idle" secara bersamaan sebelum task pertama terdaftar.
export function tryReserveConversation(conversationKey) {
  if (!conversationKey) return false;
  if (activeTasks.has(conversationKey) || reservedConversations.has(conversationKey)) {
    return false;
  }
  reservedConversations.add(conversationKey);
  return true;
}

export function releaseConversationReservation(conversationKey) {
  if (conversationKey) reservedConversations.delete(conversationKey);
}

export function getReservedConversationCount() {
  return reservedConversations.size;
}

export function setActiveTask(task) {
  activeTasks.set(resolveTaskKey(task), task);
}

export function clearActiveTask(taskId) {
  if (!taskId) {
    activeTasks.clear();
    return;
  }
  for (const [key, task] of activeTasks) {
    if (task.id === taskId) activeTasks.delete(key);
  }
}

export function registerWorker(id, data) {
  activeWorkers.set(id, { id, ...data, startedAt: Date.now() });
}

export function unregisterWorker(id) {
  activeWorkers.delete(id);
}

export function getActiveWorkers() {
  return Array.from(activeWorkers.values());
}

export function getLockedProjects() {
  const locked = new Set();
  for (const task of activeTasks.values()) {
    if (task.targetProject) locked.add(task.targetProject);
  }
  for (const w of activeWorkers.values()) {
    if (w.targetProject) {
      locked.add(w.targetProject);
    }
  }
  return locked;
}

export function isProjectBusy(projectName) {
  if (!projectName) return false;
  return getLockedProjects().has(projectName);
}

export function killAllWorkers(signal = "SIGTERM") {
  const count = activeWorkers.size;
  for (const worker of activeWorkers.values()) {
    if (worker.process) {
      killProcessTree(worker.process, signal);
    }
    if (worker.abortController?.abort) {
      worker.abortController.abort();
    }
  }
  activeWorkers.clear();
  return count;
}

export function killProcessTree(childProcess, signal = "SIGTERM") {
  if (!childProcess || !childProcess.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(childProcess.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (_) {
      try {
        childProcess.kill(signal);
      } catch (_) {}
    }
    return;
  }
  try {
    process.kill(-childProcess.pid, signal);
  } catch {
    try {
      childProcess.kill(signal);
    } catch (_) {}
  }
}

export async function appendLog(taskId, content) {
  const file = path.join(LOG_DIR, `${taskId}.log`);
  await appendFile(file, content, { mode: 0o600 });
}

export function runProcess({
  command,
  args = [],
  shell = false,
  env = process.env,
  cwd = process.cwd(),
  timeoutMs = TIMEOUT_MS,
  maxTimeoutMs = MAX_TIMEOUT_MS,
  maxOutput = MAX_OUTPUT,
  signal = null,
  onStdout,
  onStderr,
  onSpawn,
}) {
  return new Promise((resolve) => {
    let safeCwd = cwd || process.cwd();
    if (!fs.existsSync(safeCwd)) {
      try {
        fs.mkdirSync(safeCwd, { recursive: true });
      } catch (_) {
        safeCwd = process.cwd();
      }
    }
    const isWin = process.platform === "win32";
    const child = spawn(command, args, {
      cwd: safeCwd,
      shell: isWin ? true : shell,
      detached: !isWin,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (typeof onSpawn === "function") {
      try {
        onSpawn(child);
      } catch (_) {}
    }

    // Jaga Mac agar tidak sleep saat process child sedang dieksekusi
    if (process.platform === "darwin" && child.pid) {
      try {
        const taskCaffeinate = spawn("caffeinate", ["-dimsu", "-w", String(child.pid)], {
          detached: true,
          stdio: "ignore",
        });
        taskCaffeinate.unref();
      } catch (_) {}
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let idleTimer = null;
    let hardTimer = null;
    let timeoutReason = null;

    const fireTimeout = (reason) => {
      if (settled) return;
      timeoutReason = reason;
      killProcessTree(child, "SIGTERM");
      const killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
      }, 5000);
      killTimer.unref();
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve({
        child,
        code: null,
        signal: "SIGTERM",
        cancelled: true,
        timedOut: true,
        timeoutReason,
        stdout: truncate(stdout.trim(), maxOutput),
        stderr: truncate(stderr.trim(), 2500),
      });
    };

    const armIdleTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fireTimeout("idle"), timeoutMs);
    };

    armIdleTimeout();
    hardTimer = setTimeout(() => fireTimeout("max"), Math.max(maxTimeoutMs, timeoutMs));

    const onAbort = () => fireTimeout("aborted");
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > maxOutput * 2) {
        stdout = stdout.slice(-maxOutput * 2);
      }
      armIdleTimeout();
      if (typeof onStdout === "function") onStdout(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 5000) {
        stderr = stderr.slice(-5000);
      }
      armIdleTimeout();
      if (typeof onStderr === "function") onStderr(text);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        child,
        code: null,
        signal: null,
        error: error?.message || null,
        stdout: truncate(stdout.trim(), maxOutput),
        stderr: truncate(stderr.trim(), 2500),
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        child,
        code,
        signal,
        error: null,
        stdout: truncate(stdout.trim(), maxOutput),
        stderr: truncate(stderr.trim(), 2500),
      });
    });
  });
}
