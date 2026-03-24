const rateLimit = require('express-rate-limit');

/** Brute-force protection for login/register */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

/**
 * General API ceiling (per IP). Skips auth (separate limiter) and webhook (not on this stack).
 * Tune RATE_LIMIT_API_MAX for busy venues behind one NAT.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  skip: (req) => {
    const u = (req.originalUrl || '').split('?')[0];
    if (u.startsWith('/api/auth')) return true;
    if (u === '/api/health') return true;
    return false;
  },
});

module.exports = { authLimiter, apiLimiter };
