#!/usr/bin/env node
/**
 * READ-ONLY audit of every venue's subscription. Writes nothing, changes
 * nothing, contacts no provider — safe to run against production.
 *
 * Why this exists: SUBSCRIPTION_PROVIDER is global. It decides which provider's
 * webhooks are trusted, for every venue at once. Switching it (Paystack →
 * PayFast) means the old provider's renewal notifications stop verifying, so a
 * venue still on a live Paystack recurring charge keeps being billed while its
 * currentPeriodEnd stops advancing. SUBSCRIPTION_GRACE_DAYS later it flips to
 * 'expired' and requireSubscriptionActive returns 402 — the venue is locked out
 * of its own app while money is still leaving its account.
 *
 * This prints who is in that position, before it happens.
 *
 *   Render → Shell tab:   node scripts/subscription-audit.js
 */

require('dotenv').config();
const db = require('../utils/database');

const GRACE_DAYS = (() => {
  const n = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS, 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
})();
const ACTIVE = new Set(['trialing', 'active']);
const activeProvider = (process.env.SUBSCRIPTION_PROVIDER || 'paystack').trim().toLowerCase();

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—');
const days = (ms) => Math.round((ms - Date.now()) / 86400000);

/**
 * Guess which provider issued a stored subscription id.
 *  - Paystack subscription codes look like SUB_xxxxxxxx
 *  - our own pre-activation reference is vbsub_<CODE>_<ts>
 *  - PayFast stores its ITN token (a uuid) once activated
 */
function guessProvider(sub) {
  const id = sub.providerSubscriptionId || '';
  if (/^SUB_/i.test(id)) return 'paystack';
  if (/^vbsub_/i.test(id)) return 'unactivated';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return 'payfast';
  if (sub.paystackAuthorizationCode || sub.paystackEmailToken) return 'paystack';
  if (!id) return 'none';
  return 'unknown';
}

const venues = db.getAllVenues() || {};
const codes = Object.keys(venues);

console.log(`\nSUBSCRIPTION_PROVIDER = ${activeProvider}   (grace: ${GRACE_DAYS} days)`);
console.log(`${codes.length} venue(s)\n`);
console.log('VENUE   STATUS      LOOKS LIKE    PAID UNTIL         NOTE');
console.log('─'.repeat(88));

const atRisk = [];

for (const code of codes.sort()) {
  const sub = db.getSubscription(code);

  if (!sub) {
    console.log(`${code.padEnd(8)}${'(none)'.padEnd(12)}${'—'.padEnd(14)}${'—'.padEnd(19)}legacy / never subscribed — grandfathered unless enforcement is strict`);
    continue;
  }

  const issuer = guessProvider(sub);
  let note = '';

  if (ACTIVE.has(sub.status) && sub.currentPeriodEnd) {
    const deadline = sub.currentPeriodEnd + GRACE_DAYS * 86400000;
    const left = days(deadline);
    if (Date.now() > deadline) {
      note = 'ALREADY EXPIRED — this venue is being 402-blocked right now';
      atRisk.push({ code, issuer, note });
    } else if (issuer === 'paystack' && activeProvider !== 'paystack') {
      note = `AT RISK — locked out in ~${left} day(s) unless migrated`;
      atRisk.push({ code, issuer, note });
    } else {
      note = `ok, ${left} day(s) of runway`;
    }
  } else if (sub.status === 'incomplete') {
    note = 'checkout started, never activated (no verified ITN)';
  } else {
    note = sub.status;
  }

  console.log(
    `${code.padEnd(8)}${String(sub.status).padEnd(12)}${issuer.padEnd(14)}${fmt(sub.currentPeriodEnd).padEnd(19)}${note}`
  );
}

console.log('─'.repeat(88));

if (atRisk.length === 0) {
  console.log('\nNo venue depends on a provider other than the active one. The switch is safe.\n');
} else {
  console.log(`\n${atRisk.length} venue(s) need attention before the old provider is abandoned:\n`);
  for (const r of atRisk) console.log(`  ${r.code}  (${r.issuer})  ${r.note}`);
  console.log(
    '\nFor each: cancel the old recurring charge in that provider\'s dashboard so the\n' +
    'venue stops being billed, then have them sign up again through the new provider.\n' +
    'Doing it in that order means they are never charged twice.\n'
  );
}
