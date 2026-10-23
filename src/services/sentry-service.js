import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR } from "../config/env.js";
import { notifyUsers } from "./github-watcher.js";
import { executeServerCleanup, getDiskUsage } from "./cleanup-service.js";
import { truncate } from "./telegram-files.js";

const execAsync = promisify(exec);
const SENTRY_CONFIG_FILE = path.join(DATA_DIR, "sentry_config.json");

let sentryInterval = null;
let sentryConfigCache = null;
const alertCooldowns = new Map(); // containerName -> timestamp

// Daftar container utama yang dipantau kesehatannya 24/7
const DEFAULT_TARGET_CONTAINERS = [
  "ai-podcast-live",
  "wa-dashboard",
  "wa-bot",
  "th-blogs-app",
  "th-blogs-db",
];

/**
 * Muat konfigurasi Sentry
 */
export async function getSentryConfig() {
  if (sentryConfigCache) return sentryConfigCache;
  try {
    const raw = await readFile(SENTRY_CONFIG_FILE, "utf8");
    sentryConfigCache = JSON.parse(raw);
  } catch {
    sentryConfigCache = {
      enabled: true,
      autoHeal: true,
      checkIntervalMinutes: 5,
      diskThresholdPercent: 88,
      targetContainers: DEFAULT_TARGET_CONTAINERS,
      lastCheck: null,
      lastAlert: null,
      incidentCount: 0,
    };
  }
  return sentryConfigCache;
}

/**
 * Simpan konfigurasi Sentry
 */
export async function saveSentryConfig(newConfig) {
  const current = await getSentryConfig();
  sentryConfigCache = { ...current, ...newConfig };
  await writeFile(SENTRY_CONFIG_FILE, JSON.stringify(sentryConfigCache, null, 2), "utf8");
  return sentryConfigCache;
}

/**
 * Toggle Sentry On/Off
 */
export async function toggleSentry(enabled) {
  return await saveSentryConfig({ enabled });
}

/**
 * Toggle Auto-Healing On/Off
 */
export async function toggleAutoHeal(autoHeal) {
  return await saveSentryConfig({ autoHeal });
}

/**
 * Melakukan pengecekan kesehatan server & container (Manual atau Rutin)
 */
export async function checkServerHealth(bot = null, isManual = false) {
  const config = await getSentryConfig();
  if (!config.enabled && !isManual) return null;

  const now = Date.now();
  const incidents = [];

  // 1. Audit status container Docker
  try {
    const { stdout } = await execAsync(
      "docker ps -a --format '{{.Names}}|{{.Status}}|{{.State}}' 2>&1"
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    const containerMap = new Map();

    for (const line of lines) {
      const [name, statusStr, state] = line.split("|");
      if (name) {
        containerMap.set(name.trim(), {
          name: name.trim(),
          status: (statusStr || "").trim(),
          state: (state || "").trim().toLowerCase(),
        });
      }
    }

    // Periksa target containers
    const monitored = config.targetContainers || DEFAULT_TARGET_CONTAINERS;
    for (const target of monitored) {
      const info = containerMap.get(target);

      if (!info) {
        // Container tidak terdaftar sama sekali
        continue;
      }

      const isHealthy = info.state === "running";
      const isExited = info.state === "exited" || info.state === "dead" || info.status.toLowerCase().includes("exited");

      if (isExited || !isHealthy) {
        // Cek cooldown alert (15 menit per container)
        const lastAlert = alertCooldowns.get(target) || 0;
        const cooldownMs = 15 * 60 * 1000;

        if (isManual || now - lastAlert > cooldownMs) {
          alertCooldowns.set(target, now);

          let autoHealSuccess = false;
          let healLog = "";

          // Ambil log error sebelum di-restart
          try {
            const { stdout: logOut } = await execAsync(`docker logs --tail 15 ${target} 2>&1`);
            healLog = logOut.trim();
          } catch (_) {}

          // Eksekusi Auto-Healing jika diaktifkan
          if (config.autoHeal) {
            try {
              console.log(`[Server Sentry] Mendeteksi ${target} ${info.status}. Melakukan Auto-Healing restart...`);
              await execAsync(`docker restart ${target}`);
              // Beri jeda 3 detik untuk inisialisasi
              await new Promise((r) => setTimeout(r, 3000));

              const { stdout: verifyOut } = await execAsync(`docker inspect ${target} --format '{{.State.Status}}' 2>&1`);
              if (verifyOut.trim().toLowerCase() === "running") {
                autoHealSuccess = true;
              }
            } catch (healErr) {
              console.error(`[Server Sentry] Gagal auto-heal ${target}:`, healErr.message);
            }
          }

          incidents.push({
            type: "container_down",
            target,
            previousStatus: info.status,
            autoHealed: autoHealSuccess,
            logSnippet: healLog,
          });
        }
      }
    }
  } catch (err) {
    console.warn("[Server Sentry] Gagal memeriksa status docker:", err.message);
  }

  // 2. Audit kapasitas disk
  let diskIncident = null;
  try {
    const disk = await getDiskUsage();
    const percentNum = parseInt(disk.usePercent?.replace("%", "") || "0", 10);
    const threshold = config.diskThresholdPercent || 88;

    if (percentNum >= threshold) {
      const lastDiskAlert = alertCooldowns.get("__disk__") || 0;
      if (isManual || now - lastDiskAlert > 30 * 60 * 1000) {
        alertCooldowns.set("__disk__", now);
        let cleanupReport = null;

        if (config.autoHeal) {
          try {
            console.log(`[Server Sentry] Disk mencapai ${percentNum}%. Menjalankan pembersihan darurat...`);
            cleanupReport = await executeServerCleanup();
          } catch (_) {}
        }

        diskIncident = {
          type: "disk_critical",
          usedPercent: percentNum,
          disk,
          cleanupReport,
        };
      }
    }
  } catch (_) {}

  // Simpan record pengecekan
  await saveSentryConfig({
    lastCheck: new Date().toISOString(),
    incidentCount: (config.incidentCount || 0) + incidents.length + (diskIncident ? 1 : 0),
  });

  // Kirim notifikasi Telegram jika ada insiden
  if (bot && (incidents.length > 0 || diskIncident)) {
    for (const inc of incidents) {
      let alertMsg = `🚨 *[SERVER SENTRY ALERT] Container Crash Terdeteksi!*\n\n`;
      alertMsg += `• Container: \`${inc.target}\`\n`;
      alertMsg += `• Status: \`${inc.previousStatus}\`\n`;

      if (inc.autoHealed) {
        alertMsg += `• 🩺 *Auto-Healing:* Berhasil di-restart dan kembali aktif (UP)! ✅\n`;
      } else {
        alertMsg += `• ⚠️ *Auto-Healing:* Gagal memulihkan container secara otomatis.\n`;
      }

      if (inc.logSnippet) {
        alertMsg += `\n*Log Error Terakhir:*\n\`\`\`\n${truncate(inc.logSnippet, 600)}\n\`\`\`\n`;
      }

      alertMsg += `💡 _Sentry memantau kesehatan server 24/7._`;
      await notifyUsers(bot, alertMsg).catch(() => {});
    }

    if (diskIncident) {
      let diskMsg = `⚠️ *[SERVER SENTRY ALERT] Disk Mendekati Penuh (${diskIncident.usedPercent}%)!*\n\n`;
      diskMsg += `• Kapasitas Terpakai: \`${diskIncident.disk.used}\` / \`${diskIncident.disk.size}\`\n`;
      diskMsg += `• Sisa Bebas: \`${diskIncident.disk.avail}\`\n`;

      if (diskIncident.cleanupReport) {
        diskMsg += `\n🩺 *Auto-Healing:* Pembersihan darurat berhasil membebaskan \`${diskIncident.cleanupReport.dockerReclaimed}\`!\n`;
        diskMsg += `• Kapasitas Setelah Bersih: \`${diskIncident.cleanupReport.afterDisk.usePercent}\` (${diskIncident.cleanupReport.afterDisk.avail} Free) ✅\n`;
      }

      await notifyUsers(bot, diskMsg).catch(() => {});
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    incidents,
    diskIncident,
    healthy: incidents.length === 0 && !diskIncident,
  };
}

/**
 * Format laporan status sentry untuk dibaca di Telegram
 */
export function formatSentryStatus(config, healthResult = null) {
  const isEnabled = config.enabled;
  const isAutoHeal = config.autoHeal;

  let msg = `🩺 *Server Sentry & Proactive Auto-Healing*\n\n`;
  msg += `• Status Monitor: ${isEnabled ? "🟢 *Aktif (24/7)*" : "🔴 *Non-aktif*"}\n`;
  msg += `• Auto-Healing: ${isAutoHeal ? "✅ *Aktif (Auto-restart jika crash)*" : "❌ *Non-aktif*"}\n`;
  msg += `• Interval Check: *Setiap ${config.checkIntervalMinutes || 5} menit*\n`;
  msg += `• Ambang Batas Disk: *${config.diskThresholdPercent || 88}%*\n`;
  msg += `• Total Insiden Tertangani: *${config.incidentCount || 0} kejadian*\n\n`;

  msg += `📦 *Container yang Dipantau:*\n`;
  for (const c of config.targetContainers || DEFAULT_TARGET_CONTAINERS) {
    msg += `• \`${c}\`\n`;
  }

  if (config.lastCheck) {
    msg += `\n⏱ *Pengecekan Terakhir:* ${new Date(config.lastCheck).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\n`;
  }

  if (healthResult) {
    msg += `\n📊 *Hasil Pemeriksaan Terkini:*\n`;
    if (healthResult.healthy) {
      msg += `✅ *Semua container & disk dalam kondisi 100% prima dan sehat!*`;
    } else {
      msg += `⚠️ Ditemukan ${healthResult.incidents.length} anomali (sudah ditangani).`;
    }
  }

  msg += `\n\n💡 *Perintah Sentry:*\n`;
  msg += `• \`/sentry check\` - Jalankan health check sekarang\n`;
  msg += `• \`/sentry on\` / \`/sentry off\` - Toggle monitor sentry\n`;
  msg += `• \`/sentry autoheal [on|off]\` - Toggle auto-restart container`;

  return msg;
}

/**
 * Inisialisasi scheduler sentry di background (setiap 5 menit)
 */
export function initServerSentry(bot) {
  if (sentryInterval) {
    clearInterval(sentryInterval);
    sentryInterval = null;
  }

  console.log("[Server Sentry] Memulai pengawas kesehatan server proaktif (interval 5 menit)...");

  // Jalankan healthcheck pertama setelah 1 menit bot menyala
  setTimeout(() => {
    checkServerHealth(bot).catch((err) =>
      console.warn("[Server Sentry] Initial check warning:", err.message)
    );
  }, 60 * 1000);

  // Jadwalkan interval rutin setiap 5 menit
  sentryInterval = setInterval(() => {
    checkServerHealth(bot).catch((err) =>
      console.warn("[Server Sentry] Periodic check error:", err.message)
    );
  }, 5 * 60 * 1000);
}
