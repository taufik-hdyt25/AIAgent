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
        const idsMatch = content.match(/ALLOWED_TELEGRAM_IDS=([^\r\n]+)/);
        if (tokenMatch && idsMatch) {
          return {
            botToken: tokenMatch[1].trim(),
            chatId: idsMatch[1].split(",")[0].trim(),
          };
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

  const dbBullets = dbList.map((db) => `  • \`${db}\``).join("\n");
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

  const databases = getDatabases();
  console.log(`📋 Found active databases in ${CONTAINER_NAME}:`, databases);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const tempDir = path.join(BACKUP_ROOT, `bundle_temp_${dateStr}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const dbHashes = {};
  const dbSummaries = [];

  try {
    for (const db of databases) {
      console.log(`⏳ Dumping database: ${db}...`);
      const dbDir = path.join(tempDir, db);
      fs.mkdirSync(dbDir, { recursive: true });

      const dumpCmd = `docker exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} ${db}`;
      const sqlContent = execSync(dumpCmd, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });

      const sqlFile = path.join(dbDir, `${db}.sql`);
      fs.writeFileSync(sqlFile, sqlContent, "utf-8");

      const hash = calculateDeterministicHash(sqlContent);
      dbHashes[db] = hash;

      const stat = fs.statSync(sqlFile);
      dbSummaries.push({
        database: db,
        sizeBytes: stat.size,
        hash: hash,
      });
      console.log(`   ✓ ${db}: ${(stat.size / 1024).toFixed(1)} KB (hash: ${hash.slice(0, 12)}...)`);
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
      sendToTelegram(archivePath, databases, archiveStat.size);
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
