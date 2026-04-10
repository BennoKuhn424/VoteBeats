/**
 * Express param middleware that rejects invalid venue codes early,
 * before any database lookup or business logic runs.
 *
 * Venue codes are exactly 6 uppercase alphanumeric characters
 * (letters A-Z excluding I/O, digits 2-9).
 */
const VENUE_CODE_RE = /^[A-Z0-9]{6}$/;

function validateVenueCode(req, res, next, value) {
  if (!VENUE_CODE_RE.test(value)) {
    return res.status(400).json({ error: 'Invalid venue code format' });
  }
  next();
}

module.exports = validateVenueCode;
