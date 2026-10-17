import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { stat } from "node:fs/promises";
import { InlineKeyboard } from "grammy";
import { PROJECTS_DIR } from "../config/env.js";
import {
  fetchIssueDetails,
  createDraftPr,
  isGhAvailable,
} from "./github-service.js";
import { runAgentAutonomous } from "../bot/dispatcher.js";
import { truncate } from "./telegram-files.js";
import { notifyUsers } from "./github-watcher.js";

const execAsync = promisify(exec);

// Set untuk tracking proses autofix yang sedang berjalan agar tidak dobel
const activeFixJobs = new Set();

// 1. Analisis Otomatis GitHub Issue
export async function runIssueAnalysis({
  repo,
  issueNumber,
  issueData = null,
  bot,
  notifyChatId = null,
}) {
  try {
    let issue = issueData;
    if (!issue) {
      issue = await fetchIssueDetails(issueNumber, repo);
    }

    const author = issue.author?.login || "anonymous";
    const labels = (issue.labels || []).map((l) => l.name).join(", ") || "-";

    let commentsText = "";
    if (issue.comments && issue.comments.length > 0) {
      commentsText = "\nKomentar terkait:\n" +
        issue.comments
          .map((c, i) => `[#${i + 1} oleh @${c.author?.login || "user"}]: ${c.body}`)
          .join("\n");
    }

    const analysisPrompt = `
Kamu adalah TH Agent, asisten AI software engineering senior.
Tolong lakukan analisis mendalam terhadap GitHub Issue berikut ini dan berikan output terstruktur dalam bahasa Indonesia yang ramah, ringkas, dan jelas:

📦 Repository: ${repo}
📌 Issue #${issue.number}: ${issue.title}
👤 Pembuat: @${author}
🏷 Labels: ${labels}
🔗 URL: ${issue.url || "-"}

Deskripsi Issue:
${issue.body || "(Tidak ada deskripsi rinci)"}
${commentsText}

Format Jawaban yang Diharapkan:
1. 📋 *Ringkasan Masalah:* Jelaskan secara padat apa yang terjadi.
2. 🔍 *Akar Masalah (Root Cause):* Mengapa masalah ini timbul dan komponen mana yang terdampak.
3. 💡 *Rencana Perbaikan Kode:* Strategi konkrit untuk menyelesaikan issue ini, file mana saja yang perlu dimodifikasi, dan langkah-langkahnya.
`.trim();

    const { output } = await runAgentAutonomous({
      prompt: analysisPrompt,
      convId: `analysis-${repo.replace(/[^a-zA-Z0-9]/g, "-")}-${issueNumber}`,
    });

    const keyboard = new InlineKeyboard()
      .text(`🛠️ Bikin Fix & Draft PR`, `autofix:${repo}:${issueNumber}`)
      .row()
      .url(`🌐 Buka di GitHub`, issue.url || `https://github.com/${repo}/issues/${issueNumber}`)
      .text(`🚀 Deploy ke Server`, `deploy_prompt:${repo}`);

    const message =
      `🤖 *HASIL ANALISIS OTOMATIS AI (Issue #${issueNumber})*\n\n` +
      `📦 *Repo:* \`${repo}\`\n` +
      `📌 *Judul:* ${issue.title}\n\n` +
      `${truncate(output, 3200)}\n\n` +
      `💡 _Klik tombol di bawah untuk membuat branch fix, memperbaiki kode, dan membuka Draft PR otomatis!_`;

    await notifyUsers(bot, message, notifyChatId, keyboard);
    return output;
  } catch (err) {
    console.error(`[Auto-Analyze Error #${issueNumber}]:`, err);
    await notifyUsers(
      bot,
      `⚠️ Gagal menganalisis otomatis Issue #${issueNumber} pada \`${repo}\`: ${err.message}`,
      notifyChatId
    );
  }
}

// 2. Auto-Fix: Buat branch, perbaiki kode, commit, push, dan buka Draft PR
export async function runAutoFixAndCreatePr({
  repo,
  issueNumber,
  bot,
  notifyChatId = null,
}) {
  const jobKey = `${repo}#${issueNumber}`;
  if (activeFixJobs.has(jobKey)) {
    await notifyUsers(
      bot,
      `⏳ Auto-fix untuk issue #${issueNumber} pada \`${repo}\` sedang berjalan. Harap tunggu hingga proses selesai.`,
      notifyChatId
    );
    return;
  }

  activeFixJobs.add(jobKey);

  const cleanRepo = repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").trim();
  const repoFolder = cleanRepo.includes("/") ? cleanRepo.split("/")[1] : cleanRepo;
  const projectPath = path.resolve(PROJECTS_DIR, repoFolder);
  const branchName = `fix/issue-${issueNumber}`;

  const ghToken = process.env.GITHUB_TOKEN;
  const env = { ...process.env };
  if (ghToken) {
    env.GH_TOKEN = ghToken;
  }

  try {
    await notifyUsers(
      bot,
      `🛠️ *MEMULAI AUTO-FIX ISSUE #${issueNumber}*\n\n` +
        `📦 *Repo:* \`${cleanRepo}\`\n` +
        `🌿 *Branch Target:* \`${branchName}\`\n\n` +
        `⏳ _Langkah 1/4: Mempersiapkan repository di server..._`,
      notifyChatId
    );

    // Pastikan folder repo ada
    const repoExists = await stat(path.join(projectPath, ".git")).then(() => true).catch(() => false);
    if (!repoExists) {
      await notifyUsers(
        bot,
        `📥 Repository \`${cleanRepo}\` belum ada di local server. Sedang melakukan clone ke \`./projects/${repoFolder}\`...`,
        notifyChatId
      );

      const cloneUrl = ghToken
        ? `https://${ghToken}@github.com/${cleanRepo}.git`
        : `https://github.com/${cleanRepo}.git`;

      await execAsync(`git clone "${cloneUrl}" "${projectPath}"`, { env, timeout: 180000 });
    }

    // Update repository dan checkout branch fix
    try {
      await execAsync(`git fetch origin`, { cwd: projectPath, env });
      await execAsync(`git checkout main || git checkout master`, { cwd: projectPath, env }).catch(() => {});
      await execAsync(`git pull origin main || git pull origin master`, { cwd: projectPath, env }).catch(() => {});
    } catch (_) {}

    // Buat branch fix
    await execAsync(`git checkout -B "${branchName}"`, { cwd: projectPath, env });

    // Ambil detail issue
    const issueData = await fetchIssueDetails(issueNumber, cleanRepo);

    await notifyUsers(
      bot,
      `⏳ _Langkah 2/4: AI sedang membaca struktur kode di \`${repoFolder}\` dan menerapkan perbaikan..._`,
      notifyChatId
    );

    const fixPrompt = `
Kamu adalah software engineer otonom. Tugasmu adalah memperbaiki bug atau menyelesaikan GitHub Issue berikut di direktori proyek ini:
📦 Repository: ${cleanRepo}
📌 Issue #${issueData.number}: ${issueData.title}

Deskripsi Masalah:
${issueData.body || "(Tidak ada deskripsi)"}

PANDUAN EKSEKUSI:
1. Telusuri file di direktori ini menggunakan tool yang tersedia (read_file, write_file, execute_command, list_directory).
2. Lakukan perubahan kode yang diperlukan untuk menyelesaikan issue secara tuntas dan rapi.
3. Pastikan tidak menimbulkan error sintaksis. Jika ada skrip tes/build (npm test / npm run build / python test), jalankan via terminal untuk memverifikasi.
4. Di akhir, berikan ringkasan singkat dalam bahasa Indonesia mengenai file apa saja yang diubah dan perbaikan yang dilakukan.
`.trim();

    const { output: agentFixSummary } = await runAgentAutonomous({
      prompt: fixPrompt,
      cwd: projectPath,
      convId: `autofix-${cleanRepo.replace(/[^a-zA-Z0-9]/g, "-")}-${issueNumber}`,
    });

    // Cek apakah ada perubahan file
    const { stdout: gitStatus } = await execAsync(`git status --porcelain`, {
      cwd: projectPath,
      env,
    });

    if (!gitStatus || gitStatus.trim().length === 0) {
      await notifyUsers(
        bot,
        `ℹ️ *Auto-Fix Selesai Tanpa Perubahan File*\n\n` +
          `AI telah menelaah kode untuk Issue #${issueNumber}, namun tidak ada file yang diubah atau issue ini membutuhkan tindakan manual developer.\n\n` +
          `📝 *Catatan AI:*\n${truncate(agentFixSummary, 1500)}`,
        notifyChatId
      );
      return;
    }

    await notifyUsers(
      bot,
      `⏳ _Langkah 3/4: Melakukan Git commit dan push branch \`${branchName}\`..._`,
      notifyChatId
    );

    // Konfigurasi identity git jika belum ada
    await execAsync(`git config user.name "TH Agent"`, { cwd: projectPath, env });
    await execAsync(`git config user.email "agent@th-ai.local"`, { cwd: projectPath, env });

    // Set remote url dengan token jika tersedia agar push lancar tanpa prompt password
    if (ghToken) {
      await execAsync(
        `git remote set-url origin "https://x-access-token:${ghToken}@github.com/${cleanRepo}.git"`,
        { cwd: projectPath, env }
      );
    }

    const commitMsg = `fix: resolve issue #${issueNumber} - ${issueData.title}`;
    await execAsync(`git add -A`, { cwd: projectPath, env });
    await execAsync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: projectPath, env });
    await execAsync(`git push -u origin "${branchName}" --force`, { cwd: projectPath, env, timeout: 60000 });

    await notifyUsers(
      bot,
      `⏳ _Langkah 4/4: Membuka Draft PR di GitHub..._`,
      notifyChatId
    );

    const prBody = `## 🤖 TH Agent Auto-Fix

Resolves #${issueNumber}

### 📝 Ringkasan Perbaikan:
${agentFixSummary || "Perbaikan otomatis terhadap issue #" + issueNumber}

---
*Dibuat secara otomatis oleh TH Agent. Silakan review dan merge jika sudah sesuai.*`;

    let prUrl = "";
    try {
      prUrl = await createDraftPr({
        repo: cleanRepo,
        branch: branchName,
        title: `fix: ${issueData.title} (#${issueNumber})`,
        body: prBody,
      });
    } catch (prErr) {
      // Fallback jika createDraftPr gagal membuat PR otomatis
      prUrl = `https://github.com/${cleanRepo}/compare/${branchName}?expand=1`;
      console.warn("[Auto-Fix PR Warning]:", prErr.message);
    }

    const keyboard = new InlineKeyboard()
      .url(`🔍 Review Draft PR di GitHub`, prUrl)
      .row()
      .text(`🚀 Deploy ke Server`, `deploy_prompt:${cleanRepo}`);

    const successMessage =
      `🎉 *DRAFT PULL REQUEST BERHASIL DIBUAT!*\n\n` +
      `📦 *Repo:* \`${cleanRepo}\`\n` +
      `📌 *Issue Terkait:* #${issueNumber} - ${issueData.title}\n` +
      `🌿 *Branch:* \`${branchName}\`\n` +
      `🔗 *PR Link:* ${prUrl}\n\n` +
      `📝 *Perubahan yang Dilakukan AI:*\n${truncate(agentFixSummary, 2000)}\n\n` +
      `✅ *Alur Selanjutnya:*\n` +
      `1. Klik tombol di bawah untuk memeriksa diff kode di GitHub lalu klik *Merge*.\n` +
      `2. Setelah merge selesai, klik *🚀 Deploy ke Server* untuk langsung memperbarui server!`;

    await notifyUsers(bot, successMessage, notifyChatId, keyboard);
  } catch (err) {
    console.error(`[Auto-Fix Error #${issueNumber}]:`, err);
    await notifyUsers(
      bot,
      `❌ *Auto-Fix Gagal untuk Issue #${issueNumber}:*\n\`\`\`\n${truncate(err.message, 1500)}\n\`\`\``,
      notifyChatId
    );
  } finally {
    activeFixJobs.delete(jobKey);
  }
}
