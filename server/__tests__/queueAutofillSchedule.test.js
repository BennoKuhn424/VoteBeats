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

  test('scheduled playlist overrides the active playlist while the slot is active', async () => {
    freezeTime(new Date(2025, 0, 18, 2, 30, 0)); // Saturday 02:30
    const scheduledSong = song('sat-230', 'Saturday Scheduled Track');
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'playlist',
        autoplayQueue: true,
        playlistSchedule: [
          { playlistId: 'sat-slot', startHour: 2, startMinute: 30, endHour: 4, endMinute: 0, days: [6] },
        ],
      },
      activePlaylistId: 'regular',
      playlists: [
        { id: 'regular', songs: [song('regular-1', 'Regular Track')] },
        { id: 'sat-slot', songs: [scheduledSong] },
      ],
    };
    mockPickFromPlaylist.mockReturnValue(scheduledSong);

    await serverAutofill(VENUE_CODE, venue);

    expect(mockPickFromPlaylist).toHaveBeenCalledWith([scheduledSong], VENUE_CODE);
    expect(queueRepo.update).toHaveBeenCalledTimes(1);
  });

  test('does not autofill when autoplay mode is off, even with a matching schedule', async () => {
    freezeTime(new Date(2025, 0, 18, 2, 30, 0)); // Saturday 02:30, inside slot
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'off',
        autoplayQueue: false,
        playlistSchedule: [
          { playlistId: 'sat-slot', startHour: 2, startMinute: 30, endHour: 4, endMinute: 0, days: [6] },
        ],
      },
      playlists: [{ id: 'sat-slot', songs: [song('sat-230', 'Saturday Scheduled Track')] }],
    };

    await serverAutofill(VENUE_CODE, venue);

    expect(mockPickFromPlaylist).not.toHaveBeenCalled();
    expect(queueRepo.update).not.toHaveBeenCalled();
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

  test('returns to the active playlist once the scheduled slot ends', async () => {
    // The user's scenario: at 02:30 Sat the scheduled slot is active and its
    // playlist wins. Before and after, autofill falls back to the venue's
    // currently-active playlist.
    const venue = {
      code: VENUE_CODE,
      settings: {
        autoplayMode: 'playlist',
        autoplayQueue: true,
        playlistSchedule: [
          { playlistId: 'sat-slot', startHour: 2, startMinute: 30, endHour: 4, endMinute: 0, days: [6] },
        ],
      },
      activePlaylistId: 'regular',
      playlists: [
        { id: 'regular', songs: [song('regular-1', 'Regular Track')] },
        { id: 'sat-slot', songs: [song('sat-1', 'Sat Slot Track')] },
      ],
    };

    // 1) Before the slot: active playlist wins
    freezeTime(new Date(2025, 0, 18, 1, 0, 0)); // Sat 01:00, before 02:30 slot
    mockPickFromPlaylist.mockReturnValue(song('regular-1', 'Regular Track'));
    await serverAutofill(VENUE_CODE, venue);
    expect(mockPickFromPlaylist).toHaveBeenCalledTimes(1);
    expect(mockPickFromPlaylist).toHaveBeenLastCalledWith(
      [song('regular-1', 'Regular Track')],
      VENUE_CODE,
    );

    jest.clearAllMocks();
    queueRepo.get.mockReturnValue({ nowPlaying: null, upcoming: [] });
    queueRepo.update.mockImplementation(async (_v, fn) => fn({ nowPlaying: null, upcoming: [] }));

    // 2) During the slot: scheduled playlist wins
    freezeTime(new Date(2025, 0, 18, 2, 30, 0)); // Sat 02:30, slot start
    mockPickFromPlaylist.mockReturnValue(song('sat-1', 'Sat Slot Track'));
    await serverAutofill(VENUE_CODE, venue);
    expect(mockPickFromPlaylist).toHaveBeenCalledTimes(1);
    expect(mockPickFromPlaylist).toHaveBeenLastCalledWith(
      [song('sat-1', 'Sat Slot Track')],
      VENUE_CODE,
    );

    jest.clearAllMocks();
    queueRepo.get.mockReturnValue({ nowPlaying: null, upcoming: [] });
    queueRepo.update.mockImplementation(async (_v, fn) => fn({ nowPlaying: null, upcoming: [] }));

    // 3) After the slot: back to active playlist
    freezeTime(new Date(2025, 0, 18, 4, 0, 0)); // Sat 04:00, slot just ended (end-exclusive)
    mockPickFromPlaylist.mockReturnValue(song('regular-1', 'Regular Track'));
    await serverAutofill(VENUE_CODE, venue);
    expect(mockPickFromPlaylist).toHaveBeenCalledTimes(1);
    expect(mockPickFromPlaylist).toHaveBeenLastCalledWith(
      [song('regular-1', 'Regular Track')],
      VENUE_CODE,
    );
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
