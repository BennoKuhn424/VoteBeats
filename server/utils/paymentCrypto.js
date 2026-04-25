const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

/**
 * Derive a 32-byte key from the PAYMENT_ENCRYPTION_KEY env var.
 * Uses SHA-256 so the env var can be any length passphrase.
 * Returns null if the env var is not set.
 */
function getKey() {
  const raw = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

const _key = getKey();
const ENABLED = _key !== null;

if (!ENABLED) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: PAYMENT_ENCRYPTION_KEY environment variable must be set in production');
  }
  console.warn('[CRYPTO] PAYMENT_ENCRYPTION_KEY not set — payment data will be stored in plaintext');
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns a base64 string: iv (16 B) + authTag (16 B) + ciphertext.
 */
function encrypt(plaintext) {
  if (!_key) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, _key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64 string produced by encrypt().
 * Returns the original UTF-8 string, or null on failure.
 */
function decrypt(encoded) {
  if (!_key) return null;
  try {
    const buf = Buffer.from(encoded, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, _key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, ENABLED };
