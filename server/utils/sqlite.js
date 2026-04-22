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

function openDatabase() {
  try {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    // Corrupt database — back it up and start fresh
    const backupName = `speeldit.db.corrupt.${Date.now()}`;
    const backupPath = path.join(DATA_DIR, backupName);
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      level: 'CRITICAL',
      msg: 'sqlite-corrupt',
      error: err.message,
      backup: backupName,
      action: 'Backed up corrupt DB and creating fresh database',
    }));
    try {
      if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, backupPath);
      // Also move WAL/SHM files if they exist
      const walPath = DB_PATH + '-wal';
      const shmPath = DB_PATH + '-shm';
      if (fs.existsSync(walPath)) fs.renameSync(walPath, backupPath + '-wal');
      if (fs.existsSync(shmPath)) fs.renameSync(shmPath, backupPath + '-shm');
    } catch (_) { /* ignore backup failure */ }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  }
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
    settings TEXT NOT NULL DEFAULT '{}',
    playlists TEXT NOT NULL DEFAULT '[]',
    active_playlist_id TEXT,
    created_at TEXT NOT NULL
  );

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

console.log('[DB] SQLite database:', DB_PATH, process.env.DATA_DIR ? '(persistent)' : '(ephemeral - set DATA_DIR for Render disk)');

module.exports = db;
