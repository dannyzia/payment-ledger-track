import { test, expect } from '@playwright/test';

test('homepage loads minimal app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Cosmo Ledger Track');
});
