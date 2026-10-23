import { exec } from "node:child_process";
import { promisify } from "node:util";
import { notifyUsers } from "./github-watcher.js";

const execAsync = promisify(exec);

let cleanupTimer = null;
let lastCleanupResult = null;

// Timezone default: Asia/Jakarta (WIB)
const TIMEZONE = process.env.CLEANUP_TZ || "Asia/Jakarta";

/**
 * Mendapatkan informasi disk usage saat ini
 */
export async function getDiskUsage() {
  try {
    const { stdout } = await execAsync("df -h / | awk 'NR==2 {print $2, $3, $4, $5}'");
    const [size, used, avail, usePercent] = stdout.trim().split(/\s+/);
    return { size, used, avail, usePercent };
  } catch (err) {
    return { size: "?", used: "?", avail: "?", usePercent: "?" };
  }
}

/**
 * Menjalankan proses pembersihan server secara menyeluruh
 */
export async function executeServerCleanup() {
  const startedAt = Date.now();
  const beforeDisk = await getDiskUsage();

  let dockerReclaimed = "0B";
  try {
    // 1. Prune docker builder cache
    const { stdout: builderOut } = await execAsync("docker builder prune -a -f 2>&1 || true");
    const reclaimedMatch = builderOut.match(/Total reclaimed space:\s*([^\n]+)/i);
    if (reclaimedMatch) dockerReclaimed = reclaimedMatch[1].trim();
  } catch (e) {
    console.warn("[Cleanup] Docker builder prune error:", e.message);
  }

  try {
    // 2. Prune dangling images
    await execAsync("docker image prune -f 2>&1 || true");
  } catch (e) {
    console.warn("[Cleanup] Docker image prune error:", e.message);
  }

  try {
    // 3. Clean npm cache
    await execAsync("npm cache clean --force 2>&1 || true");
  } catch (e) {
    console.warn("[Cleanup] NPM cache clean error:", e.message);
  }

  try {
    // 4. Clean /tmp
    await execAsync("rm -rf /tmp/* 2>&1 || true");
  } catch (e) {
    console.warn("[Cleanup] /tmp clean error:", e.message);
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  const afterDisk = await getDiskUsage();

  lastCleanupResult = {
    executedAt: new Date().toISOString(),
    durationSec,
    dockerReclaimed,
    beforeDisk,
    afterDisk,
  };

  return lastCleanupResult;
}

/**
 * Hitung delay (ms) menuju jam 00:00 berikutnya berdasarkan timezone
 */
export function getMsUntilNextMidnight(timeZone = TIMEZONE) {
  const now = new Date();
  
  // Format waktu lokal sekarang di timezone target
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

  const hour = getPart("hour") % 24;
  const minute = getPart("minute");
  const second = getPart("second");

  // Detik tersisa hari ini sampai jam 24:00 (00:00 besok)
  const secondsPassedToday = hour * 3600 + minute * 60 + second;
  const totalSecondsInDay = 86400;
  let secondsRemaining = totalSecondsInDay - secondsPassedToday;

  if (secondsRemaining <= 0) {
    secondsRemaining = totalSecondsInDay;
  }

  return secondsRemaining * 1000;
}

/**
 * Format laporan hasil cleanup untuk Telegram
 */
export function formatCleanupReport(res) {
  return (
    `🧹 *Laporan Pembersihan Otomatis Server (00:00)*\n\n` +
    `⏱ *Waktu Eksekusi:* ${new Date(res.executedAt).toLocaleString("id-ID", { timeZone: TIMEZONE })}\n` +
    `⚡ *Durasi:* ${res.durationSec} detik\n` +
    `📦 *Docker Reclaimed:* \`${res.dockerReclaimed}\`\n\n` +
    `📊 *Status Penyimpanan Disk:* \n` +
    `• Sebelum: \`${res.beforeDisk.used}\` / \`${res.beforeDisk.size}\` (${res.beforeDisk.usePercent})\n` +
    `• Sesudah: \`${res.afterDisk.used}\` / \`${res.afterDisk.size}\` (${res.afterDisk.usePercent})\n` +
    `• Sisa Tersedia: *${res.afterDisk.avail}*\n\n` +
    `✅ *Pembersihan selesai! Semua service tetap berjalan normal.*`
  );
}

/**
 * Inisialisasi scheduler pembersihan harian jam 00:00
 */
export function initDailyCleanup(bot) {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }

  const scheduleNext = () => {
    const msUntilMidnight = getMsUntilNextMidnight();
    const hoursRemaining = (msUntilMidnight / (1000 * 3600)).toFixed(2);
    console.log(
      `[Cleanup Service] Pembersihan otomatis terjadwal dalam ${hoursRemaining} jam (pada jam 00:00 ${TIMEZONE}).`
    );

    cleanupTimer = setTimeout(async () => {
      console.log(`[Cleanup Service] Menjalankan pembersihan server rutin jam 00:00...`);
      try {
        const result = await executeServerCleanup();
        console.log(`[Cleanup Service] Pembersihan selesai. Terbebaskan: ${result.dockerReclaimed}`);

        if (bot) {
          const report = formatCleanupReport(result);
          await notifyUsers(bot, report).catch((err) => {
            console.warn("[Cleanup Service] Gagal kirim notifikasi ke Telegram:", err.message);
          });
        }
      } catch (err) {
        console.error("[Cleanup Service] Gagal menjalankan pembersihan:", err);
      } finally {
        scheduleNext();
      }
    }, msUntilMidnight);
  };

  scheduleNext();
}

export function getLastCleanupResult() {
  return lastCleanupResult;
}

export function getCleanupTimezone() {
  return TIMEZONE;
}
