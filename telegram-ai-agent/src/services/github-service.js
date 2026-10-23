import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const GITHUB_WATCH_FILE = path.join(DATA_DIR, "github-watch.json");

// Helper memeriksa apakah GitHub CLI (gh) terpasang di sistem
export async function isGhAvailable() {
  try {
    await execAsync("gh --version");
    return true;
  } catch {
    return false;
  }
}

// Regex untuk mendeteksi URL Issue GitHub dari pesan
// Contoh: https://github.com/owner/repo/issues/123
export const GITHUB_ISSUE_REGEX =
  /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/issues\/(\d+)/i;

// Mengambil data lengkap issue (title, body, author, comments, labels)
export async function fetchIssueDetails(issueTarget, repo = null) {
  const ghReady = await isGhAvailable();
  if (!ghReady) {
    throw new Error(
      "GitHub CLI (gh) belum terpasang atau tidak ditemukan di PATH sistem."
    );
  }

  // Siapkan environment dengan GITHUB_TOKEN dari .env jika ada
  const env = { ...process.env };
  if (process.env.GITHUB_TOKEN) {
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  const repoFlag = repo ? `-R "${repo}"` : "";
  const cmd = `gh issue view "${issueTarget}" ${repoFlag} --json number,title,body,state,author,labels,comments,url`;

  try {
    const { stdout } = await execAsync(cmd, { env, timeout: 30000 });
    const data = JSON.parse(stdout);
    return data;
  } catch (err) {
    const msg = err.stderr || err.message || "Gagal mengambil data issue";
    throw new Error(`GitHub CLI Error: ${msg.trim()}`);
  }
}

// Format data issue agar rapi saat diselipkan ke prompt AI
export function formatIssueForPrompt(issueData) {
  if (!issueData) return "";
  const labels = (issueData.labels || []).map((l) => l.name).join(", ") || "-";
  const author = issueData.author?.login || "anonymous";

  let commentsText = "";
  if (issueData.comments && issueData.comments.length > 0) {
    commentsText = "\n\nKomentar / Diskusi Terkait:\n" +
      issueData.comments
        .map(
          (c, idx) =>
            `[Komentar #${idx + 1} oleh @${c.author?.login || "user"}]:\n${c.body}`
        )
        .join("\n\n");
  }

  return `
--- INFORMASI GITHUB ISSUE OTOMATIS ---
• Issue #${issueData.number}: ${issueData.title}
• Status: ${issueData.state}
• Penulis: @${author}
• Labels: ${labels}
• URL: ${issueData.url || "-"}

Deskripsi Issue:
${issueData.body || "(Tidak ada deskripsi)"}
${commentsText}
--- AKHIR INFORMASI GITHUB ISSUE ---
PANDUAN:
Gunakan informasi issue di atas untuk menganalisis akar masalah, menjelaskan solusinya, atau jika diminta koding/fix, lakukan perbaikan kode di file proyek yang relevan.
`.trim();
}

// Mengambil daftar issue dari suatu repository (state: 'open')
export async function listRepoIssues(repo, limit = 15, state = "open") {
  const ghReady = await isGhAvailable();
  if (!ghReady) {
    throw new Error("GitHub CLI (gh) belum terpasang atau tidak ditemukan di PATH.");
  }

  const env = { ...process.env };
  if (process.env.GITHUB_TOKEN) {
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  const cmd = `gh issue list -R "${repo}" --state "${state}" --limit ${limit} --json number,title,body,author,labels,createdAt,url`;
  try {
    const { stdout } = await execAsync(cmd, { env, timeout: 30000 });
    return JSON.parse(stdout || "[]");
  } catch (err) {
    const msg = err.stderr || err.message || "Gagal mengambil daftar issue";
    throw new Error(`GitHub CLI Error (${repo}): ${msg.trim()}`);
  }
}

// Membaca konfigurasi watch repositori
export async function loadWatchConfig() {
  try {
    const raw = await readFile(GITHUB_WATCH_FILE, "utf8");
    const data = JSON.parse(raw);
    return {
      watchedRepos: Array.isArray(data.watchedRepos) ? data.watchedRepos : [],
      pollIntervalMinutes: Number(data.pollIntervalMinutes || process.env.GITHUB_POLL_INTERVAL_MINUTES || 5),
      seenIssues: data.seenIssues && typeof data.seenIssues === "object" ? data.seenIssues : {},
      lastChecked: data.lastChecked || 0,
      enabled: data.enabled !== undefined ? data.enabled !== false : process.env.GITHUB_WATCHER_ENABLED !== "false",
      autoAnalyze: data.autoAnalyze !== false,
      autoFix: Boolean(data.autoFix || process.env.GITHUB_AUTO_FIX === "true"),
    };
  } catch {
    // Default konfigurasi jika belum ada file
    const envRepos = (process.env.GITHUB_WATCH_REPOS || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    return {
      watchedRepos: envRepos.length > 0 ? envRepos : ["taufik-hdyt25/AIAgent"],
      pollIntervalMinutes: Number(process.env.GITHUB_POLL_INTERVAL_MINUTES || 5),
      seenIssues: {},
      lastChecked: 0,
      enabled: process.env.GITHUB_WATCHER_ENABLED !== "false",
      autoAnalyze: true,
      autoFix: process.env.GITHUB_AUTO_FIX === "true",
    };
  }
}

// Menyimpan konfigurasi watch repositori
export async function saveWatchConfig(config) {
  await writeFile(GITHUB_WATCH_FILE, JSON.stringify(config, null, 2), "utf8");
}

// Mengaktifkan / menonaktifkan GitHub Watcher (pengecekan berkala)
export async function toggleWatcher(enable = null) {
  const config = await loadWatchConfig();
  config.enabled = enable !== null ? Boolean(enable) : !config.enabled;
  await saveWatchConfig(config);
  return config.enabled;
}

// Mengaktifkan / menonaktifkan fitur autoAnalyze
export async function toggleAutoAnalyze(enable = null) {
  const config = await loadWatchConfig();
  config.autoAnalyze = enable !== null ? Boolean(enable) : !config.autoAnalyze;
  await saveWatchConfig(config);
  return config.autoAnalyze;
}

// Mengaktifkan / menonaktifkan fitur autoFix
export async function toggleAutoFix(enable = null) {
  const config = await loadWatchConfig();
  config.autoFix = enable !== null ? Boolean(enable) : !config.autoFix;
  await saveWatchConfig(config);
  return config.autoFix;
}

// Membuat Draft Pull Request di GitHub via GitHub CLI
export async function createDraftPr({ repo, branch, base = null, title, body = "" }) {
  const ghReady = await isGhAvailable();
  if (!ghReady) {
    throw new Error("GitHub CLI (gh) belum terpasang atau tidak ditemukan di PATH.");
  }

  const env = { ...process.env };
  if (process.env.GITHUB_TOKEN) {
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  // Title & body berasal dari issue GitHub (input pihak luar), jadi dikirim sebagai argumen
  // langsung via execFile tanpa shell agar tidak bisa disisipi command injection
  const args = ["pr", "create", "-R", repo, "--draft", "--head", branch, "--title", title, "--body", body];
  if (base) args.push("--base", base);

  try {
    const { stdout } = await execFileAsync("gh", args, { env, timeout: 60000 });
    const output = (stdout || "").trim();
    // Jika gh pr create mencetak URL PR (biasanya berupa link https://github.com/owner/repo/pull/xxx)
    const match = output.match(/https?:\/\/github\.com\/[^\s]+\/pull\/\d+/i);
    if (match) {
      return match[0];
    }
    return output;
  } catch (err) {
    const msg = err.stderr || err.message || "Gagal membuat Draft PR";
    throw new Error(`GitHub CLI PR Error: ${msg.trim()}`);
  }
}

// Menambahkan repository ke daftar pantauan
export async function addWatchedRepo(repo) {
  const cleanRepo = repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").trim();
  const config = await loadWatchConfig();
  if (!config.watchedRepos.includes(cleanRepo)) {
    config.watchedRepos.push(cleanRepo);
    await saveWatchConfig(config);
  }
  return config;
}

// Menghapus repository dari daftar pantauan
export async function removeWatchedRepo(repo) {
  const cleanRepo = repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").trim();
  const config = await loadWatchConfig();
  config.watchedRepos = config.watchedRepos.filter((r) => r.toLowerCase() !== cleanRepo.toLowerCase());
  await saveWatchConfig(config);
  return config;
}

// Memeriksa issue baru untuk repositori tertentu
export async function checkNewIssuesForRepo(repo) {
  const config = await loadWatchConfig();
  const issues = await listRepoIssues(repo, 15, "open");

  // Run pertama ditandai dari belum adanya entry repo, bukan dari list kosong,
  // supaya issue pertama di repo yang awalnya tanpa issue tetap terdeteksi
  const isFirstRun = !Array.isArray(config.seenIssues[repo]);
  if (isFirstRun) {
    config.seenIssues[repo] = [];
  }

  const seenList = config.seenIssues[repo];

  const newIssues = [];
  for (const issue of issues) {
    if (!seenList.includes(issue.number)) {
      newIssues.push(issue);
      seenList.push(issue.number);
    }
  }

  config.lastChecked = Date.now();
  await saveWatchConfig(config);

  // Jika ini run pertama kali untuk repo tsb, simpan issue yang ada tapi jangan spam notifikasi
  if (isFirstRun) {
    return { isFirstRun: true, newIssues: [], existingCount: issues.length };
  }

  return { isFirstRun: false, newIssues, existingCount: issues.length };
}

