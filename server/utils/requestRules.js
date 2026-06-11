const E = require('./errorCodes');
const { countProfanity } = require('./profanityFilter');
const { fetchPlainLyrics } = require('./lyricsFetch');
const lyricsCache = require('./lyricsCache');

const FF_LANGS = ['en', 'af'];
// A patron is actively waiting on this one check, so we can afford a longer
// fetch than the bulk search scan used.
const REQUEST_LYRIC_TIMEOUT_MS = 4000;

function notFamilyFriendly() {
  return {
    status: 400,
    body: {
      error: "This song isn't family-friendly and can't be requested here",
      code: E.QUEUE_NOT_FAMILY_FRIENDLY,
    },
  };
}

/**
 * Enforce a venue's patron-facing content rules against ONE submitted song.
 * Shared by the free-request (queue.js) and paid-request (queuePayment.js) paths.
 *
 * Async because family-friendly mode does a real lyric check here — at REQUEST
 * time, on the single song the patron tapped — instead of slowing every search.
 *
 * IMPORTANT (no-bypass guarantee): this runs BEFORE the song is written to the
 * queue or a payment is started, and it is fail-CLOSED. If the lyric fetch times
 * out or LRCLIB has nothing for an unrated song, the song is rejected, never
 * queued. So a slow/failed check can only wrongly block a clean song — it can
 * never let an unverified song through to playback.
 *
 * Decision order for family-friendly:
 *   explicit / title-or-artist swear        → reject (instant)
 *   Apple rating 'clean'                     → allow  (instant, trusted)
 *   unrated → fetch lyrics:
 *       swear in lyrics                      → reject
 *       clean lyrics                         → allow
 *       no lyrics found / fetch timed out    → reject (unknown = risky)
 *
 * @returns {Promise<{status:number, body:object}|null>}  Rejection, or null if allowed.
 */
async function checkRequestAllowed(venue, song) {
  const s = venue?.settings || {};

  if (s.familyFriendly === true) {
    const extras = Array.isArray(s.blockedTitleWords) ? s.blockedTitleWords : [];

    // 1. Label-flagged explicit, or a swear in the title/artist → reject instantly.
    const titleProfane = countProfanity(`${song?.title || ''} ${song?.artist || ''}`, FF_LANGS, extras) > 0;
    if (song?.explicit === true || song?.rating === 'explicit' || titleProfane) {
      return notFamilyFriendly();
    }

    // 2. Anything Apple didn't rate CLEAN must have its lyrics verified.
    if (song?.rating !== 'clean') {
      let entry = song?.appleId ? lyricsCache.get(song.appleId, FF_LANGS, extras) : null;
      if (!entry) {
        const lyrics = await fetchPlainLyrics({
          title: song?.title,
          artist: song?.artist,
          duration: song?.duration,
          timeoutMs: REQUEST_LYRIC_TIMEOUT_MS,
        });
        entry = lyrics
          ? { hitCount: countProfanity(lyrics, FF_LANGS, extras), lyricsFound: true }
          : { hitCount: 0, lyricsFound: false };
        if (song?.appleId) lyricsCache.set(song.appleId, FF_LANGS, extras, entry);
      }
      // Profane lyrics → reject. No lyrics for an unrated song → can't verify → reject.
      const unsafe = entry.lyricsFound ? entry.hitCount > 0 : true;
      if (unsafe) return notFamilyFriendly();
    }
  }

  const genres = Array.isArray(s.genreFilters) ? s.genreFilters.filter(Boolean) : [];
  if (genres.length > 0) {
    const songGenre = String(song?.genre || '').toLowerCase();
    const allowed = songGenre && genres.some((g) => songGenre.includes(String(g).toLowerCase()));
    if (!allowed) {
      return {
        status: 400,
        body: {
          error: `This venue only takes ${genres.join(', ')} requests`,
          code: E.QUEUE_GENRE_NOT_ALLOWED,
        },
      };
    }
  }

  return null;
}

module.exports = { checkRequestAllowed };
