import { readFile, writeFile, unlink } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, ROOT_DIR } from "../config/env.js";
import { truncate } from "./telegram-files.js";
import { notifyUsers } from "./github-watcher.js";

const execAsync = promisify(exec);
const PENDING_UPDATE_FILE = path.join(DATA_DIR, "pending_update.json");

/**
 * Mencari direktori root git repository TH Agent
 */
export function getGitWorkingDir() {
  const candidates = [
    process.env.AGENT_REPO_DIR,
    process.env.WORKSPACE_DIR,
    path.resolve(ROOT_DIR, "projects/AIAgent"),
    path.resolve(ROOT_DIR, "../projects/AIAgent"),
    ROOT_DIR,
    "/home/AIAgent",
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
  }
  return ROOT_DIR;
}

/**
 * Jalankan perintah git pada folder host (baik via native git atau Docker terisolasi jika di container)
 */
async function runHostGit(gitCommand) {
  const gitDir = getGitWorkingDir();

  // 1. Coba eksekusi git secara native di direktori repo host (macOS / Linux baremetal)
  try {
    return await execAsync(gitCommand, { cwd: gitDir });
  } catch (nativeErr) {
    // 2. Jika native gagal atau di dalam container Docker yang me-mount /host
    try {
      const dockerCmd = `docker run --rm -v /home/AIAgent:/host -v /home/ubuntu/.ssh:/root/.ssh:ro -w /host alpine sh -c "
apk add --no-cache git openssh-client >/dev/null 2>&1
git config --global --add safe.directory /host
${gitCommand}
"`;
      return await execAsync(dockerCmd);
    } catch {
      throw nativeErr;
    }
  }
}

/**
 * Mendapatkan commit hash lokal saat ini
 */
export async function getCurrentCommit() {
  try {
    const { stdout } = await runHostGit("git rev-parse --short HEAD");
    return stdout.trim();
  } catch (err) {
    return "unknown";
  }
}

/**
 * Memeriksa apakah ada pembaruan di repository GitHub
 */
export async function checkForUpdates() {
  try {
    const { stdout: localOut } = await runHostGit("git rev-parse --short HEAD");
    const currentCommit = localOut.trim();

    // Fetch update dari remote
    await runHostGit("git fetch origin main >/dev/null 2>&1");

    const { stdout: remoteOut } = await runHostGit("git rev-parse --short origin/main");
    const latestCommit = remoteOut.trim();

    if (currentCommit === latestCommit) {
      return {
        hasUpdate: false,
        currentCommit,
        latestCommit,
        changelog: "",
        commitCount: 0,
      };
    }

    // Ambil daftar commit baru
    const { stdout: logOut } = await runHostGit("git log HEAD..origin/main --oneline -n 10");
    const changelog = logOut.trim();
    const commitCount = changelog ? changelog.split("\n").length : 0;

    return {
      hasUpdate: true,
      currentCommit,
      latestCommit,
      changelog,
      commitCount,
    };
  } catch (err) {
    return {
      hasUpdate: false,
      error: err.message,
      currentCommit: "unknown",
      latestCommit: "unknown",
    };
  }
}

/**
 * Helper untuk build ulang bundle th-agent-bin dan sync aset setelah update
 */
async function syncAndRebuildBundle() {
  const gitDir = getGitWorkingDir();
  const agentDir = fs.existsSync(path.join(gitDir, "telegram-ai-agent"))
    ? path.join(gitDir, "telegram-ai-agent")
    : gitDir;

  // 1. Cek perubahan dependencies & npm install jika perlu
  try {
    const { stdout: diffOut } = await runHostGit("git diff HEAD~1 --name-only 2>/dev/null || echo ''");
    if (diffOut.includes("package.json") || diffOut.includes("package-lock.json")) {
      console.log("[Update Service] Dependencies berubah, menjalankan npm install...");
      await execAsync("npm install --production 2>/dev/null || npm install", {
        cwd: agentDir,
        timeout: 120000,
      });
    }
  } catch (_) {}

  // 2. Pastikan binary Pi CLI terpasang jika belum ada di host
  try {
    let hasPi = false;
    try {
      const { stdout: whichOut } = await execAsync("which pi 2>/dev/null || echo ''");
      hasPi = Boolean(whichOut.trim());
    } catch (_) {}

    if (!hasPi) {
      console.log("[Update Service] Pi CLI belum terpasang, menginstal otomatis...");
      await execAsync("npm install -g @earendil-works/pi-coding-agent 2>/dev/null || npm install @earendil-works/pi-coding-agent || true", {
        cwd: agentDir,
        timeout: 180000,
      });
    }
  } catch (_) {}

  // 3. Re-bundle th-agent-bin jika ada
  const binPath = path.join(ROOT_DIR, "th-agent-bin");
  if (fs.existsSync(binPath)) {
    console.log("[Update Service] Memperbarui bundle executable th-agent-bin...");
    const entry = path.join(agentDir, "src/bot.js");
    await execAsync(
      `npx -y esbuild "${entry}" --bundle --platform=node --format=esm --banner:js="#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);" --target=node20 --outfile="${binPath}"`,
      { cwd: agentDir }
    );
  }

  // 3. Salin public folder jika ada
  const publicSrc = path.join(agentDir, "public");
  const publicDst = path.join(ROOT_DIR, "public");
  if (fs.existsSync(publicSrc) && fs.existsSync(publicDst)) {
    await execAsync(`cp -r "${publicSrc}"/* "${publicDst}/" 2>/dev/null || true`);
  }

  // 4. Sinkronisasi container docker jika berlaku
  try {
    await execAsync(
      `tar -cf - -C /host/src . 2>/dev/null | tar -xf - -C /app/src 2>/dev/null || true`
    );
  } catch (_) {}
}

/**
 * Eksekusi update otomatis (dipanggil oleh Webhook atau Fallback Poller)
 */
export async function applyAutoUpdate(trigger = "polling", bot = null) {
  const check = await checkForUpdates();
  if (!check.hasUpdate) {
    return { updated: false, reason: "Sudah di versi paling baru." };
  }

  console.log(`[Auto-Update] (${trigger}) Memulai pull pembaruan dari origin/main...`);

  // 1. Git pull di host
  await runHostGit("git pull origin main");

  // 2. Sync dependencies & bundle
  await syncAndRebuildBundle();

  // 3. Ambil commit baru
  const newCommit = await getCurrentCommit();

  // 4. Simpan pending update notification
  const pendingData = {
    chatId: null,
    broadcastAll: true,
    fromCommit: check.currentCommit,
    toCommit: newCommit,
    updatedAt: new Date().toISOString(),
    trigger,
  };
  await writeFile(PENDING_UPDATE_FILE, JSON.stringify(pendingData, null, 2), "utf8");

  // 5. Kirim notifikasi Telegram sebelum restart
  if (bot) {
    const restartMsg =
      `🔄 *Auto-Update Berhasil Diterapkan!*\n\n` +
      `• Versi: \`${check.currentCommit}\` → \`${newCommit}\`\n` +
      `• Trigger: ${trigger === "webhook" ? "GitHub Webhook 🔔" : "Auto-Polling ⏰"}\n` +
      `• Changelog:\n\`\`\`\n${truncate(check.changelog, 400)}\n\`\`\`\n\n` +
      `⚡ *Me-restart bot secara otomatis (1-2 detik)...*`;

    await notifyUsers(bot, restartMsg).catch(() => {});
  }

  // 6. Graceful restart
  setTimeout(() => {
    console.log(`[Auto-Update] Restarting bot process to load new commit ${newCommit}...`);
    process.exit(0);
  }, 1200);

  return { updated: true, newCommit };
}

/**
 * Melakukan proses self-update langsung dari Telegram (/update command)
 */
export async function performSelfUpdate({ ctx, force = false }) {
  const chatId = ctx.chat?.id;

  const statusMsg = await ctx.reply("🔍 *Memeriksa pembaruan TH Agent dari GitHub...*", {
    parse_mode: "Markdown",
  });

  const check = await checkForUpdates();

  if (!check.hasUpdate && !force) {
    const msg =
      `✅ *TH Agent Sudah di Versi Paling Mutakhir!*\n\n` +
      `🆔 Commit Aktif: \`${check.currentCommit}\`\n` +
      `🌐 Status: Sinkron dengan \`origin/main\` di GitHub.\n\n` +
      `_Tidak ada pembaruan baru yang perlu diinstal._\n` +
      `💡 _Gunakan \`/update force\` jika ingin memaksa sinkronisasi ulang._`;

    try {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
        parse_mode: "Markdown",
      });
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown" });
    }
    return { updated: false };
  }

  // Laporkan pembaruan yang ditemukan
  let pullNotice = `📦 *Mengunduh & Menerapkan Pembaruan...*\n\n`;
  if (check.hasUpdate) {
    pullNotice += `• Dari Versi: \`${check.currentCommit}\`\n`;
    pullNotice += `• Ke Versi: \`${check.latestCommit}\` (${check.commitCount} commit baru)\n\n`;
    pullNotice += `*Catatan Perubahan:*\n\`\`\`\n${truncate(check.changelog, 500)}\n\`\`\`\n`;
  } else {
    pullNotice += `• Mode: *Force Re-sync* (\`${check.currentCommit}\`)\n\n`;
  }
  pullNotice += `⏳ Sedang mengunduh kode terbaru dan menyinkronkan file...`;

  try {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, pullNotice, {
      parse_mode: "Markdown",
    });
  } catch {
    await ctx.reply(pullNotice, { parse_mode: "Markdown" });
  }

  // 1. Git pull di host
  await runHostGit("git pull origin main");

  // 2. Sync dependencies & bundle
  await syncAndRebuildBundle();

  // 3. Ambil commit hash baru setelah pull
  const newCommit = await getCurrentCommit();

  // 4. Catat status pending update agar setelah bot restart bisa mengabari user
  const pendingData = {
    chatId,
    fromCommit: check.currentCommit,
    toCommit: newCommit,
    updatedAt: new Date().toISOString(),
    trigger: "manual",
  };
  await writeFile(PENDING_UPDATE_FILE, JSON.stringify(pendingData, null, 2), "utf8");

  // 5. Beri info restart ke user
  const restartNotice =
    `🔄 *Pembaruan Berhasil Diterapkan!*\n\n` +
    `• Versi Baru: \`${newCommit}\`\n` +
    `• Status: *Me-restart bot secara otomatis (1-2 detik)...*\n\n` +
    `_Bot akan langsung menyapa kembali begitu proses selesai!_`;

  try {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, restartNotice, {
      parse_mode: "Markdown",
    });
  } catch {
    await ctx.reply(restartNotice, { parse_mode: "Markdown" });
  }

  // 6. Graceful restart (Docker policy 'unless-stopped' / Launchd KeepAlive otomatis me-restart)
  setTimeout(() => {
    console.log(`[Update Service] Restarting bot process to load new commit ${newCommit}...`);
    process.exit(0);
  }, 1200);

  return { updated: true, newCommit };
}

/**
 * Periksa apakah ada notifikasi pending update saat bot baru menyala
 */
export async function checkPendingUpdateNotification(bot) {
  try {
    const raw = await readFile(PENDING_UPDATE_FILE, "utf8");
    const data = JSON.parse(raw);
    await unlink(PENDING_UPDATE_FILE).catch(() => {});

    const triggerLabel =
      data.trigger === "webhook"
        ? "GitHub Webhook 🔔"
        : data.trigger === "polling"
        ? "Auto-Polling ⏰"
        : "Manual /update ⚡";

    const msg =
      `🚀 *TH Agent Berhasil Diperbarui & Siap Digunakan!*\n\n` +
      `🆔 Versi Aktif: \`${data.toCommit || "latest"}\`\n` +
      `⏱ Waktu Update: ${new Date(data.updatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\n` +
      `🔧 Trigger: ${triggerLabel}\n\n` +
      `✅ Semua pembaruan kode, fitur, dan perbaikan sudah diterapkan langsung tanpa perlu instalasi ulang!\n` +
      `💡 _Ketik /help untuk melihat panduan fitur._`;

    if (bot) {
      if (data.broadcastAll) {
        const { ALLOWED_IDS } = await import("../config/env.js");
        for (const chatId of ALLOWED_IDS) {
          await bot.api.sendMessage(chatId, msg, { parse_mode: "Markdown" }).catch(() => {});
        }
      } else if (data.chatId) {
        await bot.api.sendMessage(data.chatId, msg, { parse_mode: "Markdown" }).catch(() => {});
      }
    }
  } catch (_) {
    // Tidak ada pending update, abaikan
  }
}
