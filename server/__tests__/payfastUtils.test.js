/**
 * @jest-environment node
 *
 * Unit tests for server/utils/payfast.js — signing, ITN verification layers,
 * body parsing, IP allowlisting, the /validate postback, and the cancel API.
 * All network calls are stubbed via the fetchImpl injection point.
 */

const crypto = require('crypto');
const payfast = require('../utils/payfast');

const ENV_KEYS = ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE', 'PAYFAST_SANDBOX'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('pfEncode', () => {
  test('spaces become + and hex is upper-case', () => {
    expect(payfast.pfEncode('Speeldit subscription')).toBe('Speeldit+subscription');
    expect(payfast.pfEncode('a@b.com')).toBe('a%40b.com');
  });

  test('RFC1738 specials are encoded', () => {
    expect(payfast.pfEncode("it's!")).toBe('it%27s%21');
  });
});

describe('signParams', () => {
  test('MD5 over insertion-ordered pairs, blanks skipped, passphrase appended last', () => {
    const pairs = [
      ['merchant_id', '10000100'],
      ['skip_me', ''],
      ['amount', '0.00'],
    ];
    const expected = crypto
      .createHash('md5')
      .update('merchant_id=10000100&amount=0.00&passphrase=secretpass')
      .digest('hex');
    expect(payfast.signParams(pairs, 'secretpass')).toBe(expected);
  });

  test('no passphrase → hash over params only', () => {
    const expected = crypto.createHash('md5').update('a=1&b=2').digest('hex');
    expect(payfast.signParams([['a', '1'], ['b', '2']])).toBe(expected);
  });
});

describe('verifyItnSignature', () => {
  /** Build a raw ITN body with a correct trailing signature. */
  function signedBody(fields, passphrase) {
    const raw = fields.map(([k, v]) => `${k}=${v}`).join('&');
    const parts = fields.filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`);
    if (passphrase) parts.push(`passphrase=${payfast.pfEncode(passphrase)}`);
    const sig = crypto.createHash('md5').update(parts.join('&')).digest('hex');
    return `${raw}&signature=${sig}`;
  }

  test('accepts a correctly signed body (with passphrase)', () => {
    const body = signedBody([
      ['m_payment_id', 'vbsub_VEN001_1'],
      ['payment_status', 'COMPLETE'],
      ['amount_gross', '599.00'],
    ], 'pass phrase');
    expect(payfast.verifyItnSignature(body, 'pass phrase')).toBe(true);
  });

  test('rejects a tampered body', () => {
    const body = signedBody([['payment_status', 'COMPLETE'], ['amount_gross', '599.00']], 'pp');
    const tampered = body.replace('599.00', '5.00');
    expect(payfast.verifyItnSignature(tampered, 'pp')).toBe(false);
  });

  test('rejects when signature field is missing', () => {
    expect(payfast.verifyItnSignature('a=1&b=2', 'pp')).toBe(false);
  });

  test('rejects when passphrase differs', () => {
    const body = signedBody([['payment_status', 'COMPLETE']], 'right');
    expect(payfast.verifyItnSignature(body, 'wrong')).toBe(false);
  });
});

describe('parseItnBody', () => {
  test('decodes + as space and percent-encoding', () => {
    const out = payfast.parseItnBody('item_name=Speeldit+subscription&email_address=a%40b.com&empty=');
    expect(out).toEqual({
      item_name: 'Speeldit subscription',
      email_address: 'a@b.com',
      empty: '',
    });
  });
});

describe('isPayfastIp', () => {
  test('accepts an address inside a documented range', () => {
    expect(payfast.isPayfastIp('197.97.145.145')).toBe(true);
  });
  test('accepts IPv4-mapped IPv6 form', () => {
    expect(payfast.isPayfastIp('::ffff:197.97.145.145')).toBe(true);
  });
  test('rejects an outside address', () => {
    expect(payfast.isPayfastIp('8.8.8.8')).toBe(false);
  });
  test('rejects garbage and plain IPv6', () => {
    expect(payfast.isPayfastIp('nonsense')).toBe(false);
    expect(payfast.isPayfastIp('2001:db8::1')).toBe(false);
    expect(payfast.isPayfastIp('')).toBe(false);
  });
});

describe('processHost / isSandbox', () => {
  test('sandbox flag switches the checkout host', () => {
    expect(payfast.processHost()).toBe(payfast.LIVE_PROCESS_HOST);
    process.env.PAYFAST_SANDBOX = 'true';
    expect(payfast.processHost()).toBe(payfast.SANDBOX_PROCESS_HOST);
  });
});

describe('validateItn — server-to-server postback', () => {
  const rawBody = 'm_payment_id=vbsub_X_1&payment_status=COMPLETE&signature=deadbeef';

  test('posts body minus signature to /eng/query/validate and accepts VALID', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, text: async () => 'VALID\n' });
    const ok = await payfast.validateItn(rawBody, { fetchImpl });
    expect(ok).toBe(true);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${payfast.LIVE_PROCESS_HOST}/eng/query/validate`);
    expect(opts.body).toBe('m_payment_id=vbsub_X_1&payment_status=COMPLETE');
    expect(opts.body).not.toContain('signature');
  });

  test('uses the sandbox host when PAYFAST_SANDBOX=true', async () => {
    process.env.PAYFAST_SANDBOX = 'true';
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, text: async () => 'VALID' });
    await payfast.validateItn(rawBody, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${payfast.SANDBOX_PROCESS_HOST}/eng/query/validate`);
  });

  test('INVALID answer → false', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, text: async () => 'INVALID' });
    expect(await payfast.validateItn(rawBody, { fetchImpl })).toBe(false);
  });

  test('non-2xx response → throws (caller must retry, not reject)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    await expect(payfast.validateItn(rawBody, { fetchImpl })).rejects.toThrow('503');
  });

  test('network failure → throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(payfast.validateItn(rawBody, { fetchImpl })).rejects.toThrow('ECONNREFUSED');
  });
});

describe('apiSignature', () => {
  test('sorts all params (incl. passphrase) alphabetically before hashing', () => {
    const sig = payfast.apiSignature(
      { version: 'v1', 'merchant-id': '10000100', timestamp: '2026-07-27T10:00:00' },
      'zz pass'
    );
    const expected = crypto
      .createHash('md5')
      .update(
        'merchant-id=10000100'
        + '&passphrase=zz+pass'
        + '&timestamp=2026-07-27T10%3A00%3A00'
        + '&version=v1'
      )
      .digest('hex');
    expect(sig).toBe(expected);
  });
});

describe('cancelSubscription', () => {
  beforeEach(() => {
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    process.env.PAYFAST_PASSPHRASE = 'pp';
  });

  test('PUTs the signed cancel request and resolves true on 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const ok = await payfast.cancelSubscription('tok-123', { fetchImpl });
    expect(ok).toBe(true);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${payfast.API_HOST}/subscriptions/tok-123/cancel`);
    expect(opts.method).toBe('PUT');
    expect(opts.headers['merchant-id']).toBe('10000100');
    expect(opts.headers.version).toBe('v1');
    expect(opts.headers.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // Signature must be reproducible from the same header set + passphrase.
    expect(opts.headers.signature).toBe(
      payfast.apiSignature(
        { 'merchant-id': '10000100', version: 'v1', timestamp: opts.headers.timestamp },
        'pp'
      )
    );
  });

  test('appends ?testing=true in sandbox mode', async () => {
    process.env.PAYFAST_SANDBOX = 'true';
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await payfast.cancelSubscription('tok-9', { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${payfast.API_HOST}/subscriptions/tok-9/cancel?testing=true`);
  });

  test('404 (already cancelled) resolves true — idempotent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    expect(await payfast.cancelSubscription('gone', { fetchImpl })).toBe(true);
  });

  test('other failures throw so "still billing" is never mistaken for done', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(payfast.cancelSubscription('tok', { fetchImpl })).rejects.toThrow('500');
  });

  test('missing merchant id / token throw before any network call', async () => {
    delete process.env.PAYFAST_MERCHANT_ID;
    const fetchImpl = jest.fn();
    await expect(payfast.cancelSubscription('tok', { fetchImpl })).rejects.toThrow('PAYFAST_MERCHANT_ID');
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    await expect(payfast.cancelSubscription('', { fetchImpl })).rejects.toThrow('token required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
