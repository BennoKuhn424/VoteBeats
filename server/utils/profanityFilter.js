/**
 * Profanity scanning for song lyrics.
 *
 * Design notes:
 *   - Matching is whole-word (\b) and case-insensitive so "ass" doesn't
 *     match "bass" or "classic" (the Scunthorpe problem).
 *   - Words are grouped by language pack so venues can enable EN, AF, or both.
 *   - The list is intentionally *conservative* — we want to catch the obvious
 *     profanity most venues would bleep, not moderate every possible slang.
 *   - Returns a hit COUNT, not a boolean, so venues can pick a threshold
 *     (1 strike = strict, 3+ = lenient, etc).
 *
 * This module has NO IO — it's pure. Lyrics fetching + caching lives elsewhere.
 */

// Common English profanity. Kept to the core set most broadcasters bleep.
// Intentionally excludes mild/ambiguous words ("damn", "hell") to avoid
// over-filtering — venues can add those via blockedTitleWords if needed.
const EN_WORDS = [
  'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker', 'motherfucking',
  'shit', 'shitting', 'shitty', 'bullshit',
  'bitch', 'bitches', 'bitching',
  'cunt', 'cunts',
  'pussy', 'pussies',
  'cock', 'cocks', 'dick', 'dicks', 'dickhead',
  'asshole', 'assholes',
  'bastard', 'bastards',
  'whore', 'whores', 'slut', 'sluts',
  'nigga', 'niggas', 'nigger', 'niggers',
  'faggot', 'faggots', 'fag',
  'retard', 'retarded',
  // Common disguises
  'sh1t', 'f4ck', 'fck', 'a55', 'b1tch',
];

// Common Afrikaans profanity. South-African venue operator curated.
const AF_WORDS = [
  'fok', 'fokken', 'fokkin', 'fokker', 'fokkers',
  'kak', 'kakhuis',
  'poes', 'poese',
  'doos', 'dose',
  'bliksem', 'bliksems',
  'naai', 'naaier',
  'hoer', 'hoere',
  'piel', 'piele',
  'moer',
  'gat',
  'kont',
  'tiet', 'tiete',
  'mamparra',
];

const LANGUAGE_PACKS = {
  en: EN_WORDS,
  af: AF_WORDS,
};

/**
 * Build a single regex that matches any of the words in the selected packs
 * plus any extra venue-supplied words. Built-in packs are cached; venue
 * extras change per-venue so the combined regex is built fresh when extras
 * are present. (The built-in-only branch is the hot path and stays cached.)
 */
const regexCache = new Map();

function compileWords(words) {
  if (words.length === 0) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

function normaliseExtras(extraWords) {
  if (!Array.isArray(extraWords)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of extraWords) {
    if (typeof raw !== 'string') continue;
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function buildProfanityRegex(languages, extraWords) {
  const list = Array.isArray(languages) ? languages : [];
  const extras = normaliseExtras(extraWords);

  const builtIn = [];
  for (const lang of list) {
    const pack = LANGUAGE_PACKS[lang];
    if (pack) builtIn.push(...pack);
  }

  // Cache only the built-in-language combination (the hot path). Combined
  // built-in + extras is rebuilt per call — extras are short, so cheap.
  if (extras.length === 0) {
    const key = list.slice().sort().join(',');
    if (regexCache.has(key)) return regexCache.get(key);
    const rx = compileWords(builtIn);
    regexCache.set(key, rx);
    return rx;
  }

  return compileWords([...builtIn, ...extras]);
}

/**
 * Count profanity hits in a lyrics string.
 * @param {string|null|undefined} lyrics  Plain (un-timestamped) lyrics text.
 * @param {string[]} [languages]          Built-in packs to use, e.g. ['en','af'].
 *                                        Empty array = use only extra words.
 * @param {string[]} [extraWords]         Venue-supplied custom words.
 * @returns {number}  Number of matched tokens found. 0 means clean / no lyrics.
 */
function countProfanity(lyrics, languages = ['en'], extraWords = []) {
  if (!lyrics || typeof lyrics !== 'string') return 0;
  const rx = buildProfanityRegex(languages, extraWords);
  if (!rx) return 0;
  const matches = lyrics.match(rx);
  return matches ? matches.length : 0;
}

/**
 * Helper: list the unique matched words found (for logging / debugging).
 * Not used in the hot path.
 */
function findProfanityWords(lyrics, languages = ['en'], extraWords = []) {
  if (!lyrics || typeof lyrics !== 'string') return [];
  const rx = buildProfanityRegex(languages, extraWords);
  if (!rx) return [];
  const matches = lyrics.match(rx) || [];
  const lower = matches.map((m) => m.toLowerCase());
  return [...new Set(lower)];
}

module.exports = {
  countProfanity,
  findProfanityWords,
  buildProfanityRegex,
  LANGUAGE_PACKS,
  // Exported for tests
  _EN_WORDS: EN_WORDS,
  _AF_WORDS: AF_WORDS,
};
