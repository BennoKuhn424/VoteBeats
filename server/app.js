require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { patronPaymentWebhook } = require('./routes/webhooks');
const { subscriptionWebhook } = require('./routes/subscriptionWebhooks');
const { requestLogger } = require('./middleware/requestLogger');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiters');
const { notFound, errorHandler } = require('./middleware/errorHandlers');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
}

// Cache the prepared liveness query so we don't re-prepare on every health hit.
// Lazy require because `app.js` is imported by tests that mock the database
// module — pulling sqlite at module load would skip the mock.
let _healthProbe = null;
function getHealthProbe() {
  if (_healthProbe) return _healthProbe;
  try {
    const sqlite = require('./utils/sqlite');
    _healthProbe = sqlite.prepare('SELECT 1 AS ok');
  } catch {
    _healthProbe = null;
  }
  return _healthProbe;
}

function healthPayload() {
  // Touch the DB so uptime monitors detect "disk full / disk unmounted / DB
  // corrupted" failures, not just "Node process is alive." A `SELECT 1`
  // forces a real read against speeldit.db and returns instantly when healthy.
  // If the read throws or returns the wrong shape, mark db: 'error' so the
  // payload still serializes and the route still returns 200 with a clear
  // signal; the uptime monitor or Sentry alert can flag the degraded state.
  let dbStatus = 'unknown';
  try {
    const stmt = getHealthProbe();
    const row = stmt ? stmt.get() : null;
    dbStatus = row && row.ok === 1 ? 'ok' : 'error';
  } catch {
    dbStatus = 'error';
  }
  return {
    ok: dbStatus === 'ok',
    service: 'speeldit-api',
    db: dbStatus,
    ts: new Date().toISOString(),
  };
}

// ── CORS origin allowlist (shared with server.js via export) ─────────────────
// Trim every segment; drop empty / whitespace-only values so "  " or ",," never
// sneak through as a valid origin.
const _publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const allowedOrigins = [
  ...(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ...(_publicUrl ? [_publicUrl] : []),
];
// Deduplicate
const _seen = new Set();
for (let i = allowedOrigins.length - 1; i >= 0; i--) {
  if (_seen.has(allowedOrigins[i])) allowedOrigins.splice(i, 1);
  else _seen.add(allowedOrigins[i]);
}
// Always allow localhost in development / test
if (process.env.NODE_ENV !== 'production') {
  if (!allowedOrigins.includes('http://localhost:5173')) allowedOrigins.push('http://localhost:5173');
  if (!allowedOrigins.includes('http://127.0.0.1:5173')) allowedOrigins.push('http://127.0.0.1:5173');
}
// ── Fail fast in production if no origins are configured ─────────────────────
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error(
    'FATAL: No CORS origins configured for production. ' +
    'Set CORS_ORIGINS (comma-separated) and/or PUBLIC_URL environment variables. ' +
    'Example: CORS_ORIGINS=https://yourapp.vercel.app,https://www.yourapp.com'
  );
}
app.use(
  cors({
    origin(origin, cb) {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      console.error(`CORS blocked origin: "${origin}" | allowed: ${JSON.stringify(allowedOrigins)}`);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    maxAge: 86400, // Cache preflight responses for 24 hours
  })
);

// ── Security headers (after CORS so both layers apply) ───────────────────────
app.use(
  helmet({
    // The API is called cross-origin by the SPA; these defaults would block that.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    // CSP is not useful for a JSON API and can interfere with proxied frontends.
    contentSecurityPolicy: false,
  })
);

function sendHealth(req, res) {
  const payload = healthPayload();
  // 503 when DB is unreachable so uptime monitors and load balancers see a
  // real failure, not a "Node still answering" false positive.
  res.status(payload.ok ? 200 : 503).json(payload);
}
app.get('/health', sendHealth);
app.get('/api/health', sendHealth);

// Patron-payment webhook — raw body for provider signature verification.
// Generic route delegates to the active PatronPaymentProvider (default: Yoco).
// Legacy /api/webhooks/yoco is kept as an alias so existing Yoco dashboard config still works.
app.post('/api/webhooks/payment', express.raw({ type: 'application/json' }), patronPaymentWebhook);
app.post('/api/webhooks/yoco', express.raw({ type: 'application/json' }), patronPaymentWebhook);

// Subscription webhook — raw body for provider signature verification.
// Generic route + legacy Paystack alias so existing dashboard config keeps working.
app.post('/api/webhooks/subscription', express.raw({ type: 'application/json' }), subscriptionWebhook);
app.post('/api/webhooks/paystack', express.raw({ type: 'application/json' }), subscriptionWebhook);

// 50kb covers all legitimate API payloads (song requests, settings, votes).
// Rejects oversized bodies before they reach route handlers.
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(requestLogger);

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/token', require('./routes/token'));
const queueRouter = require('./routes/queue');
app.use('/api/queue', queueRouter);
app.use('/api/search', require('./routes/search'));
app.use('/api/lyrics', require('./routes/lyrics'));
app.use('/api/music', require('./routes/music'));
app.use('/api/venue', require('./routes/venue'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/owner', require('./routes/owner'));
app.use('/api/payouts', require('./routes/payouts'));
app.use('/api/subscriptions', require('./routes/subscriptions'));

// No route matched — return a JSON 404 (before the error handlers below).
app.use(notFound);

// Sentry captures the error first, then re-throws to our handler below.
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

// Terminal JSON error handler — must be registered last.
app.use(errorHandler);

module.exports = { app, queueRouter, allowedOrigins };
