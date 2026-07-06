const path = require('path');
const { spawn } = require('child_process');

/**
 * In-process nightly backup scheduler.
 *
 * Render web services have no cron, and Render's Cron Job service type can't
 * mount another service's disk — so a scheduled backup has to run inside the
 * server process itself. This module spawns the existing (independently
 * tested) scripts/backup-db.js as a child process on a timer; the script's
 * hot-backup, integrity-check, off-disk upload, and retention behaviour are
 * unchanged.
 *
 * Schedule: first run 5 minutes after boot, then every BACKUP_INTERVAL_HOURS
 * (default 24 in production). The short initial delay is deliberate — if the
 * first run waited a full interval, a process that restarts more often than
 * the interval (crash loop, frequent deploys) would never back up at all.
 *
 * Env:
 *   BACKUP_INTERVAL_HOURS  0 disables; unset → 24 in production, disabled in
 *                          dev (local runs shouldn't litter data/backups).
 *   BACKUP_RETENTION / BACKUP_REMOTE_CMD — consumed by backup-db.js itself.
 */

const SCRIPT_PATH = path.join(__dirname, '../scripts/backup-db.js');
const INITIAL_DELAY_MS = 5 * 60 * 1000;

function resolveIntervalMs(env = process.env) {
  const raw = env.BACKUP_INTERVAL_HOURS;
  if (raw !== undefined && String(raw).trim() !== '') {
    const hours = Number(raw);
    if (Number.isFinite(hours) && hours >= 0) return hours * 60 * 60 * 1000;
  }
  return env.NODE_ENV === 'production' ? 24 * 60 * 60 * 1000 : 0;
}

/**
 * Run one backup as a child process. Resolves with the script's exit code
 * (0 = success; see backup-db.js header for the failure codes). Never rejects
 * — a failed backup must not take the server down.
 */
function runBackupOnce({ spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // stdio: 'inherit' so the script's [backup] lines land in the server's
      // stdout and reach the host's log drain / alerting.
      child = spawnFn(process.execPath, [SCRIPT_PATH], { stdio: 'inherit' });
    } catch (err) {
      console.error(JSON.stringify({
        t: new Date().toISOString(), msg: 'db-backup-spawn-failed', error: err.message,
      }));
      return resolve(-1);
    }
    child.on('error', (err) => {
      console.error(JSON.stringify({
        t: new Date().toISOString(), msg: 'db-backup-spawn-failed', error: err.message,
      }));
      resolve(-1);
    });
    child.on('exit', (code) => {
      const exitCode = code ?? -1;
      if (exitCode === 0) {
        console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'db-backup-ok' }));
      } else {
        console.error(JSON.stringify({
          t: new Date().toISOString(), msg: 'db-backup-failed', exitCode,
        }));
      }
      resolve(exitCode);
    });
  });
}

/**
 * Start the scheduler. Returns a handle with stop(), or null when disabled.
 */
function startBackupScheduler({ spawnFn = spawn, env = process.env } = {}) {
  const intervalMs = resolveIntervalMs(env);
  if (intervalMs <= 0) {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'db-backup-scheduler-disabled',
      hint: 'set BACKUP_INTERVAL_HOURS to enable outside production',
    }));
    return null;
  }

  let running = false;
  async function tick() {
    if (running) return; // a hung BACKUP_REMOTE_CMD must not stack children
    running = true;
    try {
      await runBackupOnce({ spawnFn });
    } finally {
      running = false;
    }
  }

  let interval = null;
  const initialTimer = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
  }, Math.min(INITIAL_DELAY_MS, intervalMs));

  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'db-backup-scheduler-started',
    intervalHours: intervalMs / 3_600_000,
  }));

  return {
    stop() {
      clearTimeout(initialTimer);
      if (interval) clearInterval(interval);
    },
  };
}

module.exports = { startBackupScheduler, runBackupOnce, resolveIntervalMs, SCRIPT_PATH };
