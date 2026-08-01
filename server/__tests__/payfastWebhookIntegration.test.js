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

/**
 * Only ONE init reference is stored per venue. A venue that opens the billing
 * page twice overwrites the first reference with the second — and if it then
 * completes the FIRST hosted checkout, the ITN carries an m_payment_id that no
 * longer matches any row. That ITN used to fall through as
 * "subscription-charge-unmatched": PayFast had taken the money and the venue
 * was never activated. The reference is server-minted (vbsub_<CODE>_<ts>) and
 * arrives only through a signature-, IP- and postback-verified ITN, so the
 * venue code can be recovered from it.
 */
describe('activation via a superseded init reference', () => {
  const VENUE3 = 'PFVEN3';
  const OLD_REF = `vbsub_${VENUE3}_1700000000001`;
  const NEW_REF = `vbsub_${VENUE3}_1700000009999`;

  test('an ITN for the overwritten reference still activates the venue', async () => {
    db.saveVenue(VENUE3, {
      code: VENUE3, name: 'Second Attempt Bar',
      owner: { email: 'own3@bar.co.za' }, settings: {},
    });
    // /start ran twice — only the newest reference survived on the row.
    db.upsertSubscription({
      venueCode: VENUE3,
      providerCustomerId: 'own3@bar.co.za',
      status: 'incomplete',
      paystackInitReference: NEW_REF,
    });
    expect(db.getSubscriptionByInitReference(OLD_REF)).toBeNull();

    const billingDate = dateStr(daysFromNow(30));
    const res = await postItn(itnBody({
      m_payment_id: OLD_REF, // the venue paid on the FIRST checkout page
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-333',
      billing_date: billingDate,
      merchant_id: MERCHANT_ID,
      email_address: 'own3@bar.co.za',
    }));

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    const sub = db.getSubscription(VENUE3);
    expect(sub.status).toBe('active');
    expect(sub.providerSubscriptionId).toBe('pf-tok-333');
  });

  test('a reference for a venue with no subscription row is still unmatched', async () => {
    const res = await postItn(itnBody({
      m_payment_id: 'vbsub_NOSUCH_1700000000002',
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-444',
      merchant_id: MERCHANT_ID,
      email_address: 'ghost@bar.co.za',
    }));

    // Acked so PayFast stops retrying, but nothing was created out of thin air.
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(db.getSubscription('NOSUCH')).toBeNull();
  });

  test('a reference that is not ours is not parsed for a venue code', async () => {
    const res = await postItn(itnBody({
      m_payment_id: 'somebody-elses-ref',
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      token: 'pf-tok-555',
      merchant_id: MERCHANT_ID,
      email_address: 'other@bar.co.za',
    }));

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two live subscriptions for one venue.
//
// The subscriptions table holds ONE row per venue, so only one provider token
// can ever be stored. If a venue completes two hosted checkouts, PayFast runs
// two recurring subscriptions and the second token overwrites the first —
// leaving the first billing R599 every month with nothing in the app able to
// reach it, and no trace it exists.
// ─────────────────────────────────────────────────────────────────────────────
describe('duplicate subscriptions', () => {
  const VENUE2 = 'PFVEN9';
  const REF_A = `vbsub_${VENUE2}_1700000000001`;
  const REF_B = `vbsub_${VENUE2}_1700000000002`;

  beforeAll(() => {
    db.saveVenue(VENUE2, {
      code: VENUE2, name: 'Double Bar', owner: { email: 'owner@double.co.za' }, settings: {},
    });
  });

  test('a second token is cancelled at PayFast instead of silently replacing the first', async () => {
    db.upsertSubscription({
      venueCode: VENUE2,
      providerCustomerId: 'owner@double.co.za',
      status: 'incomplete',
      paystackInitReference: REF_A,
      providerSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
    db.recordSubscriptionCheckout({ reference: REF_A, venueCode: VENUE2 });

    // Checkout A activates normally.
    const trialEnd = daysFromNow(14);
    await postItn(itnBody({
      m_payment_id: REF_A,
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      token: 'pf-dup-AAA',
      billing_date: dateStr(trialEnd),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@double.co.za',
    }));
    expect(db.getSubscription(VENUE2).providerSubscriptionId).toBe('pf-dup-AAA');

    // Checkout B — a second hosted page the venue also completed — arrives with
    // a DIFFERENT token. PayFast is now billing this venue twice.
    db.recordSubscriptionCheckout({ reference: REF_B, venueCode: VENUE2 });
    const cancelCalls = [];
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).includes('/eng/query/validate')) return { ok: true, text: async () => 'VALID' };
      cancelCalls.push({ url: String(url), method: opts?.method });
      return { ok: true, status: 200, text: async () => 'OK' };
    });

    const res = await postItn(itnBody({
      m_payment_id: REF_B,
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      token: 'pf-dup-BBB',
      billing_date: dateStr(trialEnd),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@double.co.za',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);

    // Let the fire-and-forget cancel settle.
    await new Promise((r) => setImmediate(r));

    // The tracked subscription is untouched — we keep the one the app can reach.
    const sub = db.getSubscription(VENUE2);
    expect(sub.providerSubscriptionId).toBe('pf-dup-AAA');

    // And the duplicate was actually cancelled at PayFast, not just logged.
    expect(cancelCalls.some((c) => c.url.includes('pf-dup-BBB') && /cancel/.test(c.url))).toBe(true);
  });

  test('the audit query surfaces a duplicate that could not be cancelled', () => {
    // Simulate the cancel having failed: the ledger still holds a token the
    // subscription no longer points at. This must be visible to ops.
    db.markSubscriptionCheckout(REF_B, { status: 'activated', providerSubscriptionId: 'pf-dup-BBB' });
    const dupes = db.listDuplicateSubscriptionCheckouts();
    expect(dupes.some((d) => d.venueCode === VENUE2 && d.providerSubscriptionId === 'pf-dup-BBB')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Instant trial access: /complete activates a trial optimistically so the venue
// is not left staring at a spinner. The ITN still has to do the real work.
// ─────────────────────────────────────────────────────────────────────────────
describe('optimistically-activated trial', () => {
  const VENUE3 = 'PFVEN8';
  const REF_C = `vbsub_${VENUE3}_1700000000003`;

  beforeAll(() => {
    db.saveVenue(VENUE3, {
      code: VENUE3, name: 'Instant Bar', owner: { email: 'owner@instant.co.za' }, settings: {},
    });
  });

  test('first ITN is still handled as the ACTIVATION, not as a renewal', async () => {
    // The state /complete leaves behind: trialing, dated, but no provider token.
    const optimisticTrialEnd = Date.now() + 14 * 24 * 60 * 60 * 1000;
    db.upsertSubscription({
      venueCode: VENUE3,
      providerCustomerId: 'owner@instant.co.za',
      status: 'trialing',
      paystackInitReference: REF_C,
      providerSubscriptionId: null,
      trialEndsAt: optimisticTrialEnd,
      currentPeriodEnd: optimisticTrialEnd,
    });
    db.recordSubscriptionCheckout({ reference: REF_C, venueCode: VENUE3 });

    const billingDate = daysFromNow(14);
    const res = await postItn(itnBody({
      m_payment_id: REF_C,
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      token: 'pf-tok-instant',
      billing_date: dateStr(billingDate),
      merchant_id: MERCHANT_ID,
      email_address: 'owner@instant.co.za',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);

    const sub = db.getSubscription(VENUE3);
    // The durable token must get stored — treating this as a renewal would skip
    // it and leave the subscription permanently uncancellable.
    expect(sub.providerSubscriptionId).toBe('pf-tok-instant');
    expect(sub.status).toBe('trialing');
    // A R0.00 tokenization must NOT buy a month of paid service.
    expect(sub.currentPeriodEnd).toBe(new Date(dateStr(billingDate)).getTime());
    expect(email.sendTrialStartedEmail).toHaveBeenCalled();

    // And the ledger now proves the provider confirmed it.
    expect(db.getSubscriptionCheckout(REF_C).status).toBe('activated');
  });
});
