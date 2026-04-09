const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../utils/database');
const E = require('../utils/errorCodes');

const router = express.Router();
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Cookie options for the httpOnly auth token and the readable CSRF token.
 * In production: SameSite=None (cross-origin Vercel → Render) + Secure.
 * In development: SameSite=Lax (same-origin localhost, no HTTPS needed).
 */
const BASE_COOKIE_OPTS = {
  secure: IS_PROD,
  sameSite: IS_PROD ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

/**
 * Sets auth_token (httpOnly) and csrf_token (readable) cookies on the response.
 * @param {import('express').Response} res
 * @param {string} token  - signed JWT
 * @param {string} csrf   - random CSRF token (also embedded in JWT payload)
 */
function setAuthCookies(res, token, csrf) {
  res.cookie('auth_token', token, { ...BASE_COOKIE_OPTS, httpOnly: true });
  res.cookie('csrf_token', csrf, { ...BASE_COOKIE_OPTS, httpOnly: false });
}

/**
 * Clears auth and CSRF cookies.
 * @param {import('express').Response} res
 */
function clearAuthCookies(res) {
  const clearOpts = { ...BASE_COOKIE_OPTS, maxAge: 0 };
  res.cookie('auth_token', '', clearOpts);
  res.cookie('csrf_token', '', clearOpts);
}

function generateVenueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (!db.getVenue(code)) return code;
  }
  throw new Error('Could not generate a unique venue code after 100 attempts');
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, venueName, location } = req.body;

    if (!email || !password || !venueName) {
      return res.status(400).json({ error: 'Email, password and venue name required', code: E.AUTH_MISSING_FIELDS });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters', code: E.AUTH_PASSWORD_TOO_SHORT });
    }

    // Block reserved owner email before any writes
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
      owner: { email: emailNorm, passwordHash },
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

    const csrf = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ venueCode: code, csrf }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookies(res, token, csrf);

    res.status(201).json({
      venueCode: code,
      venue: { code, name: venue.name, location: venue.location, settings: venue.settings },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', code: E.AUTH_REGISTER_FAILED });
  }
});

// POST /api/auth/login (email + password)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required', code: E.AUTH_MISSING_FIELDS });
    }

    // Platform owner: if this email is OWNER_EMAIL, never fall through to venue login
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
        const token = jwt.sign({ role: 'owner', csrf }, JWT_SECRET, { expiresIn: '7d' });
        setAuthCookies(res, token, csrf);
        return res.json({ role: 'owner' });
      }
      return res.status(401).json({ error: 'Invalid email or password', code: E.AUTH_INVALID_CREDENTIALS });
    }

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

    const csrf = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ venueCode: venue.code, csrf }, JWT_SECRET, { expiresIn: '7d' });
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

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

module.exports = router;
