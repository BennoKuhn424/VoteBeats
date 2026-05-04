#!/usr/bin/env node
/**
 * Restore a SQLite backup over the live database.
 *
 * Usage:
 *   1. STOP THE SERVER first. better-sqlite3 keeps the file open in WAL mode
 *      and overwriting it under a running process produces undefined behaviour.
 *   2. node scripts/restore-db.js                 # interactive: lists backups
 *      node scripts/restore-db.js <backup-name>   # restores the named backup
 *      node scripts/restore-db.js --latest        # restores the most recent
 *
 * Safety net: before overwriting, the current speeldit.db is renamed to
 * `speeldit.db.pre-restore.<ts>`. If the restore is wrong, you can swap it back
 * by hand. WAL/SHM sidecars are removed since they belong to the pre-restore
 * file and can confuse SQLite if left next to a different DB.
 *
 * The restore runs an integrity_check on the chosen backup BEFORE swapping —
 * a corrupt backup is worse than the current state, so we refuse to proceed
 * if the backup itself is malformed.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'speeldit.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^speeldit-.*\.db$/.test(f))
    .map((f) => ({ name: f, full: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs, size: fs.statSync(path.join(BACKUP_DIR, f)).size }))
    .sort((a, b) => b.mtime - a.mtime);
}

function printList(backups) {
  if (backups.length === 0) {
    console.log('No backups found in', BACKUP_DIR);
    return;
  }
  console.log(`Backups in ${BACKUP_DIR}:`);
  for (const b of backups) {
    const when = new Date(b.mtime).toISOString();
    console.log(`  ${b.name}  (${(b.size / 1024).toFixed(1)} KiB, ${when})`);
  }
}

function verifyIntegrity(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check');
    return Array.isArray(rows) && rows.length === 1 && (rows[0].integrity_check === 'ok' || rows[0] === 'ok');
  } finally {
    try { db.close(); } catch (_) {}
  }
}

function main() {
  const arg = process.argv[2];
  const backups = listBackups();

  if (!arg) {
    printList(backups);
    console.log('\nUsage: node scripts/restore-db.js <backup-name>  OR  --latest');
    process.exit(0);
  }

  let chosen;
  if (arg === '--latest') {
    if (backups.length === 0) {
      console.error('No backups available');
      process.exit(1);
    }
    chosen = backups[0];
  } else {
    chosen = backups.find((b) => b.name === arg);
    if (!chosen) {
      console.error(`Backup not found: ${arg}`);
      printList(backups);
      process.exit(1);
    }
  }

  console.log(`[restore] verifying ${chosen.name}...`);
  if (!verifyIntegrity(chosen.full)) {
    console.error(`[restore] REFUSING: backup ${chosen.name} fails integrity_check`);
    process.exit(2);
  }
  console.log('[restore] integrity OK');

  // Move current DB + WAL/SHM aside as a safety net.
  if (fs.existsSync(DB_PATH)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
    const safetyName = `speeldit.db.pre-restore.${ts}`;
    const safetyPath = path.join(DATA_DIR, safetyName);
    fs.renameSync(DB_PATH, safetyPath);
    console.log(`[restore] current DB saved to ${safetyName}`);

    for (const suffix of ['-wal', '-shm']) {
      const side = DB_PATH + suffix;
      if (fs.existsSync(side)) {
        // Remove the sidecars — they belong to the OLD db, not the restored one.
        try { fs.unlinkSync(side); } catch (_) {}
      }
    }
  }

  // Copy the backup into place.
  fs.copyFileSync(chosen.full, DB_PATH);
  console.log(`[restore] restored ${chosen.name} → ${DB_PATH}`);
  console.log('[restore] DONE. You can start the server now.');
}

try {
  main();
} catch (err) {
  console.error(`[restore] FAILED: ${err.stack || err.message}`);
  process.exit(3);
}
