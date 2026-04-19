#!/usr/bin/env node
/**
 * One-time migration: reads existing JSON data files and inserts them into
 * the SQLite database. Safe to run multiple times (uses INSERT OR REPLACE).
 *
 * Usage:
 *   node server/scripts/migrate-json-to-sqlite.js
 *   DATA_DIR=/var/data node server/scripts/migrate-json-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

function readJSONFile(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    const raw = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`  ⚠ Could not parse ${filename}: ${err.message}`);
    return null;
  }
}

// Decrypt if needed
let paymentCrypto;
try {
  paymentCrypto = require('../utils/paymentCrypto');
} catch {
  paymentCrypto = { ENABLED: false };
}

function readEncryptedJSONFile(filename) {
  const parsed = readJSONFile(filename);
  if (!parsed) return null;
  if (parsed._encrypted && paymentCrypto.ENABLED) {
    const decrypted = paymentCrypto.decrypt(parsed._encrypted);
    if (decrypted) {
      try { return JSON.parse(decrypted); } catch { return null; }
    }
    console.warn(`  ⚠ Could not decrypt ${filename}`);
    return null;
  }
  return parsed;
}

console.log('═══════════════════════════════════════════════════');
console.log('  VoteBeats JSON → SQLite Migration');
console.log('  DATA_DIR:', DATA_DIR);
console.log('═══════════════════════════════════════════════════\n');

// Import sqlite.js to initialize DB and get the connection
const db = require('../utils/sqlite');

let totalRows = 0;

// ── 1. Venues ──────────────────────────────────────────────────────────────────
const venues = readJSONFile('venues.json');
if (venues && typeof venues === 'object') {
  const entries = Object.entries(venues);
  console.log(`[venues] Found ${entries.length} venue(s)`);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO venues (code, name, location, owner_email, owner_password_hash, settings, playlists, active_playlist_id, created_at)
    VALUES (@code, @name, @location, @owner_email, @owner_password_hash, @settings, @playlists, @active_playlist_id, @created_at)
  `);

  const insertAll = db.transaction((list) => {
    for (const [code, v] of list) {
      stmt.run({
        code,
        name: v.name || code,
        location: v.location || '',
        owner_email: v.owner?.email || '',
        owner_password_hash: v.owner?.passwordHash || '',
        settings: JSON.stringify(v.settings || {}),
        playlists: JSON.stringify(v.playlists || []),
        active_playlist_id: v.activePlaylistId || null,
        created_at: v.createdAt || new Date().toISOString(),
      });
    }
  });
  insertAll(entries);
  totalRows += entries.length;
  console.log(`  ✓ Migrated ${entries.length} venue(s)`);
} else {
  console.log('[venues] No venues.json found or empty');
}

// ── 2. Queues ──────────────────────────────────────────────────────────────────
const queues = readJSONFile('queues.json');
if (queues && typeof queues === 'object') {
  const venueCodes = Object.keys(queues);
  console.log(`[queues] Found queues for ${venueCodes.length} venue(s)`);

  const delStmt = db.prepare('DELETE FROM queues WHERE venue_code = ?');
  const insStmt = db.prepare(`
    INSERT OR REPLACE INTO queues (venue_code, position, sort_order, song_id, apple_id, provider_track_id,
      title, artist, album_art, duration, votes, requested_by, requested_at,
      position_ms, position_anchored_at, is_paused, genre)
    VALUES (@venue_code, @position, @sort_order, @song_id, @apple_id, @provider_track_id,
      @title, @artist, @album_art, @duration, @votes, @requested_by, @requested_at,
      @position_ms, @position_anchored_at, @is_paused, @genre)
  `);

  let songCount = 0;
  const insertAll = db.transaction(() => {
    for (const venueCode of venueCodes) {
      const q = queues[venueCode];
      delStmt.run(venueCode);

      if (q.nowPlaying) {
        const s = q.nowPlaying;
        insStmt.run({
          venue_code: venueCode, position: 'now_playing', sort_order: 0,
          song_id: s.id, apple_id: s.appleId || null,
          provider_track_id: s.providerTrackId || s.appleId || null,
          title: s.title || '', artist: s.artist || '',
          album_art: s.albumArt || '', duration: s.duration || 0,
          votes: s.votes || 0, requested_by: s.requestedBy || null,
          requested_at: s.requestedAt || null, position_ms: s.positionMs || 0,
          position_anchored_at: s.positionAnchoredAt || null,
          is_paused: s.isPaused ? 1 : 0, genre: s.genre || '',
        });
        songCount++;
      }

      if (Array.isArray(q.upcoming)) {
        for (let i = 0; i < q.upcoming.length; i++) {
          const s = q.upcoming[i];
          insStmt.run({
            venue_code: venueCode, position: 'upcoming', sort_order: i,
            song_id: s.id, apple_id: s.appleId || null,
            provider_track_id: s.providerTrackId || s.appleId || null,
            title: s.title || '', artist: s.artist || '',
            album_art: s.albumArt || '', duration: s.duration || 0,
            votes: s.votes || 0, requested_by: s.requestedBy || null,
            requested_at: s.requestedAt || null, position_ms: 0,
            position_anchored_at: null, is_paused: 0, genre: s.genre || '',
          });
          songCount++;
        }
      }
    }
  });
  insertAll();
  totalRows += songCount;
  console.log(`  ✓ Migrated ${songCount} song(s) across ${venueCodes.length} venue(s)`);
} else {
  console.log('[queues] No queues.json found or empty');
}

// ── 3. Votes ───────────────────────────────────────────────────────────────────
const votes = readJSONFile('votes.json');
if (votes && typeof votes === 'object') {
  let voteCount = 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO votes (venue_code, song_id, device_id, value) VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const [venueCode, songs] of Object.entries(votes)) {
      if (!songs || typeof songs !== 'object') continue;
      for (const [songId, devices] of Object.entries(songs)) {
        if (!devices || typeof devices !== 'object') continue;
        for (const [deviceId, value] of Object.entries(devices)) {
          stmt.run(venueCode, songId, deviceId, value);
          voteCount++;
        }
      }
    }
  });
  insertAll();
  totalRows += voteCount;
  console.log(`[votes] ✓ Migrated ${voteCount} vote(s)`);
} else {
  console.log('[votes] No votes.json found or empty');
}

// ── 4. Payments ────────────────────────────────────────────────────────────────
const payments = readEncryptedJSONFile('payments.json');
if (payments && Array.isArray(payments.list)) {
  const stmt = db.prepare('INSERT OR REPLACE INTO payments (id, venue_code, amount_cents, created_at) VALUES (?, ?, ?, ?)');
  const insertAll = db.transaction((list) => {
    for (const p of list) {
      stmt.run(p.id, p.venueCode, p.amountCents || 0, p.createdAt || 0);
    }
  });
  insertAll(payments.list);
  totalRows += payments.list.length;
  console.log(`[payments] ✓ Migrated ${payments.list.length} payment(s)`);
} else {
  console.log('[payments] No payments.json found or empty');
}

// ── 5. Pending payments ────────────────────────────────────────────────────────
const pending = readEncryptedJSONFile('pendingPayments.json');
if (pending && typeof pending === 'object') {
  const entries = Object.entries(pending);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pending_payments (checkout_id, venue_code, song, device_id, amount_cents, created_at)
    VALUES (@checkout_id, @venue_code, @song, @device_id, @amount_cents, @created_at)
  `);
  let count = 0;
  const insertAll = db.transaction(() => {
    for (const [checkoutId, data] of entries) {
      stmt.run({
        checkout_id: checkoutId,
        venue_code: data.venueCode || '',
        song: JSON.stringify(data.song || {}),
        device_id: data.deviceId || '',
        amount_cents: data.amountCents || 0,
        created_at: data.createdAt || 0,
      });
      count++;
    }
  });
  insertAll();
  totalRows += count;
  console.log(`[pending] ✓ Migrated ${count} pending payment(s)`);
} else {
  console.log('[pending] No pendingPayments.json found or empty');
}

// ── 6. Analytics ───────────────────────────────────────────────────────────────
const analytics = readJSONFile('analytics.json');
if (analytics && typeof analytics === 'object') {
  const stmt = db.prepare('INSERT INTO analytics (venue_code, data, timestamp) VALUES (?, ?, ?)');
  let count = 0;
  const insertAll = db.transaction(() => {
    for (const [venueCode, events] of Object.entries(analytics)) {
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        const ts = event.timestamp || 0;
        const { timestamp, ...rest } = event;
        stmt.run(venueCode, JSON.stringify(rest), ts);
        count++;
      }
    }
  });
  insertAll();
  totalRows += count;
  console.log(`[analytics] ✓ Migrated ${count} event(s)`);
} else {
  console.log('[analytics] No analytics.json found or empty');
}

// ── 7. Player volume ───────────────────────────────────────────────────────────
const playerVolume = readJSONFile('playerVolume.json');
if (playerVolume && typeof playerVolume === 'object') {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO player_volume (venue_code, percent, updated_at) VALUES (?, ?, ?)
  `);
  let count = 0;
  const insertAll = db.transaction(() => {
    for (const [venueCode, data] of Object.entries(playerVolume)) {
      stmt.run(venueCode, data.percent || 50, data.updatedAt || 0);
      count++;
    }
  });
  insertAll();
  totalRows += count;
  console.log(`[volume] ✓ Migrated ${count} volume record(s)`);
} else {
  console.log('[volume] No playerVolume.json found or empty');
}

// ── 8. Auth tokens ─────────────────────────────────────────────────────────────
const authTokens = readJSONFile('authTokens.json');
if (authTokens && typeof authTokens === 'object') {
  const entries = Object.entries(authTokens);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO auth_tokens (token, email, type, expires_at, created_at, venue_code)
    VALUES (@token, @email, @type, @expires_at, @created_at, @venue_code)
  `);
  const insertAll = db.transaction((list) => {
    for (const [token, data] of list) {
      stmt.run({
        token,
        email: data.email || '',
        type: data.type || 'verify',
        expires_at: data.expiresAt || 0,
        created_at: data.createdAt || 0,
        venue_code: data.venueCode || null,
      });
    }
  });
  insertAll(entries);
  totalRows += entries.length;
  console.log(`[auth] ✓ Migrated ${entries.length} auth token(s)`);
} else {
  console.log('[auth] No authTokens.json found or empty');
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Migration complete: ${totalRows} total rows inserted`);
console.log(`  Database: ${path.join(DATA_DIR, 'votebeats.db')}`);
console.log(`═══════════════════════════════════════════════════`);
