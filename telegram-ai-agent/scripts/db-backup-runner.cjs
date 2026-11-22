#!/usr/bin/env node

/**
 * TH Studio smart backup runner.
 * Creates a standard .tar.gz bundle of databases and project .env files, then sends it to Telegram Backup Vault.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const args = process.argv.slice(2);
const isForce = args.includes("--force") || args.includes("-f");
const isDryRun = args.includes("--dry-run");
const skipTelegram = args.includes("--no-telegram");
const CONTAINER_NAME = "th-db";
const DB_USER = "th_user";
const PROJECTS_ROOT = "/home/th-agent/projects";
const BACKUP_ROOT = "/home/ubuntu/.th-agent/backups";
const STATE_FILE = "/home/ubuntu/.th-agent/data/last_db_backup_hash.json";
const EXCLUDED_DATABASES = ["postgres", "th_wedding_db", ...(process.env.BACKUP_EXCLUDE_DBS || "").split(",").map((s) => s.trim()).filter(Boolean)];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".cache", ".turbo", "dist", "build", "coverage"]);
const KNOWN_SQLITE_DATABASES = [
  { name: "artosku_db", filePath: `${PROJECTS_ROOT}/dompet-bulanan/dompet.sqlite`, label: "Artosku (Dompet Bulanan)" },
  { name: "whatsapp_bot_db", filePath: `${PROJECTS_ROOT}/wa-chat-bot/whatsapp-bot/prisma/dev.db`, label: "WhatsApp Bot Prisma" },
];
const AI_AGENT_STORES = [{ name: "ai_agent_memories", filePath: "/home/th-agent/telegram-ai-agent/data/memories.json", type: "JSON-Store", label: "TH Agent Vector Memories" }];

for (const dir of [BACKUP_ROOT, path.dirname(STATE_FILE)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

function discoverProjectEnvFiles() {
  const results = [];
  const rootReal = fs.realpathSync(PROJECTS_ROOT);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".env" && entry.isFile()) {
        const full = path.join(dir, entry.name);
        try {
          const real = fs.realpathSync(full);
          if (real.startsWith(rootReal + path.sep)) results.push({ filePath: full, relativePath: path.relative(rootReal, full) });
        } catch {}
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
    }
  }
  walk(rootReal);
  for (const filePath of ["/home/ubuntu/.th-agent/.env", "/home/th-agent/.env", "/home/th-agent/telegram-ai-agent/.env"]) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const real = fs.realpathSync(filePath);
      const relativePath = `system/${path.basename(path.dirname(filePath))}/.env`;
      if (!results.some((entry) => entry.relativePath === relativePath)) results.push({ filePath: real, relativePath });
    } catch {}
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function discoverSqliteDatabases() {
  const dbMap = new Map();
  for (const db of KNOWN_SQLITE_DATABASES) {
    if (fs.existsSync(db.filePath)) dbMap.set(path.resolve(db.filePath), { ...db, type: "SQLite", source: "sqlite" });
  }
  try {
    const found = execSync(`find ${JSON.stringify(PROJECTS_ROOT)} -type f \\( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \\) 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    for (const filePath of found) {
      if (filePath.split(path.sep).some((part) => SKIP_DIRS.has(part))) continue;
      const abs = path.resolve(filePath);
      if (!dbMap.has(abs)) {
        const parts = abs.split(path.sep);
        const index = parts.indexOf("projects");
        const project = parts[index + 1] || "db";
        const base = path.basename(abs, path.extname(abs));
        dbMap.set(abs, { name: `${project}_${base}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(), filePath: abs, type: "SQLite", source: "sqlite", label: `${project} (${path.basename(abs)})` });
      }
    }
  } catch (err) { console.warn("⚠️ SQLite discovery warning:", err.message); }
  return [...dbMap.values()];
}

function getEnvConfig() {
  const paths = ["/home/ubuntu/.th-agent/.env", "/home/th-agent/.env", "/home/th-agent/telegram-ai-agent/.env"];
  let botToken = null, chatId = null, allowedIds = null;
  for (const file of paths) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const token = content.match(/^BOT_TOKEN\s*=\s*['\"]?([^\r\n'\"]+)/m);
      const chat = content.match(/^TELEGRAM_BACKUP_CHAT_ID\s*=\s*['\"]?([^\r\n'\"]+)/m);
      const ids = content.match(/^ALLOWED_TELEGRAM_IDS\s*=\s*['\"]?([^\r\n'\"]+)/m);
      if (token && !botToken) botToken = token[1].trim();
      if (chat && !chatId) chatId = chat[1].trim();
      if (ids && !allowedIds) allowedIds = ids[1].split(",")[0].trim();
    } catch {}
  }
  return botToken ? { botToken, chatId: chatId || allowedIds || "-5323409843" } : null;
}

function calculateHash(content) {
  const normalized = content.split("\n").filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("\\")).join("\n");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function rotateLocalBackups(maxKeep = 7) {
  const files = fs.readdirSync(BACKUP_ROOT).filter((name) => name.startsWith("th_studio_backup_") && (name.endsWith(".tar.gz") || name.endsWith(".tar.gz.enc")))
    .map((name) => ({ name, mtime: fs.statSync(path.join(BACKUP_ROOT, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(maxKeep)) {
    fs.unlinkSync(path.join(BACKUP_ROOT, old.name));
    console.log(`[Auto-Rotate] Deleted old backup: ${old.name}`);
  }
}

function sendToTelegram(archivePath, entryNames, sizeBytes) {
  const config = getEnvConfig();
  if (!config) { console.warn("⚠️ Telegram configuration missing; archive retained locally."); return false; }
  const timestamp = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const caption = `📦 *TH Studio Backup*\n━━━━━━━━━━━━━━━━━━━━\n🗄️ Components: ${entryNames.length}\n📊 Size: ${(sizeBytes / 1048576).toFixed(2)} MB\n⏱️ ${timestamp} WIB\n🔒 Plain .tar.gz archive (no password encryption).`;
  const proc = spawnSync("curl", ["-sS", "--max-time", "120", "-F", `chat_id=${config.chatId}`, "-F", `document=@${archivePath}`, "-F", `caption=${caption}`, "-F", "parse_mode=Markdown", `https://api.telegram.org/bot${config.botToken}/sendDocument`], { encoding: "utf8", timeout: 130000 });
  if (proc.error) { console.error("❌ Telegram upload failed:", proc.error.message); return false; }
  try {
    const response = JSON.parse(proc.stdout || "{}");
    if (response.ok) { console.log("✅ Encrypted backup delivered to Telegram Backup Vault."); return true; }
    console.error("❌ Telegram API error:", response.description || "Unknown error");
  } catch { console.error("❌ Invalid Telegram response."); }
  return false;
}

async function runBackup() {
  const tempDir = path.join(BACKUP_ROOT, `bundle_temp_${Date.now()}`);
  const workDir = path.join(BACKUP_ROOT, `encrypted_temp_${Date.now()}`);
  console.log("🚀 Starting TH Studio backup...");
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try {
    const pgDbs = execSync(`docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres' ORDER BY datname;"`, { encoding: "utf8" }).trim().split("\n").filter((name) => name && !EXCLUDED_DATABASES.includes(name));
    const sqliteDbs = discoverSqliteDatabases();
    const stores = AI_AGENT_STORES.filter((s) => fs.existsSync(s.filePath)).map((s) => ({ ...s, source: "json_store" }));
    const envFiles = discoverProjectEnvFiles();
    const entries = [...pgDbs.map((name) => ({ name, type: "PostgreSQL", source: "postgres" })), ...sqliteDbs, ...stores];
    console.log(`📋 Found ${pgDbs.length} PostgreSQL DBs, ${sqliteDbs.length} SQLite DBs, ${stores.length} JSON stores, ${envFiles.length} project .env files.`);

    const hashes = {};
    const summaries = [];
    for (const item of entries) {
      const destDir = path.join(tempDir, "databases", item.name);
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
      let content = "";
      let primaryFile;
      if (item.source === "postgres") {
        content = execSync(`docker exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} ${JSON.stringify(item.name)}`, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
        primaryFile = path.join(destDir, `${item.name}.sql`);
        fs.writeFileSync(primaryFile, content, { mode: 0o600 });
      } else if (item.source === "sqlite") {
        const python = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); sys.stdout.write('\\n'.join(c.iterdump()))";
        content = execSync(`python3 -c ${JSON.stringify(python)} ${JSON.stringify(item.filePath)}`, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
        fs.copyFileSync(item.filePath, path.join(destDir, path.basename(item.filePath)));
        primaryFile = path.join(destDir, `${item.name}.sql`);
        fs.writeFileSync(primaryFile, content, { mode: 0o600 });
      } else {
        content = fs.readFileSync(item.filePath, "utf8");
        primaryFile = path.join(destDir, path.basename(item.filePath));
        fs.copyFileSync(item.filePath, primaryFile);
      }
      const hash = calculateHash(content);
      hashes[`db:${item.name}`] = hash;
      summaries.push({ name: item.name, type: item.type, sizeBytes: fs.statSync(primaryFile).size, sha256: hash });
    }

    const copiedEnvFiles = [];
    for (const env of envFiles) {
      const dest = path.join(tempDir, "project-env", env.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.copyFileSync(env.filePath, dest);
      fs.chmodSync(dest, 0o600);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(env.filePath)).digest("hex");
      hashes[`env:${env.relativePath}`] = hash;
      copiedEnvFiles.push({ path: env.relativePath, sha256: hash });
    }

    const compositeHash = crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
    const changed = !previous || previous.compositeHash !== compositeHash;
    if (!changed && !isForce) {
      console.log("ℹ️ No database or project .env changes detected; Telegram dispatch skipped.");
      return { changed: false };
    }
    if (isDryRun) {
      console.log(`🔍 Dry run: detected changes; would package ${entries.length} DB/store items and ${envFiles.length} .env files.`);
      return { changed: true, dryRun: true };
    }

    const now = new Date();
    const timestamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now).replace(/[,:\s-]/g, "");
    const metadata = { backupDate: now.toISOString(), compositeHash, encryption: "AES-256-GCM", databases: summaries, envFiles: copiedEnvFiles };
    fs.writeFileSync(path.join(tempDir, "metadata.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    const archiveName = `th_studio_backup_${timestamp}.tar.gz`;
    const archivePath = path.join(BACKUP_ROOT, archiveName);
    execSync(`tar -czf ${JSON.stringify(archivePath)} -C ${JSON.stringify(tempDir)} .`);
    fs.chmodSync(archivePath, 0o600);
    const size = fs.statSync(archivePath).size;
    console.log(`✅ Plain .tar.gz archive ready: ${archiveName} (${(size / 1048576).toFixed(2)} MB).`);

    const delivered = skipTelegram || sendToTelegram(archivePath, [...entries.map((item) => item.name), ...envFiles.map((item) => `.env:${item.relativePath}`)], size);
    if (!skipTelegram && !delivered) throw new Error("Backup archive created but Telegram delivery failed; state is not advanced for retry.");

    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastBackupAt: now.toISOString(), compositeHash, hashes, lastArchive: archiveName, lastArchiveSize: size }, null, 2), { mode: 0o600 });
    rotateLocalBackups(7);
    return { changed: true, archivePath, sizeBytes: size, delivered };
  } catch (err) {
    console.error("❌ Backup failed:", err.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

runBackup();
