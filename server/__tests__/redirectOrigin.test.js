/**
 * Unit tests for the redirect-origin allowlist helper.
 *
 * THREAT MODEL: an attacker controls req.headers.origin and req.body.clientOrigin.
 * The helper must NEVER use req.headers.origin (that lookup happens in the route,
 * but the helper enforces the contract that PUBLIC_URL + CORS_ORIGINS are the
 * only trust roots, plus localhost in non-production).
 */

const { resolveRedirectBase, buildAllowlist } = require('../utils/redirectOrigin');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Clean slate: every test sets exactly the env vars it needs.
  delete process.env.PUBLIC_URL;
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('buildAllowlist', () => {
  test('includes PUBLIC_URL when set', () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    expect(buildAllowlist()).toContain('https://app.speeldit.com');
  });

  test('strips trailing slash from PUBLIC_URL', () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.com/';
    expect(buildAllowlist()).toContain('https://app.speeldit.com');
    expect(buildAllowlist()).not.toContain('https://app.speeldit.com/');
  });

  test('includes every CORS_ORIGINS entry, trimmed', () => {
    process.env.CORS_ORIGINS = 'https://a.example.com, https://b.example.com ,https://c.example.com';
    const list = buildAllowlist();
    expect(list).toEqual(expect.arrayContaining([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]));
  });

  test('drops empty / whitespace-only CORS_ORIGINS entries', () => {
    process.env.CORS_ORIGINS = ',,  ,https://only.example.com,, ,';
    expect(buildAllowlist()).toEqual(expect.arrayContaining(['https://only.example.com']));
    expect(buildAllowlist()).not.toContain('');
  });

  test('deduplicates overlapping PUBLIC_URL and CORS_ORIGINS', () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    process.env.CORS_ORIGINS = 'https://app.speeldit.com,https://other.com';
    const list = buildAllowlist();
    const count = list.filter((x) => x === 'https://app.speeldit.com').length;
    expect(count).toBe(1);
  });

  test('adds localhost in non-production', () => {
    process.env.NODE_ENV = 'development';
    expect(buildAllowlist()).toEqual(expect.arrayContaining([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]));
  });

  test('does NOT add localhost in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    const list = buildAllowlist();
    expect(list).not.toContain('http://localhost:5173');
    expect(list).not.toContain('http://127.0.0.1:5173');
  });
});

describe('resolveRedirectBase — security', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    process.env.CORS_ORIGINS = 'https://www.speeldit.com';
  });

  test('REJECTS attacker origin even when supplied as clientOrigin', () => {
    const { baseUrl, source } = resolveRedirectBase('https://attacker.example.com');
    expect(baseUrl).toBe('https://app.speeldit.com');
    expect(source).toBe('public');
  });

  test('REJECTS clientOrigin that is a subdomain of an allowed host', () => {
    // "https://app.speeldit.com" is allowed, but "https://evil.app.speeldit.com"
    // is a different origin and must NOT be accepted.
    const { source } = resolveRedirectBase('https://evil.app.speeldit.com');
    expect(source).toBe('public');
  });

  test('REJECTS clientOrigin where the host matches but the scheme differs', () => {
    // Downgrade attack: attacker tries to force http:// instead of https://.
    const { source } = resolveRedirectBase('http://app.speeldit.com');
    expect(source).toBe('public');
  });

  test('REJECTS clientOrigin where the port differs', () => {
    const { source } = resolveRedirectBase('https://app.speeldit.com:8443');
    expect(source).toBe('public');
  });

  test('REJECTS malformed clientOrigin without throwing', () => {
    const { source } = resolveRedirectBase('not-a-url://////');
    expect(source).toBe('public');
  });

  test('REJECTS clientOrigin containing CRLF / control chars', () => {
    // URL constructor often parses weird strings — confirm the origin compare still wins.
    const { source } = resolveRedirectBase('https://app.speeldit.com\r\nLocation: https://attacker.com');
    // Whether URL throws or normalises, we must not end up using the attacker hint.
    expect(source).toBe('public');
  });

  test('REJECTS empty / null / undefined clientOrigin gracefully', () => {
    expect(resolveRedirectBase('').source).toBe('public');
    expect(resolveRedirectBase(null).source).toBe('public');
    expect(resolveRedirectBase(undefined).source).toBe('public');
  });

  test('REJECTS non-string clientOrigin (e.g. injected object)', () => {
    expect(resolveRedirectBase({ origin: 'https://attacker.com' }).source).toBe('public');
    expect(resolveRedirectBase(['https://attacker.com']).source).toBe('public');
    expect(resolveRedirectBase(42).source).toBe('public');
  });
});

describe('resolveRedirectBase — happy path', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    process.env.CORS_ORIGINS = 'https://www.speeldit.com,https://app.speeldit.com';
  });

  test('accepts clientOrigin that exactly matches PUBLIC_URL', () => {
    const { baseUrl, source } = resolveRedirectBase('https://app.speeldit.com');
    expect(baseUrl).toBe('https://app.speeldit.com');
    expect(source).toBe('client');
  });

  test('accepts clientOrigin that matches a CORS_ORIGINS entry', () => {
    const { baseUrl, source } = resolveRedirectBase('https://www.speeldit.com');
    expect(baseUrl).toBe('https://www.speeldit.com');
    expect(source).toBe('client');
  });

  test('strips trailing slash from accepted clientOrigin', () => {
    const { baseUrl } = resolveRedirectBase('https://app.speeldit.com/');
    expect(baseUrl).toBe('https://app.speeldit.com');
  });

  test('accepts clientOrigin with a path — uses only the origin component for matching, but preserves the supplied base', () => {
    // Edge case: clients should send pure origins, but if a path slips in we
    // should still match by origin and use the supplied URL (paths get stripped
    // by the route's `${base}/v/...` template anyway, since clientOrigin should
    // not contain a path; the helper treats trailing slashes only).
    const { baseUrl, source } = resolveRedirectBase('https://app.speeldit.com/some/path/');
    // We accept by origin, but the returned baseUrl is the input minus trailing slash.
    expect(source).toBe('client');
    expect(baseUrl).toBe('https://app.speeldit.com/some/path');
  });
});

describe('resolveRedirectBase — fallback chain', () => {
  test('falls back to PUBLIC_URL when clientOrigin is unsafe', () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.com';
    const { baseUrl, source } = resolveRedirectBase('https://attacker.com');
    expect(baseUrl).toBe('https://app.speeldit.com');
    expect(source).toBe('public');
  });

  test('falls back to first CORS_ORIGINS entry when PUBLIC_URL is unset and clientOrigin is unsafe', () => {
    process.env.CORS_ORIGINS = 'https://www.speeldit.com,https://other.com';
    const { baseUrl, source } = resolveRedirectBase('https://attacker.com');
    expect(baseUrl).toBe('https://www.speeldit.com');
    expect(source).toBe('fallback');
  });

  test('falls back to localhost in dev when nothing is configured', () => {
    process.env.NODE_ENV = 'development';
    const { baseUrl, source } = resolveRedirectBase(undefined);
    expect(baseUrl).toBe('http://localhost:5173');
    expect(source).toBe('fallback');
  });

  test('accepts localhost in dev when supplied as clientOrigin', () => {
    process.env.NODE_ENV = 'development';
    const { baseUrl, source } = resolveRedirectBase('http://localhost:5173');
    expect(baseUrl).toBe('http://localhost:5173');
    expect(source).toBe('client');
  });
});
