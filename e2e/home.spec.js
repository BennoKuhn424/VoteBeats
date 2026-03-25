import { test, expect } from '@playwright/test';

test.describe('Marketing / customer entry', () => {
  test('home shows join flow and venue login link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /join & vote/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /log in to your dashboard/i })).toBeVisible();
    await expect(page.getByPlaceholder(/ABC123/i)).toBeVisible();
  });
});
