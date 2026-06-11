const E = require('./errorCodes');

/**
 * Enforce a venue's patron-facing content rules against a submitted song.
 * Shared by the free-request (queue.js) and paid-request (queuePayment.js)
 * paths so both honour family-friendly + genre restrictions.
 *
 * Relies on the genre/explicit metadata the client echoes back from our own
 * search results — the same trust model as the rest of the request payload.
 * The search endpoint already filters by genre and flags explicit, so a normal
 * client never submits a disallowed song; this is the server-side backstop.
 *
 * @param {object} venue  Venue record (reads venue.settings).
 * @param {object} song   Submitted song ({ explicit?, genre? }).
 * @returns {{status:number, body:object}|null}  Rejection, or null if allowed.
 */
function checkRequestAllowed(venue, song) {
  const s = venue?.settings || {};

  if (s.familyFriendly === true && song?.explicit === true) {
    return {
      status: 400,
      body: {
        error: "This song is explicit and can't be requested in family-friendly mode",
        code: E.QUEUE_NOT_FAMILY_FRIENDLY,
      },
    };
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
