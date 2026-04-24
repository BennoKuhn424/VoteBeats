/**
 * @jest-environment node
 *
 * Unit tests for the profanity scanner (pure, no IO).
 */

const {
  countProfanity,
  findProfanityWords,
  buildProfanityRegex,
  LANGUAGE_PACKS,
} = require('../utils/profanityFilter');

describe('countProfanity — English', () => {
  test('counts a single hit', () => {
    expect(countProfanity('this is a fucking song', ['en'])).toBe(1);
  });

  test('counts multiple hits, including variants', () => {
    const lyrics = 'fuck that, shit happens, you fucking bitch';
    expect(countProfanity(lyrics, ['en'])).toBe(4); // fuck, shit, fucking, bitch
  });

  test('case-insensitive', () => {
    expect(countProfanity('FUCK this SHIT', ['en'])).toBe(2);
  });

  test('ignores Scunthorpe-style substrings', () => {
    // "assume", "classical", "bass", "class" must NOT match "ass".
    expect(countProfanity('I assume the classical bassist is in class', ['en'])).toBe(0);
  });

  test('returns 0 for null / empty / non-string', () => {
    expect(countProfanity(null)).toBe(0);
    expect(countProfanity('')).toBe(0);
    expect(countProfanity(42)).toBe(0);
  });

  test('counts disguised variants like sh1t and b1tch', () => {
    expect(countProfanity('this is sh1t and a b1tch', ['en'])).toBe(2);
  });
});

describe('countProfanity — Afrikaans', () => {
  test('counts common Afrikaans profanity', () => {
    const lyrics = 'fokken bliksem, kak poes';
    expect(countProfanity(lyrics, ['af'])).toBe(4);
  });

  test('EN-only pack does not count Afrikaans words', () => {
    expect(countProfanity('jou fokken doos', ['en'])).toBe(0);
  });

  test('combining packs catches both', () => {
    expect(countProfanity('this fucking poes', ['en', 'af'])).toBe(2);
  });

  test('Scunthorpe-safe in Afrikaans (fok matches fok but not fokus)', () => {
    expect(countProfanity('ek fokus op die musiek', ['af'])).toBe(0);
    expect(countProfanity('ek fok op', ['af'])).toBe(1);
  });
});

describe('findProfanityWords', () => {
  test('returns deduplicated lowercase list of matched words', () => {
    const lyrics = 'fuck this, FUCK that, and shit';
    const words = findProfanityWords(lyrics, ['en']);
    expect(words.sort()).toEqual(['fuck', 'shit']);
  });

  test('empty when no hits', () => {
    expect(findProfanityWords('happy clean song', ['en'])).toEqual([]);
  });
});

describe('buildProfanityRegex', () => {
  test('returns a global, case-insensitive regex', () => {
    const rx = buildProfanityRegex(['en']);
    expect(rx).toBeInstanceOf(RegExp);
    expect(rx.flags).toMatch(/g/);
    expect(rx.flags).toMatch(/i/);
  });

  test('returns null when no known language is selected', () => {
    // Unknown language code → empty word list → null regex.
    expect(buildProfanityRegex(['zz'])).toBeNull();
  });

  test('caches the regex by language-set signature', () => {
    const a = buildProfanityRegex(['en', 'af']);
    const b = buildProfanityRegex(['af', 'en']);
    expect(a).toBe(b);
  });

  test('different language sets produce distinct regexes', () => {
    const en = buildProfanityRegex(['en']);
    const both = buildProfanityRegex(['en', 'af']);
    expect(en).not.toBe(both);
  });
});

describe('LANGUAGE_PACKS sanity', () => {
  test('en and af packs are non-empty', () => {
    expect(LANGUAGE_PACKS.en.length).toBeGreaterThan(10);
    expect(LANGUAGE_PACKS.af.length).toBeGreaterThan(5);
  });

  test('all pack entries are lowercase non-empty strings', () => {
    for (const pack of Object.values(LANGUAGE_PACKS)) {
      for (const w of pack) {
        expect(typeof w).toBe('string');
        expect(w).toBe(w.toLowerCase());
        expect(w.length).toBeGreaterThan(0);
      }
    }
  });
});
