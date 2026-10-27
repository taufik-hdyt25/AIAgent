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
let dockerWarned = false;
const alertCooldowns = new Map(); // containerName -> timestamp

// Daftar container default awal jika ada di server VPS
const DEFAULT_TARGET_CONTAINERS = [
  "ai-podcast-live",
  "wa-dashboard",
  "wa-bot",
  "th-blogs-app",
  "th-blogs-db",
];

/**
 * Dapatkan daftar semua container Docker di host secara realtime
 */
export async function getDockerContainers() {
  try {
    const { stdout } = await execAsync(
      "docker ps -a --format '{{.Names}}|{{.Status}}|{{.State}}' 2>&1"
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    const containers = [];
    for (const line of lines) {
      const [name, statusStr, state] = line.split("|");
      if (name) {
        const cleanName = name.trim();
        const cleanStatus = (statusStr || "").trim();
        const cleanState = (state || "").trim().toLowerCase();
        containers.push({
          name: cleanName,
          status: cleanStatus,
          state: cleanState,
          running: cleanState === "running",
        });
      }
    }
    return { available: true, containers };
  } catch (err) {
    return { available: false, error: err.message, containers: [] };
  }
}

/**
 * Muat konfigurasi Sentry
 */
export async function getSentryConfig() {
  if (sentryConfigCache) return sentryConfigCache;
  try {
    const raw = await readFile(SENTRY_CONFIG_FILE, "utf8");
    sentryConfigCache = JSON.parse(raw);
    if (!Array.isArray(sentryConfigCache.targetContainers)) {
      sentryConfigCache.targetContainers = DEFAULT_TARGET_CONTAINERS;
    }
  } catch {
    // Deteksi container yang sebenarnya ada di host
    const dockerInfo = await getDockerContainers().catch(() => ({ available: false, containers: [] }));
    const initialTargets = dockerInfo.available && dockerInfo.containers.length > 0
      ? dockerInfo.containers.map((c) => c.name).filter((n) => n !== "telegram-coding-agent")
      : DEFAULT_TARGET_CONTAINERS;

    sentryConfigCache = {
      enabled: true,
      autoHeal: true,
      checkIntervalMinutes: 5,
      diskThresholdPercent: 88,
      targetContainers: initialTargets,
      lastCheck: null,
      lastAlert: null,
      incidentCount: 0,
    };
  }
  return sentryConfigCache;
}

/**
 * Tambah container ke daftar pantauan
 */
export async function addWatchedContainer(containerName) {
  const config = await getSentryConfig();
  const clean = containerName.trim();
  const list = config.targetContainers || [];
  if (!list.includes(clean)) {
    list.push(clean);
    await saveSentryConfig({ targetContainers: list });
  }
  return list;
}

/**
 * Hapus container dari daftar pantauan
 */
export async function removeWatchedContainer(containerName) {
  const config = await getSentryConfig();
  const clean = containerName.trim();
  const list = (config.targetContainers || []).filter((c) => c !== clean);
  await saveSentryConfig({ targetContainers: list });
  return list;
}

/**
 * Atur seluruh daftar container yang dipantau sekaligus
 */
export async function setWatchedContainers(containers) {
  const cleanList = Array.isArray(containers)
    ? containers.map((c) => String(c).trim()).filter(Boolean)
    : [];
  await saveSentryConfig({ targetContainers: cleanList });
  return cleanList;
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
  let dockerAvailable = true;
  let dockerError = null;

  // 1. Audit status container Docker
  try {
    const { stdout } = await execAsync(
      "docker ps -a --format '{{.Names}}|{{.Status}}|{{.State}}' 2>&1"
    );
    dockerWarned = false; // Reset jika Docker aktif kembali
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
    const monitored = config.targetContainers || [];
    for (const target of monitored) {
      const info = containerMap.get(target);

      if (!info) {
        // Container tidak terdaftar sama sekali di host docker ini
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
    dockerAvailable = false;
    dockerError = err.message;
    if (!dockerWarned) {
      console.log("[Server Sentry] Docker tidak terdeteksi (Mode Lokal): Container monitoring dinonaktifkan.");
      dockerWarned = true;
    }
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
    dockerAvailable,
    dockerError,
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

  if (healthResult && healthResult.dockerAvailable === false) {
    msg += `💻 *Mode Lokal Terdeteksi:*\n`;
    msg += `• Docker daemon tidak terdeteksi di mesin lokal ini.\n`;
    msg += `• Layanan monitoring kontainer otomatis dinonaktifkan di mode lokal dan hanya aktif saat bot di-deploy ke server VPS.\n`;
  } else {
    msg += `📦 *Container yang Dipantau:*\n`;
    const list = config.targetContainers || [];
    if (list.length === 0) {
      msg += `_Belum ada kontainer yang dipantau. Gunakan \`/sentry watch <nama>\` atau atur lewat Web Dashboard._\n`;
    } else {
      for (const c of list) {
        msg += `• \`${c}\`\n`;
      }
    }
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
  msg += `• \`/sentry watch <nama>\` - Tambah kontainer ke pantauan\n`;
  msg += `• \`/sentry unwatch <nama>\` - Hapus kontainer dari pantauan\n`;
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
