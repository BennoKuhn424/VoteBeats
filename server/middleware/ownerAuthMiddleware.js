const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

/**
 * Express middleware — verifies the platform owner JWT (`role: 'owner'`).
 * Attaches `req.owner` and calls next() on success.
 * Responds 401 for missing/invalid tokens and 403 if the token belongs to a
 * venue owner rather than the platform owner.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function ownerAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }
    req.owner = { ...decoded, role: 'owner' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = ownerAuthMiddleware;
