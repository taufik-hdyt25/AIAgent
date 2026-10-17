import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
