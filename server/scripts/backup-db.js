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
 * Verification: every fresh backup is opened read-only and run through
 * `PRAGMA integrity_check` BEFORE it counts as a success. A backup that can't
 * pass integrity is deleted and the script exits non-zero so cron alerting
 * fires — a silently-corrupt backup is worse than no backup.
 *
 * Off-disk copy (the important one for durability): backups in DATA_DIR/backups/
 * live on the SAME disk as the database, so a disk failure loses both. Set
 * BACKUP_REMOTE_CMD to push each verified backup somewhere off-box. The literal
 * token {file} is replaced with the absolute backup path and {base} with the
 * filename only; the command runs via the shell so you can use whatever uploader
 * you already have — no SDK, no lock-in. Examples:
 *   BACKUP_REMOTE_CMD='aws s3 cp {file} s3://my-bucket/speeldit/'
 *   BACKUP_REMOTE_CMD='rclone copy {file} r2:speeldit-backups/'
 *   BACKUP_REMOTE_CMD='b2 upload-file my-bucket {file} speeldit/{base}'
 * If the upload command exits non-zero, this script exits non-zero too (the
 * local backup is still kept) so the failure is alertable.
 *
 * Retention: keeps the N most recent backups (default 14) in DATA_DIR/backups/
 * and removes older ones. Tune via BACKUP_RETENTION env var. Off-disk retention
 * is the remote's responsibility (e.g. S3 lifecycle rules).
 *
 * Usage:
 *   node scripts/backup-db.js                # uses DATA_DIR or default
 *   DATA_DIR=/data node scripts/backup-db.js
 *   BACKUP_RETENTION=30 node scripts/backup-db.js
 *
 * Cron suggestion (Render persistent disk, 03:00 UTC nightly):
 *   0 3 * * * cd /opt/render/project/src/server && node scripts/backup-db.js
 *
 * Exit codes: 0 success; 1 no DB; 2 backup failed; 3 uncaught; 4 fresh backup
 * failed integrity_check; 5 off-disk upload failed. All non-zero codes suit
 * cron alerting.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
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

/**
 * Open a just-written backup read-only and confirm `PRAGMA integrity_check`
 * returns the single row 'ok'. Returns true/false; never throws.
 */
function verifyFreshBackup(filePath) {
  let vdb;
  try {
    vdb = new Database(filePath, { readonly: true, fileMustExist: true });
    const rows = vdb.pragma('integrity_check');
    return Array.isArray(rows) && rows.length === 1
      && (rows[0].integrity_check === 'ok' || rows[0] === 'ok');
  } catch (err) {
    console.error(`[backup] integrity_check threw: ${err.message}`);
    return false;
  } finally {
    if (vdb) { try { vdb.close(); } catch (_) {} }
  }
}

/**
 * If BACKUP_REMOTE_CMD is set, ship the verified backup off-disk. Substitutes
 * {file} (absolute path) and {base} (filename). Returns true on success, false
 * if the command failed; a missing BACKUP_REMOTE_CMD is a no-op success.
 */
function uploadOffDisk(filePath) {
  const template = process.env.BACKUP_REMOTE_CMD;
  if (!template) {
    console.log('[backup] BACKUP_REMOTE_CMD not set — backup is LOCAL ONLY (same disk as DB)');
    return true;
  }
  const cmd = template
    .replace(/\{file\}/g, filePath)
    .replace(/\{base\}/g, path.basename(filePath));
  try {
    console.log(`[backup] off-disk upload: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
    console.log('[backup] off-disk upload ok');
    return true;
  } catch (err) {
    console.error(`[backup] off-disk upload FAILED: ${err.message}`);
    return false;
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
    console.log(`[backup] written: ${targetName} (${(sizeBytes / 1024).toFixed(1)} KiB, ${result.totalPages} pages, ${elapsed} ms)`);
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

  if (process.exitCode) return; // backup itself failed — nothing valid to keep

  // Verify the fresh backup before trusting it. A corrupt backup that we kept
  // and uploaded would give false confidence and could overwrite good data on
  // a future restore.
  if (!verifyFreshBackup(targetPath)) {
    console.error(`[backup] REJECTED: ${targetName} failed integrity_check — deleting`);
    try { fs.unlinkSync(targetPath); } catch (_) {}
    process.exitCode = 4;
    return;
  }
  console.log('[backup] integrity OK');

  // Ship it off-disk (no-op if BACKUP_REMOTE_CMD is unset). The local copy is
  // kept regardless so a transient upload failure doesn't lose the backup.
  if (!uploadOffDisk(targetPath)) {
    process.exitCode = 5;
  }

  pruneOldBackups();
}

main().catch((err) => {
  console.error(`[backup] uncaught: ${err.stack || err.message}`);
  process.exit(3);
});
