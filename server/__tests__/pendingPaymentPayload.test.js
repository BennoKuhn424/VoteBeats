/**
 * @jest-environment node
 */

const { normalizePendingPayload, buildPendingPayload } = require('../utils/pendingPaymentPayload');

describe('pending payment payload helpers', () => {
  test('builds song-request payloads by default', () => {
    const payload = buildPendingPayload({
      song: { appleId: '123', title: 'Song' },
      deviceId: 'device-1',
    });

    expect(payload).toEqual({
      kind: 'song_request',
      song: { appleId: '123', title: 'Song' },
    });
  });

  test('builds playlist-generation payloads with metadata', () => {
    const payload = buildPendingPayload({
      playlistId: 'pl_1',
      prompt: 'afro house dinner',
      count: 50,
    });

    expect(payload).toEqual({
      kind: 'playlist_generation',
      song: {},
      playlistId: 'pl_1',
      prompt: 'afro house dinner',
      count: 50,
    });
  });

  test('normalizes legacy song-only payloads', () => {
    const normalized = normalizePendingPayload({ appleId: 'abc', title: 'Legacy Song' });

    expect(normalized).toEqual({
      song: { appleId: 'abc', title: 'Legacy Song' },
    });
  });

  test('normalizes wrapped playlist payloads and numeric counts', () => {
    const normalized = normalizePendingPayload({
      kind: 'playlist_generation',
      playlistId: 'pl_2',
      prompt: 'jazz',
      count: '75',
    });

    expect(normalized).toEqual({
      kind: 'playlist_generation',
      song: {},
      playlistId: 'pl_2',
      prompt: 'jazz',
      count: 75,
    });
  });

  test('drops invalid metadata safely', () => {
    expect(normalizePendingPayload(null)).toEqual({ song: {} });
    expect(normalizePendingPayload([])).toEqual({ song: {} });
    expect(normalizePendingPayload({ count: 'not-a-number', prompt: 123 })).toEqual({
      kind: undefined,
      song: {},
      playlistId: undefined,
      prompt: undefined,
      count: undefined,
    });
  });
});
