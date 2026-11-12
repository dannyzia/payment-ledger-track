import { test, expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CLT-T-063 / CLT-R-031 — the Reports link is an admin/owner capability.
 *
 * Hiding the link is the only thing that stopped staff reaching a screen they
 * have no data scope for, so it is worth an assertion rather than a manual
 * check. Two surfaces render navigation: the desktop sidebar (`aside`) above
 * 768 px, and the floating menu's panel (`#mobile-nav-panel`) below it.
 *
 * The staff account is a fixture created by scripts/e2e/create-staff.ts and
 * supplied by the isolated-stack runner; a direct `pnpm test:e2e` without those
 * variables skips rather than fails, because the account does not exist there.
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(repoRoot(), envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || '';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD || '';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';
const OWNER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL || '';
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD || '';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 393, height: 851 };

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/** Desktop sidebar links, after a role-appropriate wait for it to render. */
async function desktopNav(page: Page): Promise<string[]> {
  await page.locator('aside nav').waitFor({ state: 'visible', timeout: 15000 });
  return page
    .locator('aside a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/** Links inside the floating menu's expanded panel. */
async function phoneNav(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: /toggle navigation menu/i }).click();
  const panel = page.locator('#mobile-nav-panel');
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  return panel
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

test.describe('CLT-T-063 role-scoped navigation', () => {
  test('staff sees no Reports link in the desktop sidebar', async ({ page }) => {
    test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'staff E2E fixture is not configured');

    await page.setViewportSize(DESKTOP);
    await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);

    const links = await desktopNav(page);
    // Guard against a passing test caused by an empty sidebar: staff must still
    // get its own destinations.
    expect(links, 'sidebar rendered no links at all').not.toHaveLength(0);
    expect(links).toContain('/ledger');
    expect(links).not.toContain('/reports');
    expect(links).not.toContain('/settlements');
  });

  test('staff sees no Reports link in the phone navigation panel', async ({ page }) => {
    test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'staff E2E fixture is not configured');

    await page.setViewportSize(PHONE);
    await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);

    const links = await phoneNav(page);
    expect(links, 'phone panel rendered no links at all').not.toHaveLength(0);
    expect(links).toContain('/ledger');
    expect(links).not.toContain('/reports');
  });

  test('staff is redirected away from /reports even with the link hidden', async ({ page }) => {
    test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'staff E2E fixture is not configured');

    await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
    await page.goto('/reports');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('privileged center admin or owner sees the Reports and Settlements links', async ({
    page,
  }) => {
    const privilegedEmail = ADMIN_EMAIL || OWNER_EMAIL;
    const privilegedPassword = ADMIN_PASSWORD || OWNER_PASSWORD;
    test.skip(!privilegedEmail || !privilegedPassword, 'privileged credentials are not configured');

    await page.setViewportSize(DESKTOP);
    await signIn(page, privilegedEmail, privilegedPassword);

    const links = await desktopNav(page);
    expect(links).toContain('/reports');
    expect(links).toContain('/settlements');
  });
});
