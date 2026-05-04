#!/usr/bin/env node
/**
 * Hot-backup the SQLite database using better-sqlite3's `db.backup()`.
 *
 * Why a SQLite hot backup, not a file copy:
 *   `cp speeldit.db backup.db` while the server is running can copy a
 *   half-written page set, especially in WAL mode where the latest data lives
 *   in `speeldit.db-wal` and hasn't been merged into the main file yet. The
 *   restored copy then fails integrity_check on next boot and we trigger the
 *   recovery quarantine in utils/sqlite.js, losing whatever wasn't merged.
 *
 *   better-sqlite3's `db.backup(targetPath)` uses SQLite's online backup API
 *   (https://sqlite.org/backup.html). It iterates the live page set + WAL
 *   under read locks and emits a single, consistent, fully-merged DB file at
 *   `targetPath`. Safe to run while the server is serving traffic.
 *
 * Output naming: `speeldit-YYYY-MM-DDTHH-mm-ss.db` — sorts chronologically.
 *
 * Retention: keeps the N most recent backups (default 14) in DATA_DIR/backups/
 * and removes older ones. Tune via BACKUP_RETENTION env var.
 *
 * Usage:
 *   node scripts/backup-db.js                # uses DATA_DIR or default
 *   DATA_DIR=/data node scripts/backup-db.js
 *   BACKUP_RETENTION=30 node scripts/backup-db.js
 *
 * Cron suggestion (Render persistent disk, 03:00 UTC nightly):
 *   0 3 * * * cd /opt/render/project/src/server && node scripts/backup-db.js
 *
 * Exit codes: 0 on success, non-zero on failure (suitable for cron alerting).
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'speeldit.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION = Math.max(1, parseInt(process.env.BACKUP_RETENTION || '14', 10));

function timestampSuffix() {
  // 2026-05-04T15-32-04 — filesystem-safe sortable ISO-ish.
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

function pruneOldBackups() {
  const entries = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^speeldit-.*\.db$/.test(f))
    .map((f) => ({ name: f, full: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = entries.slice(RETENTION);
  for (const ent of toDelete) {
    try {
      fs.unlinkSync(ent.full);
      console.log(`[backup] pruned old backup: ${ent.name}`);
    } catch (err) {
      console.error(`[backup] failed to prune ${ent.name}: ${err.message}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] no database at ${DB_PATH}; nothing to back up`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const targetName = `speeldit-${timestampSuffix()}.db`;
  const targetPath = path.join(BACKUP_DIR, targetName);

  // Open read-only — we only need to drive the backup API, not write.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  try {
    const startedAt = Date.now();
    // .backup() returns a promise and yields { totalPages, remainingPages }
    // ticks on each step. better-sqlite3 handles the page-by-page loop
    // internally; we just await the final result.
    const result = await db.backup(targetPath);
    const elapsed = Date.now() - startedAt;
    const sizeBytes = fs.statSync(targetPath).size;
    console.log(`[backup] ok: ${targetName} (${(sizeBytes / 1024).toFixed(1)} KiB, ${result.totalPages} pages, ${elapsed} ms)`);
  } catch (err) {
    console.error(`[backup] FAILED: ${err.message}`);
    // Clean up a half-written backup file if one was created
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
    process.exitCode = 2;
  } finally {
    try { db.close(); } catch (_) {}
  }

  if (!process.exitCode) pruneOldBackups();
}

main().catch((err) => {
  console.error(`[backup] uncaught: ${err.stack || err.message}`);
  process.exit(3);
});
