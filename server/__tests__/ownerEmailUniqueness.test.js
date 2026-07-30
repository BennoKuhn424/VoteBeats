/**
 * @jest-environment node
 *
 * Registration reads "is this email taken?" and then inserts, with no
 * transaction spanning the two. Two signups racing on the same address both
 * pass the read and both write. `getVenueByOwnerEmail` does LIMIT 1, so from
 * that moment one of the two venues is permanently unreachable: its owner can
 * never log in, and password reset lands on the other account.
 *
 * The database constraint is what actually prevents it — the route's check
 * only exists to produce a friendly message. These tests pin the constraint,
 * including its case-insensitivity (the lookup is COLLATE NOCASE, so
 * "Owner@bar.com" and "owner@bar.com" must be the same account).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let sqlite;
let tmpDir;

const venue = (code, email) => ({
  code,
  name: `Venue ${code}`,
  owner: { email, passwordHash: 'hash', emailVerified: true },
  settings: {},
  createdAt: new Date().toISOString(),
});

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-email-uniq-'));
  process.env.DATA_DIR = tmpDir;
  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
});

afterAll(() => {
  try {
    sqlite.closeForTest?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the file handle; the temp dir is disposable.
  }
});

describe('venues.owner_email uniqueness', () => {
  test('a second venue cannot claim an email already in use', () => {
    db.saveVenue('UNIQ01', venue('UNIQ01', 'taken@bar.co.za'));

    expect(() => db.saveVenue('UNIQ02', venue('UNIQ02', 'taken@bar.co.za')))
      .toThrow(/UNIQUE constraint failed/i);

    // The first account is still the one the login lookup resolves to.
    expect(db.getVenueByOwnerEmail('taken@bar.co.za').code).toBe('UNIQ01');
    expect(db.getVenue('UNIQ02')).toBeUndefined();
  });

  test('the constraint is case-insensitive, matching the login lookup', () => {
    db.saveVenue('UNIQ03', venue('UNIQ03', 'mixed@bar.co.za'));

    expect(() => db.saveVenue('UNIQ04', venue('UNIQ04', 'MiXeD@bar.co.za')))
      .toThrow(/UNIQUE constraint failed/i);
  });

  test('a venue can still update its own row', () => {
    db.saveVenue('UNIQ05', venue('UNIQ05', 'self@bar.co.za'));
    const updated = venue('UNIQ05', 'self@bar.co.za');
    updated.name = 'Renamed Bar';

    expect(() => db.saveVenue('UNIQ05', updated)).not.toThrow();
    expect(db.getVenue('UNIQ05').name).toBe('Renamed Bar');
  });

  test('distinct emails are unaffected', () => {
    expect(() => {
      db.saveVenue('UNIQ06', venue('UNIQ06', 'a@bar.co.za'));
      db.saveVenue('UNIQ07', venue('UNIQ07', 'b@bar.co.za'));
    }).not.toThrow();
  });
});
