/**
 * E2E tests for the customer voting page (/v/:venueCode).
 *
 * These tests run against the real dev server (Vite on :5173 + API on :3000).
 * They cover page structure, the connection-state bug regression, and basic
 * search / request interactions.
 */

import { test, expect } from '@playwright/test';

// Use any registered venue code — the E2E environment must have at least one.
// Override via VITE_E2E_VENUE_CODE env var if needed.
const VENUE_CODE = process.env.E2E_VENUE_CODE || 'TESTVN';

test.describe('Customer voting page — page structure', () => {
  test('renders the "Be the vibe" heading', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    await expect(page.getByRole('heading', { name: /be the vibe/i })).toBeVisible();
  });

  test('renders the search bar', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    await expect(page.getByPlaceholder(/search for a song/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  });

  test('renders the "Up Next" section label', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    // Allow time for loading to resolve
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/up next/i)).toBeVisible();
  });
});

test.describe('Customer voting page — connection banner regression', () => {
  test('does NOT show connection-lost banner on initial load for a valid venue', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    // Wait for the spinner to disappear (successful load)
    await expect(page.getByText(/connecting to venue/i)).not.toBeVisible({ timeout: 10_000 });
    // Banner must not appear after a clean load
    await expect(page.getByText(/connection lost/i)).not.toBeVisible();
  });

  test('shows 404-style messaging for a non-existent venue code', async ({ page }) => {
    await page.goto('/v/ZZZZZZ');
    // Should show an error — either "Venue not found" or "Connection lost" after retries
    await expect(
      page.getByText(/venue not found|connection lost/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Customer voting page — search interaction', () => {
  test('search button is enabled on page load', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    await page.waitForLoadState('networkidle');
    const searchBtn = page.getByRole('button', { name: /search/i });
    await expect(searchBtn).toBeEnabled();
  });

  test('typing into search box updates the input value', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    const input = page.getByPlaceholder(/search for a song/i);
    await input.fill('Blinding Lights');
    await expect(input).toHaveValue('Blinding Lights');
  });

  test('empty search does not show an error', async ({ page }) => {
    await page.goto(`/v/${VENUE_CODE}`);
    await page.getByRole('button', { name: /search/i }).click();
    // No "No songs found" should appear for a blank query
    await expect(page.getByText(/no songs found/i)).not.toBeVisible();
  });
});

test.describe('Customer voting page — mobile / QR-scan scenario', () => {
  test('page is responsive at 390x844 (iPhone 14 viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/v/${VENUE_CODE}`);
    await expect(page.getByRole('heading', { name: /be the vibe/i })).toBeVisible();
    await expect(page.getByPlaceholder(/search for a song/i)).toBeVisible();
  });

  test('search button is tappable at mobile size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/v/${VENUE_CODE}`);
    const btn = page.getByRole('button', { name: /search/i });
    const box = await btn.boundingBox();
    // Minimum touch target is 44px per Apple/Google guidelines
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
