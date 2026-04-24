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
 * Build a single regex that matches any of the words in the selected packs.
 * Cached per pack-set signature so we don't recompile every call.
 */
const regexCache = new Map();

function buildProfanityRegex(languages) {
  const list = Array.isArray(languages) && languages.length > 0 ? languages : ['en'];
  const key = list.slice().sort().join(',');
  if (regexCache.has(key)) return regexCache.get(key);

  const words = [];
  for (const lang of list) {
    const pack = LANGUAGE_PACKS[lang];
    if (pack) words.push(...pack);
  }
  if (words.length === 0) {
    regexCache.set(key, null);
    return null;
  }

  // Escape regex meta-chars; join with | and wrap in word boundaries.
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Use a non-capturing alternation; flags gi for global case-insensitive.
  const rx = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
  regexCache.set(key, rx);
  return rx;
}

/**
 * Count profanity hits in a lyrics string.
 * @param {string|null|undefined} lyrics  Plain (un-timestamped) lyrics text.
 * @param {string[]} [languages]  e.g. ['en', 'af']. Defaults to ['en'].
 * @returns {number}  Number of profane tokens found. 0 means clean or no lyrics.
 */
function countProfanity(lyrics, languages = ['en']) {
  if (!lyrics || typeof lyrics !== 'string') return 0;
  const rx = buildProfanityRegex(languages);
  if (!rx) return 0;
  const matches = lyrics.match(rx);
  return matches ? matches.length : 0;
}

/**
 * Helper: list the unique profane words found (for logging / debugging).
 * Not used in the hot path.
 */
function findProfanityWords(lyrics, languages = ['en']) {
  if (!lyrics || typeof lyrics !== 'string') return [];
  const rx = buildProfanityRegex(languages);
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
