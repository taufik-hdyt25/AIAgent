import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR } from "../config/env.js";
import { truncate } from "./telegram-files.js";

const execAsync = promisify(exec);
const PENDING_UPDATE_FILE = path.join(DATA_DIR, "pending_update.json");

/**
 * Jalankan perintah git pada folder /home/AIAgent host via docker container terisolasi
 */
async function runHostGit(gitCommand) {
  const dockerCmd = `docker run --rm -v /home/AIAgent:/host -v /home/ubuntu/.ssh:/root/.ssh:ro -w /host alpine sh -c "
apk add --no-cache git openssh-client >/dev/null 2>&1
git config --global --add safe.directory /host
${gitCommand}
"`;
  return await execAsync(dockerCmd);
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
 * Melakukan proses self-update langsung dari Telegram
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

  // 2. Sinkronkan file src ke container saat ini
  try {
    await execAsync(
      `tar -cf - -C /host/src . 2>/dev/null | tar -xf - -C /app/src 2>/dev/null || true`
    );
  } catch (_) {}

  // 3. Ambil commit hash baru setelah pull
  const newCommit = await getCurrentCommit();

  // 4. Catat status pending update agar setelah bot restart bisa mengabari user
  const pendingData = {
    chatId,
    fromCommit: check.currentCommit,
    toCommit: newCommit,
    updatedAt: new Date().toISOString(),
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

  // 6. Graceful restart (Docker policy 'unless-stopped' otomatis me-restart container dengan kode baru)
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

    if (data.chatId && bot) {
      const msg =
        `🚀 *TH Agent Berhasil Diperbarui & Siap Digunakan!*\n\n` +
        `🆔 Versi Aktif: \`${data.toCommit || "latest"}\`\n` +
        `⏱ Waktu Update: ${new Date(data.updatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\n\n` +
        `✅ Semua pembaruan kode, fitur, dan perbaikan sudah diterapkan langsung tanpa perlu instalasi ulang!\n` +
        `💡 _Ketik /help untuk melihat panduan fitur._`;

      await bot.api.sendMessage(data.chatId, msg, { parse_mode: "Markdown" }).catch(() => {});
    }
  } catch (_) {
    // Tidak ada pending update, abaikan
  }
}
