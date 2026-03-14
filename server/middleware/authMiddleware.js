const jwt = require('jsonwebtoken');
const db = require('../utils/database');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const venue = db.getVenue(decoded.venueCode);

    if (!venue) {
      return res.status(401).json({ error: 'Venue not found' });
    }

    req.venue = venue;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
