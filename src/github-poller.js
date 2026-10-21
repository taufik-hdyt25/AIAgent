import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

const DATA_DIR = path.resolve("./data");
const PROJECTS_DIR = path.resolve("./projects");
const CONFIG_FILE = path.join(DATA_DIR, "github_poller.json");

let pollerInterval = null;
let isPolling = false;
let isExecutingTask = false;

// Default konfigurasi poller
const DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 5,
  watchedRepos: ["taufik-hdyt25/AIAgent"],
  lastCheck: null,
  processedIssues: {},
};

export async function loadPollerConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    await savePollerConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

export async function savePollerConfig(config) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function addWatchedRepo(repo) {
  const config = await loadPollerConfig();
  const normalized = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!config.watchedRepos.includes(normalized)) {
    config.watchedRepos.push(normalized);
    await savePollerConfig(config);
  }
  return normalized;
}

export async function removeWatchedRepo(repo) {
  const config = await loadPollerConfig();
  const normalized = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  config.watchedRepos = config.watchedRepos.filter((r) => r.toLowerCase() !== normalized.toLowerCase());
  await savePollerConfig(config);
  return normalized;
}

function truncateText(str, max = 2000) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n...[dipotong]";
}

// Menjalankan perintah terminal sederhana dengan timeout
async function runCmd(cmd, cwd = process.cwd()) {
  return execAsync(cmd, {
    cwd,
    env: { ...process.env },
    timeout: 120000,
    maxBuffer: 5 * 1024 * 1024,
  });
}

// Menjalankan AI Agent (Antigravity CLI / Claude Code) pada repository
async function solveIssueWithAI({ repoPath, repo, issue, engine = "agy", model = null }) {
  const agyBin = process.env.AGY_BIN || "/home/node/.local/bin/agy";
  const claudeBin = process.env.CLAUDE_BIN || "/usr/local/bin/claude";
  const convId = randomUUID();
  const activeModel = model || process.env.AGY_MODEL || "gemini-3.8-flash-high";

  const prompt = `
Kamu adalah Antigravity AI, autonomous senior software engineer.
Tugasmu adalah menganalisis dan menyelesaikan GitHub Issue ini secara mandiri sampai tuntas pada repository ini:

REPOSITORY: ${repo}
ISSUE #${issue.number}: ${issue.title}
PELAPOR: @${issue.author?.login || "anonymous"}
DESKRIPSI ISSUE:
${issue.body || "(Tidak ada deskripsi detail pada issue)"}

INSTRUKSI PENGERJAAN:
1. Pahami struktur repository dan temukan file kode yang relevan dengan issue/bug ini.
2. Lakukan perubahan, perbaikan, atau implementasi fitur langsung pada kode.
3. Jalankan linter, unit test, atau build jika ada di repository ini untuk memastikan tidak ada error (misal npm test / npm run build).
4. Pastikan kode bersih, rapi, dan sesuai arsitektur project.
5. JANGAN lakukan git commit secara manual (sistem poller yang akan meng-commit dan membuat PR).
6. Di akhir proses, berikan penjelasan ringkas tentang apa yang telah kamu selesaikan.
`.trim();

  let bin = agyBin;
  let args = [];

  if (engine === "claude") {
    bin = claudeBin;
    args = [
      "--session-id", convId,
      "--model", "sonnet",
      "-p", prompt,
      "--output-format", "text",
      "--dangerously-skip-permissions",
    ];
  } else {
    bin = agyBin;
    args = [
      "--conversation", convId,
      "--model", activeModel,
      "-p", prompt,
      "--output-format", "text",
      "--print-timeout", "15m",
      "--dangerously-skip-permissions",
    ];
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const sanitizedEnv = { ...process.env };
    delete sanitizedEnv.BOT_TOKEN;
    delete sanitizedEnv.ALLOWED_TELEGRAM_IDS;

    const child = spawn(bin, args, {
      cwd: repoPath,
      shell: false,
      detached: true,
      env: sanitizedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (_) {
        child.kill("SIGTERM");
      }
      reject(new Error("Timeout pengerjaan AI melebihi 15 menit."));
    }, 900000);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        output: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Proses pemecahan satu issue secara end-to-end
async function processSingleIssue({ repo, issue, notifyTelegram, config }) {
  const issueKey = `${repo}#${issue.number}`;
  console.log(`[Poller] Memproses issue baru: ${issueKey} - "${issue.title}"`);

  await notifyTelegram(
    `🔔 *[GitHub Issue Terdeteksi]*\n\n` +
    `📦 *Repo:* \`${repo}\`\n` +
    `📌 *Issue #${issue.number}:* ${issue.title}\n` +
    `👤 *Pelapor:* @${issue.author?.login || "user"}\n` +
    `🔗 [Buka di GitHub](${issue.url})\n\n` +
    `⏳ *Mempersiapkan workspace & mulai pengerjaan otomatis dengan Antigravity AI...*`
  );

  const repoName = repo.split("/")[1] || repo;
  const repoPath = path.join(PROJECTS_DIR, repoName);
  await mkdir(PROJECTS_DIR, { recursive: true });

  // 1. Setup / clone repository
  try {
    const checkDir = await runCmd(`git -C "${repoPath}" rev-parse --is-inside-work-tree`).catch(() => null);
    if (!checkDir) {
      console.log(`[Poller] Cloning repo ${repo} ke ${repoPath}...`);
      await runCmd(`git clone "https://github.com/${repo}.git" "${repoPath}"`);
    } else {
      console.log(`[Poller] Fetching updates untuk ${repo}...`);
      await runCmd(`git -C "${repoPath}" fetch origin`);
    }

    // Deteksi default branch
    let defaultBranch = "main";
    try {
      const { stdout: symRef } = await runCmd(`git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD`);
      defaultBranch = symRef.trim().replace(/^refs\/remotes\/origin\//, "") || "main";
    } catch {
      defaultBranch = "main";
    }

    await runCmd(`git -C "${repoPath}" checkout ${defaultBranch}`);
    await runCmd(`git -C "${repoPath}" pull origin ${defaultBranch}`).catch(() => {});

    // Buat branch khusus untuk pengerjaan issue
    const branchName = `agent/issue-${issue.number}-${Date.now().toString().slice(-6)}`;
    await runCmd(`git -C "${repoPath}" checkout -b "${branchName}"`);

    // 2. Jalankan Antigravity AI untuk menyelesaikan issue
    console.log(`[Poller] Menjalankan AI Agent di ${repoPath}...`);
    const aiResult = await solveIssueWithAI({
      repoPath,
      repo,
      issue,
    });

    const aiSummary = aiResult.output || aiResult.stderr || "AI telah menyelesaikan analisis dan perbaikan.";

    // 3. Cek apakah ada perubahan file di git
    const { stdout: statusOut } = await runCmd(`git -C "${repoPath}" status --porcelain`);
    const hasChanges = Boolean(statusOut.trim());

    if (hasChanges) {
      console.log(`[Poller] Perubahan terdeteksi, melakukan commit & push...`);
      await runCmd(`git -C "${repoPath}" add -A`);
      const safeTitle = issue.title.replace(/["`$\\]/g, "");
      await runCmd(`git -C "${repoPath}" commit -m "fix(issue-${issue.number}): ${safeTitle}"`);
      await runCmd(`git -C "${repoPath}" push -u origin "${branchName}"`);

      // 4. Buat Pull Request via GitHub CLI
      console.log(`[Poller] Membuat Pull Request via gh CLI...`);
      const prBody = `Automated resolution created by Antigravity AI.\n\nCloses #${issue.number}\n\n### Ringkasan Pengerjaan:\n${truncateText(aiSummary, 1500)}`;
      const prTitle = `Fix #${issue.number}: ${safeTitle}`;

      let prUrl = "";
      try {
        const { stdout: prOut } = await runCmd(
          `gh pr create --repo "${repo}" --head "${branchName}" --base "${defaultBranch}" --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}"`
        );
        prUrl = prOut.trim();
      } catch (prErr) {
        // Fallback jika PR sudah pernah dibuat
        const { stdout: existingPr } = await runCmd(`gh pr view "${branchName}" --repo "${repo}" --json url -q .url`).catch(() => ({ stdout: "" }));
        prUrl = existingPr.trim() || `https://github.com/${repo}/pulls`;
      }

      // 5. Berikan komentar di issue GitHub
      try {
        await runCmd(
          `gh issue comment ${issue.number} --repo "${repo}" --body "🤖 Halo! Saya telah mengimplementasikan solusi untuk issue ini secara otomatis.\n\nPull Request telah dibuat di: ${prUrl}"`
        );
      } catch (_) {}

      // 6. Notifikasi sukses ke Telegram
      await notifyTelegram(
        `✅ *[GitHub Issue Berhasil Diselesaikan!]*\n\n` +
        `📦 *Repo:* \`${repo}\`\n` +
        `📌 *Issue #${issue.number}:* ${issue.title}\n` +
        `🌿 *Branch:* \`${branchName}\`\n` +
        `🚀 *Pull Request:* [Buka PR di GitHub](${prUrl})\n\n` +
        `📝 *Ringkasan Solusi:*\n${truncateText(aiSummary, 1500)}`
      );

      config.processedIssues[issueKey] = {
        number: issue.number,
        title: issue.title,
        status: "pr_created",
        prUrl,
        branch: branchName,
        completedAt: new Date().toISOString(),
      };
    } else {
      // Tidak ada file yang diubah
      console.log(`[Poller] Tidak ada perubahan kode untuk ${issueKey}.`);
      await notifyTelegram(
        `ℹ️ *[GitHub Issue Ditinjau]*\n\n` +
        `📦 *Repo:* \`${repo}\`\n` +
        `📌 *Issue #${issue.number}:* ${issue.title}\n\n` +
        `AI telah menganalisis issue ini, namun tidak ada perubahan kode yang perlu di-commit.\n\n` +
        `📝 *Analisis AI:*\n${truncateText(aiSummary, 1500)}`
      );

      config.processedIssues[issueKey] = {
        number: issue.number,
        title: issue.title,
        status: "no_changes",
        completedAt: new Date().toISOString(),
      };
    }

    // Kembalikan branch ke default
    await runCmd(`git -C "${repoPath}" checkout ${defaultBranch}`).catch(() => {});
  } catch (err) {
    console.error(`[Poller] Error saat memproses issue ${issueKey}:`, err);
    await notifyTelegram(
      `❌ *[Gagal Memproses Issue]*\n\n` +
      `📦 *Repo:* \`${repo}\`\n` +
      `📌 *Issue #${issue.number}:* ${issue.title}\n\n` +
      `Kendala: \`${err.message}\``
    );

    config.processedIssues[issueKey] = {
      number: issue.number,
      title: issue.title,
      status: "error",
      error: err.message,
      completedAt: new Date().toISOString(),
    };
  }

  await savePollerConfig(config);
}

// Siklus pengecekan GitHub API
export async function runGitHubPollCycle(notifyTelegram, isUserTaskRunning = null) {
  if (isPolling) return;
  isPolling = true;

  try {
    const config = await loadPollerConfig();
    if (!config.enabled) {
      return;
    }

    if (!config.watchedRepos || config.watchedRepos.length === 0) {
      return;
    }

    // Hindari bentrok jika sedang ada task manual dari Telegram
    if (isUserTaskRunning && isUserTaskRunning()) {
      console.log("[Poller] Ada task aktif pengguna di Telegram, menunda polling...");
      return;
    }

    config.lastCheck = new Date().toISOString();
    await savePollerConfig(config);

    for (const repo of config.watchedRepos) {
      try {
        // Query open issues via gh CLI
        const { stdout } = await runCmd(
          `gh issue list --repo "${repo}" --state open --json number,title,body,author,createdAt,url,labels --limit 10`
        );
        const issues = JSON.parse(stdout || "[]");

        for (const issue of issues) {
          const issueKey = `${repo}#${issue.number}`;
          if (config.processedIssues && config.processedIssues[issueKey]) {
            continue; // Sudah pernah diproses
          }

          if (isExecutingTask) {
            break; // Tunggu siklus berikutnya jika sedang mengerjakan
          }

          isExecutingTask = true;
          try {
            await processSingleIssue({ repo, issue, notifyTelegram, config });
          } finally {
            isExecutingTask = false;
          }
        }
      } catch (repoErr) {
        console.warn(`[Poller] Gagal memeriksa repo ${repo}:`, repoErr.message);
      }
    }
  } catch (err) {
    console.error("[Poller] Kesalahan pada siklus polling:", err.message);
  } finally {
    isPolling = false;
  }
}

// Inisialisasi poller otomatis di bot.js
export function startGitHubPoller({ notifyTelegram, isUserTaskRunning }) {
  if (pollerInterval) {
    clearInterval(pollerInterval);
  }

  // Siklus setiap 5 menit (300.000 ms)
  const INTERVAL_MS = 5 * 60 * 1000;
  console.log(`[Poller] GitHub API Issue Poller aktif (siklus setiap 5 menit).`);

  pollerInterval = setInterval(() => {
    runGitHubPollCycle(notifyTelegram, isUserTaskRunning).catch((err) => {
      console.error("[Poller] Background cycle error:", err);
    });
  }, INTERVAL_MS);

  // Jalankan pengecekan pertama kali setelah 10 detik bot start
  setTimeout(() => {
    runGitHubPollCycle(notifyTelegram, isUserTaskRunning).catch(() => {});
  }, 10000);
}

export function stopGitHubPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}
