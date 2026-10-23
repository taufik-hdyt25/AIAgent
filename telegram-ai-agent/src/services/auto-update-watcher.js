import { createHmac, timingSafeEqual } from "node:crypto";
import { checkForUpdates, applyAutoUpdate } from "./update-service.js";
import { notifyUsers } from "./github-watcher.js";

let fallbackInterval = null;
let botInstance = null;

// Default fallback interval: 60 menit (super ringan, hanya git fetch refs ~1-2 KB)
const FALLBACK_POLL_MINUTES = Number(process.env.AUTO_UPDATE_POLL_MINUTES || 60);

/**
 * Verifikasi signature webhook GitHub (HMAC SHA-256)
 * Jika GITHUB_WEBHOOK_SECRET tidak diset, skip verifikasi (tapi beri warning log)
 */
export function verifyGithubSignature(payload, signatureHeader) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[Auto-Update] GITHUB_WEBHOOK_SECRET belum diisi. Webhook diterima tanpa verifikasi signature.");
    return true;
  }

  if (!signatureHeader) return false;

  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const digest = `sha256=${hmac.digest("hex")}`;

  const sigBuffer = Buffer.from(signatureHeader);
  const digestBuffer = Buffer.from(digest);

  if (sigBuffer.length !== digestBuffer.length) return false;
  return timingSafeEqual(sigBuffer, digestBuffer);
}

/**
 * Handler untuk GitHub Webhook event
 * Dipanggil dari web-server.js ketika endpoint /webhook/update menerima request
 */
export async function handleWebhookPush(body, headers) {
  const event = headers["x-github-event"];
  const signature = headers["x-hub-signature-256"] || "";

  // 1. Tanggapi ping event dari GitHub saat webhook pertama kali dihubungkan
  if (event === "ping") {
    console.log("[Auto-Update] 🏓 GitHub Webhook ping diterima! Webhook terhubung dengan sukses.");
    return { ok: true, ping: "pong" };
  }

  // 2. Hanya proses push event
  if (event !== "push") {
    return { ok: true, skipped: true, reason: `Event '${event}' diabaikan (hanya event push yang diproses).` };
  }

  // 3. Verifikasi signature HMAC SHA-256
  if (!verifyGithubSignature(body, signature)) {
    return { ok: false, error: "Signature webhook tidak valid." };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, error: "Payload JSON tidak valid." };
  }

  // 4. Hanya proses push ke branch main atau master
  const ref = payload.ref || "";
  const branch = ref.replace("refs/heads/", "");
  if (branch !== "main" && branch !== "master") {
    return { ok: true, skipped: true, reason: `Push ke branch '${branch}' diabaikan (hanya main/master).` };
  }

  const pusher = payload.pusher?.name || "unknown";
  const commitCount = payload.commits?.length || 0;
  const headCommit = payload.head_commit?.message || "No message";

  console.log(`[Auto-Update] 🔔 Webhook push diterima! Branch: ${branch}, Pusher: ${pusher}, Commits: ${commitCount}`);
  console.log(`[Auto-Update] Head commit: ${headCommit.split("\n")[0]}`);

  // 5. Beri info awal ke user Telegram
  if (botInstance) {
    const notifMsg =
      `🔔 *Auto-Update: Push GitHub Terdeteksi!*\n\n` +
      `📦 *Branch:* \`${branch}\`\n` +
      `👤 *Pusher:* ${pusher}\n` +
      `📝 *Commit:* _${headCommit.split("\n")[0]}_\n` +
      `🔢 *Jumlah:* ${commitCount} commit\n\n` +
      `⏳ *Mengunduh dan menerapkan pembaruan secara otomatis...*`;

    await notifyUsers(botInstance, notifMsg).catch(() => {});
  }

  // 6. Jalankan update otomatis
  try {
    const res = await applyAutoUpdate("webhook", botInstance);
    return { ok: true, updated: res.updated, branch, pusher, commitCount };
  } catch (err) {
    console.error("[Auto-Update] Gagal:", err.message);
    if (botInstance) {
      await notifyUsers(botInstance, `❌ *Auto-Update Gagal:* ${err.message}`).catch(() => {});
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Inisialisasi Auto-Update Watcher
 * - Menjalankan fallback polling tiap 60 menit (super hemat resource)
 * - Mendaftarkan instance bot untuk notifikasi Telegram
 */
export function initAutoUpdateWatcher(bot) {
  botInstance = bot;

  if (process.env.AUTO_UPDATE_ENABLED === "false") {
    console.log("[Auto-Update] Watcher dinonaktifkan via AUTO_UPDATE_ENABLED=false.");
    return;
  }

  if (fallbackInterval) {
    clearInterval(fallbackInterval);
  }

  const intervalMs = FALLBACK_POLL_MINUTES * 60 * 1000;

  console.log(
    `[Auto-Update] Watcher aktif! Webhook: /webhook/update | Fallback polling: setiap ${FALLBACK_POLL_MINUTES} menit.`
  );

  // Fallback polling sebagai safety net
  fallbackInterval = setInterval(async () => {
    try {
      const check = await checkForUpdates();
      if (check.hasUpdate) {
        console.log(`[Auto-Update] Fallback polling menemukan update: ${check.currentCommit} → ${check.latestCommit}`);
        await applyAutoUpdate("polling", botInstance);
      }
    } catch (err) {
      console.warn("[Auto-Update] Fallback polling error (diabaikan):", err.message);
    }
  }, intervalMs);

  fallbackInterval.unref?.();
}
