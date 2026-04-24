/**
 * Thin wrapper around LRCLIB for fetching plain-text lyrics.
 *
 * Split out from routes/lyrics.js so the search-time profanity scanner can
 * call it directly without going through HTTP. routes/lyrics.js should be
 * refactored to call this too — but until then both paths talk to LRCLIB.
 *
 * Returns a string (plainLyrics) or null if nothing found / fetch failed.
 * Never throws — a failed fetch just means "no lyrics."
 */

const USER_AGENT = 'Speeldit/1.0 (https://speeldit.com)';
const LRCLIB_BASE = 'https://lrclib.net/api';

/**
 * Fetch plain lyrics for a track.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.artist
 * @param {number} [opts.duration]  Apple Music duration in seconds.
 * @param {number} [opts.timeoutMs] Abort after this long. Default 3000.
 * @returns {Promise<string|null>}
 */
async function fetchPlainLyrics({ title, artist, duration, timeoutMs = 3000 }) {
  if (!title || !artist) return null;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const signal = controller ? controller.signal : undefined;

  try {
    // /api/get wants exact title+artist (+duration is optional but improves hit rate)
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (duration != null) params.set('duration', String(Math.round(Number(duration))));

    const exact = await fetch(`${LRCLIB_BASE}/get?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
    if (exact.ok) {
      const data = await exact.json();
      if (data.plainLyrics) return data.plainLyrics;
    }

    // Fallback: search for a close match. Free + unauthenticated.
    const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
    const search = await fetch(`${LRCLIB_BASE}/search?${searchParams}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
    if (search.ok) {
      const results = await search.json();
      if (Array.isArray(results) && results.length > 0) {
        const withPlain = results.find((r) => r.plainLyrics);
        if (withPlain) return withPlain.plainLyrics;
      }
    }
    return null;
  } catch (err) {
    // AbortError or network failure — treat as "no lyrics" rather than blocking.
    if (err && err.name !== 'AbortError') {
      console.warn('[lyricsFetch] fetch failed:', err.message);
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { fetchPlainLyrics };
