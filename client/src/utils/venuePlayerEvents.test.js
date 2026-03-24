import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VENUE_PLAYER_META_REFRESH, dispatchVenuePlayerMetaRefresh } from './venuePlayerEvents';

describe('venuePlayerEvents', () => {
  beforeEach(() => {
    vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches custom event with stable name', () => {
    dispatchVenuePlayerMetaRefresh();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const call = window.dispatchEvent.mock.calls[0][0];
    expect(call.type).toBe(VENUE_PLAYER_META_REFRESH);
  });
});
