/**
 * Seed a demo venue with a live-looking queue.
 *
 * Usage:  node scripts/seed-demo.js   (or: npm run seed-demo)
 *
 * Creates (idempotently — safe to re-run):
 *   - Venue DEMO01 "The Demo Taproom" with sensible default settings
 *   - Login: demo@speeldit.test / demo-password-123 (email pre-verified)
 *   - A now-playing song + four upcoming songs with votes
 *   - An active subscription row so the venue works even under
 *     SUBSCRIPTION_ENFORCEMENT=strict
 *
 * Point a browser at /v/DEMO01 to see the patron view, or log in with the
 * credentials above for the venue dashboard. Respects DATA_DIR like the server.
 */

const bcrypt = require('bcryptjs');
const db = require('../utils/database');

const VENUE_CODE = 'DEMO01';
const OWNER_EMAIL = 'demo@speeldit.test';
const OWNER_PASSWORD = 'demo-password-123';

const now = Date.now();

// Mock-catalog-style songs (picsum placeholders, same shape as real requests).
const SONGS = [
  { id: 'demo_1', appleId: 'demo_1', title: 'Golden Hour Groove', artist: 'The Sundowners', albumArt: 'https://picsum.photos/seed/demo1/400', duration: 214, genre: 'Pop', votes: 0 },
  { id: 'demo_2', appleId: 'demo_2', title: 'Table Mountain Nights', artist: 'Cape Collective', albumArt: 'https://picsum.photos/seed/demo2/400', duration: 187, genre: 'House', votes: 7 },
  { id: 'demo_3', appleId: 'demo_3', title: 'Long Street Shuffle', artist: 'Mzansi Beat Club', albumArt: 'https://picsum.photos/seed/demo3/400', duration: 232, genre: 'Amapiano', votes: 5 },
  { id: 'demo_4', appleId: 'demo_4', title: 'Neon Jukebox', artist: 'Retrofit', albumArt: 'https://picsum.photos/seed/demo4/400', duration: 198, genre: 'Rock', votes: 3 },
  { id: 'demo_5', appleId: 'demo_5', title: 'Last Round Waltz', artist: 'The Barflies', albumArt: 'https://picsum.photos/seed/demo5/400', duration: 251, genre: 'Indie', votes: 1 },
];

async function main() {
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

  db.saveVenue(VENUE_CODE, {
    code: VENUE_CODE,
    name: 'The Demo Taproom',
    location: 'Cape Town',
    owner: { email: OWNER_EMAIL, passwordHash, emailVerified: true },
    settings: {
      allowExplicit: false,
      strictExplicit: false,
      maxSongsPerUser: 3,
      genreFilters: [],
      blockedArtists: [],
      blockedTitleWords: [],
      lyricsFilter: false,
      lyricsThreshold: 3,
      lyricsLanguages: ['en'],
      requirePaymentForRequest: false,
      requestPriceCents: 1000,
      autoplayQueue: false,
      autoplayMode: 'off',
    },
    createdAt: new Date().toISOString(),
  });

  const [nowPlaying, ...upcoming] = SONGS;
  db.updateQueue(VENUE_CODE, {
    nowPlaying: {
      ...nowPlaying,
      requestedBy: 'demo-device',
      requestedAt: now - 60_000,
      positionMs: 45_000,
      positionAnchoredAt: now,
      isPaused: true, // paused so the demo doesn't auto-advance past the queue
    },
    upcoming: upcoming.map((s, i) => ({
      ...s,
      requestedBy: `demo-device-${i}`,
      requestedAt: now - (upcoming.length - i) * 30_000,
    })),
  });

  db.upsertSubscription({
    venueCode: VENUE_CODE,
    status: 'active',
    currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
  });

  console.log('Demo venue seeded:');
  console.log(`  Patron page:   /v/${VENUE_CODE}`);
  console.log(`  Venue login:   ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log('  Re-running this script resets the demo queue.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
