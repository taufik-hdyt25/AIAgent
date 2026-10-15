import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BOT_TOKEN = process.env.BOT_TOKEN;
const AGY_BIN =
  process.env.AGY_BIN || path.join(os.homedir(), ".local/bin/agy");
const PROJECTS_FILE = path.resolve(
  process.env.PROJECTS_FILE || "./data/projects.json"
);
const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 900000);
const MAX_OUTPUT = Number(process.env.MAX_TASK_OUTPUT || 12000);
const AUTO_APPROVE_PERMISSIONS =
  process.env.AGY_AUTO_APPROVE_PERMISSIONS === "true";
const ALLOWED_IDS = new Set(
  (process.env.ALLOWED_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

if (!BOT_TOKEN || ALLOWED_IDS.size === 0) {
  console.warn(
    "[PERINGATAN] BOT_TOKEN atau ALLOWED_TELEGRAM_IDS belum diisi di .env. Bot memerlukan konfigurasi ini untuk berjalan penuh."
  );
}

const bot = new Bot(BOT_TOKEN || "PLACEHOLDER_TOKEN_FOR_CHECK");
const DATA_DIR = path.dirname(PROJECTS_FILE);
const LOG_DIR = path.resolve("./logs");
const CONTEXT_FILE = path.join(DATA_DIR, "context.json");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(LOG_DIR, { recursive: true });

let activeTask = null;

async function loadContext() {
  try {
    const data = await readFile(CONTEXT_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveContext(context) {
  await writeFile(
    CONTEXT_FILE,
    JSON.stringify(context, null, 2) + "\n",
    { mode: 0o600 }
  );
}

async function getUserActiveProject(userId) {
  if (!userId) return null;
  const context = await loadContext();
  return context[String(userId)] || null;
}

async function setUserActiveProject(userId, projectName) {
  if (!userId) return;
  const context = await loadContext();
  if (projectName) {
    context[String(userId)] = projectName;
  } else {
    delete context[String(userId)];
  }
  await saveContext(context);
}

function authorized(ctx) {
  return ctx.from && ALLOWED_IDS.has(String(ctx.from.id));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadProjects() {
  try {
    const data = await readFile(PROJECTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      await saveProjects({});
      return {};
    }
    throw err;
  }
}

async function saveProjects(projects) {
  await writeFile(
    PROJECTS_FILE,
    JSON.stringify(projects, null, 2) + "\n",
    { mode: 0o600 }
  );
}

function safeName(value) {
  return /^[a-zA-Z0-9_-]{1,40}$/.test(value);
}

function truncate(text, max = 3500) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...[output dipotong]";
}

async function runFile(command, args, options = {}) {
  return execFileAsync(command, args, {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

async function git(cwd, args) {
  const { stdout } = await runFile("git", args, { cwd });
  return stdout.trim();
}

async function prepareBranch(projectPath) {
  let root;
  try {
    root = await git(projectPath, ["rev-parse", "--show-toplevel"]);
  } catch (err) {
    throw new Error(
      `Direktori '${projectPath}' bukan root repository Git yang valid.`
    );
  }

  if (path.resolve(root) !== path.resolve(projectPath)) {
    throw new Error("Path project harus merupakan root repository Git.");
  }

  const status = await git(projectPath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);

  if (status) {
    throw new Error(
      "Working tree tidak bersih. Commit atau simpan perubahan (git stash) terlebih dahulu."
    );
  }

  const baseBranch = await git(projectPath, ["branch", "--show-current"]);
  const branch = `agent/task-${Date.now()}`;
  await git(projectPath, ["switch", "-c", branch]);
  return { branch, baseBranch };
}

async function appendLog(taskId, content) {
  const file = path.join(LOG_DIR, `${taskId}.log`);
  await appendFile(file, content, { mode: 0o600 });
}

function killProcessTree(childProcess, signal = "SIGTERM") {
  if (!childProcess || !childProcess.pid) return;
  try {
    // POSIX process group kill (requires child spawned with detached: true)
    process.kill(-childProcess.pid, signal);
  } catch (err) {
    try {
      childProcess.kill(signal);
    } catch (_) {}
  }
}

async function runAgent(projectName, instruction, ctx) {
  if (activeTask) {
    await ctx.reply(
      `Masih ada task yang berjalan (${activeTask.id}). Gunakan /status atau /cancel.`
    );
    return;
  }

  const projects = await loadProjects();
  const project = projects[projectName];

  if (!project) {
    await ctx.reply("Project tidak ditemukan. Gunakan /projects.");
    return;
  }

  const projectPath = path.resolve(project.path);
  if (!(await fileExists(projectPath))) {
    await ctx.reply(`Direktori project '${projectPath}' tidak ditemukan di VPS/disk.`);
    return;
  }

  const taskId = randomUUID().slice(0, 8);

  activeTask = {
    id: taskId,
    project: projectName,
    startedAt: Date.now(),
    process: null,
    cancelled: false,
  };

  const task = activeTask;

  try {
    const { branch, baseBranch } = await prepareBranch(projectPath);

    await ctx.reply(
      `🚀 Task ${taskId} dimulai.\n` +
      `📁 Project: ${projectName}\n` +
      `🌿 Branch baru: ${branch} (dari: ${baseBranch || "HEAD"})`
    );

    const prompt = `
Kamu adalah AI coding agent yang bekerja pada repository lokal ini.

TUGAS:
${instruction}

ATURAN:
- Kerjakan tugas secara mandiri sampai selesai.
- Periksa struktur dan pola kode sebelum mengubah file.
- Pertahankan konvensi dan dependency project.
- Jangan membaca atau menampilkan .env, credential, private key,
  token, atau secret lainnya.
- Jangan mengirim data ke layanan eksternal.
- Jangan mengubah konfigurasi keamanan atau permission agent.
- Jangan menghapus data penting, menjalankan sudo, mengubah service
  sistem, atau melakukan deployment production.
- Jangan melakukan git push, merge, atau mengubah branch.
- Jangan menjalankan command yang tidak diperlukan.
- Jalankan lint, test, atau build hanya jika script tersedia.
- Jika permission command ditolak, jelaskan dan jangan mencoba
  mengakali permission.
- Jika ada risiko atau blocker, laporkan dengan jujur.

Di akhir, laporkan ringkasan perubahan, file yang diubah,
pemeriksaan yang dijalankan, hasilnya, dan blocker bila ada.
`.trim();

    const agyArgs = [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--print-timeout",
      "15m",
    ];

    if (AUTO_APPROVE_PERMISSIONS) {
      agyArgs.push("--dangerously-skip-permissions");
    }

    // Sanitasi environment: jangan teruskan token bot atau secret
    const sanitizedEnv = { ...process.env };
    delete sanitizedEnv.BOT_TOKEN;
    delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;
    delete sanitizedEnv.GEMINI_API_KEY;

    // Gunakan detached: true agar child process memiliki process group sendiri
    const child = spawn(AGY_BIN, agyArgs, {
      cwd: projectPath,
      shell: false,
      detached: true,
      env: sanitizedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    task.process = child;

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    let killTimer;

    const finish = async (error, code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);

      const result = {
        taskId,
        project: projectName,
        branch,
        cancelled: task.cancelled,
        exitCode: code,
        signal,
        error: error?.message || null,
        output: truncate(stdout.trim(), MAX_OUTPUT),
        stderr: truncate(stderr.trim(), 2500),
      };

      await appendLog(taskId, JSON.stringify(result, null, 2) + "\n");
      if (activeTask?.id === taskId) activeTask = null;

      let message;
      if (task.cancelled) {
        message = `⚠️ Task ${taskId} dihentikan.\nPeriksa branch ${branch}.`;
      } else if (error || code !== 0) {
        const errDetail = stderr.trim() || error?.message || `Exit code: ${code}`;
        message =
          `❌ Task ${taskId} gagal.\nBranch: ${branch}\n\n` +
          truncate(errDetail, 2500);
      } else {
        message =
          `✅ Task ${taskId} selesai.\nProject: ${projectName}\n` +
          `Branch: ${branch}\n\n` +
          (stdout.trim() || "Agent tidak mengembalikan output teks.") +
          "\n\n👉 Periksa git diff sebelum melakukan merge.";
      }

      try {
        await ctx.reply(truncate(message, 3800));
      } catch (replyError) {
        console.error("Gagal mengirim laporan Telegram:", replyError.message);
      }
    };

    timer = setTimeout(() => {
      task.cancelled = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        if (activeTask?.id === taskId) killProcessTree(child, "SIGKILL");
      }, 5000);
      killTimer.unref();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT * 2) {
        stdout = stdout.slice(-MAX_OUTPUT * 2);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });

    child.on("error", (error) => finish(error, null, null));
    child.on("close", (code, signal) => finish(null, code, signal));
  } catch (error) {
    if (activeTask?.id === taskId) activeTask = null;
    await appendLog(taskId, `${error.stack || error}\n`);
    await ctx.reply(`❌ Task gagal dijalankan: ${truncate(error.message, 2500)}`);
  }
}

bot.use(async (ctx, next) => {
  if (ctx.from && ctx.message?.text) {
    console.log(
      `[Pesan Masuk] Dari ID: ${ctx.from.id} (@${ctx.from.username || "tanpa_username"}): "${ctx.message.text}"`
    );
  }

  if (!authorized(ctx)) {
    if (ctx.from) {
      console.warn(
        `[Akses Ditolak] Pesan dari Telegram ID tidak terdaftar: ${ctx.from.id} (@${ctx.from.username || "tanpa_username"})`
      );
      try {
        await ctx.reply(
          `⛔ *Akses Ditolak*\n\nUser ID Telegram Anda: \`${ctx.from.id}\`\n\nID Anda belum terdaftar di \`ALLOWED_TELEGRAM_IDS\` pada file \`.env\`.\nSilakan masukkan ID di atas ke \`.env\` lalu restart bot.`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Gagal mengirim pesan penolakan:", err.message);
      }
    }
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  const activeProj = await getUserActiveProject(ctx.from?.id);
  const activeInfo = activeProj
    ? `🎯 *Project Aktif:* \`${activeProj}\`\n💬 *Langsung ketik instruksi Anda di chat ini untuk mulai ngoding!*\n\n`
    : `⚠️ *Belum ada project aktif.*\nKetik \`/projects\` untuk memilih project dari tombol.\n\n`;

  await ctx.reply(
    `🤖 *Telegram AI Coding Agent Aktif.*\n\n` +
      activeInfo +
      `Perintah yang tersedia:\n` +
      `• \`/projects\` - Daftar & pilih project aktif\n` +
      `• \`/use <nama>\` - Pilih project aktif secara manual\n` +
      `• \`/unuse\` - Lepas pilihan project aktif\n` +
      `• \`/clone <nama> <URL>\` - Clone repo GitHub & otomatis aktifkan\n` +
      `• \`/code <project> <instruksi>\` - Jalankan coding pada project spesifik\n` +
      `• \`/status\` - Lihat status task & project aktif\n` +
      `• \`/cancel\` - Hentikan task aktif\n` +
      `• \`/help\` - Panduan lengkap`,
    { parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📖 *Cara Praktis Ngoding Lewat Telegram:*\n\n" +
      "1. *Pilih Project Dulu:*\n" +
      "   Ketik `/projects` lalu klik tombol project Anda (atau gunakan `/use nama-project`).\n\n" +
      "2. *Langsung Chat:*\n" +
      "   Setelah project dipilih, Anda **tidak perlu mengetik /code lagi**. Cukup ketik instruksi seperti chat biasa:\n" +
      "   _\"Buatkan komponen Navbar responsif dengan logo dan tombol login\"_\n\n" +
      "3. *Atau Clone Repo Baru:*\n" +
      "   `/clone blog https://github.com/user/blog.git`\n" +
      "   Repo yang baru di-clone otomatis langsung menjadi project aktif!\n\n" +
      "📌 *Catatan:* Setiap task otomatis dibuatkan branch Git terpisah (`agent/task-...`).",
    { parse_mode: "Markdown" }
  );
});

bot.command("projects", async (ctx) => {
  const projects = await loadProjects();
  const entries = Object.entries(projects);
  const activeProj = await getUserActiveProject(ctx.from?.id);

  if (!entries.length) {
    await ctx.reply(
      "Belum ada project terdaftar.\nGunakan `/clone <nama> <URL-GitHub>` untuk clone repo publik GitHub.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const list = entries
    .map(([name, p]) => {
      const isCurrent = name === activeProj ? " ✅ *(Aktif)*" : "";
      return `• *${name}*${isCurrent}: ${p.description || p.path}`;
    })
    .join("\n");

  const keyboard = new InlineKeyboard();
  entries.forEach(([name], idx) => {
    const label = name === activeProj ? `✅ ${name}` : `📂 ${name}`;
    keyboard.text(label, `select_project:${name}`);
    if ((idx + 1) % 2 === 0) keyboard.row();
  });

  if (activeProj) {
    keyboard.row().text("❌ Lepas Pilihan Project", "deselect_project");
  }

  await ctx.reply(
    `📂 *Daftar Project:*\n${list}\n\n👇 *Klik tombol di bawah untuk memilih project aktif:*`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
});

bot.callbackQuery(/^select_project:(.+)$/, async (ctx) => {
  const projectName = ctx.match[1];
  const projects = await loadProjects();

  if (!projects[projectName]) {
    await ctx.answerCallbackQuery({
      text: "Project tidak ditemukan!",
      show_alert: true,
    });
    return;
  }

  await setUserActiveProject(ctx.from.id, projectName);
  await ctx.answerCallbackQuery({ text: `Project aktif: ${projectName}` });

  await ctx.reply(
    `🎯 *Project aktif sekarang:* \`${projectName}\`\n\n` +
      `💡 Sekarang Anda bisa **langsung kirim instruksi coding apa saja di chat ini** (tanpa perlu mengetik \`/code\`)!`,
    { parse_mode: "Markdown" }
  );
});

bot.callbackQuery("deselect_project", async (ctx) => {
  await setUserActiveProject(ctx.from.id, null);
  await ctx.answerCallbackQuery({ text: "Pilihan project dilepas." });
  await ctx.reply(
    "Pilihan project aktif telah dilepas. Gunakan `/projects` untuk memilih kembali."
  );
});

bot.command(["use", "select"], async (ctx) => {
  const args = ctx.message.text.trim().split(/\s+/);
  const projectName = args[1]?.trim();

  if (!projectName) {
    await ctx.reply("Format: `/use <nama-project>` atau gunakan tombol di `/projects`.", {
      parse_mode: "Markdown",
    });
    return;
  }

  const projects = await loadProjects();
  if (!projects[projectName]) {
    await ctx.reply(`Project '${projectName}' tidak ditemukan. Cek daftar di /projects.`);
    return;
  }

  await setUserActiveProject(ctx.from.id, projectName);
  await ctx.reply(
    `🎯 *Project aktif sekarang:* \`${projectName}\`\n\n` +
      `💬 Silakan **langsung kirim instruksi coding Anda di chat ini**!`,
    { parse_mode: "Markdown" }
  );
});

bot.command(["unuse", "leave"], async (ctx) => {
  await setUserActiveProject(ctx.from.id, null);
  await ctx.reply(
    "Project aktif telah dilepas. Gunakan `/projects` untuk memilih project baru."
  );
});

bot.command("status", async (ctx) => {
  const activeProj = await getUserActiveProject(ctx.from?.id);
  const projectInfo = activeProj ? `\n🎯 Project Aktif Anda: *${activeProj}*` : "\n⚠️ Belum ada project aktif yang dipilih.";

  if (!activeTask) {
    await ctx.reply(`Tidak ada task coding yang sedang berjalan saat ini.${projectInfo}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  const elapsed = Math.floor((Date.now() - activeTask.startedAt) / 1000);
  await ctx.reply(
    `⏳ *Task Aktif Sedang Berjalan:*\nID: \`${activeTask.id}\`\nProject: *${activeTask.project}*\nDurasi: ${elapsed} detik${projectInfo}`,
    { parse_mode: "Markdown" }
  );
});

bot.command("cancel", async (ctx) => {
  if (!activeTask?.process) {
    await ctx.reply("Tidak ada proses agent aktif yang bisa dihentikan.");
    return;
  }

  activeTask.cancelled = true;
  killProcessTree(activeTask.process, "SIGTERM");
  await ctx.reply(`🛑 Permintaan penghentian dikirim untuk task \`${activeTask.id}\`.`, {
    parse_mode: "Markdown",
  });
});

bot.command("code", async (ctx) => {
  const text = ctx.message.text.replace(/^\/code(?:@\w+)?\s*/, "");
  const match = text.match(/^([a-zA-Z0-9_-]{1,40})\s+([\s\S]+)$/);

  if (!match) {
    await ctx.reply("Format: `/code <nama-project> <instruksi coding>`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const [, projectName, instruction] = match;

  if (instruction.length > 4000) {
    await ctx.reply("Instruksi maksimal 4000 karakter.");
    return;
  }

  await runAgent(projectName, instruction, ctx);
});

bot.command("clone", async (ctx) => {
  if (activeTask) {
    await ctx.reply("Task sedang berjalan. Tunggu hingga selesai.");
    return;
  }

  const args = ctx.message.text.trim().split(/\s+/);
  const [, name, rawUrl] = args;

  if (!safeName(name || "") || !rawUrl) {
    await ctx.reply("Format: `/clone <nama> https://github.com/owner/repo.git`", {
      parse_mode: "Markdown",
    });
    return;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    await ctx.reply("URL tidak valid.");
    return;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)
  ) {
    await ctx.reply("Hanya URL repository GitHub publik yang diizinkan.");
    return;
  }

  const projects = await loadProjects();
  if (projects[name]) {
    await ctx.reply("Nama project sudah terdaftar dalam daftar project.");
    return;
  }

  const destination = path.join(os.homedir(), "projects", name);
  if (await fileExists(destination)) {
    await ctx.reply(`Direktori destination '${destination}' sudah ada di filesystem.`);
    return;
  }

  try {
    await ctx.reply(`Meng-clone repository ke '${destination}'...`);
    await mkdir(path.dirname(destination), { recursive: true });
    await runFile("git", ["clone", "--", url.href, destination], {
      timeout: 120000,
    });

    projects[name] = {
      path: destination,
      description: `GitHub: ${url.pathname}`,
    };

    await saveProjects(projects);
    // Otomatis aktifkan project yang baru di-clone untuk user ini
    await setUserActiveProject(ctx.from.id, name);

    await ctx.reply(
      `✅ Repository *${name}* berhasil di-clone!\n\n` +
        `🎯 Otomatis dijadikan **Project Aktif**.\n` +
        `💬 Sekarang Anda bisa **langsung kirim instruksi coding apa saja di chat ini** tanpa perlu perintah tambahan!`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await ctx.reply(`❌ Clone gagal: ${truncate(error.message, 2000)}`);
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const activeProj = await getUserActiveProject(ctx.from.id);

  if (activeProj) {
    const projects = await loadProjects();
    if (!projects[activeProj]) {
      await setUserActiveProject(ctx.from.id, null);
      await ctx.reply(
        `Project '${activeProj}' tidak lagi ditemukan di daftar. Silakan pilih kembali dari /projects.`
      );
      return;
    }

    if (text.length > 4000) {
      await ctx.reply("Instruksi maksimal 4000 karakter.");
      return;
    }

    // Langsung jalankan coding agent di project aktif!
    await runAgent(activeProj, text, ctx);
    return;
  }

  // Jika belum ada project yang dipilih:
  const projects = await loadProjects();
  const entries = Object.entries(projects);

  if (entries.length > 0) {
    const keyboard = new InlineKeyboard();
    entries.forEach(([name], idx) => {
      keyboard.text(`📂 ${name}`, `select_project:${name}`);
      if ((idx + 1) % 2 === 0) keyboard.row();
    });

    await ctx.reply(
      "⚠️ *Belum ada project aktif yang dipilih.*\n\n" +
        "Pilih project tujuan coding Anda dengan mengklik tombol di bawah:",
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  } else {
    await ctx.reply(
      "Belum ada project terdaftar.\n" +
        "Silakan clone repository terlebih dahulu dengan perintah:\n" +
        "`/clone <nama> <URL-GitHub>`",
      { parse_mode: "Markdown" }
    );
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error.message);
});

if (process.env.NODE_ENV !== "test" && BOT_TOKEN && BOT_TOKEN !== "PLACEHOLDER_TOKEN_FOR_CHECK") {
  console.log("Memulai Telegram Coding Agent...");
  bot.start();
} else {
  console.log("Bot diinisialisasi dalam mode pengecekan / offline (tanpa BOT_TOKEN aktif).");
}

export { bot, loadProjects, saveProjects, prepareBranch, killProcessTree };
