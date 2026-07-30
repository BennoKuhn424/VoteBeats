/**
 * The AI-playlist checkout tells the server which origin the venue is browsing
 * from, so the post-payment redirect lands back on the tab they started in
 * (the venue app is reachable on more than one allowlisted host).
 *
 * It is ADVISORY only: the server validates it against its own allowlist and
 * falls back to PUBLIC_URL, because any HTTP client can put anything here.
 * That server-side check is pinned in
 * server/__tests__/playlistGenerationRoute.test.js — this only proves the
 * client sends its real origin and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('axios', () => {
  const instance = {
    post: (...a) => mockPost(...a),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: {},
  };
  return { default: { create: () => instance } };
});

vi.mock('axios-retry', () => ({ default: vi.fn(), isNetworkOrIdempotentRequestError: vi.fn() }));

import api from './api';

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
});

describe('generatePlaylistCheckout', () => {
  it('sends the prompt, count and the browser origin', async () => {
    await api.generatePlaylistCheckout('VEN001', 'pl_1', 'sunday jazz', 50);

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/venue/VEN001/playlists/pl_1/generate-checkout');
    expect(body).toEqual({
      prompt: 'sunday jazz',
      count: 50,
      clientOrigin: window.location.origin,
    });
  });

  it('sends the real origin, never a hard-coded host', async () => {
    await api.generatePlaylistCheckout('VEN001', 'pl_1', 'jazz', 25);

    expect(mockPost.mock.calls[0][1].clientOrigin).toBe(window.location.origin);
    expect(mockPost.mock.calls[0][1].clientOrigin).toMatch(/^https?:\/\//);
  });
});
