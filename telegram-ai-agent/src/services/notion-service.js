import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";
import { truncate } from "./telegram-files.js";

const NOTION_CONFIG_PATH = path.join(DATA_DIR, "notion-config.json");
const NOTION_API_VERSION = "2022-06-28";

// Default konfigurasi pemetaan proyek ke Database ID Notion
const DEFAULT_CONFIG = {
  enabled: true,
  checkIntervalMinutes: 3,
  projects: {
    "ai-podcast-live": "402d2258-979b-808f-89fa-db448a5c1bb2",
  },
};

export async function getNotionConfig() {
  try {
    const raw = await readFile(NOTION_CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    await saveNotionConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveNotionConfig(config) {
  try {
    await mkdir(path.dirname(NOTION_CONFIG_PATH), { recursive: true });
    await writeFile(NOTION_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("[Notion] Gagal simpan config:", err.message);
    return false;
  }
}

export function getNotionApiKey() {
  return process.env.NOTION_API_KEY || "";
}

// Helper fetch Notion REST API
async function callNotionApi(endpoint, method = "GET", body = null) {
  const token = getNotionApiKey();
  if (!token) throw new Error("NOTION_API_KEY belum dikonfigurasi.");

  const url = `https://api.notion.com/v1${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Notion API Error (${res.status})`);
  }
  return data;
}

// Ambil isi teks di dalam halaman Notion (children blocks)
export async function fetchPageContentText(pageId) {
  try {
    const data = await callNotionApi(`/blocks/${pageId}/children?page_size=50`);
    if (!data.results) return "";

    const lines = [];
    for (const block of data.results) {
      const type = block.type;
      const contentObj = block[type];
      if (contentObj?.rich_text) {
        const text = contentObj.rich_text.map((t) => t.plain_text).join("").trim();
        if (text) lines.push(text);
      }
    }
    return lines.join("\n");
  } catch (err) {
    console.warn(`[Notion] Gagal baca isi page ${pageId}:`, err.message);
    return "";
  }
}

// Ambil semua task dengan status "TODO" dari semua project yang terdaftar
export async function fetchPendingTasks() {
  const config = await getNotionConfig();
  if (!config.enabled || !config.projects) return [];

  const pendingTasks = [];

  for (const [projectName, dbId] of Object.entries(config.projects)) {
    if (!dbId) continue;
    try {
      const queryRes = await callNotionApi(`/databases/${dbId}/query`, "POST", {
        filter: {
          property: "Status",
          status: {
            equals: "TODO",
          },
        },
        page_size: 10,
      });

      if (!queryRes.results) continue;

      for (const page of queryRes.results) {
        const pageId = page.id;
        // Deteksi property title (bisa 'Project name', 'Name', atau 'title')
        let title = "Untitled Task";
        for (const prop of Object.values(page.properties || {})) {
          if (prop.type === "title" && prop.title?.[0]?.plain_text) {
            title = prop.title.map((t) => t.plain_text).join("").trim();
            break;
          }
        }

        // Ambil detail konten dari dalam page jika ada
        const details = await fetchPageContentText(pageId);

        pendingTasks.push({
          pageId,
          dbId,
          projectName,
          title,
          details,
          priority: page.properties?.Priority?.select?.name || "Medium",
          url: page.url,
        });
      }
    } catch (err) {
      console.warn(`[Notion] Gagal query database ${projectName} (${dbId}):`, err.message);
    }
  }

  return pendingTasks;
}

// Update status task di Notion
export async function updateTaskStatus(pageId, status, reportText = null) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const updatePayload = {
      properties: {
        Status: {
          status: { name: status },
        },
      },
    };

    if (status === "In progress") {
      updatePayload.properties["Start date"] = {
        date: { start: today },
      };
    } else if (status === "Done") {
      updatePayload.properties["End date"] = {
        date: { start: today },
      };
    }

    await callNotionApi(`/pages/${pageId}`, "PATCH", updatePayload);

    // Jika ada laporan hasil eksekusi, tambahkan sebagai blok ke dalam page
    if (reportText) {
      await callNotionApi(`/blocks/${pageId}/children`, "PATCH", {
        children: [
          {
            object: "block",
            type: "divider",
            divider: {},
          },
          {
            object: "block",
            type: "heading_2",
            heading_2: {
              rich_text: [{ type: "text", text: { content: "🤖 Laporan Hasil Eksekusi TH Agent" } }],
            },
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: truncate(reportText, 1800) },
                },
              ],
            },
          },
        ],
      });
    }

    return true;
  } catch (err) {
    console.error(`[Notion] Gagal update task ${pageId} ke '${status}':`, err.message);
    return false;
  }
}
