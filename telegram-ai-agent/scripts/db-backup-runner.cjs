#!/usr/bin/env node

/**
 * TH Agent Smart Database Backup Runner
 * - Automatically dumps all active user databases in PostgreSQL (th-db container)
 * - Bundles all databases into 1 compressed archive (.tar.gz) with separate folders per database
 * - Deterministic SHA-256 change detection: only creates & sends backup if data has actually changed
 * - Telegram integration: automatically sends archive to Telegram owner (sendDocument)
 * - Auto-rotation: retains last 7 local backups to prevent disk bloat
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
const BACKUP_ROOT = path.join("/home/ubuntu/.th-agent/backups");
const STATE_FILE = path.join("/home/ubuntu/.th-agent/data/last_db_backup_hash.json");

// Known databases and auto-discovery rules
const KNOWN_SQLITE_DATABASES = [
  {
    name: "artosku_db",
    filePath: "/home/th-agent/projects/dompet-bulanan/dompet.sqlite",
    label: "Artosku (Dompet Bulanan)",
  },
  {
    name: "whatsapp_bot_db",
    filePath: "/home/th-agent/projects/wa-chat-bot/whatsapp-bot/prisma/dev.db",
    label: "WhatsApp Bot Prisma",
  },
  {
    name: "nine_router_db",
    filePath: "/home/ubuntu/.9router/db/data.sqlite",
    label: "9Router Database",
  },
];

const AI_AGENT_STORES = [
  {
    name: "ai_agent_memories",
    filePath: "/home/th-agent/telegram-ai-agent/data/memories.json",
    type: "JSON-Store",
    label: "TH Agent Vector Memories",
  },
];

function discoverSqliteDatabases() {
  const dbMap = new Map();
  for (const db of KNOWN_SQLITE_DATABASES) {
    if (fs.existsSync(db.filePath)) {
      dbMap.set(path.resolve(db.filePath), { ...db, type: "SQLite", source: "sqlite" });
    }
  }

  // Auto-discover any other active SQLite databases across /home/th-agent/projects/
  try {
    const cmd = `find /home/th-agent/projects/ -type f \\( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db" \\) 2>/dev/null | grep -v "/node_modules/" | grep -v "/\\.git/" | grep -v "/\\.cache/" | grep -v "/\\.next/"`;
    const found = execSync(cmd, { encoding: "utf-8" }).trim().split("\n").filter(Boolean);
    for (const f of found) {
      const absPath = path.resolve(f);
      if (!dbMap.has(absPath)) {
        const parts = absPath.split(path.sep);
        const projIdx = parts.indexOf("projects");
        const projName = projIdx !== -1 && parts[projIdx + 1] ? parts[projIdx + 1] : "db";
        const baseName = path.basename(absPath, path.extname(absPath));
        const cleanName = `${projName}_${baseName}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
        dbMap.set(absPath, {
          name: cleanName,
          filePath: absPath,
          type: "SQLite",
          source: "sqlite",
          label: `${projName} (${path.basename(absPath)})`,
        });
      }
    }
  } catch (err) {
    console.warn("⚠️ Warning during SQLite dynamic discovery:", err.message);
  }

  return Array.from(dbMap.values());
}

// Ensure directories exist
if (!fs.existsSync(BACKUP_ROOT)) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
}
const stateDir = path.dirname(STATE_FILE);
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

function getEnvConfig() {
  const envPaths = [
    "/home/ubuntu/.th-agent/.env",
    "/home/th-agent/.env",
    "/home/th-agent/telegram-ai-agent/.env",
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        const tokenMatch = content.match(/BOT_TOKEN=([^\r\n]+)/);
        const backupChatMatch = content.match(/TELEGRAM_BACKUP_CHAT_ID=([^\r\n]+)/);
        const idsMatch = content.match(/ALLOWED_TELEGRAM_IDS=([^\r\n]+)/);
        if (tokenMatch) {
          const chatId = backupChatMatch
            ? backupChatMatch[1].trim()
            : idsMatch
            ? idsMatch[1].split(",")[0].trim()
            : null;
          if (chatId) {
            return {
              botToken: tokenMatch[1].trim(),
              chatId,
            };
          }
        }
      } catch (_) {}
    }
  }
  return null;
}

function getDatabases() {
  try {
    const cmd = `docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres' ORDER BY datname;"`;
    const output = execSync(cmd, { encoding: "utf-8" }).trim();
    return output
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean);
  } catch (err) {
    console.error("❌ Failed to query databases from container:", err.message);
    process.exit(1);
  }
}

function calculateDeterministicHash(sqlContent) {
  // Filter out comments (-- ...) and dynamic session commands (\restrict ...)
  const lines = sqlContent.split("\n");
  const filtered = lines.filter((l) => {
    const trimmed = l.trim();
    return !trimmed.startsWith("--") && !trimmed.startsWith("\\");
  });
  return crypto.createHash("sha256").update(filtered.join("\n")).digest("hex");
}

function rotateLocalBackups(maxKeep = 7) {
  try {
    const files = fs
      .readdirSync(BACKUP_ROOT)
      .filter((f) => f.startsWith("th_databases_backup_") && f.endsWith(".tar.gz"))
      .map((f) => {
        const fullPath = path.join(BACKUP_ROOT, f);
        return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > maxKeep) {
      const toDelete = files.slice(maxKeep);
      for (const item of toDelete) {
        fs.unlinkSync(item.path);
        console.log(`[Auto-Rotate] Deleted old backup: ${item.name}`);
      }
    }
  } catch (err) {
    console.warn("⚠️ Warning during backup rotation:", err.message);
  }
}

function sendToTelegram(archivePath, dbList, totalSizeBytes) {
  const config = getEnvConfig();
  if (!config) {
    console.warn("⚠️ Telegram configuration not found. Skipping Telegram send.");
    return false;
  }

  const { botToken, chatId } = config;
  const sizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(2);
  const sizeKb = (totalSizeBytes / 1024).toFixed(1);
  const displaySize = totalSizeBytes > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

  // Format timestamp in WIB (UTC+7)
  const now = new Date();
  const wibTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);

  const dbBullets = dbList
    .map((db) => {
      if (typeof db === "object" && db.name) {
        return `  • \`${db.name}\` _(${db.type || "DB"})_`;
      }
      return `  • \`${db}\``;
    })
    .join("\n");
  const caption =
    `📦 *Auto-Backup Database TH Studio*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✨ *Status:* Terdeteksi perubahan data baru!\n` +
    `🗄️ *Databases:* \n${dbBullets}\n` +
    `📊 *Ukuran Arsip:* ${displaySize}\n` +
    `⏱️ *Waktu:* ${wibTime} WIB\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `_Semua database dibundling jadi 1 file dan terpisah per folder di dalamnya._`;

  console.log(`[Telegram] Sending backup (${displaySize}) to Chat ID ${chatId}...`);
  try {
    const curlArgs = [
      "-s",
      "-F", `chat_id=${chatId}`,
      "-F", `document=@${archivePath}`,
      "-F", `caption=${caption}`,
      "-F", "parse_mode=Markdown",
      `https://api.telegram.org/bot${botToken}/sendDocument`
    ];
    const proc = spawnSync("curl", curlArgs, { encoding: "utf-8" });
    if (proc.error) {
      console.error("❌ Failed to execute curl:", proc.error.message);
      return false;
    }
    const parsed = JSON.parse(proc.stdout || "{}");
    if (parsed.ok) {
      console.log("✅ Backup successfully delivered to Telegram!");
      return true;
    } else {
      console.error("❌ Telegram API error:", parsed.description);
      return false;
    }
  } catch (err) {
    console.error("❌ Failed to send document to Telegram:", err.message);
    return false;
  }
}

async function runBackup() {
  console.log("🚀 Starting TH Database Backup Runner...");

  const pgDatabases = getDatabases();
  console.log(`📋 Found active PostgreSQL databases in ${CONTAINER_NAME}:`, pgDatabases);

  const sqliteDatabases = discoverSqliteDatabases();
  console.log(`📋 Found active SQLite databases:`, sqliteDatabases.map((s) => `${s.name} (${s.label})`));

  const activeStores = AI_AGENT_STORES.filter((s) => fs.existsSync(s.filePath)).map((s) => ({
    ...s,
    source: "json_store",
  }));
  if (activeStores.length > 0) {
    console.log(`📋 Found active persistent stores:`, activeStores.map((s) => `${s.name} (${s.label})`));
  }

  const allDbEntries = [
    ...pgDatabases.map((db) => ({ name: db, type: "PostgreSQL", source: "postgres" })),
    ...sqliteDatabases,
    ...activeStores,
  ];

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const tempDir = path.join(BACKUP_ROOT, `bundle_temp_${dateStr}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const dbHashes = {};
  const dbSummaries = [];

  try {
    for (const item of allDbEntries) {
      console.log(`⏳ Dumping database: ${item.name} (${item.type})...`);
      const dbDir = path.join(tempDir, item.name);
      fs.mkdirSync(dbDir, { recursive: true });

      let sqlContent = "";
      let primaryFile = "";
      if (item.source === "postgres") {
        const dumpCmd = `docker exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} ${item.name}`;
        sqlContent = execSync(dumpCmd, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
        primaryFile = path.join(dbDir, `${item.name}.sql`);
        fs.writeFileSync(primaryFile, sqlContent, "utf-8");
      } else if (item.source === "sqlite") {
        const dumpCmd = `python3 -c "import sqlite3, sys; conn = sqlite3.connect('${item.filePath}'); sys.stdout.write('\\n'.join(conn.iterdump()))"`;
        sqlContent = execSync(dumpCmd, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });

        // Copy raw .sqlite file alongside .sql dump for instant file recovery
        const rawFileName = path.basename(item.filePath);
        fs.copyFileSync(item.filePath, path.join(dbDir, rawFileName));
        primaryFile = path.join(dbDir, `${item.name}.sql`);
        fs.writeFileSync(primaryFile, sqlContent, "utf-8");
      } else if (item.source === "json_store") {
        sqlContent = fs.readFileSync(item.filePath, "utf-8");
        primaryFile = path.join(dbDir, path.basename(item.filePath));
        fs.writeFileSync(primaryFile, sqlContent, "utf-8");
      }

      const hash = calculateDeterministicHash(sqlContent);
      dbHashes[item.name] = hash;

      const stat = fs.statSync(primaryFile);
      dbSummaries.push({
        database: item.name,
        type: item.type,
        sizeBytes: stat.size,
        hash: hash,
      });
      console.log(`   ✓ ${item.name} (${item.type}): ${(stat.size / 1024).toFixed(1)} KB (hash: ${hash.slice(0, 12)}...)`);
    }

    // Compute composite hash for all databases
    const compositeHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(dbHashes))
      .digest("hex");

    console.log(`🔑 Composite Database Hash: ${compositeHash.slice(0, 16)}...`);

    // Load previous hash
    let previousState = null;
    if (fs.existsSync(STATE_FILE)) {
      try {
        previousState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      } catch (_) {}
    }

    const hasChanged = !previousState || previousState.compositeHash !== compositeHash;

    if (!hasChanged && !isForce) {
      console.log("ℹ️  [Skip] No database changes detected since last backup. Telegram dispatch skipped.");
      // Clean up temp
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { changed: false };
    }

    if (isForce) {
      console.log("⚡ Forced backup requested (--force flag).");
    } else {
      console.log("✨ New or modified data detected in database!");
    }

    if (isDryRun) {
      console.log("🔍 Dry run completed. Changes detected, no archive created.");
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { changed: true, dryRun: true };
    }

    // Create metadata.json inside the bundle
    const metadata = {
      backupDate: now.toISOString(),
      compositeHash: compositeHash,
      databases: dbSummaries,
    };
    fs.writeFileSync(path.join(tempDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

    // Package into .tar.gz
    const archiveName = `th_databases_backup_${dateStr}.tar.gz`;
    const archivePath = path.join(BACKUP_ROOT, archiveName);

    console.log(`📦 Packaging archive: ${archiveName}...`);
    execSync(`tar -czf "${archivePath}" -C "${tempDir}" .`);
    const archiveStat = fs.statSync(archivePath);

    console.log(`✅ Archive created: ${archivePath} (${(archiveStat.size / 1024).toFixed(1)} KB)`);

    // Clean up temporary folder
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Save state
    const newState = {
      lastBackupAt: now.toISOString(),
      compositeHash: compositeHash,
      dbHashes: dbHashes,
      lastArchive: archiveName,
      lastArchiveSize: archiveStat.size,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), "utf-8");

    // Rotate local backups (keep last 7)
    rotateLocalBackups(7);

    // Dispatch to Telegram
    if (!skipTelegram) {
      sendToTelegram(archivePath, allDbEntries, archiveStat.size);
    }

    return {
      changed: true,
      archivePath: archivePath,
      sizeBytes: archiveStat.size,
    };
  } catch (err) {
    console.error("❌ Backup failed:", err.message);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

runBackup();
