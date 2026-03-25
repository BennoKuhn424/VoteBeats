require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors());

app.get('/health', (req, res) => {
  res.status(200).json(healthPayload());
});

app.get('/api/health', (req, res) => {
  res.status(200).json(healthPayload());
});

// Yoco webhook needs raw body for signature verification (must be before express.json)
app.post('/api/webhooks/yoco', express.raw({ type: 'application/json' }), yocoWebhook);

app.use(express.json());
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

module.exports = { app, queueRouter };
