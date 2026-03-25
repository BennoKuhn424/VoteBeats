import { test, expect } from '@playwright/test';

test.describe('Venue auth entry', () => {
  test('venue login page shows email/password form', async ({ page }) => {
    await page.goto('/venue/login');
    await expect(page.getByRole('heading', { name: /venue login/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
  });
});
