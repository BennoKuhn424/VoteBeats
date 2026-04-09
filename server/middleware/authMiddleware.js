const jwt = require('jsonwebtoken');
const db = require('../utils/database');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware — verifies the venue owner's JWT from the httpOnly
 * auth_token cookie and attaches the venue object to `req.venue`.
 * For state-changing requests (POST/PUT/DELETE/PATCH), also validates the
 * CSRF token: the X-CSRF-Token header must match the `csrf` claim in the JWT.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authMiddleware(req, res, next) {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const venue = db.getVenue(decoded.venueCode);

    if (!venue) {
      return res.status(401).json({ error: 'Venue not found' });
    }

    // CSRF check for state-changing requests
    if (!SAFE_METHODS.has(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== decoded.csrf) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }

    req.venue = venue;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
