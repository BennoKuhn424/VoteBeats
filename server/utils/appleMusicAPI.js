/**
 * Apple Music API integration.
 * Uses JWT from .p8 key (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_MUSIC_KEY_PATH) when set.
 * Falls back to APPLE_MUSIC_DEVELOPER_TOKEN if no .p8 configured.
 * Without either, returns mock results for development.
 */

const { getDeveloperToken } = require('./appleMusicToken');
const APPLE_MUSIC_DEVELOPER_TOKEN = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;

function getToken() {
  return getDeveloperToken() || APPLE_MUSIC_DEVELOPER_TOKEN;
}

// Matches the "Languages" section labels in Settings.jsx.
// When any selected autoplay genre is a language, it becomes a mandatory
// filter: songs must match at least one selected language AND at least one
// selected regular genre (if regular genres are also selected).
const LANGUAGE_GENRES = new Set([
  'afrikaans', 'english', 'spanish', 'french', 'portuguese', 'german', 'italian',
  'zulu', 'xhosa', 'sotho', 'tswana', 'korean', 'japanese', 'arabic', 'hindi',
]);

// Per-venue ring buffer of recently autofilled appleIds (in-memory, last 50).
// Prevents the same song from being picked twice in a row during autofill.
const recentlyPlayedByVenue = new Map();

function getRecentPool(venueCode) {
  if (!recentlyPlayedByVenue.has(venueCode)) recentlyPlayedByVenue.set(venueCode, []);
  return recentlyPlayedByVenue.get(venueCode);
}

function recordAutofillPlay(venueCode, appleId) {
  const pool = getRecentPool(venueCode);
  const idx = pool.indexOf(appleId);
  if (idx !== -1) pool.splice(idx, 1);
  pool.push(appleId);
  if (pool.length > 50) pool.shift();
}

/** Fisher–Yates — uniform permutation; `sort(() => Math.random() - 0.5)` is biased. */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DEFAULT_VENUE_TIMEZONE = 'Africa/Johannesburg';

/** Hour (0–23) for explicit-content window; uses venue.settings.timezone when set (IANA). */
function getVenueLocalHour(venue) {
  const tz = (venue?.settings?.timezone && typeof venue.settings.timezone === 'string')
    ? venue.settings.timezone
    : DEFAULT_VENUE_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour');
    if (h) return parseInt(h.value, 10);
  } catch (_) {
    /* invalid IANA — fall through to server-local */
  }
  return new Date().getHours();
}

// Maps venue genre labels (from Settings.jsx) to what Apple Music actually stores
// in genre metadata. Apple Music's tags often differ from common genre names —
// e.g. "Indie" songs are tagged "Alternative", "Hip-Hop" songs are "Hip-Hop/Rap", etc.
// Both the search term expansion AND the songMatchesGenreRules matching use this map.
const GENRE_ALIASES = {
  'indie':       ['indie', 'alternative', 'indie pop', 'indie rock', 'alternative & indie'],
  'hip-hop':     ['hip-hop', 'hip hop', 'rap', 'hip-hop/rap', 'urban contemporary'],
  'r&b':         ['r&b', 'r&b/soul', 'soul', 'urban contemporary'],
  'soul':        ['soul', 'r&b/soul', 'r&b'],
  'electronic':  ['electronic', 'dance', 'electronica', 'edm'],
  'dance':       ['dance', 'electronic', 'edm', 'house'],
  'edm':         ['edm', 'electronic', 'dance', 'house'],
  'house':       ['house', 'afro house', 'deep house', 'electronic'],
  'amapiano':    ['amapiano', 'afrobeat', 'house', 'afro house'],
  'kwaito':      ['kwaito', 'afrobeat', 'african'],
  'afrobeat':    ['afrobeat', 'afro', 'afro pop', 'world'],
  'metal':       ['metal', 'heavy metal', 'hard rock'],
  'punk':        ['punk', 'punk rock', 'alternative'],
  'folk':        ['folk', 'contemporary folk', 'singer/songwriter', 'acoustic'],
  'blues':       ['blues', 'blues/r&b'],
  'gospel':      ['gospel', 'christian', 'religious'],
  'trap':        ['trap', 'hip-hop', 'hip-hop/rap', 'rap'],
  'lo-fi':       ['lo-fi', 'lo fi', 'lofi', 'alternative', 'chillhop'],
  'classical':   ['classical', 'orchestral', 'opera'],
  'reggae':      ['reggae', 'reggae/dancehall', 'dancehall'],
  'latin':       ['latin', 'urbano latino', 'latin pop', 'reggaeton'],
  'funk':        ['funk', 'soul', 'r&b'],
  'jazz':        ['jazz', 'smooth jazz', 'vocal jazz'],
  'ambient':     ['ambient', 'new age', 'electronic'],
  'techno':      ['techno', 'electronic', 'dance'],
  'alternative': ['alternative', 'indie', 'indie pop', 'indie rock', 'alternative & indie'],
};

// Used when no genre is selected — search terms rotate so we get a wide variety.
const BROAD_SEARCH_TERMS = [
  'pop', 'rock', 'hip hop', 'r&b', 'alternative', 'indie',
  'electronic', 'dance', 'soul', 'country', 'folk', 'jazz',
  'afrobeat', 'amapiano', 'reggae', 'funk', 'blues', 'latin',
  'new music', 'top hits', 'chart hits',
];

// Per-language artist/keyword pools.  When a language is selected without any
// regular genre filter we rotate through these instead of just the language name,
// giving access to thousands more songs in that language.
const LANGUAGE_SEARCH_TERMS = {
  afrikaans: [
    'afrikaans',
    'Gstring', 'Bok van Blerk', 'Kurt Darren', 'Droomsindroom', 'Elandré',
    'Juanita du Plessis', 'Karen Zoid', 'Steve Hofmeyr', 'Die Heuwels Fantasties',
    'Bouwer Bosch', 'Riana Nel', 'Francois van Coke', 'Chris Chameleon',
    'Valiant Swart', 'Laurika Rauch', 'Koos Kombuis', 'Bobby van Jaarsveld',
    'Ruan José', 'Robbie Wessels', 'Straatligkinders', 'Spoegwolf',
    'Foto na Dans', 'Dozi', 'Coenie de Villiers', 'Johannes Kerkorrel',
    'Anton Goosen', 'Fokofpolisiekar', 'Nicholis Louw', 'Amore Bekker',
    'Carike Keuzenkamp', 'Lochner de Kock', 'Theuns Jordaan', 'Mathys Roets',
    'Andre Visser', 'Stef Bos', 'Manie Jackson', 'Die Tuindwergies',
    'Sunstroke', 'Liezel Pieters', 'Awie van Wyk', 'Groep Twee',
    'afrikaanse treffers', 'nuwe afrikaans', 'afrikaans pop', 'afrikaans rock',
  ],

  // English has no genre tag in Apple Music — songs are labelled Pop/Rock/etc.
  // Use popular artists + genre terms so we get a wide variety of English songs.
  english: [
    'pop', 'rock', 'hip hop', 'r&b', 'alternative', 'indie',
    'electronic', 'dance', 'soul', 'country', 'folk', 'jazz',
    'Taylor Swift', 'Ed Sheeran', 'The Weeknd', 'Billie Eilish',
    'Ariana Grande', 'Bruno Mars', 'Dua Lipa', 'Harry Styles',
    'Post Malone', 'Drake', 'Adele', 'Coldplay', 'Imagine Dragons',
    'Olivia Rodrigo', 'Doja Cat', 'Justin Bieber', 'Sam Smith',
    'Lewis Capaldi', 'Charlie Puth', 'Shawn Mendes', 'Lizzo',
    'top hits', 'chart hits', 'new music', 'singer songwriter',
  ],

  spanish: [
    'latin', 'reggaeton', 'latin pop', 'salsa', 'bachata', 'cumbia',
    'Bad Bunny', 'J Balvin', 'Shakira', 'Maluma', 'Daddy Yankee',
    'Ricky Martin', 'Enrique Iglesias', 'Luis Fonsi', 'Ozuna',
    'Anuel AA', 'Karol G', 'Becky G', 'Nicky Jam', 'Farruko',
    'Peso Pluma', 'Rauw Alejandro', 'Myke Towers', 'Sebastián Yatra',
    'Rosalía', 'Anitta spanish', 'C. Tangana', 'Alejandro Sanz',
  ],

  french: [
    'chanson française', 'french pop', 'musique française',
    'Stromae', 'Aya Nakamura', 'Indochine', 'Mylène Farmer', 'Céline Dion',
    'Christine and the Queens', 'Zaz', 'MC Solaar', 'Soprano',
    'Maître Gims', 'PNL', 'Angèle', 'Clara Luciani', 'Louane',
    'Francis Cabrel', 'Edith Piaf', 'Serge Gainsbourg', 'Ninho',
    'Nekfeu', 'Julien Doré', 'Grand Corps Malade', 'Patrick Bruel',
  ],

  portuguese: [
    'sertanejo', 'forró', 'bossa nova', 'fado', 'brazilian music',
    'Anitta', 'Caetano Veloso', 'Jorge Ben Jor', 'Roberto Carlos',
    'Marília Mendonça', 'Wesley Safadão', 'Ludmilla', 'Ivete Sangalo',
    'Gusttavo Lima', 'Luan Santana', 'Gloria Groove', 'Pabllo Vittar',
    'Salvador Sobral', 'Ana Moura', 'Dulce Pontes', 'Madredeus',
  ],

  german: [
    'deutsch pop', 'deutschrock', 'schlager', 'german music',
    'Rammstein', 'Die Toten Hosen', 'Kraftwerk', 'Nena', 'Falco',
    'Helene Fischer', 'Mark Forster', 'Clueso', 'Silbermond',
    'Adel Tawil', 'Lena Meyer-Landrut', 'Andreas Gabalier',
    'Herbert Grönemeyer', 'Udo Jürgens', 'Sarah Connor', 'Revolverheld',
  ],

  italian: [
    'musica italiana', 'canzone italiana', 'italian pop',
    'Laura Pausini', 'Eros Ramazzotti', 'Tiziano Ferro', 'Andrea Bocelli',
    'Zucchero', 'Jovanotti', 'Elisa', 'Marco Mengoni', 'Emma Marrone',
    'Mahmood', 'Blanco', 'Måneskin', 'Fedez', 'Giorgia', 'Vasco Rossi',
    'Lucio Battisti', 'Fabrizio De André', 'Pino Daniele',
  ],

  zulu: [
    'maskandi', 'gqom', 'zulu music', 'isicathamiya',
    'Ladysmith Black Mambazo', 'Sjava', 'Big Zulu', 'Busta 929',
    'Mlindo The Vocalist', 'Mthunzi', 'Mnqobi Yazo', 'Imithente',
    'Phuzekhemisi', 'Mfaz Omnyama', 'Thokozani Langa', 'afro house',
  ],

  xhosa: [
    'xhosa music', 'xhosa gospel', 'imibongo',
    'Miriam Makeba', 'Brenda Fassie', 'Thandiswa Mazwai',
    'Zahara', 'Langa Mavuso', 'Nathi', 'xhosa pop',
  ],

  sotho: [
    'sotho music', 'sesotho', 'lesotho music', 'sotho gospel',
    'Mahlathini', 'The Mahotella Queens', 'Ntate Stunna',
    'Nkosazana Daughter', 'Morija', 'sotho traditional',
  ],

  tswana: [
    'setswana', 'tswana music', 'botswana music', 'tswana gospel',
    'Vee Mampeezy', 'Charma Gal', 'Zeus', 'ATI', 'tswana pop',
  ],

  korean: [
    'kpop', 'k-pop', 'korean pop', 'korean music',
    'BTS', 'BLACKPINK', 'Stray Kids', 'EXO', 'TWICE', 'IU',
    'Aespa', 'NewJeans', 'PSY', 'Epik High', 'Zico', 'G-Dragon',
    'SHINee', 'SEVENTEEN', 'ITZY', 'Red Velvet', 'NCT 127',
    'Monsta X', 'Sunmi', 'HyunA', 'LE SSERAFIM', 'fromis_9',
  ],

  japanese: [
    'jpop', 'j-pop', 'japanese music', 'anime music', 'j-rock',
    'Fujii Kaze', 'Kenshi Yonezu', 'Aimyon', 'King Gnu', 'Yoasobi',
    'Official HIGE DANdism', 'Mrs GREEN APPLE', 'Yorushika', 'Aimer',
    'Bump of Chicken', 'One OK Rock', 'Utada Hikaru', 'Perfume', 'LiSA',
    'Radwimps', 'Eve', 'Vaundy', 'Ado', 'Creepy Nuts',
  ],

  arabic: [
    'arabic music', 'arabic pop', 'khaleeji', 'arab music',
    'Amr Diab', 'Nancy Ajram', 'Fairuz', 'Kadim Al Sahir',
    'Elissa', 'Haifa Wehbe', 'Mohamed Hamaki', 'Sherine',
    'Tamer Hosny', 'Assala', 'Wael Jassar', 'Ragheb Alama',
    'Balqees', 'Hussain Al Jassmi', 'Mohammed Abdu',
  ],

  hindi: [
    'bollywood', 'hindi songs', 'indian music', 'punjabi music',
    'Arijit Singh', 'A.R. Rahman', 'Shreya Ghoshal', 'Badshah',
    'Neha Kakkar', 'Sonu Nigam', 'Atif Aslam', 'Jubin Nautiyal',
    'Pritam', 'desi pop', 'bhangra', 'Yo Yo Honey Singh',
    'Diljit Dosanjh', 'Guru Randhawa', 'Armaan Malik',
  ],
};

// Pick a song not heard recently; fall back to full pool when everything is recent.
function pickFreshSong(songs, venueCode) {
  if (!songs.length) return null;
  const recent = getRecentPool(venueCode);
  const fresh = songs.filter((s) => !recent.includes(s.appleId));
  const chosen = fresh.length > 0
    ? fresh[Math.floor(Math.random() * fresh.length)]
    : songs[Math.floor(Math.random() * songs.length)];
  if (chosen && venueCode) recordAutofillPlay(venueCode, chosen.appleId);
  return chosen;
}

// Expands a genre label to all Apple Music genre tags it should match.
// e.g. 'Indie' → ['indie', 'alternative', 'indie pop', 'indie rock', 'alternative & indie']
function expandGenre(genre) {
  return GENRE_ALIASES[genre.toLowerCase()] || [genre.toLowerCase()];
}

// Returns true if a song satisfies the venue's genre selection rules.
//   - No genres selected             → accept every song (no filter)
//   - Only regular genres selected  → song matches any of them (OR)
//   - Only language genres selected  → song matches any of them (OR)
//   - Both groups selected           → song must match ≥1 language AND ≥1 regular genre (AND)
function songMatchesGenreRules(song, languageGenres, regularGenres) {
  const hasLang = languageGenres.length > 0;
  const hasRegular = regularGenres.length > 0;

  // No genre filter at all — every song qualifies
  if (!hasLang && !hasRegular) return true;

  const songGenre = (song.genre || '').toLowerCase();

  // Check if a song's genre string matches a given genre label (with aliases).
  const matchesRegular = (g) => expandGenre(g).some((alias) => songGenre.includes(alias));

  // 'English' is never stored as a genre tag in Apple Music — songs are tagged
  // 'Pop', 'Rock', 'Hip-Hop' etc.  Exclude it from language checks so that
  // English (alone or combined with regular genres) doesn't block all results.
  const checkableLangs = languageGenres.filter((g) => g.toLowerCase() !== 'english');
  const hasCheckableLang = checkableLangs.length > 0;

  if (hasCheckableLang && hasRegular) {
    return (
      checkableLangs.some((g) => songGenre.includes(g.toLowerCase())) &&
      regularGenres.some(matchesRegular)
    );
  }
  if (hasCheckableLang) {
    return checkableLangs.some((g) => songGenre.includes(g.toLowerCase()));
  }
  // Only English selected (no other checkable language): fall through to regular genre check
  if (hasRegular) {
    return regularGenres.some(matchesRegular);
  }
  // English-only, no regular genres → any song qualifies
  return true;
}

// Mock catalog for development when no Apple Music API token is set
const MOCK_CATALOG = [
  { appleId: 'song_001', title: 'Midnight Groove', artist: 'The Velvet Keys', albumArt: 'https://picsum.photos/200', duration: 210, genre: 'Jazz' },
  { appleId: 'song_002', title: 'Summer Vibes', artist: 'Coastal Dreams', albumArt: 'https://picsum.photos/201', duration: 195, genre: 'Pop' },
  { appleId: 'song_003', title: 'Bassline Therapy', artist: 'DJ Nexus', albumArt: 'https://picsum.photos/202', duration: 240, genre: 'Electronic' },
  { appleId: 'song_004', title: 'Acoustic Sunset', artist: 'Emma Hart', albumArt: 'https://picsum.photos/203', duration: 180, genre: 'Folk' },
  { appleId: 'song_005', title: 'Neon Nights', artist: 'Synthwave Collective', albumArt: 'https://picsum.photos/204', duration: 225, genre: 'Synthwave' },
  { appleId: 'song_006', title: 'Urban Rhythm', artist: 'MC Flow', albumArt: 'https://picsum.photos/205', duration: 200, genre: 'Hip-Hop' },
  { appleId: 'song_007', title: 'Tropical Paradise', artist: 'Island Fusion', albumArt: 'https://picsum.photos/206', duration: 215, genre: 'Reggae' },
  { appleId: 'song_008', title: 'Electric Dreams', artist: 'Voltage', albumArt: 'https://picsum.photos/207', duration: 230, genre: 'Electronic' },
  { appleId: 'song_009', title: 'Jazz Cafe', artist: 'The Modern Quartet', albumArt: 'https://picsum.photos/208', duration: 255, genre: 'Jazz' },
  { appleId: 'song_010', title: 'Rock Anthem', artist: 'Thunder Road', albumArt: 'https://picsum.photos/209', duration: 220, genre: 'Rock' },
  { appleId: 'song_011', title: 'Moonlight Serenade', artist: 'Luna Strings', albumArt: 'https://picsum.photos/210', duration: 195, genre: 'Classical' },
  { appleId: 'song_012', title: 'Latin Fire', artist: 'Carlos & The Rhythm Section', albumArt: 'https://picsum.photos/211', duration: 210, genre: 'Latin' },
  { appleId: 'song_013', title: 'Lo-Fi Study', artist: 'Beats & Books', albumArt: 'https://picsum.photos/212', duration: 180, genre: 'Lo-Fi' },
  { appleId: 'song_014', title: 'Country Roads Remix', artist: 'Modern Outlaws', albumArt: 'https://picsum.photos/213', duration: 200, genre: 'Country' },
  { appleId: 'song_015', title: 'Afrobeat Celebration', artist: 'Kwame & The Groove Kings', albumArt: 'https://picsum.photos/214', duration: 245, genre: 'Afrobeat' },
  { appleId: 'song_016', title: 'Techno Underground', artist: 'Berliner Beats', albumArt: 'https://picsum.photos/215', duration: 360, genre: 'Techno' },
  { appleId: 'song_017', title: 'R&B Smooth', artist: 'Soulful Nights', albumArt: 'https://picsum.photos/216', duration: 225, genre: 'R&B' },
  { appleId: 'song_018', title: 'Punk Revolution', artist: 'The Rebels', albumArt: 'https://picsum.photos/217', duration: 165, genre: 'Punk' },
  { appleId: 'song_019', title: 'Trap Remix 2024', artist: 'Producer X', albumArt: 'https://picsum.photos/218', duration: 195, genre: 'Trap' },
  { appleId: 'song_020', title: 'Ambient Space', artist: 'Cosmos Explorer', albumArt: 'https://picsum.photos/219', duration: 420, genre: 'Ambient' },
  { appleId: 'song_021', title: 'Desert Winds', artist: 'Sahara Echo', albumArt: 'https://picsum.photos/220', duration: 240, genre: 'World' },
  { appleId: 'song_022', title: 'City Lights', artist: 'Urban Souls', albumArt: 'https://picsum.photos/221', duration: 210, genre: 'Pop' },
  { appleId: 'song_023', title: 'Rainy Day', artist: 'Mellow Moods', albumArt: 'https://picsum.photos/222', duration: 195, genre: 'Lo-Fi' },
  { appleId: 'song_024', title: 'Dance All Night', artist: 'Club Masters', albumArt: 'https://picsum.photos/223', duration: 230, genre: 'Dance' },
  { appleId: 'song_025', title: 'Mountain High', artist: 'Echo Valley', albumArt: 'https://picsum.photos/224', duration: 255, genre: 'Folk' },
  { appleId: 'song_026', title: 'Ocean Breeze', artist: 'Wave Riders', albumArt: 'https://picsum.photos/225', duration: 200, genre: 'Pop' },
  { appleId: 'song_027', title: 'Funky Town', artist: 'Groove Squad', albumArt: 'https://picsum.photos/226', duration: 220, genre: 'Funk' },
  { appleId: 'song_028', title: 'Starlight', artist: 'Night Dreamers', albumArt: 'https://picsum.photos/227', duration: 210, genre: 'Pop' },
  { appleId: 'song_029', title: 'Fire & Ice', artist: 'Dual Elements', albumArt: 'https://picsum.photos/228', duration: 240, genre: 'Electronic' },
  { appleId: 'song_030', title: 'Sunrise Symphony', artist: 'Dawn Orchestra', albumArt: 'https://picsum.photos/229', duration: 300, genre: 'Classical' },
  { appleId: 'song_031', title: 'Wild Hearts', artist: 'Free Spirits', albumArt: 'https://picsum.photos/230', duration: 195, genre: 'Rock' },
  { appleId: 'song_032', title: 'Neon Dreams', artist: 'Cyber Pulse', albumArt: 'https://picsum.photos/231', duration: 225, genre: 'Synthwave' },
  { appleId: 'song_033', title: 'Soul Connection', artist: 'Deep Feelings', albumArt: 'https://picsum.photos/232', duration: 240, genre: 'R&B' },
  { appleId: 'song_034', title: 'Electric Love', artist: 'Voltage Hearts', albumArt: 'https://picsum.photos/233', duration: 215, genre: 'Pop' },
  { appleId: 'song_035', title: 'Midnight Run', artist: 'Night Drivers', albumArt: 'https://picsum.photos/234', duration: 200, genre: 'Electronic' },
  { appleId: 'song_036', title: 'Golden Hour', artist: 'Sunset Club', albumArt: 'https://picsum.photos/235', duration: 230, genre: 'Pop' },
  { appleId: 'song_037', title: 'Bass Drop', artist: 'Sound Wave', albumArt: 'https://picsum.photos/236', duration: 180, genre: 'EDM' },
  { appleId: 'song_038', title: 'Velvet Voice', artist: 'Silk Tones', albumArt: 'https://picsum.photos/237', duration: 225, genre: 'R&B' },
  { appleId: 'song_039', title: 'Thunder Strike', artist: 'Storm Chasers', albumArt: 'https://picsum.photos/238', duration: 195, genre: 'Rock' },
  { appleId: 'song_040', title: 'Paradise Found', artist: 'Island Vibes', albumArt: 'https://picsum.photos/239', duration: 210, genre: 'Pop' },
  { appleId: 'song_041', title: 'Nonstop', artist: 'Drake', albumArt: 'https://picsum.photos/240', duration: 238, genre: 'Hip-Hop' },
  { appleId: 'song_042', title: 'Blinding Lights', artist: 'The Weeknd', albumArt: 'https://picsum.photos/241', duration: 200, genre: 'Pop' },
  { appleId: 'song_043', title: 'Levitating', artist: 'Dua Lipa', albumArt: 'https://picsum.photos/242', duration: 203, genre: 'Pop' },
  { appleId: 'song_044', title: 'Shivers', artist: 'Ed Sheeran', albumArt: 'https://picsum.photos/243', duration: 207, genre: 'Pop' },
  { appleId: 'song_045', title: 'Save Your Tears', artist: 'The Weeknd', albumArt: 'https://picsum.photos/244', duration: 215, genre: 'Pop' },
  { appleId: 'song_046', title: 'Heat Waves', artist: 'Glass Animals', albumArt: 'https://picsum.photos/245', duration: 239, genre: 'Indie' },
  { appleId: 'song_047', title: 'Good 4 U', artist: 'Olivia Rodrigo', albumArt: 'https://picsum.photos/246', duration: 178, genre: 'Pop' },
  { appleId: 'song_048', title: 'Peaches', artist: 'Justin Bieber', albumArt: 'https://picsum.photos/247', duration: 211, genre: 'Pop' },
  { appleId: 'song_049', title: 'Stay', artist: 'The Kid LAROI', albumArt: 'https://picsum.photos/248', duration: 141, genre: 'Pop' },
  { appleId: 'song_050', title: 'Industry Baby', artist: 'Lil Nas X', albumArt: 'https://picsum.photos/249', duration: 212, genre: 'Hip-Hop' },
  // Additional songs from user catalog (~200 more)
  { appleId: 'song_051', title: 'The A Team', artist: 'Ed Sheeran', albumArt: 'https://picsum.photos/251', duration: 258, genre: 'Pop' },
  { appleId: 'song_052', title: 'A-Ba-Ni-Bi', artist: 'Yosef Simon', albumArt: 'https://picsum.photos/252', duration: 181, genre: 'Worldwide' },
  { appleId: 'song_053', title: 'The Adults Are Talking', artist: 'The Strokes', albumArt: 'https://picsum.photos/253', duration: 309, genre: 'Alternative' },
  { appleId: 'song_054', title: 'Adventure of a Lifetime', artist: 'Coldplay', albumArt: 'https://picsum.photos/254', duration: 264, genre: 'Alternative' },
  { appleId: 'song_055', title: 'Africa (Single Version)', artist: 'Toto', albumArt: 'https://picsum.photos/255', duration: 261, genre: 'Pop' },
  { appleId: 'song_056', title: 'Afrika Son', artist: 'Droomsindroom', albumArt: 'https://picsum.photos/256', duration: 171, genre: 'Afrikaans' },
  { appleId: 'song_057', title: 'After Dark', artist: 'Mr.Kitty', albumArt: 'https://picsum.photos/257', duration: 259, genre: 'Alternative' },
  { appleId: 'song_058', title: 'After Dark x Sweater Weather', artist: "Daddy's Girl, Creamy & 11:11 Music Group", albumArt: 'https://picsum.photos/258', duration: 291, genre: 'Alternative' },
  { appleId: 'song_059', title: 'After Many Miles', artist: 'The Ghost of Paul Revere', albumArt: 'https://picsum.photos/259', duration: 150, genre: 'Rock' },
  { appleId: 'song_060', title: 'After Party', artist: 'Don Toliver', albumArt: 'https://picsum.photos/260', duration: 168, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_061', title: 'Aftermath', artist: 'Caravan Palace', albumArt: 'https://picsum.photos/261', duration: 186, genre: 'Electronic' },
  { appleId: 'song_062', title: 'Ai My Lam', artist: 'Ryno Velvet', albumArt: 'https://picsum.photos/262', duration: 233, genre: 'Rock' },
  { appleId: 'song_063', title: 'Al Die Dubbels', artist: 'Bok van Blerk', albumArt: 'https://picsum.photos/263', duration: 197, genre: 'Afrikaans' },
  { appleId: 'song_064', title: 'Alejandro', artist: 'Lady Gaga', albumArt: 'https://picsum.photos/264', duration: 275, genre: 'Pop' },
  { appleId: 'song_065', title: 'Alibi', artist: 'Sevdaliza, Pabllo Vittar & Yseult', albumArt: 'https://picsum.photos/265', duration: 162, genre: 'Urbano latino' },
  { appleId: 'song_066', title: 'Alien Blues', artist: 'Vundabar', albumArt: 'https://picsum.photos/266', duration: 156, genre: 'Pop' },
  { appleId: 'song_067', title: 'All Girls Are the Same', artist: 'Juice WRLD', albumArt: 'https://picsum.photos/267', duration: 166, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_068', title: 'All I Want', artist: 'Kodaline', albumArt: 'https://picsum.photos/268', duration: 306, genre: 'Alternative' },
  { appleId: 'song_069', title: 'All Mine', artist: 'Kanye West', albumArt: 'https://picsum.photos/269', duration: 146, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_070', title: 'All My Life (feat. J. Cole)', artist: 'Lil Durk', albumArt: 'https://picsum.photos/270', duration: 224, genre: 'Rap' },
  { appleId: 'song_071', title: 'All My Love', artist: 'Noah Kahan', albumArt: 'https://picsum.photos/271', duration: 252, genre: 'Alternative' },
  { appleId: 'song_072', title: 'All My Love', artist: 'Noah Kahan', albumArt: 'https://picsum.photos/272', duration: 252, genre: 'Alternative' },
  { appleId: 'song_073', title: 'All Night (Slowed N Reverb)', artist: 'The Vamps & Matoma', albumArt: 'https://picsum.photos/273', duration: 244, genre: 'Pop' },
  { appleId: 'song_074', title: 'All Night Long (All Night)', artist: 'Lionel Richie', albumArt: 'https://picsum.photos/274', duration: 385, genre: 'R&B/Soul' },
  { appleId: 'song_075', title: 'All Shook Up', artist: 'Elvis Presley', albumArt: 'https://picsum.photos/275', duration: 118, genre: 'Rock' },
  { appleId: 'song_076', title: 'All Star', artist: 'Smash Mouth', albumArt: 'https://picsum.photos/276', duration: 201, genre: 'Pop' },
  { appleId: 'song_077', title: 'All That and More (Sailboat)', artist: 'Rainbow Kitten Surprise', albumArt: 'https://picsum.photos/277', duration: 171, genre: 'Rock' },
  { appleId: 'song_078', title: 'All the Debts I Owe', artist: 'Caamp', albumArt: 'https://picsum.photos/278', duration: 193, genre: 'Contemporary Folk' },
  { appleId: 'song_079', title: 'All the Pretty Girls', artist: 'KALEO', albumArt: 'https://picsum.photos/279', duration: 270, genre: 'Alternative' },
  { appleId: 'song_080', title: 'All the Right Moves', artist: 'OneRepublic', albumArt: 'https://picsum.photos/280', duration: 238, genre: 'Pop' },
  { appleId: 'song_081', title: 'All The Things She Said (Teaboy Flip)', artist: 'Teaboy', albumArt: 'https://picsum.photos/281', duration: 164, genre: 'Pop' },
  { appleId: 'song_082', title: 'All Time Low', artist: 'Jon Bellion', albumArt: 'https://picsum.photos/282', duration: 218, genre: 'Pop' },
  { appleId: 'song_083', title: 'All We Do', artist: 'Oh Wonder', albumArt: 'https://picsum.photos/283', duration: 214, genre: 'Alternative' },
  { appleId: 'song_084', title: 'All We Ever Knew', artist: 'The Head and the Heart', albumArt: 'https://picsum.photos/284', duration: 226, genre: 'Alternative' },
  { appleId: 'song_085', title: "All Your'n", artist: 'Tyler Childers', albumArt: 'https://picsum.photos/285', duration: 218, genre: 'Country' },
  { appleId: 'song_086', title: "All's Well That Ends", artist: 'Rainbow Kitten Surprise', albumArt: 'https://picsum.photos/286', duration: 207, genre: 'Rock' },
  { appleId: 'song_087', title: 'Almost (Sweet Music)', artist: 'Hozier', albumArt: 'https://picsum.photos/287', duration: 217, genre: 'Alternative' },
  { appleId: 'song_088', title: 'Alright (2015 - Remaster)', artist: 'Supergrass', albumArt: 'https://picsum.photos/288', duration: 181, genre: 'Rock' },
  { appleId: 'song_089', title: 'Am I Wrong', artist: 'Nico & Vinz', albumArt: 'https://picsum.photos/289', duration: 248, genre: 'Pop' },
  { appleId: 'song_090', title: 'Amen', artist: 'Droomsindroom', albumArt: 'https://picsum.photos/290', duration: 206, genre: 'Afrikaans' },
  { appleId: 'song_091', title: 'American Boy (feat. Kanye West)', artist: 'Estelle', albumArt: 'https://picsum.photos/291', duration: 285, genre: 'R&B/Soul' },
  { appleId: 'song_092', title: 'American Hero', artist: 'Rainbow Kitten Surprise', albumArt: 'https://picsum.photos/292', duration: 273, genre: 'Rock' },
  { appleId: 'song_093', title: 'American Money', artist: 'BØRNS', albumArt: 'https://picsum.photos/293', duration: 261, genre: 'Alternative' },
  { appleId: 'song_094', title: 'American Pie', artist: 'Don Mclean', albumArt: 'https://picsum.photos/294', duration: 516, genre: 'Pop' },
  { appleId: 'song_095', title: 'American Romance', artist: 'Michael Marcagi', albumArt: 'https://picsum.photos/295', duration: 192, genre: 'Alternative' },
  { appleId: 'song_096', title: 'American Shoes', artist: 'Rainbow Kitten Surprise', albumArt: 'https://picsum.photos/296', duration: 249, genre: 'Rock' },
  { appleId: 'song_097', title: 'Amour plastique', artist: 'Videoclub, Adèle Castillon & Mattyeux', albumArt: 'https://picsum.photos/297', duration: 227, genre: 'French Pop' },
  { appleId: 'song_098', title: 'Amsterdam', artist: 'Krooked Kings', albumArt: 'https://picsum.photos/298', duration: 290, genre: 'Alternative' },
  { appleId: 'song_099', title: '...And to Those I Love, Thanks for Sticking Around', artist: '$uicideboy$', albumArt: 'https://picsum.photos/299', duration: 168, genre: 'Hip-Hop' },
  { appleId: 'song_100', title: 'Andante, Andante', artist: 'Lily James', albumArt: 'https://picsum.photos/300', duration: 240, genre: 'Soundtrack' },
  { appleId: 'song_101', title: 'Anemone', artist: 'slenderbodies', albumArt: 'https://picsum.photos/301', duration: 228, genre: 'Alternative' },
  { appleId: 'song_102', title: 'Angela', artist: 'The Lumineers', albumArt: 'https://picsum.photos/302', duration: 202, genre: 'Alternative' },
  { appleId: 'song_103', title: 'Angels Above Me', artist: 'Stick Figure', albumArt: 'https://picsum.photos/303', duration: 267, genre: 'Reggae' },
  { appleId: 'song_104', title: 'Another Love', artist: 'OSTEKKE', albumArt: 'https://picsum.photos/304', duration: 146, genre: 'Dance' },
  { appleId: 'song_105', title: 'Another Love', artist: 'Tom Odell', albumArt: 'https://picsum.photos/305', duration: 251, genre: 'Singer/Songwriter' },
  { appleId: 'song_106', title: 'Another Story', artist: 'The Head and the Heart', albumArt: 'https://picsum.photos/306', duration: 274, genre: 'Alternative' },
  { appleId: 'song_107', title: 'ANXIETY (feat. Doechii)', artist: 'Sleepy Hallow', albumArt: 'https://picsum.photos/307', duration: 149, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_108', title: 'Anyone For You (Tiger Lily)', artist: 'George Ezra', albumArt: 'https://picsum.photos/308', duration: 188, genre: 'Singer/Songwriter' },
  { appleId: 'song_109', title: 'Aphrodite', artist: 'TRESOR & Beatenberg', albumArt: 'https://picsum.photos/309', duration: 235, genre: 'Pop' },
  { appleId: 'song_110', title: 'Apocalypse', artist: 'Cigarettes After Sex', albumArt: 'https://picsum.photos/310', duration: 290, genre: 'Alternative' },
  { appleId: 'song_111', title: 'Apologize (feat. One Republic)', artist: 'Timbaland', albumArt: 'https://picsum.photos/311', duration: 184, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_112', title: 'Arcade', artist: 'Duncan Laurence', albumArt: 'https://picsum.photos/312', duration: 184, genre: 'Pop' },
  { appleId: 'song_113', title: 'Are We Ready? (Wreck)', artist: 'Two Door Cinema Club', albumArt: 'https://picsum.photos/313', duration: 231, genre: 'Alternative' },
  { appleId: 'song_114', title: 'Are You Bored Yet? (feat. Clairo)', artist: 'Wallows', albumArt: 'https://picsum.photos/314', duration: 178, genre: 'Alternative' },
  { appleId: 'song_115', title: 'Armed and Dangerous', artist: 'Juice WRLD', albumArt: 'https://picsum.photos/315', duration: 170, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_116', title: 'As It Was', artist: 'Harry Styles', albumArt: 'https://picsum.photos/316', duration: 167, genre: 'Pop' },
  { appleId: 'song_117', title: 'Asseblief', artist: 'Elandré', albumArt: 'https://picsum.photos/317', duration: 208, genre: 'Afrikaans' },
  { appleId: 'song_118', title: 'Astronaut In The Ocean', artist: 'Masked Wolf', albumArt: 'https://picsum.photos/318', duration: 133, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_119', title: 'Astrovan', artist: 'Mt. Joy', albumArt: 'https://picsum.photos/319', duration: 186, genre: 'Alternative' },
  { appleId: 'song_120', title: 'Atlantis', artist: 'Seafret', albumArt: 'https://picsum.photos/320', duration: 230, genre: 'Alternative' },
  { appleId: 'song_121', title: 'bad guy', artist: 'Billie Eilish', albumArt: 'https://picsum.photos/321', duration: 194, genre: 'Alternative' },
  { appleId: 'song_122', title: 'Bad Liar', artist: 'Imagine Dragons', albumArt: 'https://picsum.photos/322', duration: 261, genre: 'Alternative' },
  { appleId: 'song_123', title: 'Bank Account', artist: '21 Savage', albumArt: 'https://picsum.photos/323', duration: 220, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_124', title: 'A Bar Song (Tipsy)', artist: 'Shaboozey', albumArt: 'https://picsum.photos/324', duration: 171, genre: 'Country' },
  { appleId: 'song_125', title: 'Barcelona', artist: 'George Ezra', albumArt: 'https://picsum.photos/325', duration: 189, genre: 'Singer/Songwriter' },
  { appleId: 'song_126', title: 'Be Alright', artist: 'Dean Lewis', albumArt: 'https://picsum.photos/326', duration: 196, genre: 'Singer/Songwriter' },
  { appleId: 'song_127', title: 'Beautiful Things', artist: 'Benson Boone', albumArt: 'https://picsum.photos/327', duration: 180, genre: 'Pop' },
  { appleId: 'song_128', title: 'Before You Go', artist: 'Lewis Capaldi', albumArt: 'https://picsum.photos/328', duration: 216, genre: 'Alternative' },
  { appleId: 'song_129', title: "Beggin'", artist: 'Måneskin', albumArt: 'https://picsum.photos/329', duration: 212, genre: 'Pop' },
  { appleId: 'song_130', title: 'Belong Together', artist: 'Mark Ambor', albumArt: 'https://picsum.photos/330', duration: 148, genre: 'Pop' },
  { appleId: 'song_131', title: 'Better Now', artist: 'Post Malone', albumArt: 'https://picsum.photos/331', duration: 231, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_132', title: 'Blinding Lights', artist: 'The Weeknd', albumArt: 'https://picsum.photos/332', duration: 202, genre: 'R&B/Soul' },
  { appleId: 'song_133', title: 'Blossom', artist: 'Milky Chance', albumArt: 'https://picsum.photos/333', duration: 253, genre: 'Indie Pop' },
  { appleId: 'song_134', title: 'Bohemian Rhapsody', artist: 'Queen', albumArt: 'https://picsum.photos/334', duration: 355, genre: 'Rock' },
  { appleId: 'song_135', title: 'bones', artist: 'Rainbow Kitten Surprise', albumArt: 'https://picsum.photos/335', duration: 205, genre: 'Alternative' },
  { appleId: 'song_136', title: 'Budapest', artist: 'George Ezra', albumArt: 'https://picsum.photos/336', duration: 201, genre: 'Pop' },
  { appleId: 'song_137', title: 'Burn', artist: 'David Kushner', albumArt: 'https://picsum.photos/337', duration: 179, genre: 'Pop' },
  { appleId: 'song_138', title: 'Cake By The Ocean', artist: 'DNCE', albumArt: 'https://picsum.photos/338', duration: 219, genre: 'Pop' },
  { appleId: 'song_139', title: "California Dreamin' (Single)", artist: 'The Mamas & The Papas', albumArt: 'https://picsum.photos/339', duration: 162, genre: 'Pop' },
  { appleId: 'song_140', title: 'Call Me Maybe', artist: 'Carly Rae Jepsen', albumArt: 'https://picsum.photos/340', duration: 193, genre: 'Pop' },
  { appleId: 'song_141', title: 'Can I Call You Tonight?', artist: 'Dayglow', albumArt: 'https://picsum.photos/341', duration: 279, genre: 'Alternative' },
  { appleId: 'song_142', title: 'Caroline', artist: 'Aminé', albumArt: 'https://picsum.photos/342', duration: 210, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_143', title: 'Chamber of Reflection', artist: 'Mac DeMarco', albumArt: 'https://picsum.photos/343', duration: 232, genre: 'Alternative' },
  { appleId: 'song_144', title: 'Chasing Cars', artist: 'Snow Patrol', albumArt: 'https://picsum.photos/344', duration: 266, genre: 'Alternative' },
  { appleId: 'song_145', title: 'Cigarette Daydreams', artist: 'Cage the Elephant', albumArt: 'https://picsum.photos/345', duration: 209, genre: 'Alternative' },
  { appleId: 'song_146', title: 'Circles', artist: 'Post Malone', albumArt: 'https://picsum.photos/346', duration: 215, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_147', title: 'Clash', artist: 'Dave & Stormzy', albumArt: 'https://picsum.photos/347', duration: 252, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_148', title: 'Cleopatra', artist: 'The Lumineers', albumArt: 'https://picsum.photos/348', duration: 201, genre: 'Alternative' },
  { appleId: 'song_149', title: 'Clouds', artist: 'BØRNS', albumArt: 'https://picsum.photos/349', duration: 190, genre: 'Alternative' },
  { appleId: 'song_150', title: 'Cocoon', artist: 'Milky Chance', albumArt: 'https://picsum.photos/350', duration: 255, genre: 'Indie Pop' },
  { appleId: 'song_151', title: 'Cold Little Heart', artist: 'Michael Kiwanuka', albumArt: 'https://picsum.photos/351', duration: 598, genre: 'Soul' },
  { appleId: 'song_152', title: 'Come and Get Your Love', artist: 'Redbone', albumArt: 'https://picsum.photos/352', duration: 206, genre: 'Rock' },
  { appleId: 'song_153', title: 'Counting Stars', artist: 'OneRepublic', albumArt: 'https://picsum.photos/353', duration: 257, genre: 'Pop' },
  { appleId: 'song_154', title: 'Cradles', artist: 'Sub Urban', albumArt: 'https://picsum.photos/354', duration: 210, genre: 'Alternative' },
  { appleId: 'song_155', title: 'death bed (feat. beabadoobee)', artist: 'Powfu', albumArt: 'https://picsum.photos/355', duration: 173, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_156', title: 'Dirty Paws', artist: 'Of Monsters and Men', albumArt: 'https://picsum.photos/356', duration: 278, genre: 'Alternative' },
  { appleId: 'song_157', title: 'Do I Wanna Know?', artist: 'Arctic Monkeys', albumArt: 'https://picsum.photos/357', duration: 272, genre: 'Alternative' },
  { appleId: 'song_158', title: 'Dog Days Are Over', artist: 'Florence + the Machine', albumArt: 'https://picsum.photos/358', duration: 253, genre: 'Alternative' },
  { appleId: 'song_159', title: "Don't Stop Believin'", artist: 'Journey', albumArt: 'https://picsum.photos/359', duration: 248, genre: 'Pop' },
  { appleId: 'song_160', title: "Don't Stop Me Now", artist: 'Queen', albumArt: 'https://picsum.photos/360', duration: 210, genre: 'Rock' },
  { appleId: 'song_161', title: 'Dreams', artist: 'Fleetwood Mac', albumArt: 'https://picsum.photos/361', duration: 258, genre: 'Rock' },
  { appleId: 'song_162', title: 'Electric Love', artist: 'BØRNS', albumArt: 'https://picsum.photos/362', duration: 220, genre: 'Alternative' },
  { appleId: 'song_163', title: 'Empire State of Mind', artist: 'JAY-Z feat. Alicia Keys', albumArt: 'https://picsum.photos/363', duration: 277, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_164', title: 'Enemy', artist: 'Imagine Dragons & JID', albumArt: 'https://picsum.photos/364', duration: 173, genre: 'Alternative' },
  { appleId: 'song_165', title: 'Escapism.', artist: 'RAYE & 070 Shake', albumArt: 'https://picsum.photos/365', duration: 272, genre: 'Pop' },
  { appleId: 'song_166', title: 'Espresso', artist: 'Sabrina Carpenter', albumArt: 'https://picsum.photos/366', duration: 175, genre: 'Pop' },
  { appleId: 'song_167', title: 'Everybody Wants to Rule the World', artist: 'Tears for Fears', albumArt: 'https://picsum.photos/367', duration: 251, genre: 'Pop' },
  { appleId: 'song_168', title: 'Fast Car', artist: 'Tracy Chapman', albumArt: 'https://picsum.photos/368', duration: 297, genre: 'Singer/Songwriter' },
  { appleId: 'song_169', title: 'Feel It Still', artist: 'Portugal. The Man', albumArt: 'https://picsum.photos/369', duration: 163, genre: 'Alternative' },
  { appleId: 'song_170', title: 'Fix You', artist: 'Coldplay', albumArt: 'https://picsum.photos/370', duration: 295, genre: 'Alternative' },
  { appleId: 'song_171', title: 'Flume', artist: 'Bon Iver', albumArt: 'https://picsum.photos/371', duration: 219, genre: 'Alternative' },
  { appleId: 'song_172', title: 'Get Lucky', artist: 'Daft Punk, Pharrell Williams & Nile Rodgers', albumArt: 'https://picsum.photos/372', duration: 370, genre: 'Pop' },
  { appleId: 'song_173', title: 'Glimpse of Us', artist: 'Joji', albumArt: 'https://picsum.photos/373', duration: 233, genre: 'Pop' },
  { appleId: 'song_174', title: "God's Plan", artist: 'Drake', albumArt: 'https://picsum.photos/374', duration: 199, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_175', title: 'Good Looking', artist: 'Suki Waterhouse', albumArt: 'https://picsum.photos/375', duration: 215, genre: 'Alternative' },
  { appleId: 'song_176', title: 'Good 4 U', artist: 'Olivia Rodrigo', albumArt: 'https://picsum.photos/376', duration: 238, genre: 'Pop' },
  { appleId: 'song_177', title: 'Heat Waves', artist: 'Glass Animals', albumArt: 'https://picsum.photos/377', duration: 239, genre: 'Alternative' },
  { appleId: 'song_178', title: 'Heather', artist: 'Conan Gray', albumArt: 'https://picsum.photos/378', duration: 198, genre: 'Pop' },
  { appleId: 'song_179', title: 'Here Comes the Sun', artist: 'The Beatles', albumArt: 'https://picsum.photos/379', duration: 186, genre: 'Rock' },
  { appleId: 'song_180', title: 'Hey Ya!', artist: 'Outkast', albumArt: 'https://picsum.photos/380', duration: 236, genre: 'Pop' },
  { appleId: 'song_181', title: 'Ho Hey', artist: 'The Lumineers', albumArt: 'https://picsum.photos/381', duration: 163, genre: 'Folk' },
  { appleId: 'song_182', title: 'Hotline Bling', artist: 'Drake', albumArt: 'https://picsum.photos/382', duration: 267, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_183', title: 'House of Gold', artist: 'twenty one pilots', albumArt: 'https://picsum.photos/383', duration: 164, genre: 'Alternative' },
  { appleId: 'song_184', title: 'How to Save a Life', artist: 'The Fray', albumArt: 'https://picsum.photos/384', duration: 263, genre: 'Rock' },
  { appleId: 'song_185', title: 'I Bet My Life', artist: 'Imagine Dragons', albumArt: 'https://picsum.photos/385', duration: 194, genre: 'Alternative' },
  { appleId: 'song_186', title: "I'm Yours", artist: 'Jason Mraz', albumArt: 'https://picsum.photos/386', duration: 243, genre: 'Pop' },
  { appleId: 'song_187', title: 'Iris', artist: 'The Goo Goo Dolls', albumArt: 'https://picsum.photos/387', duration: 290, genre: 'Rock' },
  { appleId: 'song_188', title: 'Je Te Laisserai Des Mots', artist: 'Patrick Watson', albumArt: 'https://picsum.photos/388', duration: 161, genre: 'Alternative' },
  { appleId: 'song_189', title: 'Jocelyn Flores', artist: 'XXXTENTACION', albumArt: 'https://picsum.photos/389', duration: 119, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_190', title: 'July', artist: 'Noah Cyrus & Leon Bridges', albumArt: 'https://picsum.photos/390', duration: 152, genre: 'Pop' },
  { appleId: 'song_191', title: 'Killshot', artist: 'Eminem', albumArt: 'https://picsum.photos/391', duration: 254, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_192', title: 'Kiss Me More', artist: 'Doja Cat feat. SZA', albumArt: 'https://picsum.photos/392', duration: 209, genre: 'Pop' },
  { appleId: 'song_193', title: 'Levitating', artist: 'Dua Lipa', albumArt: 'https://picsum.photos/393', duration: 203, genre: 'Pop' },
  { appleId: 'song_194', title: 'Little Dark Age', artist: 'MGMT', albumArt: 'https://picsum.photos/394', duration: 300, genre: 'Alternative' },
  { appleId: 'song_195', title: 'The Less I Know the Better', artist: 'Tame Impala', albumArt: 'https://picsum.photos/395', duration: 219, genre: 'Alternative' },
  { appleId: 'song_196', title: 'Lose Yourself', artist: 'Eminem', albumArt: 'https://picsum.photos/396', duration: 326, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_197', title: 'Lost', artist: 'Frank Ocean', albumArt: 'https://picsum.photos/397', duration: 234, genre: 'Pop' },
  { appleId: 'song_198', title: 'Love Story', artist: 'Taylor Swift', albumArt: 'https://picsum.photos/398', duration: 236, genre: 'Country' },
  { appleId: 'song_199', title: 'Lucid Dreams', artist: 'Juice WRLD', albumArt: 'https://picsum.photos/399', duration: 239, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_200', title: 'Mr. Brightside', artist: 'The Killers', albumArt: 'https://picsum.photos/400', duration: 223, genre: 'Alternative' },
  { appleId: 'song_201', title: 'Neon Moon', artist: 'Brooks & Dunn', albumArt: 'https://picsum.photos/401', duration: 257, genre: 'Country' },
  { appleId: 'song_202', title: 'Night Changes', artist: 'One Direction', albumArt: 'https://picsum.photos/402', duration: 226, genre: 'Pop' },
  { appleId: 'song_203', title: 'Notion', artist: 'The Rare Occasions', albumArt: 'https://picsum.photos/403', duration: 195, genre: 'Alternative' },
  { appleId: 'song_204', title: 'Peaches', artist: 'Justin Bieber', albumArt: 'https://picsum.photos/404', duration: 198, genre: 'Pop' },
  { appleId: 'song_205', title: 'Photograph', artist: 'Ed Sheeran', albumArt: 'https://picsum.photos/405', duration: 259, genre: 'Pop' },
  { appleId: 'song_206', title: 'Pumped Up Kicks', artist: 'Foster the People', albumArt: 'https://picsum.photos/406', duration: 240, genre: 'Alternative' },
  { appleId: 'song_207', title: 'Radioactive', artist: 'Imagine Dragons', albumArt: 'https://picsum.photos/407', duration: 187, genre: 'Alternative' },
  { appleId: 'song_208', title: 'Redbone', artist: 'Childish Gambino', albumArt: 'https://picsum.photos/408', duration: 327, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_209', title: 'Resonance', artist: 'Home', albumArt: 'https://picsum.photos/409', duration: 213, genre: 'Alternative' },
  { appleId: 'song_210', title: 'Riptide', artist: 'Vance Joy', albumArt: 'https://picsum.photos/410', duration: 204, genre: 'Alternative' },
  { appleId: 'song_211', title: 'Roses', artist: 'SAINt JHN', albumArt: 'https://picsum.photos/411', duration: 179, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_212', title: 'Royals', artist: 'Lorde', albumArt: 'https://picsum.photos/412', duration: 190, genre: 'Alternative' },
  { appleId: 'song_213', title: 'Running Up That Hill', artist: 'Kate Bush', albumArt: 'https://picsum.photos/413', duration: 301, genre: 'Pop' },
  { appleId: 'song_214', title: 'Save Your Tears', artist: 'The Weeknd', albumArt: 'https://picsum.photos/414', duration: 216, genre: 'R&B/Soul' },
  { appleId: 'song_215', title: 'September', artist: 'Earth Wind & Fire', albumArt: 'https://picsum.photos/415', duration: 215, genre: 'R&B/Soul' },
  { appleId: 'song_216', title: 'Seven Nation Army', artist: 'The White Stripes', albumArt: 'https://picsum.photos/416', duration: 232, genre: 'Rock' },
  { appleId: 'song_217', title: 'Sex on Fire', artist: 'Kings of Leon', albumArt: 'https://picsum.photos/417', duration: 203, genre: 'Alternative' },
  { appleId: 'song_218', title: 'Shake It Off', artist: 'Taylor Swift', albumArt: 'https://picsum.photos/418', duration: 219, genre: 'Pop' },
  { appleId: 'song_219', title: 'Shallow', artist: 'Lady Gaga & Bradley Cooper', albumArt: 'https://picsum.photos/419', duration: 215, genre: 'Pop' },
  { appleId: 'song_220', title: 'Shape of You', artist: 'Ed Sheeran', albumArt: 'https://picsum.photos/420', duration: 234, genre: 'Pop' },
  { appleId: 'song_221', title: 'Skinny Love', artist: 'Bon Iver', albumArt: 'https://picsum.photos/421', duration: 239, genre: 'Alternative' },
  { appleId: 'song_222', title: 'Smells Like Teen Spirit', artist: 'Nirvana', albumArt: 'https://picsum.photos/422', duration: 301, genre: 'Rock' },
  { appleId: 'song_223', title: 'Somebody That I Used to Know', artist: 'Gotye', albumArt: 'https://picsum.photos/423', duration: 245, genre: 'Alternative' },
  { appleId: 'song_224', title: 'Someone You Loved', artist: 'Lewis Capaldi', albumArt: 'https://picsum.photos/424', duration: 182, genre: 'Alternative' },
  { appleId: 'song_225', title: 'Something in the Orange', artist: 'Zach Bryan', albumArt: 'https://picsum.photos/425', duration: 228, genre: 'Country' },
  { appleId: 'song_226', title: 'Space Song', artist: 'Beach House', albumArt: 'https://picsum.photos/426', duration: 320, genre: 'Alternative' },
  { appleId: 'song_227', title: 'STAY', artist: 'The Kid LAROI & Justin Bieber', albumArt: 'https://picsum.photos/427', duration: 142, genre: 'Pop' },
  { appleId: 'song_228', title: 'Stolen Dance', artist: 'Milky Chance', albumArt: 'https://picsum.photos/428', duration: 314, genre: 'Alternative' },
  { appleId: 'song_229', title: 'Stressed Out', artist: 'twenty one pilots', albumArt: 'https://picsum.photos/429', duration: 202, genre: 'Alternative' },
  { appleId: 'song_230', title: 'Stubborn Love', artist: 'The Lumineers', albumArt: 'https://picsum.photos/430', duration: 279, genre: 'Folk' },
  { appleId: 'song_231', title: 'Sugar', artist: 'Maroon 5', albumArt: 'https://picsum.photos/431', duration: 236, genre: 'Pop' },
  { appleId: 'song_232', title: 'Sunflower', artist: 'Post Malone & Swae Lee', albumArt: 'https://picsum.photos/432', duration: 158, genre: 'Hip-Hop/Rap' },
  { appleId: 'song_233', title: 'Sweater Weather', artist: 'The Neighbourhood', albumArt: 'https://picsum.photos/433', duration: 240, genre: 'Alternative' },
  { appleId: 'song_234', title: "Sweet Child O' Mine", artist: "Guns N' Roses", albumArt: 'https://picsum.photos/434', duration: 356, genre: 'Rock' },
  { appleId: 'song_235', title: 'Take Me To Church', artist: 'Hozier', albumArt: 'https://picsum.photos/435', duration: 242, genre: 'Singer/Songwriter' },
  { appleId: 'song_236', title: 'Take On Me', artist: 'a-ha', albumArt: 'https://picsum.photos/436', duration: 225, genre: 'Pop' },
  { appleId: 'song_237', title: 'Teenage Dirtbag', artist: 'Wheatus', albumArt: 'https://picsum.photos/437', duration: 242, genre: 'Rock' },
  { appleId: 'song_238', title: 'thank u next', artist: 'Ariana Grande', albumArt: 'https://picsum.photos/438', duration: 207, genre: 'Pop' },
  { appleId: 'song_239', title: 'The Night We Met', artist: 'Lord Huron', albumArt: 'https://picsum.photos/439', duration: 208, genre: 'Alternative' },
  { appleId: 'song_240', title: 'Thinkin Bout You', artist: 'Frank Ocean', albumArt: 'https://picsum.photos/440', duration: 201, genre: 'Pop' },
  { appleId: 'song_241', title: 'This Life', artist: 'Vampire Weekend', albumArt: 'https://picsum.photos/441', duration: 269, genre: 'Alternative' },
  { appleId: 'song_242', title: 'Thunder', artist: 'Imagine Dragons', albumArt: 'https://picsum.photos/442', duration: 187, genre: 'Alternative' },
  { appleId: 'song_243', title: 'Uptown Funk', artist: 'Bruno Mars', albumArt: 'https://picsum.photos/443', duration: 270, genre: 'Pop' },
  { appleId: 'song_244', title: 'Viva la Vida', artist: 'Coldplay', albumArt: 'https://picsum.photos/444', duration: 241, genre: 'Alternative' },
  { appleId: 'song_245', title: 'Watermelon Sugar', artist: 'Harry Styles', albumArt: 'https://picsum.photos/445', duration: 174, genre: 'Pop' },
  { appleId: 'song_246', title: 'Way Down We Go', artist: 'KALEO', albumArt: 'https://picsum.photos/446', duration: 220, genre: 'Alternative' },
  { appleId: 'song_247', title: 'We Are Young', artist: 'Fun. feat. Janelle Monáe', albumArt: 'https://picsum.photos/447', duration: 251, genre: 'Alternative' },
  { appleId: 'song_248', title: "when the party's over", artist: 'Billie Eilish', albumArt: 'https://picsum.photos/448', duration: 196, genre: 'Alternative' },
  { appleId: 'song_249', title: 'Yellow', artist: 'Coldplay', albumArt: 'https://picsum.photos/449', duration: 269, genre: 'Alternative' },
  { appleId: 'song_250', title: "You're Beautiful", artist: 'James Blunt', albumArt: 'https://picsum.photos/450', duration: 202, genre: 'Pop' },
  { appleId: 'song_251', title: 'Young Dumb & Broke', artist: 'Khalid', albumArt: 'https://picsum.photos/451', duration: 203, genre: 'R&B/Soul' },
];

/**
 * Decide whether a song should be dropped by the explicit filter.
 * In strict mode, songs the label didn't rate (contentRating missing → isExplicit null)
 * are treated as risky and dropped alongside confirmed explicits.
 */
function shouldDropForExplicit(song, strict) {
  if (song.isExplicit === true) return true;
  if (strict && (song.isExplicit === null || song.isExplicit === undefined)) return true;
  return false;
}

/**
 * Case-insensitive whole-word match. Word boundary is /\b/, which avoids the
 * Scunthorpe problem ("ass" won't match "classic" or "bass").
 */
function haystackContainsWord(haystack, word) {
  if (!haystack || !word) return false;
  const needle = word.toLowerCase().trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

function filterByVenueSettings(songs, venue) {
  if (!venue?.settings) return songs;

  let filtered = songs;

  // Time-based explicit filter: allow explicit after a certain hour (venue local time).
  // If explicitAfterHour is set, it overrides allowExplicit during the scheduled hours.
  const strict = venue.settings.strictExplicit === true;
  const explicitAfterHour = venue.settings.explicitAfterHour;
  if (typeof explicitAfterHour === 'number' && explicitAfterHour >= 0 && explicitAfterHour <= 23) {
    const currentHour = getVenueLocalHour(venue);
    const explicitAllowedNow = currentHour >= explicitAfterHour;
    if (!explicitAllowedNow) {
      filtered = filtered.filter((s) => !shouldDropForExplicit(s, strict));
    }
  } else if (venue.settings.allowExplicit === false) {
    filtered = filtered.filter((s) => !shouldDropForExplicit(s, strict));
  }

  if (venue.settings.genreFilters?.length) {
    const genres = venue.settings.genreFilters.map((g) => g.toLowerCase());
    filtered = filtered.filter(
      (s) => s.genre && genres.some((g) => String(s.genre).toLowerCase().includes(g))
    );
  }

  if (venue.settings.blockedArtists?.length) {
    const blocked = venue.settings.blockedArtists.map((a) => a.toLowerCase());
    filtered = filtered.filter(
      (s) => !blocked.some((b) => String(s.artist).toLowerCase().includes(b))
    );
  }

  // Word-boundary match on title + artist; catches tracks whose label didn't
  // flag them explicit but where the title itself is the problem (slurs, etc).
  if (venue.settings.blockedTitleWords?.length) {
    const words = venue.settings.blockedTitleWords;
    filtered = filtered.filter(
      (s) => !words.some((w) => haystackContainsWord(s.title, w) || haystackContainsWord(s.artist, w))
    );
  }

  return filtered;
}

/**
 * Search Apple Music catalog for songs matching a query string.
 * Applies venue-level filters (explicit content, blocked artists, genre).
 * Falls back to a mock catalog when no Apple developer token is configured.
 * @param {string} query - Free-text search term
 * @param {string|null} [venueCode] - Optional venue code for filter context
 * @returns {Promise<object[]>} Array of song objects { appleId, title, artist, albumArt, duration, genre, isExplicit }
 */
async function searchAppleMusic(query, venueCode) {
  const db = require('./database');
  const venue = venueCode ? db.getVenue(venueCode) : null;
  const token = getToken();

  if (token) {
    try {
      const res = await fetch(
        `https://api.music.apple.com/v1/catalog/za/search?types=songs&term=${encodeURIComponent(query)}&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) throw new Error(`Apple Music search error: ${res.status}`);
      const data = await res.json();
      const songs = (data.results?.songs?.data || []).map((s) => ({
        appleId: s.id,
        title: s.attributes.name,
        artist: s.attributes.artistName,
        albumArt: s.attributes.artwork?.url?.replace(/\{w\}/g, '300').replace(/\{h\}/g, '300') || '',
        duration: Math.round(s.attributes.durationInMillis / 1000),
        // Join ALL genre tags so downstream filters catch secondary tags (e.g. 'Afrikaans').
        genre: (s.attributes.genreNames || []).join(' '),
        // Tri-state: true = label-flagged explicit, false = explicitly clean,
        // null = unrated / missing tag (treated as risky under strictExplicit).
        isExplicit: s.attributes.contentRating === 'explicit'
          ? true
          : s.attributes.contentRating === 'clean'
            ? false
            : null,
      }));
      return filterByVenueSettings(songs, venue);
    } catch (err) {
      console.error('Apple Music API error:', err);
      return mockSearch(query, venue);
    }
  }

  return mockSearch(query, venue);
}

function mockSearch(query, venue) {
  const q = (query || '').toLowerCase();
  const matched = MOCK_CATALOG.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.genre.toLowerCase().includes(q)
  );
  return filterByVenueSettings(matched.length ? matched : MOCK_CATALOG.slice(0, 5), venue);
}

/**
 * Search Apple Music by genre for autofill. Splits genres into language genres
 * (e.g. 'afrikaans') and regular genres, applying AND/OR rules:
 *  - language genres are mandatory (song must match at least one)
 *  - regular genres are optional (song must match at least one if any are selected)
 * @param {string[]} genres - Full autoplayGenre array from venue.settings
 * @param {string} venueCode
 * @returns {Promise<object[]>} Filtered song objects
 */
async function searchByGenre(genres, venueCode) {
  const db = require('./database');
  const venue = venueCode ? db.getVenue(venueCode) : null;
  const token = getToken();

  const allGenres = Array.isArray(genres) ? genres : [genres];
  const languageGenres = allGenres.filter((g) => LANGUAGE_GENRES.has(g.toLowerCase()));
  const regularGenres = allGenres.filter((g) => !LANGUAGE_GENRES.has(g.toLowerCase()));

  // Determine which language genres actually have genre tags in Apple Music.
  // 'English' is never a genre tag — songs are tagged Pop/Rock/etc. — so exclude
  // it from language checks; it only acts as a pass-through.
  const checkableLangs = languageGenres.filter((g) => g.toLowerCase() !== 'english');

  // Build search terms:
  //  • Non-English language selected (with or without regular genre):
  //      → search using the per-language artist/keyword pool so Apple Music
  //        returns songs actually in that language, then filter by genre.
  //  • English + regular genre (or regular genre only):
  //      → search using expanded genre aliases (e.g. 'Indie' → 'alternative').
  //  • No selections at all:
  //      → rotate through broad popular terms for maximum variety.
  let searchTerms;
  if (checkableLangs.length > 0) {
    const expanded = [];
    for (const lang of checkableLangs) {
      const terms = LANGUAGE_SEARCH_TERMS[lang.toLowerCase()];
      if (terms) expanded.push(...terms);
    }
    searchTerms = expanded.length > 0 ? expanded : checkableLangs;
  } else if (regularGenres.length > 0) {
    searchTerms = [...new Set(regularGenres.flatMap(expandGenre))];
  } else {
    searchTerms = shuffleArray(BROAD_SEARCH_TERMS).slice(0, 5);
  }

  if (token) {
    // Shuffle so repeated calls rotate through all selected genres.
    const shuffled = shuffleArray(searchTerms);
    for (const term of shuffled) {
      try {
        // Use a large random offset so every autofill call reaches a different
        // slice of Apple Music's catalog (thousands of songs available at offset 0-200).
        const offset = Math.floor(Math.random() * 200);
        const res = await fetch(
          `https://api.music.apple.com/v1/catalog/za/search?types=songs&term=${encodeURIComponent(term)}&limit=25&offset=${offset}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) throw new Error(`Apple Music autofill error: ${res.status}`);
        const data = await res.json();
        const songs = (data.results?.songs?.data || []).map((s) => ({
          appleId: s.id,
          title: s.attributes.name,
          artist: s.attributes.artistName,
          albumArt: s.attributes.artwork?.url?.replace(/\{w\}/g, '300').replace(/\{h\}/g, '300') || '',
          duration: Math.round(s.attributes.durationInMillis / 1000),
          // Join ALL genre tags so 'Afrikaans' is caught even when it's not the primary tag.
          genre: (s.attributes.genreNames || []).join(' '),
          // Tri-state: true = label-flagged explicit, false = explicitly clean,
        // null = unrated / missing tag (treated as risky under strictExplicit).
        isExplicit: s.attributes.contentRating === 'explicit'
          ? true
          : s.attributes.contentRating === 'clean'
            ? false
            : null,
        }));

        const matched = songs.filter((s) => songMatchesGenreRules(s, languageGenres, regularGenres));
        const pool = filterByVenueSettings(matched, venue);
        if (pool.length > 0) {
          return pickFreshSong(pool, venueCode);
        }

        // Language fallback: when we searched via LANGUAGE_SEARCH_TERMS the results
        // ARE in the right language, but many songs are loosely tagged (e.g. an Afrikaans
        // pop song tagged "Pop" not "Afrikaans", or a Zulu hip-hop song tagged "Hip-Hop"
        // not "Zulu"). If the strict genre+language filter matched nothing, trust Apple
        // Music's own search relevance and accept any song from those results.
        // This applies for both language-only AND language+genre selections.
        if (checkableLangs.length > 0 && songs.length > 0) {
          const fallbackPool = filterByVenueSettings(songs, venue);
          if (fallbackPool.length > 0) {
            return pickFreshSong(fallbackPool, venueCode);
          }
        }
      } catch (err) {
        console.error('Apple Music genre search error:', err);
      }
    }
  }

  // Mock catalog fallback — only used when no real Apple Music token is configured
  // (i.e. development mode). Mock song IDs like "song_117" are fake and MusicKit
  // will throw NOT_FOUND if we try to play them with a real subscription.
  if (token) return null;

  const matched = MOCK_CATALOG.filter((s) => songMatchesGenreRules(s, languageGenres, regularGenres));
  if (matched.length === 0) return null;
  const pool = filterByVenueSettings(matched, venue);
  return pickFreshSong(pool, venueCode);
}

// Pick a random song from a venue's curated playlist.
// - Small playlists (<10 songs): only block the last (size-1) played songs so songs
//   cycle through the whole list before repeating.
// - Large playlists (>=10 songs): use the full 50-song recent pool to avoid repeats.
/**
 * Pick a fresh song from a playlist for autofill, avoiding recent repeats.
 * Small playlists (<10 songs): cycles through all songs before repeating.
 * Large playlists (>=10 songs): uses the full 50-song recent pool to avoid repeats.
 * @param {object[]} playlist - Array of song objects with `.appleId`
 * @param {string} venueCode - Used to read/write the per-venue recent pool
 * @returns {object|null} A song object, or null if playlist is empty
 */
function pickFromPlaylist(playlist, venueCode) {
  if (!playlist || playlist.length === 0) return null;

  if (playlist.length >= 10) {
    return pickFreshSong(playlist, venueCode);
  }

  // Small playlist: trim the recent pool to (size - 1) so each song plays before repeating
  const gap = Math.max(1, playlist.length - 1);
  const recent = getRecentPool(venueCode);
  const trimmedRecent = recent.slice(-gap);
  const fresh = playlist.filter((s) => !trimmedRecent.includes(s.appleId));
  const chosen = fresh.length > 0
    ? fresh[Math.floor(Math.random() * fresh.length)]
    : playlist[Math.floor(Math.random() * playlist.length)];
  if (chosen && venueCode) recordAutofillPlay(venueCode, chosen.appleId);
  return chosen;
}

module.exports = {
  searchAppleMusic,
  searchByGenre,
  pickFromPlaylist,
  // Exported for direct unit testing of the filter pipeline.
  filterByVenueSettings,
  shouldDropForExplicit,
  haystackContainsWord,
  getVenueLocalHour,
};
