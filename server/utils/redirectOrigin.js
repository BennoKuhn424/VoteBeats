/**
 * Resolves a safe redirect base URL for payment success/cancel/failure URLs.
 *
 * SECURITY: must NEVER trust req.headers.origin for redirect target validation.
 * A non-browser HTTP client (curl, server-side script) can set Origin freely;
 * accepting it lets an attacker redirect a victim post-payment to a phishing
 * page. The only trusted sources are server-controlled env vars (PUBLIC_URL,
 * CORS_ORIGINS) plus localhost in development.
 *
 * Returns: { baseUrl, source } where source ∈ 'client'|'public'|'fallback'
 * baseUrl always has any trailing slash stripped.
 */

function buildAllowlist() {
  const list = [];
  const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (publicUrl) list.push(publicUrl);
  for (const raw of (process.env.CORS_ORIGINS || '').split(',')) {
    const v = raw.trim().replace(/\/+$/, '');
    if (v) list.push(v);
  }
  if (process.env.NODE_ENV !== 'production') {
    list.push('http://localhost:5173');
    list.push('http://127.0.0.1:5173');
  }
  return [...new Set(list)];
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function resolveRedirectBase(clientOrigin) {
  const allowlist = buildAllowlist();
  const allowedOrigins = new Set(allowlist.map(safeOrigin).filter(Boolean));

  if (typeof clientOrigin === 'string' && clientOrigin) {
    const wantOrigin = safeOrigin(clientOrigin);
    if (wantOrigin && allowedOrigins.has(wantOrigin)) {
      return { baseUrl: clientOrigin.replace(/\/+$/, ''), source: 'client' };
    }
  }

  const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (publicUrl) return { baseUrl: publicUrl, source: 'public' };

  if (allowlist.length > 0) return { baseUrl: allowlist[0], source: 'fallback' };

  // Last-resort dev fallback. In production we never reach here because
  // app.js fails fast when CORS_ORIGINS + PUBLIC_URL are both unset.
  return { baseUrl: 'http://localhost:5173', source: 'fallback' };
}

module.exports = { resolveRedirectBase, buildAllowlist };
