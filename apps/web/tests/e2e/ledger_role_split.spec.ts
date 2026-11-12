import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CLT-T-069 — the ledger is scoped by role (PRD §8.5).
 *
 * A staff account sees strictly the entries it created; an admin or owner sees
 * every entry. The split is enforced three times over (the pull SQL filters
 * `created_by` for staff, the ledger page drops foreign rows, and the nav hides
 * privileged destinations), so the assertion is made on what is actually on
 * screen after two different accounts have each written an entry to the same
 * server.
 *
 * Both fixture accounts are created by scripts/e2e/create-staff.ts and supplied
 * by the isolated-stack runner; a direct `pnpm test:e2e` without those
 * variables skips rather than fails, because the accounts do not exist there.
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

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/**
 * The entry screen reads db.methods once on mount, so the initial pull must
 * have populated the Dexie cache before navigating or the method chips never
 * render (same reason as the offline-sync spec).
 */
async function waitForMethodCache(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const dbs = await indexedDB.databases();
          const dbName = dbs.find(
            (d) => d.name?.startsWith('KumonLedger_') || d.name === 'CosmoLedgerTrackDB',
          )?.name;
          if (!dbName) return 0;
          return new Promise<number>((resolve) => {
            const open = indexedDB.open(dbName);
            open.onsuccess = () => {
              const idb = open.result;
              if (!Array.from(idb.objectStoreNames).includes('methods')) {
                idb.close();
                resolve(0);
                return;
              }
              const req = idb.transaction('methods', 'readonly').objectStore('methods').getAll();
              req.onsuccess = () => {
                idb.close();
                resolve((req.result as unknown[]).length);
              };
              req.onerror = () => {
                idb.close();
                resolve(0);
              };
            };
            open.onerror = () => resolve(0);
          });
        }),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
}

/** Pending outbox rows; 0 means the local save has been accepted by the server. */
async function pendingOutbox(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const dbName = dbs.find(
      (d) => d.name?.startsWith('KumonLedger_') || d.name === 'CosmoLedgerTrackDB',
    )?.name;
    if (!dbName) return -1;
    return new Promise<number>((resolve) => {
      const open = indexedDB.open(dbName);
      open.onsuccess = () => {
        const idb = open.result;
        if (!Array.from(idb.objectStoreNames).includes('outbox')) {
          idb.close();
          resolve(0);
          return;
        }
        const req = idb.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        req.onsuccess = () => {
          idb.close();
          const rows = req.result as Array<{ status?: string }>;
          resolve(rows.filter((row) => row.status === 'pending').length);
        };
        req.onerror = () => {
          idb.close();
          resolve(-1);
        };
      };
      open.onerror = () => resolve(-1);
    });
  });
}

/** Save one entry through the real form and wait until it reached the server. */
async function createEntry(page: Page, customer: string, txnRef: string): Promise<void> {
  const menu = page.locator('#floating-action-menu');
  await menu.getByRole('link', { name: 'New Entry' }).click();
  await page.waitForSelector('#input-customer', { timeout: 20000 });
  await expect(page.getByRole('button', { name: /bkash/i }).first()).toBeVisible({
    timeout: 45000,
  });

  await page.fill('#input-customer', customer);
  await page.fill('#input-gross', '100.00');
  await page.getByRole('button', { name: /bkash/i }).first().click();
  await page.fill('#input-txn-ref', txnRef);
  await expect(page.locator('#btn-save')).toBeEnabled({ timeout: 30000 });
  await page.evaluate(() => (document.getElementById('btn-save') as HTMLButtonElement).click());
  await expect(page.locator('body')).toContainText(/Saved offline as/i, { timeout: 15000 });

  await expect.poll(() => pendingOutbox(page), { timeout: 45000 }).toBe(0);
}

/**
 * Access token from the app's own persisted Supabase session, so the pull below
 * runs as the signed-in account rather than as a test-only credential.
 */
async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes('access_token')) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed?.access_token) return parsed.access_token;
      } catch {
        // Unrelated or chunked entry; keep looking.
      }
    }
    return '';
  });
}

/**
 * Entry customer names the server is willing to hand this account. The pull
 * endpoint carries the authoritative scope, so asserting it here means a
 * regression in the SQL filter fails the test even while the ledger page's own
 * staff filter still hides the foreign row on screen.
 */
async function serverCustomerNames(
  request: APIRequestContext,
  origin: string,
  token: string,
): Promise<string[]> {
  const res = await request.get(
    `${origin}/api/v1/sync/pull?since=0&deviceId=${crypto.randomUUID()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.status(), 'pull status').toBe(200);
  const body = (await res.json()) as { entries?: Array<{ customer_name: string }> };
  return (body.entries ?? []).map((entry) => entry.customer_name);
}

/** Open the ledger through the client router (a deep full load is bounced). */
async function openLedger(page: Page): Promise<void> {
  const menu = page.locator('#floating-action-menu');
  await menu.getByRole('button', { name: 'Toggle navigation menu' }).click();
  await page.locator('#mobile-nav-panel').getByRole('link', { name: 'Ledger' }).click();
  await page.waitForSelector('.ledger-row', { timeout: 30000 });
}

test.describe('CLT-T-069 ledger scope by role', () => {
  test('staff see only their own entries while an admin sees the whole ledger', async ({
    browser,
  }) => {
    test.skip(
      !STAFF_EMAIL || !STAFF_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD,
      'staff/admin E2E fixtures are not configured',
    );
    test.setTimeout(240_000);

    const suffix = Date.now().toString(36).toUpperCase();
    const adminCustomer = `SPLIT-ADMIN-${suffix}`;
    const staffCustomer = `SPLIT-STAFF-${suffix}`;

    const adminContext = await browser.newContext();
    const staffContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const staffPage = await staffContext.newPage();

      // 1. The admin writes an entry the staff member must never see.
      await signIn(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
      await waitForMethodCache(adminPage);
      await createEntry(adminPage, adminCustomer, `SPLITADM${suffix}`);

      // 2. A staff member writes their own entry on the same server.
      await signIn(staffPage, STAFF_EMAIL, STAFF_PASSWORD);
      await waitForMethodCache(staffPage);
      await createEntry(staffPage, staffCustomer, `SPLITSTF${suffix}`);

      // 3. Server scope: the staff pull excludes the admin's entry, and the
      //    admin pull includes both. Each layer is asserted on its own.
      const origin = new URL(staffPage.url()).origin;
      const staffToken = await accessToken(staffPage);
      expect(staffToken, 'staff session token not found in local storage').not.toBe('');
      const staffServerNames = await serverCustomerNames(staffContext.request, origin, staffToken);
      expect(staffServerNames, 'staff pull leaked another role\u2019s entry').not.toContain(
        adminCustomer,
      );
      expect(staffServerNames, 'staff pull is missing the staff member\u2019s entry').toContain(
        staffCustomer,
      );

      const adminToken = await accessToken(adminPage);
      expect(adminToken, 'admin session token not found in local storage').not.toBe('');
      const adminServerNames = await serverCustomerNames(adminContext.request, origin, adminToken);
      expect(adminServerNames, 'admin pull is missing its own entry').toContain(adminCustomer);
      expect(adminServerNames, 'admin pull is missing the staff member\u2019s entry').toContain(
        staffCustomer,
      );

      // 4. Staff ledger: own row present, admin's row absent, staff copy.
      await openLedger(staffPage);
      await expect(
        staffPage.locator('.ledger-row').filter({ hasText: staffCustomer }).first(),
        'staff cannot see the entry it just created',
      ).toBeVisible({ timeout: 30000 });
      await expect(
        staffPage.locator('.ledger-row').filter({ hasText: adminCustomer }),
        'staff ledger leaked another role\u2019s entry',
      ).toHaveCount(0);
      await expect(staffPage.locator('body')).toContainText(/My transaction entries/i);

      // 5. Admin ledger: both rows present, admin copy. This is also the proof
      //    that the staff row reached the server rather than living only in the
      //    staff browser's IndexedDB.
      await adminPage.goto('/dashboard');
      await adminPage.waitForURL('**/dashboard', { timeout: 20000 });
      await openLedger(adminPage);
      await expect(
        adminPage.locator('.ledger-row').filter({ hasText: adminCustomer }).first(),
        'admin cannot see its own entry',
      ).toBeVisible({ timeout: 30000 });
      await expect(
        adminPage.locator('.ledger-row').filter({ hasText: staffCustomer }).first(),
        'admin ledger does not include the staff member\u2019s entry',
      ).toBeVisible({ timeout: 30000 });
      await expect(adminPage.locator('body')).toContainText(/All shop transactions/i);
    } finally {
      await adminContext.close();
      await staffContext.close();
    }
  });
});
