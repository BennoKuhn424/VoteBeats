const jwt = require('jsonwebtoken');
const { isRevoked } = require('../utils/tokenBlacklist');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware — verifies the platform owner JWT from the httpOnly
 * auth_token cookie. Attaches `req.owner` and calls next() on success.
 * For state-changing requests (POST/PUT/DELETE/PATCH), validates the CSRF
 * token: the X-CSRF-Token header must match the `csrf` claim in the JWT.
 * Responds 401 for missing/invalid tokens and 403 for role mismatch or bad CSRF.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function ownerAuthMiddleware(req, res, next) {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.jti && isRevoked(decoded.jti)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    if (decoded.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    // CSRF check for state-changing requests
    if (!SAFE_METHODS.has(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== decoded.csrf) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }

    req.owner = { ...decoded, role: 'owner' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = ownerAuthMiddleware;
