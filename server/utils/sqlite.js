/**
 * SQLite database initialization and connection management.
 *
 * Opens (or creates) DATA_DIR/speeldit.db with WAL mode for better
 * concurrent read performance. Runs CREATE TABLE IF NOT EXISTS on startup
 * so the schema is always up to date.
 *
 * Legacy filename "votebeats.db" is auto-renamed on first boot — see
 * migrateLegacyDbName below.
 *
 * If the database file is corrupt on open, it's backed up with a timestamp
 * suffix and a fresh database is created (same fail-open philosophy as the
 * old JSON layer).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'speeldit.db');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'votebeats.db');

/**
 * One-shot rename of votebeats.db → speeldit.db (+ WAL/SHM sidecars) if an
 * old-named DB exists and the new-named one doesn't. Idempotent: after the
 * first boot on a given volume, this is a no-op forever.
 */
function migrateLegacyDbName() {
  if (fs.existsSync(DB_PATH) || !fs.existsSync(LEGACY_DB_PATH)) return;
  try {
    fs.renameSync(LEGACY_DB_PATH, DB_PATH);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.renameSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
    console.log(`[DB] Renamed legacy ${LEGACY_DB_PATH} → ${DB_PATH}`);
  } catch (err) {
    // Don't take the server down over this — openDatabase below will just
    // create a fresh speeldit.db. Operator can rename manually.
    console.error(`[DB] Legacy rename failed: ${err.message}. Leaving ${LEGACY_DB_PATH} in place.`);
  }
}
migrateLegacyDbName();

function applyPragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

/**
 * Run SQLite's integrity_check pragma. Returns true iff the DB is intact.
 * `integrity_check` returns one row containing 'ok' on a healthy DB, or one
 * or more rows describing problems otherwise.
 */
function isDatabaseIntact(db) {
  try {
    const rows = db.pragma('integrity_check');
    return Array.isArray(rows)
      && rows.length === 1
      && (rows[0].integrity_check === 'ok' || rows[0] === 'ok');
  } catch (_) {
    return false;
  }
}

/**
 * Move the corrupt DB + WAL/SHM sidecars aside so a fresh DB can be created.
 * Returns the chosen backup base name (or null if nothing was moved).
 */
function quarantineCorruptDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  const backupName = `speeldit.db.corrupt.${Date.now()}`;
  const backupPath = path.join(DATA_DIR, backupName);
  try {
    fs.renameSync(DB_PATH, backupPath);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(DB_PATH + suffix)) {
        fs.renameSync(DB_PATH + suffix, backupPath + suffix);
      }
    }
    return backupName;
  } catch (_) {
    return null;
  }
}

function openDatabase() {
  // ── Path 1: try to open + verify integrity ───────────────────────────────
  // better-sqlite3's `new Database()` is lazy — it doesn't actually touch the
  // file until the first statement runs. So errors from a non-DB file surface
  // on the first pragma, not on the constructor. We wrap the open + pragmas
  // + integrity_check in a single try block.
  let openErr = null;
  let openedDb = null;
  try {
    openedDb = new Database(DB_PATH);
    applyPragmas(openedDb);

    // Even when the file opens, run integrity_check on existing databases to
    // catch silent corruption before the schema-applying CREATE TABLE statements
    // run against a damaged page tree. A freshly created empty DB has no pages
    // to corrupt yet, so skip the check for zero-byte files.
    const fileExisted = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;
    if (fileExisted && !isDatabaseIntact(openedDb)) {
      try { openedDb.close(); } catch (_) {}
      openedDb = null;
      const backup = quarantineCorruptDb();
      console.error(JSON.stringify({
        t: new Date().toISOString(),
        level: 'CRITICAL',
        msg: 'sqlite-integrity-check-failed',
        backup,
        action: 'integrity_check returned non-ok — quarantined and recreating',
      }));
      const fresh = new Database(DB_PATH);
      applyPragmas(fresh);
      return fresh;
    }

    return openedDb;
  } catch (err) {
    openErr = err;
  }

  // ── Path 2: file is so corrupt that opening or pragma-ing failed ─────────
  // Close any handle we obtained before pragmas threw — on Windows an open
  // handle prevents fs.renameSync, which would defeat the quarantine.
  if (openedDb) {
    try { openedDb.close(); } catch (_) {}
  }
  const backup = quarantineCorruptDb();
  console.error(JSON.stringify({
    t: new Date().toISOString(),
    level: 'CRITICAL',
    msg: 'sqlite-corrupt',
    error: openErr ? openErr.message : 'unknown',
    backup,
    action: 'Backed up corrupt DB and creating fresh database',
  }));
  const fresh = new Database(DB_PATH);
  applyPragmas(fresh);
  return fresh;
}

const db = openDatabase();

// ── Schema ──────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS venues (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    owner_email TEXT NOT NULL,
    owner_password_hash TEXT NOT NULL,
    email_verified INTEGER,
    settings TEXT NOT NULL DEFAULT '{}',
    playlists TEXT NOT NULL DEFAULT '[]',
    active_playlist_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_venues_owner_email ON venues(owner_email COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS queues (
    venue_code TEXT NOT NULL,
    position TEXT NOT NULL CHECK(position IN ('now_playing', 'upcoming')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    song_id TEXT NOT NULL,
    apple_id TEXT,
    provider_track_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    album_art TEXT DEFAULT '',
    duration REAL DEFAULT 0,
    votes INTEGER DEFAULT 0,
    requested_by TEXT,
    requested_at INTEGER,
    position_ms REAL DEFAULT 0,
    position_anchored_at INTEGER,
    is_paused INTEGER DEFAULT 0,
    genre TEXT DEFAULT '',
    PRIMARY KEY (venue_code, song_id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    venue_code TEXT NOT NULL,
    song_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    value INTEGER NOT NULL CHECK(value IN (-1, 0, 1)),
    PRIMARY KEY (venue_code, song_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    venue_code TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_payments (
    checkout_id TEXT PRIMARY KEY,
    venue_code TEXT NOT NULL,
    song TEXT NOT NULL,
    device_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_code TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_venue_time ON analytics(venue_code, timestamp);

  CREATE TABLE IF NOT EXISTS player_volume (
    venue_code TEXT PRIMARY KEY,
    percent INTEGER NOT NULL DEFAULT 50,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_throttles (
    scope TEXT NOT NULL,
    throttle_key TEXT NOT NULL,
    last_at INTEGER NOT NULL,
    PRIMARY KEY (scope, throttle_key)
  );
  CREATE INDEX IF NOT EXISTS idx_request_throttles_last_at ON request_throttles(last_at);

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    venue_code TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_email_type ON auth_tokens(email, type);

  CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    venue_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    gross_cents INTEGER NOT NULL,
    venue_share_percent INTEGER NOT NULL DEFAULT 70,
    venue_amount_cents INTEGER NOT NULL,
    platform_amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed')),
    paid_at INTEGER,
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE(venue_code, year, month)
  );
  CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
  CREATE INDEX IF NOT EXISTS idx_payouts_venue ON payouts(venue_code, year, month);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_role TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    venue_code TEXT,
    ip TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_role, actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

  CREATE TABLE IF NOT EXISTS subscriptions (
    venue_code TEXT PRIMARY KEY,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete')),
    trial_ends_at INTEGER,
    current_period_end INTEGER,
    cancel_at_period_end INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

  -- Every hosted checkout ever opened for a venue, one row per init reference.
  --
  -- The subscriptions table holds ONE row per venue, so starting a second
  -- checkout used to overwrite the first one's init reference and erase all
  -- trace of it. If the venue then completed both hosted pages, the provider
  -- created TWO recurring subscriptions while we could only ever store (and
  -- therefore only ever cancel) the last token to arrive — the other one bills
  -- the venue every month, invisibly, forever.
  --
  -- This ledger is append-only so no checkout can be lost:
  --   open       — hosted page issued, nothing confirmed yet
  --   activated  — an ITN matched this reference and activated the venue
  --   superseded — abandoned; a later checkout replaced it before it activated
  CREATE TABLE IF NOT EXISTS subscription_checkouts (
    reference TEXT PRIMARY KEY,
    venue_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'activated', 'superseded')),
    provider_subscription_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sub_checkouts_venue ON subscription_checkouts(venue_code, status);
  CREATE INDEX IF NOT EXISTS idx_sub_checkouts_provider ON subscription_checkouts(provider_subscription_id);
`);

// Paystack uses the same subscriptions table — the stripe_* columns hold
// Paystack customer_code / subscription_code respectively. These ALTERs add
// Paystack-specific fields we need on top (email_token for cancel, auth_code
// for the saved card, init_reference for correlating the initial transaction).
// Using IF NOT EXISTS via try/catch because older SQLite versions don't
// support ALTER TABLE ADD COLUMN IF NOT EXISTS.
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('subscriptions', 'paystack_email_token', 'TEXT');
addColumnIfMissing('subscriptions', 'paystack_authorization_code', 'TEXT');
addColumnIfMissing('subscriptions', 'paystack_init_reference', 'TEXT');

// Email-verification state for venue owner logins. Three-valued on purpose:
// 1 = verified, 0 = registered but not yet verified, NULL = legacy account
// created before this column existed (grandfathered — never blocked at login).
addColumnIfMissing('venues', 'email_verified', 'INTEGER');

// Proof of payment for payouts. Recorded when the owner marks a payout paid so
// a venue disputing a transfer can be shown the bank reference and date rather
// than just a status flag. Free-text reference (EFT ref / transaction number)
// plus who recorded it — deliberately not a file upload: Render's disk is
// ephemeral and money evidence must not live somewhere it can vanish.
addColumnIfMissing('payouts', 'proof_reference', 'TEXT');
addColumnIfMissing('payouts', 'proof_recorded_at', 'INTEGER');
addColumnIfMissing('payouts', 'proof_recorded_by', 'TEXT');

// Trace every payment row back to the checkout that produced it. Without this
// a payment cannot be reconciled against the provider, and nothing stops the
// same checkout being credited twice (the row id embeds Date.now(), so it is
// unique per call rather than per checkout). The UNIQUE index below is the
// real double-credit guard.
addColumnIfMissing('payments', 'checkout_id', 'TEXT');
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout ON payments(checkout_id) WHERE checkout_id IS NOT NULL'
);

// One-shot claim ledger for checkouts that buy something other than a queued
// song (currently AI playlist generation). The pending_payments row is deleted
// the moment the goods are delivered, so it cannot be the replay guard: once
// it is gone, `verifyCheckout` still answers "paid" for that checkout forever,
// and the same receipt can be redeemed again and again. Claiming the id here
// is the durable "this checkout has been spent" record.
db.exec(`
  CREATE TABLE IF NOT EXISTS consumed_checkouts (
    checkout_id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    venue_code TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Money that the provider confirmed but that we could not turn into a payment
// row (abandoned checkout purged before the webhook landed, fulfilment crash,
// amount-guard rejection). These are NOT lost — they are parked here for the
// owner to inspect and settle by hand, instead of vanishing silently.
db.exec(`
  CREATE TABLE IF NOT EXISTS orphaned_payments (
    checkout_id TEXT PRIMARY KEY,
    venue_code TEXT,
    amount_cents INTEGER,
    reason TEXT NOT NULL,
    detail TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER,
    resolved_note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orphaned_resolved ON orphaned_payments(resolved, created_at);
`);

// One account per email address. Registration checks for an existing venue
// before inserting, but that read and the insert are not atomic — two requests
// racing on the same address both pass the check and both write. The loser is
// then unreachable forever: getVenueByOwnerEmail does LIMIT 1, so one of the
// two venues can never be logged into again. The constraint is what actually
// prevents it; the route's check only produces the friendly error message.
//
// Deliberately non-fatal: a database that already contains duplicates from
// before this index existed must still boot, so the operator can merge them
// by hand rather than being locked out by a crash loop.
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_owner_email_unique ON venues(owner_email COLLATE NOCASE)');
} catch (err) {
  console.error(JSON.stringify({
    t: new Date().toISOString(),
    level: 'CRITICAL',
    msg: 'venues-owner-email-not-unique',
    error: err.message,
    action: 'Duplicate owner_email rows exist — merge them, then restart to enforce uniqueness.',
  }));
}

// `payments` is append-only and grows for the life of the deployment, and every
// earnings/payout/reconcile query filters it by created_at (often with a venue).
// Without this index each of those is a full table scan.
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_venue_created ON payments(venue_code, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at)');

console.log('[DB] SQLite database:', DB_PATH, process.env.DATA_DIR ? '(persistent)' : '(ephemeral - set DATA_DIR for Render disk)');

// Expose `close` as an own property of the exported handle so test cleanup can
// release the file handle (Windows refuses to fs.rmSync the temp dir while the
// DB is still open). Production code never calls this — graceful shutdown in
// server.js exits the process which closes the handle automatically.
db.closeForTest = function closeForTest() {
  try { db.close(); } catch (_) { /* already closed */ }
};

module.exports = db;
