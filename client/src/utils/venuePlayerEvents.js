/** Dispatched when venue playlist metadata changes so VenuePlayerBar can refetch. */
export const VENUE_PLAYER_META_REFRESH = 'speeldit-venue-player-meta-refresh';

export function dispatchVenuePlayerMetaRefresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VENUE_PLAYER_META_REFRESH));
  }
}
