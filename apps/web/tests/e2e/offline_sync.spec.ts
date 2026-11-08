import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/**
 * Plan 020 §6.6 — Playwright E2E offline sync specification (PRD §8.1):
 * offline entry creation, local save latency under 100ms measured with
 * performance.now(), reconnect synchronization via the sync indicator,
 * driving the real UI DOM elements shipped in Plan 007/008:
 *   #input-customer / #input-gross / #btn-save / .sync-indicator / .ledger-row
 *
 * Credentials are read at runtime from the same untracked root .env/.env.local
 * that `pnpm db:bootstrap` loads (BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD);
 * values are never logged.
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

test.describe('E2E Local-First Offline Save, Latency, and Reconnect Sync', () => {
  // Full login + sync-pull + offline save + reconnect cycle needs well above
  // the 30s default (Plan 020 §6.5 webServer timeout is 120000ms).
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Authenticate with the bootstrap Owner credentials (local Supabase auth).
    test.skip(
      !OWNER_EMAIL || !OWNER_PASSWORD,
      'BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD are not configured in the root .env; e2e login cannot proceed (Plan 020 Precondition 3).',
    );

    // Login with one tolerance retry: local GoTrue rate limits after several
    // automated attempts, so a single delay-and-retry absorbs transient 429s.
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
  });

  test('records entry offline with save latency under 100ms and syncs upon reconnect', async ({
    page,
    context,
  }) => {
    const mobileMenu = page.locator('#floating-action-menu');
    // 1. Wait for the background sync pull to populate the Dexie method cache
    //    BEFORE navigating: a fresh browser profile starts with an empty cache,
    //    and the entry page reads db.methods once on mount without a live
    //    subscription, so chips would never appear if the pull lands late.
    //    Reads straight from IndexedDB (same database the Dexie client writes).
    let methodCacheInfo = 'cache probe not started';
    await expect
      .poll(
        async () => {
          methodCacheInfo = await page.evaluate(
            () =>
              new Promise<string>((resolve) => {
                const open = indexedDB.open('CosmoLedgerTrackDB');
                open.onsuccess = () => {
                  const idb = open.result;
                  if (!Array.from(idb.objectStoreNames).includes('methods')) {
                    idb.close();
                    resolve('count=0 store-missing');
                    return;
                  }
                  const req = idb
                    .transaction('methods', 'readonly')
                    .objectStore('methods')
                    .getAll();
                  req.onsuccess = () => {
                    idb.close();
                    const rows = (
                      req.result as Array<{ code?: string; display_order?: unknown }>
                    ).map((r) => `${r.code}:do=${r.display_order}`);
                    resolve(`count=${rows.length} [${rows.join(', ')}]`);
                  };
                  req.onerror = () => {
                    idb.close();
                    resolve('count=0 idb-error');
                  };
                };
                open.onerror = () => resolve('count=0 open-failed');
              }),
          );
          return methodCacheInfo;
        },
        { timeout: 45000 },
      )
      .toMatch(/^count=[1-9]/);
    console.log('Method cache state:', methodCacheInfo);

    // 2. Reach the entry form via SPA navigation with a real pointer click on
    //    the floating menu's New Entry link (CLT-T-050 fixed the region's
    //    keyboard handler and the drag layer's pointer capture that used to
    //    swallow it). A full page load of a deep route is still bounced by the
    //    boot client guard, so navigation stays inside the client router.
    //    Scoped to the mobile menu: the desktop sidebar's links are in the DOM
    //    but hidden at this viewport.
    await mobileMenu.getByRole('link', { name: 'New Entry' }).click();
    await page.waitForSelector('#input-customer', { timeout: 20000 });

    // 3. The method chip cache is populated — the picker must render bKash.
    await expect(page.getByRole('button', { name: /bkash/i }).first()).toBeVisible({
      timeout: 30000,
    });

    // 4. Emulate offline network disconnect
    await context.setOffline(true);
    await expect(page.locator('.sync-indicator')).toContainText('Offline', {
      timeout: 10000,
    });

    // 5. Fill transaction inputs (real entry screen DOM ids). The method chips
    //    carry no data-method attribute — select via accessible name. bKash
    //    carries requires_txn_ref (Plan 007), so the mandatory transaction
    //    reference must be filled before the save guard passes.
    await page.fill('#input-customer', 'Playwright Test Customer');
    await page.fill('#input-gross', '5909.00');
    const methodChip = page.getByRole('button', { name: /bkash/i }).first();
    await methodChip.click();
    await page.fill('#input-txn-ref', 'BJT84920KL');

    // The Save button enables once customer / gross / chip / rate profile are all bound.
    await expect(page.locator('#btn-save')).toBeEnabled({ timeout: 30000 });

    // 6. Measure Save latency INSIDE the page: browser-side performance.now()
    //    around the form submit (element click) and the success state render —
    //    excludes Playwright actionability overhead (PRD NFR: local Dexie save
    //    must stay under 100ms, never block on network).
    const latencyMs = await page.evaluate(async () => {
      const t0 = performance.now();
      (document.getElementById('btn-save') as HTMLButtonElement | null)?.click();
      while (performance.now() - t0 < 10_000) {
        if (/Saved offline as/.test(document.body.innerText)) {
          return performance.now() - t0;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      return -1;
    });

    console.log(`Measured local save latency: ${latencyMs}ms`);
    expect(latencyMs, 'save went missing offline').toBeGreaterThan(0);
    expect(latencyMs, 'local save latency must stay under 100ms (PRD §8.1)').toBeLessThan(100);

    // 7. Reconnect: the background sync flushes the outbox, then the synced
    //    entry shows in the ledger (SPA navigation via a router-dispatched click).
    await context.setOffline(false);
    await expect(page.locator('.sync-indicator')).toContainText('Synced', { timeout: 20000 });
    // The menu's nav panel is collapsed by default: expand it with a real click
    // on the ☰ toggle, then activate the Ledger link it reveals.
    await mobileMenu.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await page.locator('#mobile-nav-panel').getByRole('link', { name: 'Ledger' }).click();
    await page.waitForSelector('.ledger-row', { timeout: 20000 });
    // The ledger is ordered by entry date, so a seeded row from another month
    // can sit first (CLT-R-029). Find this run's row by its customer name
    // rather than assuming the top of the list.
    await expect(
      page.locator('.ledger-row').filter({ hasText: 'Playwright Test Customer' }).first(),
    ).toBeVisible({ timeout: 20000 });
  });
});
