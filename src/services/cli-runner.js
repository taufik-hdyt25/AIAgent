import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { LOG_DIR, MAX_OUTPUT, TIMEOUT_MS } from "../config/env.js";
import { truncate } from "./telegram-files.js";

let activeTask = null;

export function getActiveTask() {
  return activeTask;
}

export function setActiveTask(task) {
  activeTask = task;
}

export function clearActiveTask(taskId) {
  if (activeTask && (!taskId || activeTask.id === taskId)) {
    activeTask = null;
  }
}

export function killProcessTree(childProcess, signal = "SIGTERM") {
  if (!childProcess || !childProcess.pid) return;
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
  maxOutput = MAX_OUTPUT,
  onStdout,
  onStderr,
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      killProcessTree(child, "SIGTERM");
      const killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
      }, 5000);
      killTimer.unref();
      settled = true;
      resolve({
        child,
        code: null,
        signal: "SIGTERM",
        cancelled: true,
        timedOut: true,
        stdout: truncate(stdout.trim(), maxOutput),
        stderr: truncate(stderr.trim(), 2500),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > maxOutput * 2) {
        stdout = stdout.slice(-maxOutput * 2);
      }
      if (typeof onStdout === "function") onStdout(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 5000) {
        stderr = stderr.slice(-5000);
      }
      if (typeof onStderr === "function") onStderr(text);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
      clearTimeout(timer);
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
