/**
 * In-memory JWT blacklist — stores revoked token JTI values until they expire.
 * On logout the token's `jti` is added here; auth middlewares reject any token
 * whose `jti` appears in this set.
 *
 * Trade-off: entries are lost on server restart, meaning a recently-logged-out
 * token becomes valid again until it naturally expires. Acceptable for a
 * single-instance deployment — for horizontal scaling, replace with Redis.
 */

// Map<jti, expiresAtMs>
const blacklist = new Map();

// Clean up expired entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of blacklist) {
    if (now >= expiresAt) blacklist.delete(jti);
  }
}, 60 * 60 * 1000).unref();

/**
 * Adds a token's JTI to the blacklist until its expiry timestamp.
 * @param {string} jti
 * @param {number} exp  - JWT `exp` claim (seconds since epoch)
 */
function revoke(jti, exp) {
  blacklist.set(jti, exp * 1000);
}

/**
 * Returns true if the JTI has been revoked and the token should be rejected.
 * @param {string} jti
 */
function isRevoked(jti) {
  if (!blacklist.has(jti)) return false;
  // Auto-clean expired entry on read
  if (Date.now() >= blacklist.get(jti)) {
    blacklist.delete(jti);
    return false;
  }
  return true;
}

module.exports = { revoke, isRevoked };
