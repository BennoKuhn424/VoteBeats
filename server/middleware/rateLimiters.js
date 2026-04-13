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

/**
 * Tight limit for owner-only admin endpoints (overview, etc.).
 * These endpoints return sensitive aggregate data — 20 req/min per IP is plenty.
 */
const ownerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to admin endpoints. Please slow down.' },
});

/**
 * Strict limit for email-sending endpoints (forgot-password, resend-verification).
 * Prevents abuse of the email service — 5 requests per 15 minutes per IP.
 */
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many email requests. Please wait before trying again.' },
});

/**
 * Limit for token verification endpoints (verify-email, reset-password).
 * Prevents brute-force token guessing — 10 attempts per 15 minutes per IP.
 */
const tokenVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait before trying again.' },
});

module.exports = { authLimiter, apiLimiter, ownerLimiter, emailLimiter, tokenVerifyLimiter };
