/**
 * In-memory TTL cache for song lyrics + profanity scan results.
 *
 * Scope: this process only. Survives the lifetime of one Node process,
 * not across Render restarts — which is fine since LRCLIB is free and
 * the cache warms quickly.
 *
 * Key: `${appleId}|${languages.sort().join(',')}`  so a strict-AF venue
 * and an EN-only venue get distinct cached counts for the same track.
 *
 * Entry shape:
 *   { hitCount: number, lyricsFound: boolean, expiresAt: number }
 *
 * We store only the hit count, not the raw lyrics — they're big and we
 * don't need them again. `lyricsFound` distinguishes "lyrics exist and
 * were clean" from "LRCLIB had no lyrics for this song" so the caller
 * can treat the two cases differently under strict mode.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 5000; // rough bound; evict oldest when exceeded

const cache = new Map();

function now() {
  return Date.now();
}

function makeKey(appleId, languages) {
  const langKey = Array.isArray(languages) && languages.length > 0
    ? [...languages].sort().join(',')
    : 'en';
  return `${appleId}|${langKey}`;
}

function get(appleId, languages) {
  const key = makeKey(appleId, languages);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU ordering
  cache.delete(key);
  cache.set(key, entry);
  return { hitCount: entry.hitCount, lyricsFound: entry.lyricsFound };
}

function set(appleId, languages, { hitCount, lyricsFound }, ttlMs = DEFAULT_TTL_MS) {
  const key = makeKey(appleId, languages);
  // Simple size bound: drop oldest entry (insertion order) when over cap.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, {
    hitCount: Number(hitCount) || 0,
    lyricsFound: !!lyricsFound,
    expiresAt: now() + ttlMs,
  });
}

function clear() {
  cache.clear();
}

function size() {
  return cache.size;
}

module.exports = { get, set, clear, size, makeKey, DEFAULT_TTL_MS, MAX_ENTRIES };
