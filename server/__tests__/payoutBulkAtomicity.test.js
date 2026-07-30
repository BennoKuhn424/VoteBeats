/**
 * @jest-environment node
 *
 * Real-DB test for POST /api/payouts/mark-all-paid.
 *
 * The route flips every pending payout for a month to 'paid' in a loop and then
 * writes ONE audit row describing the batch. Without a transaction, a failure
 * partway through the loop left some payouts already marked paid while the
 * audit row — the only record of who marked them and against what proof of
 * payment — was never written at all. That is the worst possible state for
 * money: it looks settled and nothing says why.
 *
 * Mocking the database cannot prove this; the rollback has to be exercised
 * against real SQLite.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let sqlite;
let app;
let request;
let jwt;
let tmpDir;

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';
// Payments are booked with Date.now(), and payouts roll up by payment date, so
// the batch under test is necessarily the current month.
const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-payout-atomic-'));
  process.env.DATA_DIR = tmpDir;
  request = require('supertest');
  jwt = require('jsonwebtoken');
  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
  ({ app } = require('../app'));
});

afterAll(() => {
  try {
    sqlite.closeForTest?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the file handle; the temp dir is disposable.
  }
});

function ownerRequest() {
  const token = jwt.sign(
    { role: 'owner', csrf: 'csrf-owner', jti: 'owner-jti' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  return request(app)
    .post('/api/payouts/mark-all-paid')
    .set('Cookie', `auth_token=${token}`)
    .set('X-CSRF-Token', 'csrf-owner');
}

/** Three venues each owed money for the same month. */
function seedPayouts() {
  sqlite.prepare('DELETE FROM payouts').run();
  sqlite.prepare('DELETE FROM audit_log').run();
  for (const code of ['ATOM01', 'ATOM02', 'ATOM03']) {
    db.saveVenue(code, { code, name: `Bar ${code}`, owner: { email: `${code}@bar.test` }, settings: {} });
    db.addPayment(code, 10000, `chk_${code}`);
  }
  db.generateMonthlyPayouts(YEAR, MONTH);
  const rows = db.getAllPayoutsForMonth(YEAR, MONTH);
  expect(rows.length).toBe(3);
  return rows;
}

function statuses() {
  return db.getAllPayoutsForMonth(YEAR, MONTH).map((p) => p.status).sort();
}

function auditRowCount() {
  return sqlite
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payout.mark-all-paid'")
    .get().n;
}

describe('POST /api/payouts/mark-all-paid', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    sqlite.prepare('DELETE FROM payouts').run();
    sqlite.prepare('DELETE FROM payments').run();
    sqlite.prepare('DELETE FROM audit_log').run();
  });

  test('marks every pending payout and writes one audit row', async () => {
    const rows = seedPayouts();

    const res = await ownerRequest().send({ year: YEAR, month: MONTH, proofReference: 'EFT-2026-04-001' });

    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(rows.length);
    expect(statuses()).toEqual(['paid', 'paid', 'paid']);
    expect(auditRowCount()).toBe(1);
  });

  test('a failure partway through leaves NO payout marked paid and no audit row', async () => {
    seedPayouts();
    let calls = 0;
    jest.spyOn(db, 'updatePayoutStatus').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return jest.requireActual('../utils/database').updatePayoutStatus(...args);
    });

    const res = await ownerRequest().send({ year: YEAR, month: MONTH, proofReference: 'EFT-2026-04-002' });

    expect(res.status).toBe(500);
    // The first update DID run — the rollback is the only thing undoing it.
    expect(calls).toBe(2);
    expect(statuses()).toEqual(['pending', 'pending', 'pending']);
    // And nothing claims a batch was settled.
    expect(auditRowCount()).toBe(0);
  });

  test('refuses to mark anything paid without proof of payment', async () => {
    seedPayouts();

    const res = await ownerRequest().send({ year: YEAR, month: MONTH });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_REQUIRED');
    expect(statuses()).toEqual(['pending', 'pending', 'pending']);
    expect(auditRowCount()).toBe(0);
  });
});
