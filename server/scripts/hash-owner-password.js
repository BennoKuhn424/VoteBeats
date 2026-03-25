/**
 * Generate OWNER_PASSWORD_HASH for server .env (never commit real passwords).
 * Usage: node scripts/hash-owner-password.js "your-password"
 */
const bcrypt = require('bcryptjs');

const p = process.argv[2];
if (!p) {
  console.error('Usage: node scripts/hash-owner-password.js "<password>"');
  process.exit(1);
}

bcrypt.hash(p, 10).then((hash) => {
  console.log(hash);
  process.exit(0);
});
