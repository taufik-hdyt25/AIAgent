import fs from "node:fs";

const TH_BLOG_ENV = "/home/th-agent/projects/th-blog/.env";
const TH_BLOG_URL = (process.env.TH_BLOG_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const INTERVAL_MS = 15 * 60 * 1000;
let blogTimer = null;

function readCronSecret() {
  if (process.env.TH_BLOG_CRON_SECRET) return process.env.TH_BLOG_CRON_SECRET.trim();
  try {
    const raw = fs.readFileSync(TH_BLOG_ENV, "utf8");
    const m = raw.match(/^CRON_SECRET=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

export async function runThBlogAutoPost({ bot = null, manual = false } = {}) {
  const secret = readCronSecret();
  if (!secret) {
    return { ok: false, error: "CRON_SECRET th-blog tidak ditemukan" };
  }

  if (manual) {
    console.log(`[SpecialistRouter] role=writer model=th-blog-autopost`);
  }

  try {
    const res = await fetch(`${TH_BLOG_URL}/api/cron/auto-post`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error || `HTTP ${res.status}`;
      console.error(`[ThBlogAutoPost] Gagal: ${errMsg}`);
      return { ok: false, status: res.status, error: errMsg };
    }

    const skipped = data?.status === "skipped";
    if (!skipped) {
      if (!manual) {
        console.log(`[SpecialistRouter] role=writer model=th-blog-autopost`);
      }
      console.log(`[th-admin-integration] task=th-blog-autopost status=${data?.status || "ok"}`);
      console.log(`[Agent] Dispatch selesai th-blog-autopost`);

      if (bot) {
        const targetId = String(process.env.ALLOWED_TELEGRAM_IDS || "").split(",")[0]?.trim();
        if (targetId) {
          const title = data?.post?.title || data?.title || "Artikel baru";
          const slug = data?.post?.slug || data?.slug || "";
          const url = slug ? `https://thblog.web.id/posts/${slug}` : "https://thblog.web.id";
          const msg = `📝 *TH Blog Auto-Post Diterbitkan*\n\n• *Judul:* ${title}\n• *Status:* ${data?.status || "published"}\n• *Link:* ${url}`;
          await bot.api.sendMessage(targetId, msg, { parse_mode: "Markdown" }).catch(async () => {
            await bot.api.sendMessage(targetId, msg).catch(() => {});
          });
        }
      }
    } else if (manual) {
      console.log(`[Agent] Dispatch selesai th-blog-autopost-skipped`);
    }

    return { ok: true, ...data };
  } catch (err) {
    const errMsg = err?.message || "Gagal menghubungi th-blog";
    console.error(`[ThBlogAutoPost] Error: ${errMsg}`);
    return { ok: false, error: errMsg };
  }
}

export function initThBlogAutoPost(bot) {
  if (blogTimer) clearInterval(blogTimer);
  setTimeout(() => {
    runThBlogAutoPost({ bot, manual: false }).catch(() => {});
  }, 12_000);
  blogTimer = setInterval(() => {
    runThBlogAutoPost({ bot, manual: false }).catch(() => {});
  }, INTERVAL_MS);
  console.log("[ThBlogAutoPost] Aktif (cek jadwal auto-post th-blog tiap 15 menit).");
}
