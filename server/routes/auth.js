const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const E = require('../utils/errorCodes');

const router = express.Router();
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

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

    const token = jwt.sign({ venueCode: code }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
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
    // (avoids stale venues on disk with the same email shadowing owner dashboard).
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
        const token = jwt.sign({ role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, role: 'owner' });
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

    const token = jwt.sign({ venueCode: venue.code }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
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

module.exports = router;
