const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../utils/database');
const E = require('../utils/errorCodes');
const validate = require('../middleware/validate');
const {
  registerSchema, loginSchema, forgotPasswordSchema,
  resetPasswordSchema, resendVerificationSchema,
} = require('../utils/schemas');
const { revoke, isRevoked } = require('../utils/tokenBlacklist');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { emailLimiter, tokenVerifyLimiter } = require('../middleware/rateLimiters');

const router = express.Router();
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

const IS_PROD = process.env.NODE_ENV === 'production';

const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;        // 1 hour

const BASE_COOKIE_OPTS = {
  secure: IS_PROD,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

function setAuthCookies(res, token, csrf) {
  res.cookie('auth_token', token, { ...BASE_COOKIE_OPTS, httpOnly: true });
  res.cookie('csrf_token', csrf, { ...BASE_COOKIE_OPTS, httpOnly: false });
}

function clearAuthCookies(res) {
  const clearOpts = { ...BASE_COOKIE_OPTS, maxAge: 0 };
  res.cookie('auth_token', '', clearOpts);
  res.cookie('csrf_token', '', clearOpts);
}

function generateVenueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(bytes[i] % chars.length);
    }
    if (!db.getVenue(code)) return code;
  }
  throw new Error('Could not generate a unique venue code after 100 attempts');
}

/** Generate a cryptographically random token for email verification or password reset. */
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Timing-safe token lookup. Prevents timing attacks by always comparing
 * against every stored token in constant time relative to token count.
 * Returns the matching record or null.
 */
function findAuthToken(token, expectedType) {
  const record = db.getAuthToken(token);
  if (!record || record.type !== expectedType) {
    // Still do a dummy comparison to keep timing consistent
    crypto.timingSafeEqual(
      Buffer.from(token.padEnd(64, '0')),
      Buffer.from(generateSecureToken()),
    );
    return null;
  }
  return record;
}

// ── Purge expired tokens on startup and every hour ────────────────────────
db.purgeExpiredAuthTokens();
setInterval(() => {
  const removed = db.purgeExpiredAuthTokens();
  if (removed > 0) console.log(`[AUTH] Purged ${removed} expired auth tokens`);
}, 60 * 60 * 1000);

// ─── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { email, password, venueName, location } = req.body;

    if (process.env.OWNER_EMAIL && email.trim().toLowerCase() === process.env.OWNER_EMAIL.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Email not available', code: E.AUTH_EMAIL_UNAVAILABLE });
    }

    const emailNorm = email.trim().toLowerCase();
    const venues = db.getAllVenues();
    const existing = Object.values(venues).find(
      (v) => v.owner?.email?.toLowerCase() === emailNorm
    );
    if (existing) {
      return res.status(400).json({ error: 'Email already registered', code: E.AUTH_EMAIL_TAKEN });
    }

    const code = generateVenueCode();
    const passwordHash = await bcrypt.hash(password, 10);

    const venue = {
      code,
      name: venueName,
      location: location || '',
      owner: { email: emailNorm, passwordHash, emailVerified: false },
      settings: {
        allowExplicit: false,
        maxSongsPerUser: 3,
        genreFilters: [],
        blockedArtists: [],
        requirePaymentForRequest: false,
        requestPriceCents: 1000,
        autoplayQueue: false,
        autoplayMode: 'off',
      },
      createdAt: new Date().toISOString(),
    };

    db.saveVenue(code, venue);

    // Send verification email
    const verifyToken = generateSecureToken();
    db.removeAuthTokensByEmail(emailNorm, 'verify');
    db.saveAuthToken(verifyToken, {
      email: emailNorm,
      type: 'verify',
      venueCode: code,
      expiresAt: Date.now() + VERIFY_TOKEN_EXPIRY_MS,
    });

    try {
      await sendVerificationEmail(emailNorm, verifyToken, venueName);
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send verification email:', emailErr.message);
    }

    // Don't auto-login — they need to verify first.
    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      venueCode: code,
      requiresVerification: true,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', code: E.AUTH_REGISTER_FAILED });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Platform owner login
    const ownerEmail = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
    const ownerHash = process.env.OWNER_PASSWORD_HASH;
    if (ownerEmail && email.trim().toLowerCase() === ownerEmail) {
      if (!ownerHash) {
        return res.status(503).json({
          error: 'Owner login is not configured (set OWNER_PASSWORD_HASH on the API server).',
          code: E.AUTH_OWNER_NOT_CONFIGURED,
        });
      }
      const match = await bcrypt.compare(password, ownerHash);
      if (match) {
        const csrf = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign({ role: 'owner', csrf, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '7d' });
        setAuthCookies(res, token, csrf);
        return res.json({ role: 'owner' });
      }
      return res.status(401).json({ error: 'Invalid email or password', code: E.AUTH_INVALID_CREDENTIALS });
    }

    // Venue owner login
    const venues = db.getAllVenues();
    const venue = Object.values(venues).find(
      (v) => v.owner?.email?.toLowerCase() === email.toLowerCase()
    );
    if (!venue) {
      return res.status(401).json({ error: 'Invalid email or password', code: E.AUTH_INVALID_CREDENTIALS });
    }

    const match = await bcrypt.compare(password, venue.owner.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password', code: E.AUTH_INVALID_CREDENTIALS });
    }

    // Block login if email is not verified.
    // Uses strict === false so old accounts (emailVerified undefined) are not blocked.
    if (venue.owner.emailVerified === false) {
      return res.status(403).json({
        error: 'Please verify your email before logging in. Check your inbox for a verification link.',
        code: E.AUTH_EMAIL_NOT_VERIFIED,
        email: venue.owner.email,
      });
    }

    const csrf = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ venueCode: venue.code, csrf, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookies(res, token, csrf);

    res.json({
      venueCode: venue.code,
      venue: {
        code: venue.code,
        name: venue.name,
        location: venue.location,
        settings: venue.settings,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', code: E.AUTH_LOGIN_FAILED });
  }
});

// ─── GET /api/auth/verify-email?token=xxx ───────────────────────────────────
router.get('/verify-email', tokenVerifyLimiter, async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string' || token.length > 256) {
      return res.status(400).json({ error: 'Invalid verification link', code: E.AUTH_VERIFY_INVALID_TOKEN });
    }

    const record = findAuthToken(token, 'verify');
    if (!record) {
      return res.status(400).json({ error: 'Invalid or already-used verification link', code: E.AUTH_VERIFY_INVALID_TOKEN });
    }

    if (record.expiresAt < Date.now()) {
      db.removeAuthToken(token);
      return res.status(400).json({ error: 'Verification link has expired. Please request a new one.', code: E.AUTH_VERIFY_EXPIRED });
    }

    // Mark email as verified on the venue
    const venue = db.getVenue(record.venueCode);
    if (venue && venue.owner) {
      venue.owner.emailVerified = true;
      db.saveVenue(record.venueCode, venue);
    }

    // Clean up all verify tokens for this email
    db.removeAuthTokensByEmail(record.email, 'verify');

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Verification failed', code: E.AUTH_VERIFY_FAILED });
  }
});

// ─── POST /api/auth/resend-verification ─────────────────────────────────────
router.post('/resend-verification', emailLimiter, validate(resendVerificationSchema), async (req, res) => {
  try {
    const emailNorm = req.body.email.trim().toLowerCase();

    const venues = db.getAllVenues();
    const venue = Object.values(venues).find(
      (v) => v.owner?.email?.toLowerCase() === emailNorm
    );

    // Always return same success message to prevent email enumeration
    const successMsg = 'If that email is registered, a verification link has been sent.';

    if (!venue || venue.owner.emailVerified === true) {
      return res.json({ message: successMsg });
    }

    const verifyToken = generateSecureToken();
    db.removeAuthTokensByEmail(emailNorm, 'verify');
    db.saveAuthToken(verifyToken, {
      email: emailNorm,
      type: 'verify',
      venueCode: venue.code,
      expiresAt: Date.now() + VERIFY_TOKEN_EXPIRY_MS,
    });

    try {
      await sendVerificationEmail(emailNorm, verifyToken, venue.name);
    } catch (emailErr) {
      console.error('[EMAIL] Failed to resend verification email:', emailErr.message);
    }

    res.json({ message: successMsg });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Could not resend verification email', code: E.AUTH_RESEND_FAILED });
  }
});

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
router.post('/forgot-password', emailLimiter, validate(forgotPasswordSchema), async (req, res) => {
  try {
    const emailNorm = req.body.email.trim().toLowerCase();

    const venues = db.getAllVenues();
    const venue = Object.values(venues).find(
      (v) => v.owner?.email?.toLowerCase() === emailNorm
    );

    // Always return success to prevent email enumeration
    const successMsg = 'If that email is registered, a password reset link has been sent.';

    if (!venue) {
      return res.json({ message: successMsg });
    }

    const resetToken = generateSecureToken();
    db.removeAuthTokensByEmail(emailNorm, 'reset');
    db.saveAuthToken(resetToken, {
      email: emailNorm,
      type: 'reset',
      venueCode: venue.code,
      expiresAt: Date.now() + RESET_TOKEN_EXPIRY_MS,
    });

    try {
      await sendPasswordResetEmail(emailNorm, resetToken);
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send password reset email:', emailErr.message);
    }

    res.json({ message: successMsg });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Could not process password reset', code: E.AUTH_FORGOT_FAILED });
  }
});

// ─── POST /api/auth/reset-password ──────────────────────────────────────────
router.post('/reset-password', tokenVerifyLimiter, validate(resetPasswordSchema), async (req, res) => {
  try {
    const { token, password } = req.body;

    const record = findAuthToken(token, 'reset');
    if (!record) {
      return res.status(400).json({ error: 'Invalid or already-used reset link', code: E.AUTH_RESET_INVALID_TOKEN });
    }

    if (record.expiresAt < Date.now()) {
      db.removeAuthToken(token);
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.', code: E.AUTH_RESET_EXPIRED });
    }

    const venue = db.getVenue(record.venueCode);
    if (!venue || !venue.owner) {
      db.removeAuthToken(token);
      return res.status(400).json({ error: 'Account not found', code: E.AUTH_RESET_FAILED });
    }

    // Update password
    venue.owner.passwordHash = await bcrypt.hash(password, 10);
    // Also verify email if it wasn't already (they proved email ownership)
    venue.owner.emailVerified = true;
    db.saveVenue(record.venueCode, venue);

    // Clean up all reset tokens for this email
    db.removeAuthTokensByEmail(record.email, 'reset');

    res.json({ message: 'Password has been reset. You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Could not reset password', code: E.AUTH_RESET_FAILED });
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.auth_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.jti && decoded.exp) revoke(decoded.jti, decoded.exp);
    } catch {
      // Token already invalid — nothing to revoke
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

module.exports = router;
