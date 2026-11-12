import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CLT-T-074 / CLT-T-075 / CLT-T-076 — multi-center surfaces.
 *
 * The suite had no browser coverage for the Head Office screens or for the
 * per-center IndexedDB split, so four things were only ever verified by unit
 * tests or by hand:
 *
 *   1. `/admin/super/centers` — the franchise register and its status filter;
 *   2. `/admin/super/search` — cross-center entry search;
 *   3. the desktop header center switcher — its selection reaches storage and
 *      pre-fills the search page's center filter;
 *   4. MHK vs RMP cache isolation — every franchise center must cache into its
 *      own `KumonLedger_<centerId>` database, never a shared one.
 *
 * Fixtures come from the isolated-stack runner
 * (`pnpm test:e2e:isolated -- multi_center`): the bootstrap owner is the
 * platform super-admin, and `scripts/e2e/create-staff.ts` creates an admin on
 * MHK plus one staff member on MHK and one on RMP. A direct `pnpm test:e2e`
 * without those variables skips rather than fails.
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

const SUPER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL || '';
const SUPER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD || '';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';
const MHK_STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || '';
const MHK_STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD || '';
const RMP_STAFF_EMAIL = process.env.E2E_RMP_STAFF_EMAIL || '';
const RMP_STAFF_PASSWORD = process.env.E2E_RMP_STAFF_PASSWORD || '';

const DESKTOP = { width: 1280, height: 900 };

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/** Non-legacy cache databases, one per franchise center. */
async function franchiseDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases
      .map((entry) => entry.name ?? '')
      .filter((name) => name.startsWith('KumonLedger_'));
  });
}

/** Rows in the cached `methods` store, read straight out of IndexedDB. */
async function cachedMethodCount(page: Page, databaseName: string): Promise<number> {
  return page.evaluate(async (name) => {
    return new Promise<number>((resolve) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const idb = open.result;
        if (!Array.from(idb.objectStoreNames).includes('methods')) {
          idb.close();
          resolve(0);
          return;
        }
        const request = idb.transaction('methods', 'readonly').objectStore('methods').getAll();
        request.onsuccess = () => {
          idb.close();
          resolve((request.result as unknown[]).length);
        };
        request.onerror = () => {
          idb.close();
          resolve(0);
        };
      };
      open.onerror = () => resolve(0);
    });
  }, databaseName);
}

/** Pending outbox rows; 0 means the local save reached the server. */
async function pendingOutbox(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const name = databases.find((entry) => entry.name?.startsWith('KumonLedger_'))?.name;
    if (!name) return -1;
    return new Promise<number>((resolve) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const idb = open.result;
        if (!Array.from(idb.objectStoreNames).includes('outbox')) {
          idb.close();
          resolve(0);
          return;
        }
        const request = idb.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        request.onsuccess = () => {
          idb.close();
          const rows = request.result as Array<{ status?: string }>;
          resolve(rows.filter((row) => row.status === 'pending').length);
        };
        request.onerror = () => {
          idb.close();
          resolve(-1);
        };
      };
      open.onerror = () => resolve(-1);
    });
  });
}

/** The value of the `<option>` whose label starts with the given center code. */
async function optionValueFor(page: Page, selectLabel: string, code: string): Promise<string> {
  const select = page.getByLabel(selectLabel);
  await expect(select).toBeVisible({ timeout: 20000 });
  return select.evaluate((element, wanted) => {
    const options = Array.from((element as HTMLSelectElement).options);
    const match = options.find((option) => option.text.trim().startsWith(wanted));
    return match ? match.value : '';
  }, code);
}

/** A super-admin with no center of its own caches into the legacy database. */
const LEGACY_DB = 'CosmoLedgerTrackDB';

/** Access token from the app's own persisted Supabase session. */
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
 * Method ids the server returns for a center — the truth the browser cache is
 * compared against, so the assertion does not depend on hard-coded UUIDs.
 */
async function serverMethodIds(
  request: APIRequestContext,
  origin: string,
  token: string,
  centerId?: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    since: '0',
    includeMeta: 'true',
    deviceId: crypto.randomUUID(),
  });
  if (centerId) params.set('centerId', centerId);
  const res = await request.get(`${origin}/api/v1/sync/pull?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), 'server pull for a center').toBe(200);
  const body = (await res.json()) as { methods?: Array<{ id: string }> };
  return (body.methods ?? []).map((method) => method.id);
}

/** Cached payment-method ids, read straight out of a named IndexedDB database. */
async function cachedMethodIds(page: Page, databaseName: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    return new Promise<string[]>((resolve) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const idb = open.result;
        if (!Array.from(idb.objectStoreNames).includes('methods')) {
          idb.close();
          resolve([]);
          return;
        }
        const request = idb.transaction('methods', 'readonly').objectStore('methods').getAll();
        request.onsuccess = () => {
          idb.close();
          resolve((request.result as Array<{ id: string }>).map((method) => method.id));
        };
        request.onerror = () => {
          idb.close();
          resolve([]);
        };
      };
      open.onerror = () => resolve([]);
    });
  }, databaseName);
}

test.describe('CLT-T-074 super-admin franchise centers', () => {
  test.setTimeout(90_000);

  test('the platform super-admin sees both franchise centers and can filter them', async ({
    page,
  }) => {
    test.skip(!SUPER_EMAIL || !SUPER_PASSWORD, 'bootstrap owner credentials are not configured');

    await signIn(page, SUPER_EMAIL, SUPER_PASSWORD);
    await page.goto('/admin/super/centers');

    await expect(page.getByRole('heading', { name: 'Franchise Centers' })).toBeVisible({
      timeout: 20000,
    });

    const table = page.locator('table');
    await expect(table).toContainText('MHK', { timeout: 20000 });
    await expect(table).toContainText('RMP');

    // The filter round-trips through the API instead of hiding rows client-side,
    // so it is worth asserting the active view still lists both centers.
    await page.getByLabel('Filter by status').selectOption('active');
    await expect(table).toContainText('MHK', { timeout: 20000 });
    await expect(table).toContainText('RMP');
  });

  test('a franchise admin is refused the Head Office center register', async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'admin E2E fixture is not configured');

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/super/centers');

    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: 'Franchise Centers' })).toHaveCount(0);
  });
});

test.describe('CLT-T-076 cross-center search', () => {
  test.setTimeout(150_000);

  test('an entry saved at a center is findable from Head Office with its center code', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.skip(!MHK_STAFF_EMAIL || !MHK_STAFF_PASSWORD, 'staff E2E fixture is not configured');
    test.skip(!SUPER_EMAIL || !SUPER_PASSWORD, 'bootstrap owner credentials are not configured');

    const customer = `MC ${Date.now().toString().slice(-8)}`;

    // 1. Record the entry as a Mohakhali staff member, through the real form.
    //    The entry screen reads db.methods once on mount, so the first pull must
    //    have filled the cache before navigating or the chips never render
    //    (same constraint as offline_sync and ledger_role_split).
    await signIn(page, MHK_STAFF_EMAIL, MHK_STAFF_PASSWORD);
    await expect.poll(() => franchiseDatabases(page), { timeout: 60000 }).toHaveLength(1);
    const [staffDatabase] = await franchiseDatabases(page);
    await expect
      .poll(() => cachedMethodCount(page, staffDatabase), { timeout: 60000 })
      .toBeGreaterThan(0);

    await page.goto('/entries/new');
    await expect(page.getByRole('button', { name: /bkash/i }).first()).toBeVisible({
      timeout: 30000,
    });

    await page.fill('#input-customer', customer);
    await page.fill('#input-gross', '250.00');
    await page.getByRole('button', { name: /bkash/i }).first().click();
    await page.fill('#input-txn-ref', `MC${Date.now().toString().slice(-9)}`);
    await expect(page.locator('#btn-save')).toBeEnabled({ timeout: 30000 });
    await page.evaluate(() => (document.getElementById('btn-save') as HTMLButtonElement).click());
    await expect(page.locator('body')).toContainText(/Saved offline as/i, { timeout: 15000 });
    await expect.poll(() => pendingOutbox(page), { timeout: 60000 }).toBe(0);

    // 2. Search for it from Head Office in its own context, so the test does not
    //    depend on the sign-out path or on one browser profile holding both
    //    roles' caches.
    const superContext = await browser.newContext({ baseURL });
    const superPage = await superContext.newPage();
    try {
      await signIn(superPage, SUPER_EMAIL, SUPER_PASSWORD);
      await superPage.goto('/admin/super/search');
      await expect(superPage.getByRole('heading', { name: 'Global Search' })).toBeVisible({
        timeout: 20000,
      });

      await superPage.getByPlaceholder(/Entry #, customer/).fill(customer);
      await superPage.getByRole('button', { name: 'Search' }).click();

      const row = superPage.locator('tbody tr').filter({ hasText: customer }).first();
      await expect(row).toBeVisible({ timeout: 30000 });
      await expect(row).toContainText('MHK');
    } finally {
      await superContext.close();
    }
  });
});

test.describe('CLT-T-074 header center switcher', () => {
  test.setTimeout(90_000);

  test('the switcher selection is stored and pre-fills the search center filter', async ({
    page,
  }) => {
    test.skip(!SUPER_EMAIL || !SUPER_PASSWORD, 'bootstrap owner credentials are not configured');

    await page.setViewportSize(DESKTOP);
    await signIn(page, SUPER_EMAIL, SUPER_PASSWORD);

    const mhkId = await optionValueFor(page, 'Center Context', 'MHK');
    expect(mhkId, 'the switcher did not list Mohakhali').not.toBe('');

    await page.getByLabel('Center Context').selectOption(mhkId);
    const stored = await page.evaluate(() => sessionStorage.getItem('clt_super_center'));
    expect(stored, 'the switcher did not persist the selected center').toBe(mhkId);

    // The global search page reads the same key, so a broken switcher would show
    // up here as a filter stuck on "All Centers".
    await page.goto('/admin/super/search');
    await expect(page.getByLabel('Filter by center')).toHaveValue(mhkId, { timeout: 20000 });
  });
});

test.describe('CLT-T-074 center context narrows the pull', () => {
  test.setTimeout(180_000);

  test('switching center re-pulls only that center, and All Centers restores both', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(!SUPER_EMAIL || !SUPER_PASSWORD, 'bootstrap owner credentials are not configured');
    expect(baseURL, 'Playwright baseURL is required').toBeTruthy();

    await page.setViewportSize(DESKTOP);
    await signIn(page, SUPER_EMAIL, SUPER_PASSWORD);

    const mhkId = await optionValueFor(page, 'Center Context', 'MHK');
    const rmpId = await optionValueFor(page, 'Center Context', 'RMP');
    expect(mhkId, 'the switcher did not list Mohakhali').not.toBe('');
    expect(rmpId, 'the switcher did not list Rampura').not.toBe('');

    // Server truth for each center, read with the app's own token.
    const token = await accessToken(page);
    expect(token, 'no Supabase access token in this browser context').not.toBe('');
    const mhkMethods = await serverMethodIds(request, baseURL as string, token, mhkId);
    const rmpMethods = await serverMethodIds(request, baseURL as string, token, rmpId);
    expect(mhkMethods.length, 'Mohakhali has no payment methods on the server').toBeGreaterThan(0);
    expect(rmpMethods.length, 'Rampura has no payment methods on the server').toBeGreaterThan(0);
    expect(
      mhkMethods.filter((id) => rmpMethods.includes(id)),
      'the centers share method ids, so the narrowing assertion would be vacuous',
    ).toHaveLength(0);

    // A fresh super-admin session starts on "All Centers", which caches every
    // center's methods into the one legacy database.
    const union = new Set([...mhkMethods, ...rmpMethods]);
    await expect
      .poll(
        async () => {
          const ids = await cachedMethodIds(page, LEGACY_DB);
          return [...union].every((id) => ids.includes(id));
        },
        { timeout: 90000 },
      )
      .toBe(true);

    // Narrow to Mohakhali: the next cycle must ask the server for that center.
    const pullUrls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/sync/pull')) pullUrls.push(req.url());
    });

    const mhkResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/sync/pull') && res.url().includes(`centerId=${mhkId}`),
      { timeout: 60000 },
    );
    await page.getByLabel('Center Context').selectOption(mhkId);
    expect((await mhkResponse).status()).toBe(200);

    // The cache must end up holding exactly Mohakhali's methods.
    await expect
      .poll(async () => (await cachedMethodIds(page, LEGACY_DB)).length, { timeout: 90000 })
      .toBe(mhkMethods.length);
    const afterMhk = await cachedMethodIds(page, LEGACY_DB);
    expect(
      afterMhk.filter((id) => rmpMethods.includes(id)),
      'Rampura methods survived a Mohakhali-scoped pull',
    ).toHaveLength(0);

    // Back to All Centers: both centers come back, so the narrowing is driven by
    // the switcher rather than by the first pull winning permanently.
    const allResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/sync/pull') && !res.url().includes('centerId='),
      { timeout: 60000 },
    );
    await page.getByLabel('Center Context').selectOption('all');
    expect((await allResponse).status()).toBe(200);
    await expect
      .poll(
        async () => {
          const ids = await cachedMethodIds(page, LEGACY_DB);
          return ids.filter((id) => rmpMethods.includes(id)).length;
        },
        { timeout: 90000 },
      )
      .toBe(rmpMethods.length);

    expect(
      pullUrls.some((url) => url.includes(`centerId=${mhkId}`)),
      'no pull request carried the selected center',
    ).toBe(true);
  });
});

test.describe('CLT-T-075 per-center IndexedDB isolation', () => {
  test.setTimeout(150_000);

  test('MHK and RMP accounts cache into separate KumonLedger databases', async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    test.skip(!MHK_STAFF_EMAIL || !MHK_STAFF_PASSWORD, 'MHK staff fixture is not configured');
    test.skip(!RMP_STAFF_EMAIL || !RMP_STAFF_PASSWORD, 'RMP staff fixture is not configured');
    expect(baseURL, 'Playwright baseURL is required').toBeTruthy();

    await signIn(page, MHK_STAFF_EMAIL, MHK_STAFF_PASSWORD);
    await expect.poll(() => franchiseDatabases(page), { timeout: 60000 }).toHaveLength(1);
    const [mhkDatabase] = await franchiseDatabases(page);
    const mhkToken = await accessToken(page);
    expect(mhkToken, 'no MHK Supabase access token').not.toBe('');
    const mhkServerMethods = await serverMethodIds(request, baseURL as string, mhkToken);
    expect(
      mhkServerMethods.length,
      'Mohakhali has no payment methods on the server',
    ).toBeGreaterThan(0);

    await expect
      .poll(
        async () => {
          const ids = await cachedMethodIds(page, mhkDatabase);
          return mhkServerMethods.every((id) => ids.includes(id));
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const mhkCachedMethods = await cachedMethodIds(page, mhkDatabase);

    // A separate browser context: the Rampura account must never see the
    // Mohakhali database, and the point is what a second device would get.
    const rmpContext = await browser.newContext({ baseURL });
    const rmpPage = await rmpContext.newPage();
    try {
      await signIn(rmpPage, RMP_STAFF_EMAIL, RMP_STAFF_PASSWORD);
      await expect.poll(() => franchiseDatabases(rmpPage), { timeout: 60000 }).toHaveLength(1);
      const [rmpDatabase] = await franchiseDatabases(rmpPage);
      const rmpToken = await accessToken(rmpPage);
      expect(rmpToken, 'no RMP Supabase access token').not.toBe('');
      const rmpServerMethods = await serverMethodIds(request, baseURL as string, rmpToken);
      expect(
        rmpServerMethods.length,
        'Rampura has no payment methods on the server',
      ).toBeGreaterThan(0);
      expect(
        mhkServerMethods.filter((id) => rmpServerMethods.includes(id)),
        'MHK and RMP should have disjoint method IDs',
      ).toHaveLength(0);

      await expect
        .poll(
          async () => {
            const ids = await cachedMethodIds(rmpPage, rmpDatabase);
            return rmpServerMethods.every((id) => ids.includes(id));
          },
          { timeout: 60000 },
        )
        .toBe(true);
      const rmpCachedMethods = await cachedMethodIds(rmpPage, rmpDatabase);

      expect(
        rmpDatabase,
        'both centers cached into the same database; tenant isolation is broken',
      ).not.toBe(mhkDatabase);
      expect(mhkDatabase).toMatch(/^KumonLedger_/);
      expect(rmpDatabase).toMatch(/^KumonLedger_/);
      expect(
        mhkCachedMethods.filter((id) => rmpServerMethods.includes(id)),
        'Mohakhali cache contains Rampura method IDs',
      ).toHaveLength(0);
      expect(
        rmpCachedMethods.filter((id) => mhkServerMethods.includes(id)),
        'Rampura cache contains Mohakhali method IDs',
      ).toHaveLength(0);
    } finally {
      await rmpContext.close();
    }
  });
});
