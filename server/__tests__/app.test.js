const request = require('supertest');
const { execFileSync } = require('child_process');
const path = require('path');
const { app } = require('../app');

describe('HTTP app', () => {
  test('GET /health', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('speeldit-api');
  });

  test('GET /api/health', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('health response includes a DB liveness signal (proves SQLite is readable)', async () => {
    // /api/health hits SQLite with SELECT 1 so an uptime monitor sees a real
    // failure when the disk is full, unmounted, or the DB is corrupt — not
    // just a "Node is alive" false positive.
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.db).toBe('ok');
  });

  test('responses include security headers from helmet', async () => {
    const res = await request(app).get('/health').expect(200);
    // Helmet sets several headers; x-content-type-options is one of the most
    // stable across versions and is unlikely to be removed.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS production guard', () => {
  // Spawn a child process so we don't pollute global NODE_ENV for other tests.
  const serverDir = path.resolve(__dirname, '..');

  // Build an env block for a NODE_ENV=production child. The app refuses to
  // start in prod without JWT_SECRET *or* PAYMENT_ENCRYPTION_KEY (the latter
  // throws from utils/paymentCrypto.js, the former from the JWT bootstrap).
  // These tests are about the CORS guard specifically — supply dummy values
  // for the unrelated production-only requirements so the spawned process
  // gets far enough to hit (or pass) the CORS check.
  function prodEnv(overrides) {
    return {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret',
      // 32-byte hex key — paymentCrypto requires this in prod, format only
      // matters because it's read at module load.
      PAYMENT_ENCRYPTION_KEY: '0'.repeat(64),
      ...overrides,
    };
  }

  test('refuses to start in production with no CORS origins', () => {
    expect(() => {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: '', PUBLIC_URL: '' }),
        stdio: 'pipe',
      });
    }).toThrow();
  });

  test('starts in production when CORS_ORIGINS is set', () => {
    expect(() => {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: 'https://example.com', PUBLIC_URL: '' }),
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  test('starts in production when only PUBLIC_URL is set', () => {
    expect(() => {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: '', PUBLIC_URL: 'https://myapp.vercel.app' }),
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  test('throws in production when PUBLIC_URL is whitespace-only', () => {
    expect(() => {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: '', PUBLIC_URL: '   ' }),
        stdio: 'pipe',
      });
    }).toThrow();
  });

  test('starts when PUBLIC_URL has leading/trailing spaces around a real URL', () => {
    expect(() => {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: '', PUBLIC_URL: '  https://myapp.vercel.app/  ' }),
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  test('deduplicates origins from CORS_ORIGINS and PUBLIC_URL after trim', () => {
    // Should not throw — both resolve to the same origin after trim + slash strip
    expect(() => {
      execFileSync(
        process.execPath,
        ['-e', "const { allowedOrigins } = require('./app'); if (allowedOrigins.filter(o => o === 'https://myapp.vercel.app').length !== 1) throw new Error('not deduped'); process.exit(0);"],
        {
          cwd: serverDir,
          env: prodEnv({
            CORS_ORIGINS: ' https://myapp.vercel.app ',
            PUBLIC_URL: '  https://myapp.vercel.app/  ',
          }),
          stdio: 'pipe',
        },
      );
    }).not.toThrow();
  });

  test('error message is actionable', () => {
    try {
      execFileSync(process.execPath, ['-e', "require('./app'); process.exit(0);"], {
        cwd: serverDir,
        env: prodEnv({ CORS_ORIGINS: '', PUBLIC_URL: '' }),
        stdio: 'pipe',
      });
      throw new Error('should have thrown');
    } catch (err) {
      const stderr = err.stderr?.toString() || '';
      expect(stderr).toContain('CORS_ORIGINS');
      expect(stderr).toContain('PUBLIC_URL');
    }
  });
});
