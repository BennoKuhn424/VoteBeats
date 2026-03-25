import { test, expect } from '@playwright/test';

test('API health endpoint', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:3000/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe('speeldit-api');
});
