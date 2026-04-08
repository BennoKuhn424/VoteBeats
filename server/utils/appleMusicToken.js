/**
 * Generates Apple MusicKit JWT developer token.
 * Requires: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_MUSIC_KEY_PATH (path to .p8 file)
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

let cachedToken = null;
let cachedExpiry = 0;

/**
 * Generate (or return a cached) Apple MusicKit JWT developer token.
 * Reads private key from APPLE_MUSIC_KEY env var (raw .p8 content) or
 * APPLE_MUSIC_KEY_PATH (path to .p8 file on disk).
 * Token is cached for 1 hour; expires after 180 days.
 * @returns {string|null} JWT string, or null if credentials are not configured.
 */
function getDeveloperToken() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const keyContent = process.env.APPLE_MUSIC_KEY; // For deployment: raw .p8 content
  const keyPath = process.env.APPLE_MUSIC_KEY_PATH;

  if (!teamId || !keyId || (!keyContent && !keyPath)) {
    return null;
  }

  let privateKey = null;
  if (keyContent) {
    privateKey = keyContent.replace(/\\n/g, '\n');
  } else if (keyPath) {
    const absPath = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
    if (!fs.existsSync(absPath)) {
      console.error('Apple Music .p8 key file not found at:', absPath);
      return null;
    }
    privateKey = fs.readFileSync(absPath, 'utf8');
  }
  if (!privateKey) return null;

  // Cache token for 1 hour (tokens are valid 180 days but we refresh to be safe)
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpiry > now + 3600) {
    return cachedToken;
  }

  try {
    const token = jwt.sign(
      {},
      privateKey,
      {
        algorithm: 'ES256',
        expiresIn: '180d',
        issuer: teamId,
        header: {
          alg: 'ES256',
          kid: keyId,
        },
      }
    );
    cachedToken = token;
    cachedExpiry = now + 180 * 24 * 3600; // 180 days
    return token;
  } catch (err) {
    console.error('Failed to generate Apple Music token:', err);
    return null;
  }
}

module.exports = { getDeveloperToken };
