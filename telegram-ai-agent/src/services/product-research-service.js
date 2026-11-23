import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

let fetchOverride = null;
export function setProductResearchFetchForTests(fetcher) { fetchOverride = fetcher; }

function getStorePath() { return process.env.PRODUCT_RESEARCH_STORE || path.join(os.homedir(), ".th-agent", "data", "product-research.json"); }
const PLAY = "https://play.google.com/store";
const MAX_RESULTS = 20;

function clean(value, max = 500) { return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function esc(value) { return String(value).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function appIdFromUrl(value) { try { return new URL(value).searchParams.get("id"); } catch { return null; } }
function canonicalUrl(id, country, language) { return `${PLAY}/apps/details?id=${encodeURIComponent(id)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}`; }

async function fetchText(url) {
  if (fetchOverride) {
    const response = await fetchOverride(url);
    if (!response.ok) throw Object.assign(new Error(`Google Play returned HTTP ${response.status}`), { status: response.status });
    return response.text();
  }
  try {
    const output = execFileSync("curl", ["-sS", "-L", "-w", "\\nSTATUS:%{http_code}", "--max-time", "20", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", "-H", "Accept-Language: en-US,en;q=0.9", "-H", "Referer: https://play.google.com/", url], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 22000, stdio: ["ignore", "pipe", "ignore"] });
    const marker = output.lastIndexOf("\nSTATUS:");
    const status = Number(output.slice(marker + 8).trim());
    if (status < 200 || status >= 300) throw Object.assign(new Error(`Google Play request failed (HTTP ${status})`), { status });
    return output.slice(0, marker);
  } catch (error) {
    if (error.status) throw error;
    const status = Number(String(error.stderr || "").match(/HTTP\/(?:1\.1|2)\s+(\d{3})/i)?.[1]) || 503;
    throw Object.assign(new Error(`Google Play request failed (HTTP ${status})`), { status });
  }
}
function parseLd(html) {
  const matches = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) { try { const parsed = JSON.parse(match[1]); const items = Array.isArray(parsed) ? parsed : [parsed]; const found = items.find((item) => item["@type"] === "SoftwareApplication" || item["@type"] === "MobileApplication"); if (found) return found; } catch {} }
  return null;
}
function parseDetail(html, id, country, language) {
  const ld = parseLd(html);
  const meta = (key) => clean(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1] || "", 12000);
  const metaContent = (key) => clean(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1] || "", 12000);
  const title = clean(ld?.name || metaContent("og:title").replace(/\s*-\s*Apps on Google Play.*$/i, ""), 300);
  const description = clean(ld?.description || metaContent("og:description"), 5000);
  const rating = Number(ld?.aggregateRating?.ratingValue || html.match(/"ratingValue"\s*:\s*"?([\d.]+)/)?.[1] || 0) || null;
  const reviewCount = Number(ld?.aggregateRating?.ratingCount || ld?.aggregateRating?.reviewCount || html.match(/"ratingCount"\s*:\s*"?(\d+)/)?.[1] || 0) || null;
  const category = clean((Array.isArray(ld?.applicationCategory) ? ld.applicationCategory[0] : ld?.applicationCategory) || "", 120);
  const installs = clean(ld?.offers?.[0]?.description || "", 100);
  return { id, title, developer: clean(ld?.author?.name || (typeof ld?.author === "string" ? ld.author : ""), 200), description, category, rating, reviewCount, installs: installs || null, installsIsEstimate: Boolean(installs), icon: clean(ld?.image || metaContent("og:image"), 1000), url: canonicalUrl(id, country, language), source: "Google Play listing", retrievedAt: new Date().toISOString() };
}

export async function searchPlay({ query, country = "us", language = "en", limit = 10 }) {
  const q = clean(query, 300); if (!q) throw new Error("query is required");
  country = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : "us";
  language = /^[a-z]{2}(-[a-z]{2})?$/i.test(language) ? language.toLowerCase() : "en";
  const searchUrl = `${PLAY}/store/search?q=${encodeURIComponent(q)}&c=apps&gl=${country}&hl=${language}`;
  let html;
  try { html = await fetchText(searchUrl); }
  catch (error) {
    if (error.status === 404) throw Object.assign(new Error("Google Play search is unavailable from this network; use a Play Store URL or app ID instead"), { code: "PLAY_SEARCH_UNAVAILABLE" });
    throw error;
  }
  const ids = [...new Set([...html.matchAll(/href=["'](?:https:\/\/play\.google\.com)?\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g)].map((m) => m[1]))].slice(0, Math.min(Math.max(Number(limit) || 10, 1), MAX_RESULTS));
  const results = await Promise.all(ids.map(async (id) => { try { return parseDetail(await fetchText(canonicalUrl(id, country, language)), id, country, language); } catch { return { id, title: id, url: canonicalUrl(id, country, language), source: "Google Play listing", retrievedAt: new Date().toISOString(), detailUnavailable: true }; } }));
  return results;
}

export async function getPlayApp({ url, appId, country = "us", language = "en" }) {
  const id = appId || appIdFromUrl(url || ""); if (!id) throw new Error("Provide a valid Google Play URL or appId");
  country = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : "us";
  language = /^[a-z]{2}(-[a-z]{2})?$/i.test(language) ? language.toLowerCase() : "en";
  try { return parseDetail(await fetchText(canonicalUrl(id, country, language)), id, country, language); }
  catch (error) {
    if (error.status === 404) throw Object.assign(new Error("Google Play listing is unavailable in the selected country/language"), { code: "PLAY_LISTING_UNAVAILABLE" });
    throw error;
  }
}
async function loadStore() { const storePath = getStorePath(); try { const data = JSON.parse(await fs.readFile(storePath, "utf8")); return Array.isArray(data.items) ? data : { items: [] }; } catch { return { items: [] }; } }
async function saveStore(data) { const storePath = getStorePath(); await fs.mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 }); const tmp = `${storePath}.${process.pid}.tmp`; await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); await fs.rename(tmp, storePath); }
export async function listResearch() { return (await loadStore()).items; }
export async function saveResearch({ candidate, plan, title }) {
  if (!candidate || typeof candidate !== "object" || !candidate.id) throw new Error("candidate with id is required");
  const store = await loadStore(); const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), title: clean(title || candidate.title || candidate.id, 300), candidate, plan: plan || null, createdAt: now, updatedAt: now };
  store.items.unshift(item); if (store.items.length > 200) store.items.length = 200; await saveStore(store); return item;
}
export async function updateResearch(id, patch) {
  const store = await loadStore(); const item = store.items.find((entry) => entry.id === id); if (!item) return null;
  if (patch.title !== undefined) item.title = clean(patch.title, 300);
  if (patch.candidate !== undefined) item.candidate = patch.candidate;
  if (patch.plan !== undefined) item.plan = patch.plan;
  item.updatedAt = new Date().toISOString(); await saveStore(store); return item;
}
export async function deleteResearch(id) { const store = await loadStore(); const count = store.items.length; store.items = store.items.filter((item) => item.id !== id); if (count === store.items.length) return false; await saveStore(store); return true; }
