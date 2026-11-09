import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const ENGINE_PI = "pi";
const ENGINE_COMMANDCODE = "commandcode";
export const DEFAULT_CMD_MAX_TURNS = 300;
export const DEFAULT_CMD_MAX_CONTINUATIONS = 3;

export function normalizeEngine(value) {
  const v = String(value || "").toLowerCase();
  if (v === "commandcode" || v === "command-code" || v === "cmd") return ENGINE_COMMANDCODE;
  return ENGINE_PI;
}

export function getEngine() {
  return normalizeEngine(process.env.CLI_ENGINE || ENGINE_PI);
}

export function isCommandCodeEngine(engine = getEngine()) {
  return normalizeEngine(engine) === ENGINE_COMMANDCODE;
}

export function getCmdMaxTurns() {
  const raw = String(process.env.CMD_MAX_TURNS || "").trim().toLowerCase();
  if (!raw) return DEFAULT_CMD_MAX_TURNS;
  if (raw === "unlimited" || raw === "inf" || raw === "0") return 1000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_CMD_MAX_TURNS;
}

export function getCmdMaxContinuations() {
  const raw = String(process.env.CMD_MAX_CONTINUATIONS || "").trim();
  if (!raw) return DEFAULT_CMD_MAX_CONTINUATIONS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_CMD_MAX_CONTINUATIONS;
}

export function resolveCmdBin() {
  if (process.env.CMD_BIN && fs.existsSync(process.env.CMD_BIN)) {
    return process.env.CMD_BIN;
  }
  const binName = process.platform === "win32" ? "cmd.exe" : "cmd";
  if (process.platform !== "win32") {
    try {
      const w = execSync("which cmd 2>/dev/null", { encoding: "utf8" }).trim();
      if (w && fs.existsSync(w)) return w;
    } catch (_) {}
    const candidates = [
      path.join(os.homedir(), ".local", "bin", "cmd"),
      path.join(os.homedir(), ".npm-global", "bin", "cmd"),
      path.join(os.homedir(), ".bun", "bin", "cmd"),
      "/usr/local/bin/cmd",
      "/usr/bin/cmd",
      "/opt/homebrew/bin/cmd",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return process.env.CMD_BIN || binName;
}

export function buildCmdArgs(prompt, options = {}) {
  const maxTurns = Number(options.maxTurns) > 0 ? Math.floor(Number(options.maxTurns)) : getCmdMaxTurns();
  const args = [
    "-p",
    prompt,
    "--yolo",
    "--output-format",
    "json",
    "--skip-onboarding",
    "--trust",
    "--no-auto-update",
    "--max-turns",
    String(maxTurns),
  ];
  if (options.resumeSessionId) {
    args.push("--resume", String(options.resumeSessionId));
  }
  if (process.env.CMD_MODEL) {
    args.push("-m", process.env.CMD_MODEL);
  }
  if (process.env.CMD_EFFORT) {
    args.push("--effort", process.env.CMD_EFFORT);
  }
  return args;
}

function extractCmdContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && part.text)
    .map((part) => part.text)
    .join("");
}

/**
 * Streaming parser untuk NDJSON output dari `cmd -p --output-format json`.
 * Menangani event stream panjang tanpa kehilangan baris final `type: "result"`
 * atau teks parsial ketika terjadi `max_turns`.
 */
export function createCmdEventParser() {
  let buffer = "";
  let rawLines = [];
  let sessionId = null;
  let lastAssistantText = "";
  let partialDeltaText = "";
  let finalResult = null;

  const handleLine = (trimmed) => {
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      if (rawLines.length < 50) rawLines.push(trimmed);
      return;
    }
    if (!obj || typeof obj !== "object") return;

    if (obj.sessionId && !sessionId) {
      sessionId = obj.sessionId;
    }

    if (obj.type === "event" && obj.event && typeof obj.event === "object") {
      const ev = obj.event;
      if (ev.sessionId) sessionId = ev.sessionId;

      if (ev.type === "message_start") {
        partialDeltaText = "";
      } else if (ev.type === "text_delta" && typeof ev.delta === "string") {
        partialDeltaText += ev.delta;
      } else if (ev.type === "message_end") {
        const msgText = extractCmdContentText(ev.content) || partialDeltaText;
        if (msgText) lastAssistantText = msgText;
        partialDeltaText = "";
      } else if (ev.type === "run_end" && ev.result) {
        if (ev.result.nextState?.sessionId) {
          sessionId = ev.result.nextState.sessionId;
        }
        if (ev.result.finalText) {
          lastAssistantText = ev.result.finalText;
        }
      }
      return;
    }

    if (obj.type === "result") {
      finalResult = obj;
      if (obj.sessionId) sessionId = obj.sessionId;
      if (obj.finalText) lastAssistantText = obj.finalText;
    }
  };

  return {
    push(chunk) {
      buffer += String(chunk || "");
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
      }
    },
    flush() {
      const rem = buffer.trim();
      buffer = "";
      if (rem) handleLine(rem);
    },
    getResult() {
      const bestText = (finalResult?.finalText || lastAssistantText || partialDeltaText || "").trim();
      if (!finalResult) {
        const plain = rawLines.join("\n").trim();
        return {
          text: bestText || plain,
          partialText: bestText || plain,
          error: null,
          subtype: null,
          isMaxTurns: false,
          sessionId,
          usage: null,
        };
      }

      const subtype = finalResult.subtype || null;
      const stopReason = finalResult.stopReason || null;
      const isMaxTurns = subtype === "max_turns" || stopReason === "max_turns";
      const ok = subtype === "success";

      return {
        text: ok ? bestText : "",
        partialText: bestText,
        error: ok ? null : (finalResult.error || `Command Code: ${subtype || "error"}`),
        subtype,
        stopReason,
        isMaxTurns,
        sessionId: finalResult.sessionId || sessionId || null,
        usage: finalResult.usage || null,
      };
    },
  };
}

/**
 * Parse NDJSON output dari `cmd -p --output-format json`.
 * Baris final bertipe "result" memuat finalText / subtype / sessionId.
 */
export function parseCmdResult(stdout) {
  const parser = createCmdEventParser();
  parser.push(stdout);
  parser.flush();
  return parser.getResult();
}

export { ENGINE_PI, ENGINE_COMMANDCODE };
