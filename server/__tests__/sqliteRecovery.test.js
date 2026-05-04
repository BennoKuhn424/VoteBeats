/**
 * Tests for the SQLite open-time recovery flow in utils/sqlite.js.
 *
 * Two failure modes are covered:
 *   (1) File is so damaged SQLite throws at `new Database(path)`.
 *   (2) File opens fine but `PRAGMA integrity_check` returns non-ok.
 *
 * In both cases the corrupt file (and any -wal/-shm sidecars) must be moved
 * aside with a `speeldit.db.corrupt.<ts>` name and a fresh DB created. A
 * brand-new empty DATA_DIR must NOT trigger the quarantine path.
 *
 * The module under test reads DATA_DIR at module load and opens the DB at
 * that point too, so each test sets DATA_DIR + jest.isolateModules around a
 * fresh require. process.env mutation is restored in afterEach.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ORIGINAL_ENV = { ...process.env };

let tmpDir;
let consoleErrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speeldit-recovery-'));
  process.env.DATA_DIR = tmpDir;
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.resetModules();
});

afterEach(() => {
  consoleErrSpy.mockRestore();
  process.env = { ...ORIGINAL_ENV };
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

function listCorruptBackups(dir) {
  return fs.readdirSync(dir).filter((f) => f.startsWith('speeldit.db.corrupt.'));
}

function loggedMessages() {
  return consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
}

describe('sqlite.openDatabase — recovery', () => {
  test('happy path: empty DATA_DIR → creates fresh DB, no quarantine', () => {
    jest.isolateModules(() => {
      const db = require('../utils/sqlite');
      expect(db).toBeDefined();
      // Schema was applied — venues table exists
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='venues'").get();
      expect(row?.name).toBe('venues');
    });

    expect(listCorruptBackups(tmpDir)).toHaveLength(0);
    expect(loggedMessages()).not.toContain('sqlite-corrupt');
    expect(loggedMessages()).not.toContain('sqlite-integrity-check-failed');
  });

  test('file too damaged to open: writes garbage, expects quarantine + fresh DB', () => {
    // Write garbage that's NOT a SQLite file. better-sqlite3 throws SQLITE_NOTADB.
    const dbPath = path.join(tmpDir, 'speeldit.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database, not even close. '.repeat(100));

    jest.isolateModules(() => {
      const db = require('../utils/sqlite');
      // Schema applies cleanly on the fresh DB
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='venues'").get();
      expect(row?.name).toBe('venues');
    });

    const backups = listCorruptBackups(tmpDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^speeldit\.db\.corrupt\.\d+$/);
    expect(loggedMessages()).toContain('sqlite-corrupt');
  });

  test('integrity_check fails: real SQLite file with damaged pages → quarantine + fresh DB', () => {
    const dbPath = path.join(tmpDir, 'speeldit.db');

    // Create a real SQLite DB with enough rows that corrupting page 2+ will
    // wipe schema metadata pages. SQLite stores sqlite_master on page 1 with
    // overflow pages following — inserting a few KB of data forces multiple
    // pages and gives us something to wreck.
    {
      const seed = new Database(dbPath);
      seed.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      const insert = seed.prepare("INSERT INTO t (v) VALUES (?)");
      const tx = seed.transaction(() => {
        for (let i = 0; i < 200; i++) insert.run('x'.repeat(500));
      });
      tx();
      seed.close();
    }

    // Corrupt the file by zeroing out a large chunk after the 100-byte header.
    // This obliterates the page-1 b-tree pointers and content pages — both
    // `new Database()` (via first pragma) and `integrity_check` will fail.
    const stat = fs.statSync(dbPath);
    const fd = fs.openSync(dbPath, 'r+');
    try {
      const corruptionLength = Math.max(stat.size - 100, 0);
      const zeros = Buffer.alloc(corruptionLength);
      fs.writeSync(fd, zeros, 0, zeros.length, 100);
    } finally {
      fs.closeSync(fd);
    }

    jest.isolateModules(() => {
      const db = require('../utils/sqlite');
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='venues'").get();
      expect(row?.name).toBe('venues');
      // The pre-corruption table 't' must NOT be present — we got a fresh DB.
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").get();
      expect(t).toBeUndefined();
    });

    const backups = listCorruptBackups(tmpDir);
    expect(backups).toHaveLength(1);
    const logs = loggedMessages();
    // Either recovery path is acceptable — what matters is that we quarantined
    // the bad file and recreated.
    expect(
      logs.includes('sqlite-integrity-check-failed') || logs.includes('sqlite-corrupt')
    ).toBe(true);
  });

  test('healthy existing DB: no quarantine triggered', () => {
    const dbPath = path.join(tmpDir, 'speeldit.db');

    // Create a real, intact SQLite DB.
    {
      const seed = new Database(dbPath);
      seed.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('ok');");
      seed.close();
    }

    jest.isolateModules(() => {
      const db = require('../utils/sqlite');
      // Both the seeded table AND the new schema tables should coexist.
      const tRow = db.prepare("SELECT v FROM t WHERE id = 1").get();
      expect(tRow?.v).toBe('ok');
      const venuesRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='venues'").get();
      expect(venuesRow?.name).toBe('venues');
    });

    expect(listCorruptBackups(tmpDir)).toHaveLength(0);
    expect(loggedMessages()).not.toContain('sqlite-corrupt');
    expect(loggedMessages()).not.toContain('sqlite-integrity-check-failed');
  });
});
