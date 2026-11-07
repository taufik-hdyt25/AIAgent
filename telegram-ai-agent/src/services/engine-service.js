const ENGINE_PI = "pi";
const ENGINE_COMMANDCODE = "commandcode";

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

export function buildCmdArgs(prompt) {
  const args = [
    "-p",
    prompt,
    "--yolo",
    "--output-format",
    "json",
    "--skip-onboarding",
    "--trust",
    "--max-turns",
    String(process.env.CMD_MAX_TURNS || "60"),
  ];
  if (process.env.CMD_MODEL) {
    args.push("-m", process.env.CMD_MODEL);
  }
  if (process.env.CMD_EFFORT) {
    args.push("--effort", process.env.CMD_EFFORT);
  }
  return args;
}

/**
 * Parse NDJSON output dari `cmd -p --output-format json`.
 * Baris final bertipe "result" memuat finalText / subtype / sessionId.
 */
export function parseCmdResult(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  let result = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.type === "result") result = obj;
    } catch {
      // abaikan frame event / baris non-JSON
    }
  }
  if (!result) {
    return { text: String(stdout || "").trim(), error: null, sessionId: null };
  }
  const ok = result.subtype === "success";
  return {
    text: ok ? (result.finalText || "") : "",
    error: ok ? null : (result.error || `Command Code: ${result.subtype || "error"}`),
    sessionId: result.sessionId || null,
    usage: result.usage || null,
  };
}

export { ENGINE_PI, ENGINE_COMMANDCODE };
