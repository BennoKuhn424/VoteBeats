require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { yocoWebhook } = require('./routes/webhooks');
const { requestLogger } = require('./middleware/requestLogger');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiters');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
}

function healthPayload() {
  return {
    ok: true,
    service: 'speeldit-api',
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

app.get('/health', (req, res) => {
  res.status(200).json(healthPayload());
});

app.get('/api/health', (req, res) => {
  res.status(200).json(healthPayload());
});

// Yoco webhook needs raw body for signature verification (must be before express.json)
app.post('/api/webhooks/yoco', express.raw({ type: 'application/json' }), yocoWebhook);

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

if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

module.exports = { app, queueRouter, allowedOrigins };
