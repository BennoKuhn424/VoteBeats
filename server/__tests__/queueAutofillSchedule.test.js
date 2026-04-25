// Use explicit factories so Jest never loads the real ../utils/database
// (which pulls in better-sqlite3 and breaks under any Node ABI mismatch).
jest.mock('../utils/database', () => ({
  getVenue: jest.fn(),
  getQueues: jest.fn(),
  recordAnalyticsEvent: jest.fn(),
}));
jest.mock('../repos/queueRepo', () => ({
  get: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../utils/broadcast', () => ({
  broadcastQueue: jest.fn(),
  broadcastVolumeFeedback: jest.fn(),
  init: jest.fn(),
  getConnectedCount: jest.fn(() => 0),
}));
jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));

const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');

const mockPickFromPlaylist = jest.fn();

jest.mock('../providers', () => ({
  getProvider: () => ({
    pickFromPlaylist: mockPickFromPlaylist,
    searchByGenre: jest.fn(),
  }),
}));

const { serverAutofill } = require('../routes/queueAutofill');

const VENUE_CODE = 'TSTV01';

function song(id, title) {
  return {
    id,
    appleId: id,
    title,
    artist: 'Artist',
    duration: 180,
  };
}

describe('serverAutofill playlist scheduling', () => {
  let realDate;

  beforeEach(() => {
    jest.resetAllMocks();
    realDate = global.Date;
    queueRepo.get.mockReturnValue({ nowPlaying: null, upcoming: [] });
    queueRepo.update.mockImplementation(async (_venueCode, mutateFn) => mutateFn({ nowPlaying: null, upcoming: [] }));
  });

  afterEach(() => {
    global.Date = realDate;
  });

  function freezeTime(date) {
    const RealDate = realDate;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate(date);
        return new RealDate(...args);
      }

      static now() {
        return new RealDate(date).getTime();
      }
    };
  }

  test('fills from the playlist matching the current schedule slot', async () => {
    freezeTime(new Date(2025, 0, 15, 19, 30, 0)); // Wednesday evening
    const lunchSong = song('lunch-1', 'Lunch Track');
    const dinnerSong = song('dinner-1', 'Dinner Track');
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'playlist',
        autoplayQueue: true,
        playlistSchedule: [
          { playlistId: 'lunch', startHour: 12, endHour: 15, days: [3] },
          { playlistId: 'dinner', startHour: 18, endHour: 23, days: [3] },
        ],
      },
      activePlaylistId: 'lunch',
      playlists: [
        { id: 'lunch', songs: [lunchSong] },
        { id: 'dinner', songs: [dinnerSong] },
      ],
    };
    mockPickFromPlaylist.mockReturnValue(dinnerSong);

    await serverAutofill(VENUE_CODE, venue);

    expect(mockPickFromPlaylist).toHaveBeenCalledWith([dinnerSong], VENUE_CODE);
    expect(queueRepo.update).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastQueue).toHaveBeenCalledWith(
      VENUE_CODE,
      expect.objectContaining({
        nowPlaying: expect.objectContaining({ id: 'dinner-1', title: 'Dinner Track' }),
      }),
    );
  });

  test('falls back to active playlist when no schedule slot matches', async () => {
    freezeTime(new Date(2025, 0, 15, 16, 0, 0));
    const activeSong = song('active-1', 'Active Track');
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'playlist',
        autoplayQueue: true,
        playlistSchedule: [{ playlistId: 'late', startHour: 22, endHour: 23 }],
      },
      activePlaylistId: 'active',
      playlists: [
        { id: 'active', songs: [activeSong] },
        { id: 'late', songs: [song('late-1', 'Late Track')] },
      ],
    };
    mockPickFromPlaylist.mockReturnValue(activeSong);

    await serverAutofill(VENUE_CODE, venue);

    expect(mockPickFromPlaylist).toHaveBeenCalledWith([activeSong], VENUE_CODE);
  });

  test('falls back to active playlist when scheduled slot matches but playlist is empty', async () => {
    freezeTime(new Date(2025, 0, 15, 19, 30, 0)); // Wednesday evening
    const activeSong = song('active-1', 'Active Track');
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'playlist',
        autoplayQueue: true,
        playlistSchedule: [{ playlistId: 'dinner', startHour: 18, endHour: 23 }],
      },
      activePlaylistId: 'active',
      playlists: [
        { id: 'active', songs: [activeSong] },
        { id: 'dinner', songs: [] }, // matches the schedule but has no songs
      ],
    };
    mockPickFromPlaylist.mockReturnValue(activeSong);

    await serverAutofill(VENUE_CODE, venue);

    expect(mockPickFromPlaylist).toHaveBeenCalledWith([activeSong], VENUE_CODE);
  });

  test('does not autofill when queue already has a song', async () => {
    queueRepo.get.mockReturnValue({ nowPlaying: song('current', 'Current'), upcoming: [] });

    await serverAutofill(VENUE_CODE, {
      settings: { autoplayMode: 'playlist' },
      playlists: [{ id: 'any', songs: [song('any', 'Any')] }],
    });

    expect(mockPickFromPlaylist).not.toHaveBeenCalled();
    expect(queueRepo.update).not.toHaveBeenCalled();
  });
});
