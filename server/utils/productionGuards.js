/**
 * Fail-loud startup guards for money safety.
 *
 * The single biggest risk to payment data is not a code bug — it is running in
 * production against an EPHEMERAL disk. On Render, a web service's default
 * filesystem is wiped on every deploy and restart. If DATA_DIR is not pointed
 * at a mounted persistent disk, the SQLite file (venues, payments, payouts,
 * subscriptions, bank details) is destroyed on the next deploy, silently and
 * completely. No amount of in-app idempotency helps once the file is gone.
 *
 * These guards convert that silent total-loss into a loud boot failure, and
 * warn about backup configuration that would leave backups on the same
 * disposable disk as the data they protect.
 *
 * Nothing here runs outside production — local/dev/test keep the ephemeral
 * default so they don't litter disks or demand real infra.
 */

/**
 * Assert the money-critical environment is safe to run in production.
 * @param {object} env
 * @param {(msg:string)=>void} warn
 * @throws {Error} when a fatal misconfiguration would risk data loss.
 */
function assertProductionDataSafety(env = process.env, warn = defaultWarn) {
  if (env.NODE_ENV !== 'production') return { ok: true, skipped: true };

  const problems = [];

  // 1. Persistent disk — the non-negotiable one.
  const dataDir = (env.DATA_DIR || '').trim();
  if (!dataDir) {
    problems.push(
      'DATA_DIR is not set. In production the SQLite database MUST live on a ' +
        'mounted persistent disk, or all payment/venue data is wiped on the next ' +
        'deploy. Set DATA_DIR to your Render disk mount path (e.g. /var/data).'
    );
  }

  // 2. Payment-data encryption at rest (mirrors paymentCrypto's own guard, but
  //    surfaced here too so the whole money-safety story is in one place).
  if (!(env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
    problems.push(
      'PAYMENT_ENCRYPTION_KEY is not set. Card/bank payloads would be stored in ' +
        'plaintext. Set a strong secret.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      'FATAL: unsafe production configuration for payment data:\n  - ' +
        problems.join('\n  - ')
    );
  }

  // Non-fatal warnings — safe to run, but worth fixing.

  // Backups that never leave the disk protect against corruption but not disk
  // loss. This is a warning, not fatal, because a fresh deploy legitimately has
  // no backup command while being set up.
  if (!(env.BACKUP_REMOTE_CMD || '').trim()) {
    warn(
      'BACKUP_REMOTE_CMD is not set — database backups stay on the same disk as ' +
        'the live database. If that disk is lost, the backups go with it. Configure ' +
        'off-disk shipping for real durability.'
    );
  }

  if ((env.BACKUP_INTERVAL_HOURS || '').trim() === '0') {
    warn('BACKUP_INTERVAL_HOURS=0 — automated backups are disabled in production.');
  }

  return { ok: true, skipped: false };
}

function defaultWarn(msg) {
  console.warn(JSON.stringify({ t: new Date().toISOString(), msg: 'production-guard-warning', warning: msg }));
}

module.exports = { assertProductionDataSafety };
