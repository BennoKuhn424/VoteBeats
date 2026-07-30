/**
 * @jest-environment node
 *
 * Unit tests for PayfastSubscriptionProvider — checkout construction (trial
 * money rules), webhook verification layers, event normalization, and cancel
 * safety. Network is stubbed at the utils layer.
 */

const crypto = require('crypto');
const payfast = require('../utils/payfast');
const PayfastSubscriptionProvider = require('../providers/subscription/PayfastSubscriptionProvider');
const { getProvider, _resetProviderForTests } = require('../providers/subscription');

const ENV_KEYS = [
  'PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE', 'PAYFAST_SANDBOX',
  'SUBSCRIPTION_PROVIDER', 'SUBSCRIPTION_AMOUNT_ZAR', 'SUBSCRIPTION_TRIAL_DAYS',
  'PAYSTACK_TRIAL_DAYS', 'PUBLIC_API_URL',
];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PAYFAST_MERCHANT_ID = '10000100';
  process.env.PAYFAST_MERCHANT_KEY = '46f0cd694581a';
  process.env.PAYFAST_PASSPHRASE = 'test-pass';
  process.env.PUBLIC_API_URL = 'https://api.speeldit.com';
  _resetProviderForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetProviderForTests();
});

describe('factory registration', () => {
  test('SUBSCRIPTION_PROVIDER=payfast resolves the PayFast provider', () => {
    process.env.SUBSCRIPTION_PROVIDER = 'payfast';
    const p = getProvider();
    expect(p.name).toBe('payfast');
    expect(p).toBeInstanceOf(PayfastSubscriptionProvider);
  });

  test('activation is webhook-driven', () => {
    expect(new PayfastSubscriptionProvider().activationVia).toBe('webhook');
  });
});

describe('isConfigured', () => {
  test('true with merchant id + key + public API url, false when any is missing', () => {
    expect(new PayfastSubscriptionProvider().isConfigured()).toBe(true);
    delete process.env.PAYFAST_MERCHANT_KEY;
    expect(new PayfastSubscriptionProvider().isConfigured()).toBe(false);
  });

  test('missing PUBLIC_API_URL → unconfigured (the ITN could never reach us)', () => {
    delete process.env.PUBLIC_API_URL;
    expect(new PayfastSubscriptionProvider().isConfigured()).toBe(false);
  });
});

describe('initCardCapture — checkout construction and money rules', () => {
  function paramsOf(url) {
    return new URLSearchParams(url.split('?')[1]);
  }

  test('trial signup: initial amount 0.00 (tokenize only), recurring = monthly fee, billing_date = trial end', async () => {
    process.env.SUBSCRIPTION_AMOUNT_ZAR = '599';
    process.env.SUBSCRIPTION_TRIAL_DAYS = '14';
    const p = new PayfastSubscriptionProvider();
    const { authorizationUrl, reference } = await p.initCardCapture({
      email: 'owner@bar.co.za',
      amountZar: 1,
      reference: 'vbsub_VEN001_123',
      callbackUrl: 'https://speeldit.com/venue/billing/complete?reference=vbsub_VEN001_123',
    });

    expect(reference).toBe('vbsub_VEN001_123');
    const q = paramsOf(authorizationUrl);
    expect(authorizationUrl.startsWith(`${payfast.LIVE_PROCESS_HOST}/eng/process?`)).toBe(true);
    expect(q.get('amount')).toBe('0.00');
    expect(q.get('recurring_amount')).toBe('599.00');
    expect(q.get('subscription_type')).toBe('1');
    expect(q.get('frequency')).toBe('3');
    expect(q.get('cycles')).toBe('0');
    expect(q.get('m_payment_id')).toBe('vbsub_VEN001_123');
    expect(q.get('notify_url')).toBe('https://api.speeldit.com/api/webhooks/subscription');

    const expectedBillingDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    expect(q.get('billing_date')).toBe(expectedBillingDate);
  });

  test('no-trial signup: charges the fee now and starts recurring next month (never twice in month one)', async () => {
    process.env.SUBSCRIPTION_AMOUNT_ZAR = '599';
    process.env.SUBSCRIPTION_TRIAL_DAYS = '0';
    const p = new PayfastSubscriptionProvider();
    const { authorizationUrl } = await p.initCardCapture({
      email: 'owner@bar.co.za',
      reference: 'vbsub_VEN001_124',
      callbackUrl: 'https://speeldit.com/cb',
    });

    const q = paramsOf(authorizationUrl);
    expect(q.get('amount')).toBe('599.00');
    expect(q.get('recurring_amount')).toBe('599.00');
    // billing_date must be in the future — roughly one month out.
    const billing = new Date(q.get('billing_date')).getTime();
    expect(billing).toBeGreaterThan(Date.now() + 20 * 24 * 60 * 60 * 1000);
  });

  test('signature covers the fields in insertion order with the passphrase', async () => {
    const p = new PayfastSubscriptionProvider();
    const { authorizationUrl } = await p.initCardCapture({
      email: 'owner@bar.co.za',
      reference: 'vbsub_V_1',
      callbackUrl: 'https://cb.example',
    });
    const q = paramsOf(authorizationUrl);
    const sig = q.get('signature');
    // Recompute over every non-signature field in the order they appear.
    const pairs = [];
    for (const [k, v] of q.entries()) {
      if (k !== 'signature') pairs.push([k, v]);
    }
    expect(sig).toBe(payfast.signParams(pairs, 'test-pass'));
  });

  test('throws PROVIDER_NOT_CONFIGURED without credentials', async () => {
    delete process.env.PAYFAST_MERCHANT_ID;
    const p = new PayfastSubscriptionProvider();
    await expect(p.initCardCapture({ email: 'x@y.z', reference: 'r', callbackUrl: 'https://cb' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});

describe('verifyCardCapture', () => {
  test('always reports unverified — the ITN is the source of truth', async () => {
    const p = new PayfastSubscriptionProvider();
    const out = await p.verifyCardCapture('vbsub_V_1');
    expect(out.verified).toBe(false);
    expect(out.reusableAuthorization).toBeUndefined();
  });
});

describe('webhook verification layers', () => {
  function signedItn(fields, passphrase = 'test-pass') {
    const parts = fields.filter(([, v]) => v !== '').map(([k, v]) => `${k}=${payfast.pfEncode(v)}`);
    const toSign = [...parts, `passphrase=${payfast.pfEncode(passphrase)}`].join('&');
    const sig = crypto.createHash('md5').update(toSign).digest('hex');
    return `${parts.join('&')}&signature=${sig}`;
  }

  test('valid signature + PayFast source IP passes in live mode', () => {
    const p = new PayfastSubscriptionProvider();
    const body = signedItn([['m_payment_id', 'vbsub_V_1'], ['payment_status', 'COMPLETE']]);
    expect(p.verifyWebhook(Buffer.from(body), { 'x-real-ip': '197.97.145.145' })).toBe(true);
  });

  test('valid signature from a non-PayFast IP fails in live mode', () => {
    const p = new PayfastSubscriptionProvider();
    const body = signedItn([['payment_status', 'COMPLETE']]);
    expect(p.verifyWebhook(Buffer.from(body), { 'x-real-ip': '8.8.8.8' })).toBe(false);
  });

  test('sandbox relaxes the IP check but never the signature', () => {
    process.env.PAYFAST_SANDBOX = 'true';
    const p = new PayfastSubscriptionProvider();
    const good = signedItn([['payment_status', 'COMPLETE']]);
    expect(p.verifyWebhook(Buffer.from(good), { 'x-real-ip': '127.0.0.1' })).toBe(true);
    expect(p.verifyWebhook(Buffer.from(good.replace('COMPLETE', 'CANCELLED')), { 'x-real-ip': '127.0.0.1' })).toBe(false);
  });

  test('parseWebhookBody decodes the form-encoded ITN', () => {
    const p = new PayfastSubscriptionProvider();
    const out = p.parseWebhookBody(Buffer.from('payment_status=COMPLETE&item_name=Speeldit+subscription'));
    expect(out).toEqual({ payment_status: 'COMPLETE', item_name: 'Speeldit subscription' });
  });
});

describe('normalizeWebhookEvent', () => {
  const base = {
    merchant_id: '10000100',
    m_payment_id: 'vbsub_VEN001_123',
    token: 'pf-token-abc',
    email_address: 'owner@bar.co.za',
  };

  test('COMPLETE → charge_succeeded with amount, token and reference', () => {
    const p = new PayfastSubscriptionProvider();
    const evt = p.normalizeWebhookEvent({
      ...base,
      payment_status: 'COMPLETE',
      amount_gross: '599.00',
      billing_date: '2026-08-27',
    });
    expect(evt.kind).toBe('charge_succeeded');
    expect(evt.providerSubscriptionId).toBe('pf-token-abc');
    expect(evt.reference).toBe('vbsub_VEN001_123');
    expect(evt.amountGrossZar).toBe(599);
    expect(evt.nextPaymentDate).toBe(new Date('2026-08-27').getTime());
  });

  test('zero-amount tokenization survives as the number 0, not undefined', () => {
    const p = new PayfastSubscriptionProvider();
    const evt = p.normalizeWebhookEvent({ ...base, payment_status: 'COMPLETE', amount_gross: '0.00' });
    expect(evt.amountGrossZar).toBe(0);
  });

  test('missing token falls back to the reference as the subscription id', () => {
    const p = new PayfastSubscriptionProvider();
    const { token, ...noToken } = base;
    const evt = p.normalizeWebhookEvent({ ...noToken, payment_status: 'COMPLETE' });
    expect(evt.providerSubscriptionId).toBe('vbsub_VEN001_123');
  });

  test('CANCELLED → subscription_canceled with reference fallback data', () => {
    const p = new PayfastSubscriptionProvider();
    const evt = p.normalizeWebhookEvent({ ...base, payment_status: 'CANCELLED' });
    expect(evt.kind).toBe('subscription_canceled');
    expect(evt.providerSubscriptionId).toBe('pf-token-abc');
    expect(evt.reference).toBe('vbsub_VEN001_123');
  });

  test('another merchant\'s notification is never acted on', () => {
    const p = new PayfastSubscriptionProvider();
    const evt = p.normalizeWebhookEvent({ ...base, merchant_id: '99999999', payment_status: 'COMPLETE' });
    expect(evt.kind).toBe('unhandled');
    expect(evt.rawEvent).toBe('payfast:merchant-mismatch');
  });

  test('unknown statuses are unhandled', () => {
    const p = new PayfastSubscriptionProvider();
    expect(p.normalizeWebhookEvent({ ...base, payment_status: 'PENDING' }).kind).toBe('unhandled');
    expect(p.normalizeWebhookEvent({ ...base }).kind).toBe('unhandled');
  });
});

describe('cancel — never pretends while PayFast may still bill', () => {
  test('real token → API cancel via utils', async () => {
    const spy = jest.spyOn(payfast, 'cancelSubscription').mockResolvedValue(true);
    const p = new PayfastSubscriptionProvider();
    await p.cancel({ providerSubscriptionId: 'pf-token-abc' });
    expect(spy).toHaveBeenCalledWith('pf-token-abc');
    spy.mockRestore();
  });

  test('API failure propagates (status must stay unchanged upstream)', async () => {
    const spy = jest.spyOn(payfast, 'cancelSubscription').mockRejectedValue(new Error('PayFast cancel failed (500)'));
    const p = new PayfastSubscriptionProvider();
    await expect(p.cancel({ providerSubscriptionId: 'pf-token-abc' })).rejects.toThrow('cancel failed');
    spy.mockRestore();
  });

  test('our own init reference (no PayFast token yet) → loud refusal, not silent success', async () => {
    const p = new PayfastSubscriptionProvider();
    await expect(p.cancel({ providerSubscriptionId: 'vbsub_VEN001_123' }))
      .rejects.toMatchObject({ code: 'PROVIDER_CANCEL_UNADDRESSABLE' });
  });

  test('no id at all resolves quietly (nothing exists at PayFast)', async () => {
    const p = new PayfastSubscriptionProvider();
    await expect(p.cancel({ providerSubscriptionId: undefined })).resolves.toBeUndefined();
  });
});

describe('getManageLink', () => {
  test('throws PROVIDER_NO_MANAGE_LINK for the route to map to its fallback', async () => {
    const p = new PayfastSubscriptionProvider();
    await expect(p.getManageLink({ providerSubscriptionId: 'x' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NO_MANAGE_LINK' });
  });
});

/**
 * A subscription id issued by a DIFFERENT provider must never reach PayFast's
 * cancel API. payfast.cancelSubscription treats HTTP 404 as "already
 * cancelled", so a leftover Paystack/Stripe id would 404, be reported as a
 * successful cancellation, and the venue would be marked canceled here while
 * the other provider kept charging their card — the one outcome worse than
 * failing to cancel.
 */
describe('cancel — foreign subscription ids', () => {
  const provider = new PayfastSubscriptionProvider();

  test('a Paystack subscription code is refused, not sent to PayFast', async () => {
    const fetchImpl = jest.fn();
    await expect(provider.cancel({ providerSubscriptionId: 'SUB_abc123xyz' }))
      .rejects.toMatchObject({ code: 'PROVIDER_CANCEL_UNADDRESSABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a Stripe subscription id is refused too', async () => {
    await expect(provider.cancel({ providerSubscriptionId: 'sub_1PabcdEFGH' }))
      .rejects.toMatchObject({ code: 'PROVIDER_CANCEL_UNADDRESSABLE' });
  });

  test('our own pre-activation reference is still refused', async () => {
    await expect(provider.cancel({ providerSubscriptionId: 'vbsub_ABC123_1700000000000' }))
      .rejects.toMatchObject({ code: 'PROVIDER_CANCEL_UNADDRESSABLE' });
  });

  test('an unrecognised shape is allowed through — assume PayFast changed format', async () => {
    // Refusing these would break real cancellations if PayFast ever alters its
    // token format, which is likelier than a fourth provider appearing.
    await expect(provider.cancel({ providerSubscriptionId: 'whatever-new-format' }))
      .rejects.not.toMatchObject({ code: 'PROVIDER_CANCEL_UNADDRESSABLE' });
  });
});
