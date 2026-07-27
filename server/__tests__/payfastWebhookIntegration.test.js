/**
 * @jest-environment node
 *
 * End-to-end ITN lifecycle against the REAL sqlite layer and the REAL PayFast
 * provider: signup (incomplete) → activation ITN (0.00 tokenization) →
 * renewal ITN → cancellation ITN, plus every rejection path that protects
 * money (bad signature, failed /validate, unreachable /validate, wrong
 * amount, unknown reference, foreign merchant).
 *
 * Only email and the network (global.fetch, used for the /validate postback)
 * are mocked. Mocked-db tests have hidden money bugs here before — the ledger
 * work found real defects only visible against sqlite.
 */

jest.mock('../utils/email', () => ({
  sendSubscriptionReceiptEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionCanceledEmail: jest.fn().mockResolvedValue(undefined),
  sendTrialStartedEmail: jest.fn().mockResolvedValue(undefined),
}));

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSPHRASE = 'itn-test-pass';
const MERCHANT_ID = '10000100';
const VENUE = 'PFVEN1';
const REFERENCE = `vbsub_${VENUE}_1700000000000`;

let db;
let sqlite;
let email;
let subscriptionWebhook;
let pfEncode;
let tmpDir;
let realFetch;

const ENV = {
  SUBSCRIPTION_PROVIDER: 'payfast',
  PAYFAST_MERCHANT_ID: MERCHANT_ID,
  PAYFAST_MERCHANT_KEY: '46f0cd694581a',
  PAYFAST_PASSPHRASE: PASSPHRASE,
  PAYFAST_SANDBOX: 'true', // relaxes the source-IP layer; signature + validate stay hard
  SUBSCRIPTION_AMOUNT_ZAR: '599',
  SUBSCRIPTION_TRIAL_DAYS: '14',
  PUBLIC_API_URL: 'https://api.speeldit.test',
};
const savedEnv = {};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-payfast-itn-'));
  savedEnv.DATA_DIR = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }

  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
  email = require('../utils/email');
  ({ pfEncode } = require('../utils/payfast'));
  require('../providers/subscription')._resetProviderForTests();
  ({ subscriptionWebhook } = require('../routes/subscriptionWebhooks'));

  db.saveVenue(VENUE, { code: VENUE, name: 'PayFast Bar', owner: { email: 'owner@pfbar.co.za' }, settings: {} });

  realFetch = global.fetch;
});

afterAll(() => {
  global.fetch = realFetch;
  require('../providers/subscription')._resetProviderForTests();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    sqlite.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows may hold the handle; temp dir is disposable.
  }
});

let ipCounter = 0;
beforeEach(() => {
  jest.clearAllMocks();
  // The webhook has a per-IP rate limit — give every request a fresh IP.
  ipCounter++;
  // Default: PayFast confirms the postback.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => 'VALID' });
});

/** Build a signed, form-encoded ITN body the way PayFast would. */
function itnBody(fields, { passphrase = PASSPHRASE, tamper = false } = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${pfEncode(v)}`);
  const toSign = [...parts, `passphrase=${pfEncode(passphrase)}`].join('&');
  let sig = crypto.createHash('md5').update(toSign).digest('hex');
  if (tamper) sig = sig.replace(/^./, sig[0] === '0' ? '1' : '0');
  return `${parts.join('&')}&signature=${sig}`;
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

async function postItn(body) {
  const res = mockRes();
  const req = {
    body: Buffer.from(body, 'utf8'),
    ip: `10.0.0.${ipCounter}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    socket: { remoteAddress: `10.0.0.${ipCounter}` },
  };
  await subscriptionWebhook(req, res);
  return res;
}

function seedIncomplete() {
  db.upsertSubscription({
    venueCode: VENUE,
    providerCustomerId: 'owner@pfbar.co.za',
    status: 'incomplete',
    paystackInitReference: REFERENCE,
    providerSubscriptionId: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
  });
}

const daysFromNow = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);
const dateStr = (d) => d.toISOString().slice(0, 10);

describe('activation — the first verified ITN turns incomplete into trialing', () => {
  test('0.00 tokenization ITN activates the trial, stores the PayFast token, sets dates', async () => {
    seedIncomplete();
    const trialEnd = daysFromNow(14);
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      pf_payment_id: '1089250',
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      token: 'pf-tok-111',
      billing_date: dateStr(trialEnd),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const sub = db.getSubscription(VENUE);
    expect(sub.status).toBe('trialing');
    expect(sub.providerSubscriptionId).toBe('pf-tok-111');
    expect(sub.trialEndsAt).toBe(new Date(dateStr(trialEnd)).getTime());
    expect(sub.currentPeriodEnd).toBe(new Date(dateStr(trialEnd)).getTime());
    expect(email.sendTrialStartedEmail).toHaveBeenCalledWith(
      'owner@pfbar.co.za',
      expect.objectContaining({ venueName: 'PayFast Bar', amountZar: 599 })
    );
    // The verified body was posted back to PayFast for confirmation.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/eng/query/validate'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('re-delivered activation ITN is idempotent', async () => {
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      token: 'pf-tok-111',
      billing_date: dateStr(daysFromNow(14)),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const after = db.getSubscription(VENUE);
    // Still one subscription, still trialing, token unchanged.
    expect(after.status).toBe('trialing');
    expect(after.providerSubscriptionId).toBe(before.providerSubscriptionId);
  });
});

describe('renewals — extend only for the right money', () => {
  test('a 599.00 renewal ITN (matched by token) flips to active and extends the period', async () => {
    const nextBilling = daysFromNow(44);
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-111',
      billing_date: dateStr(nextBilling),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const sub = db.getSubscription(VENUE);
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodEnd).toBe(new Date(dateStr(nextBilling)).getTime());
    expect(email.sendSubscriptionReceiptEmail).toHaveBeenCalled();
  });

  test('an ITN for the WRONG amount never extends service', async () => {
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      payment_status: 'COMPLETE',
      amount_gross: '5.00',
      token: 'pf-tok-111',
      billing_date: dateStr(daysFromNow(74)),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));

    // Acked (delivery worked; the discrepancy is ops' problem, not PayFast's)
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const after = db.getSubscription(VENUE);
    expect(after.currentPeriodEnd).toBe(before.currentPeriodEnd);
    expect(after.status).toBe(before.status);
    expect(email.sendSubscriptionReceiptEmail).not.toHaveBeenCalled();
  });

  test('a stale billing_date can never shrink the paid period into the past', async () => {
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-111',
      billing_date: '2020-01-01',
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const after = db.getSubscription(VENUE);
    expect(after.currentPeriodEnd).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(after.currentPeriodEnd).toBeGreaterThanOrEqual(before.currentPeriodEnd - 1);
  });
});

describe('rejection paths — nothing moves on unverified input', () => {
  const goodFields = () => ({
    m_payment_id: REFERENCE,
    payment_status: 'COMPLETE',
    amount_gross: '599.00',
    token: 'pf-tok-111',
    billing_date: dateStr(daysFromNow(60)),
    merchant_id: MERCHANT_ID,
    email_address: 'owner@pfbar.co.za',
  });

  test('tampered signature → 403, subscription untouched', async () => {
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody(goodFields(), { tamper: true }));
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(db.getSubscription(VENUE).currentPeriodEnd).toBe(before.currentPeriodEnd);
  });

  test('PayFast answers INVALID on the postback → 403, subscription untouched', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => 'INVALID' });
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody(goodFields()));
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(db.getSubscription(VENUE).currentPeriodEnd).toBe(before.currentPeriodEnd);
  });

  test('validate endpoint unreachable → 500 so PayFast retries; event not processed', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody(goodFields()));
    expect(res.sendStatus).toHaveBeenCalledWith(500);
    expect(db.getSubscription(VENUE).currentPeriodEnd).toBe(before.currentPeriodEnd);
  });

  test('foreign merchant_id → acked but ignored', async () => {
    const before = db.getSubscription(VENUE);
    const res = await postItn(itnBody({ ...goodFields(), merchant_id: '99999999' }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(db.getSubscription(VENUE).currentPeriodEnd).toBe(before.currentPeriodEnd);
  });

  test('unknown token AND unknown reference → acked, logged, nothing written', async () => {
    const res = await postItn(itnBody({
      ...goodFields(),
      m_payment_id: 'vbsub_GHOST_1',
      token: 'pf-tok-ghost',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(db.getSubscription(VENUE).status).toBe('active'); // untouched
  });
});

describe('cancellation', () => {
  test('CANCELLED ITN → status canceled + email', async () => {
    const res = await postItn(itnBody({
      m_payment_id: REFERENCE,
      payment_status: 'CANCELLED',
      token: 'pf-tok-111',
      merchant_id: MERCHANT_ID,
      email_address: 'owner@pfbar.co.za',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(db.getSubscription(VENUE).status).toBe('canceled');
    expect(email.sendSubscriptionCanceledEmail).toHaveBeenCalled();
  });
});

describe('activation without a trial', () => {
  test('a full-fee first ITN activates straight to active', async () => {
    const VENUE2 = 'PFVEN2';
    const REF2 = `vbsub_${VENUE2}_1700000000001`;
    db.saveVenue(VENUE2, { code: VENUE2, name: 'No Trial Bar', owner: { email: 'own2@bar.co.za' }, settings: {} });
    db.upsertSubscription({
      venueCode: VENUE2,
      providerCustomerId: 'own2@bar.co.za',
      status: 'incomplete',
      paystackInitReference: REF2,
    });

    const billingDate = dateStr(daysFromNow(31));
    const res = await postItn(itnBody({
      m_payment_id: REF2,
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-222',
      billing_date: billingDate,
      merchant_id: MERCHANT_ID,
      email_address: 'own2@bar.co.za',
    }));

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const sub = db.getSubscription(VENUE2);
    // Money moved on activation → this is NOT a trial. billing_date is simply
    // the next charge → period end.
    expect(sub.status).toBe('active');
    expect(sub.providerSubscriptionId).toBe('pf-tok-222');
    expect(sub.currentPeriodEnd).toBe(new Date(billingDate).getTime());
    expect(email.sendTrialStartedEmail).not.toHaveBeenCalled();
  });
});
