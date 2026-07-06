import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * API + Vite dev servers in parallel (more reliable than a single concurrently process).
 * Run: npm run test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  // Registers a fresh venue via the API and exports E2E_VENUE_CODE to specs.
  globalSetup: './e2e/global-setup.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Capped at 2 locally: the two dev servers + N Chromium instances overwhelm
  // modest machines, turning page.goto into 30s timeouts. 2 is fast and stable.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: path.join(rootDir, 'server'),
      url: 'http://127.0.0.1:3000/health',
      timeout: 90_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      cwd: path.join(rootDir, 'client'),
      url: 'http://127.0.0.1:5173',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
