import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/**
 * CLT-T-050 — FloatingMenu activation with REAL pointer and keyboard input.
 *
 * Plan 020's offline spec worked around two defects with dispatchEvent('click'):
 *   1. the menu region's Enter/Space handler preventDefault()ed bubbled keys from
 *      the New Entry anchor and the ☰ button;
 *   2. pointer capture retargeted the click away from those children.
 * Those workarounds proved router wiring only. These cases prove a human can
 * activate the controls: real click, real focus + Enter, drag from the pill's
 * neutral area, and a double-tap reset.
 *
 * Credentials come from the untracked root .env/.env.local, as in offline_sync.
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(repoRoot(), envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

const OWNER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL || '';
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD || '';

function menuRegion(page: Page): Locator {
  return page.locator('#floating-action-menu');
}

function newEntryLink(page: Page): Locator {
  return menuRegion(page).getByRole('link', { name: 'New Entry' });
}

function toggleButton(page: Page): Locator {
  return menuRegion(page).getByRole('button', { name: /toggle navigation menu/i });
}

/** Centre of the pill's neutral padding ring — inside the region, on no control. */
async function neutralPoint(page: Page): Promise<{ x: number; y: number }> {
  const inner = menuRegion(page).locator('> div').first();
  const box = await inner.boundingBox();
  if (!box) throw new Error('floating menu pill has no bounding box');
  return { x: box.x + 5, y: box.y + box.height / 2 };
}

test.describe('CLT-T-050 FloatingMenu real input activation', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    test.skip(
      !OWNER_EMAIL || !OWNER_PASSWORD,
      'BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD are not configured in the root .env; e2e login cannot proceed.',
    );

    async function attemptLogin(): Promise<boolean> {
      await page.goto('/login');
      await page.fill('#login-email', OWNER_EMAIL);
      await page.fill('#login-password', OWNER_PASSWORD);
      await page.click('button[type="submit"]');
      try {
        await page.waitForURL('**/dashboard', { timeout: 15000 });
        return page.url().includes('/dashboard');
      } catch {
        return false;
      }
    }

    if (!(await attemptLogin())) {
      await page.waitForTimeout(8000);
      expect(await attemptLogin(), 'login did not redirect to /dashboard after retry').toBe(true);
    }

    await expect(menuRegion(page)).toBeVisible({ timeout: 20000 });
  });

  test('a: a real click on New Entry navigates to /entries/new', async ({ page }) => {
    await newEntryLink(page).click();
    await page.waitForURL('**/entries/new', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/entries/new');
  });

  test('b: focusing New Entry and pressing Enter navigates to /entries/new', async ({ page }) => {
    await newEntryLink(page).focus();
    await expect(newEntryLink(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/entries/new', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/entries/new');
  });

  test('c: a real click on the toggle expands the panel exactly once', async ({ page }) => {
    const panel = page.locator('#mobile-nav-panel');

    await expect(panel).toHaveCount(0);
    await toggleButton(page).click();
    await expect(panel).toBeVisible();
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'true');

    await toggleButton(page).click();
    await expect(panel).toHaveCount(0);
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('d: Enter on the focused toggle expands, then collapses', async ({ page }) => {
    const panel = page.locator('#mobile-nav-panel');

    await toggleButton(page).focus();
    await expect(toggleButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'true');

    await toggleButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('e: Space on the focused toggle toggles, and Escape collapses', async ({ page }) => {
    const panel = page.locator('#mobile-nav-panel');

    await toggleButton(page).focus();
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('f: the pill still drags from its neutral area and snaps to an edge', async ({ page }) => {
    const region = menuRegion(page);
    const before = await region.boundingBox();
    if (!before) throw new Error('menu region has no bounding box');

    const start = await neutralPoint(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Well past the 6px threshold, ending on the opposite side of the screen.
    await page.mouse.move(start.x - 120, start.y - 250, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400); // settle the 200ms snap transition

    const after = await region.boundingBox();
    if (!after) throw new Error('menu region has no bounding box after drag');
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    expect(moved, 'dragging the neutral pill area must move the menu').toBeGreaterThan(20);
    // Snap plus the 12px viewport clamp: it must stay fully on screen.
    expect(after.x).toBeGreaterThanOrEqual(11);
    expect(after.y).toBeGreaterThanOrEqual(11);
  });

  // CLT-R-013 moved this guard: a press that starts on a control and then moves
  // becomes a drag (the release's click is swallowed, so nothing navigates),
  // because Android's touch-target adjustment delivered the pill's neutral
  // strip to the New Entry anchor. A press that does NOT move is still a tap.
  test('g: dragging from New Entry moves the menu and does not navigate', async ({ page }) => {
    const region = menuRegion(page);
    const before = await region.boundingBox();
    if (!before) throw new Error('menu region has no bounding box');

    const box = await newEntryLink(page).boundingBox();
    if (!box) throw new Error('New Entry link has no bounding box');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 120, point.y - 250, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400); // settle the 200ms snap transition

    const after = await region.boundingBox();
    if (!after) throw new Error('menu region has no bounding box after drag');
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    expect(moved, 'a moving press on New Entry must drag the pill').toBeGreaterThan(20);
    // The swallowed click must not have opened the entry form.
    await expect(page).not.toHaveURL(/\/entries\/new/);
  });

  test('h: double-tapping the neutral area resets the docked position', async ({ page }) => {
    const region = menuRegion(page);
    const docked = await region.boundingBox();
    if (!docked) throw new Error('menu region has no bounding box');

    const start = await neutralPoint(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 80, start.y - 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const moved = await region.boundingBox();
    if (!moved) throw new Error('menu region has no bounding box after drag');
    expect(Math.abs(moved.x - docked.x) + Math.abs(moved.y - docked.y)).toBeGreaterThan(20);

    const point = await neutralPoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(450); // 300ms reset transition

    const reset = await region.boundingBox();
    if (!reset) throw new Error('menu region has no bounding box after reset');
    expect(Math.abs(reset.x - docked.x)).toBeLessThan(3);
    expect(Math.abs(reset.y - docked.y)).toBeLessThan(3);
  });
});
