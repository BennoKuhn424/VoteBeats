/**
 * @jest-environment node
 */

jest.mock('../utils/database', () => ({
  getVenue: jest.fn().mockReturnValue({ code: 'TSTV01', settings: {} }),
}));

jest.mock('../utils/appleMusicToken', () => ({
  getDeveloperToken: jest.fn(),
}));

const { getDeveloperToken } = require('../utils/appleMusicToken');

describe('Apple Music mock catalog fallback', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    getDeveloperToken.mockReset();
    jest.resetModules();
  });

  test('uses mock catalog outside production when no token is configured', async () => {
    process.env.NODE_ENV = 'test';
    getDeveloperToken.mockReturnValue(null);
    delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;

    const { searchAppleMusic } = require('../utils/appleMusicAPI');
    const results = await searchAppleMusic('pop', null);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('appleId');
  });

  test('does not use mock catalog in production when no token is configured', async () => {
    process.env.NODE_ENV = 'production';
    getDeveloperToken.mockReturnValue(null);
    delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;

    const { searchAppleMusic } = require('../utils/appleMusicAPI');

    await expect(searchAppleMusic('pop', null)).rejects.toThrow(/not configured/i);
  });

  test('does not hide Apple API failures with mock data in production', async () => {
    process.env.NODE_ENV = 'production';
    getDeveloperToken.mockReturnValue(null);
    process.env.APPLE_MUSIC_DEVELOPER_TOKEN = 'dev-token';
    global.fetch = jest.fn().mockRejectedValue(new Error('Apple is down'));

    const { searchAppleMusic } = require('../utils/appleMusicAPI');

    await expect(searchAppleMusic('pop', null)).rejects.toThrow('Apple is down');
  });

  test('allows explicit mock fallback in production when ALLOW_MOCK_CATALOG=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MOCK_CATALOG = 'true';
    getDeveloperToken.mockReturnValue(null);
    delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;

    const { searchAppleMusic } = require('../utils/appleMusicAPI');
    const results = await searchAppleMusic('pop', null);

    expect(results.length).toBeGreaterThan(0);
  });
});
