import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import { ROOT_DIR, PROJECTS_DIR, UPLOADS_DIR } from "./config/env.js";
import { resolveDynamicUniversalModel } from "./config/models.js";

// Definisi Tools untuk OpenAI-compatible Tool Calling
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Menjalankan perintah shell/terminal di server (di dalam folder ./projects). Gunakan untuk git clone, build, install dependencies, menjalankan script, test, dll.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Perintah shell lengkap yang akan dieksekusi (contoh: 'ls -la', 'git status', 'python3 script.py', 'npm test')",
          },
          cwd: {
            type: "string",
            description: "Subfolder kerja relatif terhadap ./projects (default: root projects)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Membaca isi lengkap sebuah file teks/kode di server.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path file relatif (misal 'projects/app/index.js' atau 'uploads/file.py')",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Menulis atau membuat file kode baru di server.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path file relatif tempat file akan disimpan (misal 'projects/app/server.js')",
          },
          content: {
            type: "string",
            description: "Isi teks/kode lengkap yang akan ditulis ke file.",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "Melihat daftar file dan folder dalam sebuah direktori.",
      parameters: {
        type: "object",
        properties: {
          dir_path: {
            type: "string",
            description: "Path folder relatif (contoh 'projects', 'uploads', 'projects/my-app')",
          },
        },
      },
    },
  },
];

// Eksekusi fungsi tool lokal
async function executeToolCall(toolCall, options = {}) {
  const { name, arguments: argsString } = toolCall.function;
  const baseDir = options.workingDir || PROJECTS_DIR;
  let args = {};
  try {
    args = JSON.parse(argsString || "{}");
  } catch (err) {
    return `Error parsing tool arguments: ${err.message}`;
  }

  try {
    switch (name) {
      case "execute_command": {
        const targetCwd = args.cwd ? path.resolve(baseDir, args.cwd) : baseDir;
        if (options.sandboxed && !targetCwd.startsWith(baseDir)) {
          return `Akses Ditolak: Direktori kerja '${args.cwd}' berada di luar scope folder yang diizinkan (${baseDir}).`;
        }
        await mkdir(targetCwd, { recursive: true });

        // Sanitasi environment agar tidak membocorkan BOT_TOKEN
        const sanitizedEnv = { ...process.env };
        delete sanitizedEnv.BOT_TOKEN;
        delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;
        if (process.env.GITHUB_TOKEN) {
          sanitizedEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
        }

        const { stdout, stderr } = await execAsync(args.command, {
          cwd: targetCwd,
          env: sanitizedEnv,
          timeout: 120000, // 2 menit timeout per command
          maxBuffer: 2 * 1024 * 1024,
        });

        const output = (stdout || "") + (stderr ? `\n[STDERR]:\n${stderr}` : "");
        return output.trim() || "[Command dieksekusi tanpa output]";
      }

      case "read_file": {
        const resolvedPath = path.isAbsolute(args.file_path)
          ? args.file_path
          : path.resolve(baseDir, args.file_path);
        if (options.sandboxed && !resolvedPath.startsWith(baseDir)) {
          return `Akses Ditolak: Path file '${args.file_path}' berada di luar scope folder yang diizinkan (${baseDir}).`;
        }
        const content = await readFile(resolvedPath, "utf8");
        return content.length > 50000 ? content.slice(0, 50000) + "\n...[output dipotong]" : content;
      }

      case "write_file": {
        const resolvedPath = path.isAbsolute(args.file_path)
          ? args.file_path
          : path.resolve(baseDir, args.file_path);
        if (options.sandboxed && !resolvedPath.startsWith(baseDir)) {
          return `Akses Ditolak: Path file '${args.file_path}' berada di luar scope folder yang diizinkan (${baseDir}).`;
        }
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, args.content, "utf8");
        return `File berhasil ditulis: ${args.file_path} (${Buffer.byteLength(args.content)} bytes)`;
      }

      case "list_directory": {
        const resolvedPath = args.dir_path ? path.resolve(baseDir, args.dir_path) : baseDir;
        if (options.sandboxed && !resolvedPath.startsWith(baseDir)) {
          return `Akses Ditolak: Direktori '${args.dir_path}' berada di luar scope folder yang diizinkan (${baseDir}).`;
        }
        await mkdir(resolvedPath, { recursive: true });
        const items = await readdir(resolvedPath, { withFileTypes: true });
        const list = items.map((it) => `${it.isDirectory() ? "📁 [DIR] " : "📄 [FILE]"} ${it.name}`);
        return list.length ? list.join("\n") : "[Direktori kosong]";
      }

      default:
        return `Tool '${name}' tidak dikenali.`;
    }
  } catch (err) {
    return `Error eksekusi tool ${name}: ${err.message}`;
  }
}

// In-memory conversation history cache (dibatasi 20 pesan terakhir per session)
const sessionHistories = new Map();

export function getSessionMessages(convId) {
  if (!sessionHistories.has(convId)) {
    sessionHistories.set(convId, []);
  }
  return sessionHistories.get(convId);
}

export function resetSessionHistory(convId) {
  sessionHistories.delete(convId);
}

// Loop Utama Universal Agent
export async function runUniversalAgent({
  prompt,
  convId,
  apiKey,
  baseUrl = "https://api.deepseek.com/v1",
  model = "",
  systemPrompt,
  workingDir = null,
  sandboxed = false,
  onToolStart,
}) {
  if (!apiKey) {
    throw new Error(
      "UNIVERSAL_API_KEY (atau OPENROUTER_API_KEY) belum diisi di .env atau Web Settings."
    );
  }

  // Jika model belum diisi, auto-detect dinamis dari server
  let activeModel = model;
  if (!activeModel || activeModel === "auto") {
    try {
      const dynamic = await resolveDynamicUniversalModel(baseUrl, apiKey);
      if (dynamic) activeModel = dynamic;
    } catch (_) {}
  }
  if (!activeModel) {
    activeModel = baseUrl.includes("deepseek.com") ? "deepseek-chat" : "default";
  }

  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const endpoint = `${cleanBaseUrl}/chat/completions`;

  const messages = getSessionMessages(convId);

  // Jika sesi baru, tambahkan system message
  if (messages.length === 0) {
    messages.push({
      role: "system",
      content:
        systemPrompt ||
        "Kamu adalah TH Agent, asisten AI software engineer cowok (pria) yang memiliki AKSES PENUH dan OTONOM. DILARANG KERAS meminta izin/konfirmasi yang memperlama proses. Langsung eksekusi tugas nyata menggunakan tools sampai tuntas. ATURAN OUTPUT: Berikan respon yang RINGKAS, PADAT, dan LANGSUNG KE POIN PENTING & KESIMPULAN (Summary). Hindari dump log terminal panjang agar pesan pas di layar chat Telegram.",
    });
  }

  // Tambahkan prompt pengguna
  messages.push({ role: "user", content: prompt });

  // Batasi history maksimal 25 pesan agar tidak melampaui context window
  if (messages.length > 25) {
    const sysMsg = messages[0];
    messages.splice(0, messages.length - 20);
    if (messages[0].role !== "system") {
      messages.unshift(sysMsg);
    }
  }

  const MAX_TURNS = 10;
  let currentTurn = 0;

  while (currentTurn < MAX_TURNS) {
    currentTurn++;

    const payload = {
      model: activeModel,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/taufik-hdyt25/AIAgent",
        "X-Title": "TH Agent Telegram",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP Error ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        errMsg = parsed.error?.message || errText;
      } catch {
        errMsg = errText;
      }

      // Fallback jika endpoint/server lokal tidak mendukung function calling / tools
      if (
        payload.tools &&
        (errMsg.toLowerCase().includes("tool") ||
          errMsg.toLowerCase().includes("function") ||
          res.status === 400)
      ) {
        delete payload.tools;
        delete payload.tool_choice;
        try {
          const retryRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/taufik-hdyt25/AIAgent",
              "X-Title": "TH Agent Telegram",
            },
            body: JSON.stringify(payload),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryChoice = retryData.choices?.[0];
            if (retryChoice?.message) {
              messages.push(retryChoice.message);
              return retryChoice.message.content || "[Pesan kosong]";
            }
          }
        } catch {
          // Lanjut lempar error asli jika retry gagal
        }
      }

      throw new Error(`Gagal memanggil API (${cleanBaseUrl}): ${errMsg}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error("Respon dari penyedia AI kosong atau tidak valid.");
    }

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // Jika model meminta pemanggilan Tool
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const toolCall of assistantMsg.tool_calls) {
        if (typeof onToolStart === "function") {
          onToolStart(toolCall.function.name, toolCall.function.arguments);
        }

        const toolResult = await executeToolCall(toolCall, { workingDir, sandboxed });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: String(toolResult),
        });
      }
      // Lanjut ke iterasi berikutnya agar model membaca hasil tool
      continue;
    }

    // Jika model sudah selesai dan mengembalikan teks jawaban
    return assistantMsg.content || "[Pesan kosong]";
  }

  return "⚠️ Batas maksimum pemanggilan tools tercapai (10 turn). Tugas dihentikan untuk keamanan.";
}
