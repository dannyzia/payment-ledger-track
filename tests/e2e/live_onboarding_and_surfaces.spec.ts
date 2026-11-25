import { test, expect, type Locator, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { totpCode } from '../../scripts/e2e/totp';

/**
 * Live production onboarding + authenticated surface sweep — headed run.
 *
 * One lifecycle, three phases, against the deployed origin:
 *   1. the platform seat signs in and answers its authenticator challenge, then
 *      verifies the franchise centres and the MHK owner's login;
 *   2. the centre owner signs in and invites a staff cashier into the roster;
 *   3. every centre screen is driven as that owner: forms are filled and live
 *      calculations are exercised, but nothing that commits to the ledger
 *      (STAMP & FILE, Close Month) is ever submitted.
 *
 * Credentials come from the untracked `.env.live-e2e`, never from this file.
 * The run writes `test-results/live-onboarding/onboarding-report.json` so the
 * decisions it took (which owner login worked, what the invite answered) are
 * auditable after the fact.
 *
 * The control audit allows exactly one known baseline violation: the deployed
 * build still serves the pre-fix 16 px "View Entries ↗" target. Any other
 * small or covered control fails the run.
 */

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env.live-e2e');
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE, override: true });

const ORIGIN = process.env.E2E_LIVE_BASE_URL ?? 'https://payment-ledger-track.vercel.app';

const SUPER = {
  email: process.env.E2E_LIVE_SUPER_EMAIL ?? '',
  password: process.env.E2E_LIVE_SUPER_PASSWORD ?? '',
  secret: process.env.E2E_LIVE_SUPER_TOTP_SECRET ?? '',
};

const OWNER = {
  email: process.env.E2E_LIVE_OWNER_EMAIL ?? '',
  name: process.env.E2E_LIVE_OWNER_NAME ?? 'Center Owner',
  password: process.env.E2E_LIVE_OWNER_PASSWORD ?? '',
};

const STAFF = {
  email: process.env.E2E_LIVE_STAFF_EMAIL ?? '',
  name: process.env.E2E_LIVE_STAFF_NAME ?? 'Cashier',
};

const MAY_RESET_OWNER_PASSWORD = process.env.E2E_LIVE_RESET_OWNER_PASSWORD === '1';

/**
 * The five channels the bootstrap profile prices (`MHK` fixture rates: 42% commission,
 * 115 bp bKash). The entry form only offers methods it can price, so seeing all five
 * after the first pull is proof the metadata sync landed in Dexie.
 */
const EXPECTED_METHODS = [/cash/i, /b\s*kash/i, /visa/i, /master\s*card/i, /bank/i];

/**
 * GoTrue refuses a password sign-in until the account's email is confirmed, and an
 * invited owner is created unconfirmed. No admin route confirms a user outright: the
 * only surface that sets `email_confirm: true` is the Edit Center modal's owner-email
 * change. So an owner that cannot sign in yet is moved once to its plus-address, which
 * keeps the mailbox and confirms the account on the way through.
 */
const OWNER_ALT_EMAIL = process.env.E2E_LIVE_OWNER_ALT_EMAIL ?? OWNER.email.replace('@', '+e2e@');
let ownerEmailInUse = OWNER.email;

const REPORT_DIR = path.join(ROOT, 'test-results', 'live-onboarding');
const facts: Record<string, unknown> = {};

test.use({ baseURL: ORIGIN, actionTimeout: 10000, navigationTimeout: 25000 });

function record(key: string, value: unknown): void {
  facts[key] = value;
}

function note(description: string): void {
  test.info().annotations.push({ type: 'finding', description });
}

function requireCredentials(): void {
  const missing: string[] = [];
  if (!SUPER.email) missing.push('E2E_LIVE_SUPER_EMAIL');
  if (!SUPER.password) missing.push('E2E_LIVE_SUPER_PASSWORD');
  if (!SUPER.secret) missing.push('E2E_LIVE_SUPER_TOTP_SECRET');
  expect(missing, `fill ${path.relative(ROOT, ENV_FILE)} before a live run`).toEqual([]);
}

/* ------------------------------------------------------------------ *
 * Console health
 * ------------------------------------------------------------------ */

const IGNORED_CONSOLE = [/favicon/i, /net::ERR_ABORTED/];

interface PageWatch {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { status: number; url: string }[];
}

/**
 * Watches console output and 4xx/5xx responses for one page.
 *
 * Uncaught exceptions fail the phase. Console errors and failed requests are
 * recorded and annotated with their URLs instead: the deployed app has a noise
 * floor (a centre-less seat's scoped API, a stale service-worker script) that has to
 * be reported precisely, not swallowed — and not allowed to abort the sweep before
 * the other screens have run.
 */
function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') watch.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => watch.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      watch.failedRequests.push({
        status: response.status(),
        url: response.url().replace(ORIGIN, ''),
      });
    }
  });
  return watch;
}

function reportPageHealth(watch: PageWatch, phase: string): void {
  const consoleErrors = watch.consoleErrors.filter(
    (line) => !IGNORED_CONSOLE.some((re) => re.test(line)),
  );
  record(`${phase}_console_errors`, consoleErrors);
  record(`${phase}_failed_requests`, watch.failedRequests);

  expect(watch.pageErrors, `${phase} uncaught exceptions`).toEqual([]);

  if (consoleErrors.length > 0) {
    note(`${phase}: ${consoleErrors.length} console error(s) — ${consoleErrors.join(' | ')}`);
  }
  if (watch.failedRequests.length > 0) {
    note(
      `${phase}: failed requests — ${watch.failedRequests
        .map((f) => `${f.status} ${f.url}`)
        .join(', ')}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Sign-in
 * ------------------------------------------------------------------ */

type SignInResult = { ok: boolean; url: string; error: string };

async function signIn(page: Page, email: string, password: string): Promise<SignInResult> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.locator('button[type="submit"]').click();
  await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25000 })
    .catch(() => undefined);

  const url = page.url();
  if (!url.includes('/login')) return { ok: true, url, error: '' };

  const error = await page
    .locator('[role="alert"]')
    .first()
    .innerText()
    .catch(() => '');
  return { ok: false, url, error: error.replace(/\s+/g, ' ').trim() };
}

/**
 * Answers the platform seat's authenticator challenge. The app routes a seat at
 * `aal1` to /admin/super/security, which either challenges (existing factor) or
 * enrols; only the challenge path is automated here. Verifying mints a fresh
 * recovery-code batch, so the codes screen is always part of the flow.
 */
async function completeSeatFactor(page: Page): Promise<void> {
  const challenge = page.locator('#totp-challenge');
  await challenge.waitFor({ state: 'visible', timeout: 25000 });
  await challenge.fill(totpCode(SUPER.secret));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const codesHeading = page.getByRole('heading', { name: /save your recovery codes/i });
  const dashboardButton = page.getByRole('button', { name: /continue to the dashboard/i });

  const outcome = await Promise.race([
    codesHeading
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => 'codes' as const)
      .catch(() => null),
    dashboardButton
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => 'done' as const)
      .catch(() => null),
  ]);

  if (!outcome) {
    const alert = await page
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => '');
    throw new Error(`2FA challenge did not pass: ${alert.trim() || 'no alert text'}`);
  }

  record('seat_factor_phase', outcome);
  if (outcome === 'codes') await page.locator('input[type="checkbox"]').check();
  await dashboardButton.click();
  await page.waitForURL('**/dashboard', { timeout: 25000 });
}

/* ------------------------------------------------------------------ *
 * Control audit
 * ------------------------------------------------------------------ */

/** The deployed build predates the 44 px reports fix; only that target is excused. */
const KNOWN_UNDEPLOYED = [/View Entries/];

async function labelOf(control: Locator): Promise<string> {
  const text = (await control.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 48);
  const aria = await control.getAttribute('aria-label').catch(() => null);
  if (aria) return aria.slice(0, 48);
  const title = await control.getAttribute('title').catch(() => null);
  return (title ?? '(icon button)').slice(0, 48);
}

async function auditControls(page: Page, screen: string): Promise<void> {
  const buttons = page.locator('button:visible, a[role="button"]:visible');
  const count = await buttons.count();
  const violations: string[] = [];

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const box = await button.boundingBox();
    if (!box) continue;

    const label = await labelOf(button);
    if (box.width < 24 || box.height < 24) {
      violations.push(`${Math.round(box.width)}x${Math.round(box.height)}px target: ${label}`);
      continue;
    }

    const hit = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'offscreen';
      const top = document.elementFromPoint(x, y);
      if (!top) return 'no hit target';
      if (top === element || element.contains(top)) return 'ok';
      return `covered by ${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}`;
    });

    if (hit !== 'ok' && hit !== 'offscreen') violations.push(`${hit}: ${label}`);
  }

  record(`controls:${screen}`, { buttons: count, violations });

  const unexpected = violations.filter((v) => !KNOWN_UNDEPLOYED.some((re) => re.test(v)));
  expect(unexpected, `control audit on ${screen}`).toEqual([]);
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

test.describe('Live production onboarding', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(() => {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const payload = { origin: ORIGIN, ranAt: new Date().toISOString(), ...facts };
    fs.writeFileSync(
      path.join(REPORT_DIR, 'onboarding-report.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  });

  test('Phase 1 — seat sign-in with 2FA, fleet dashboard, MHK/RMP centres', async ({ page }) => {
    test.setTimeout(240_000);
    requireCredentials();

    const watch = watchPage(page);

    const signInResult = await signIn(page, SUPER.email, SUPER.password);
    expect(signInResult.ok, `super admin password rejected: ${signInResult.error}`).toBe(true);
    record('phase1_signin_url', new URL(signInResult.url).pathname);

    // The seat's factor is not yet proven in a fresh context.
    expect(new URL(page.url()).pathname, 'seat must be gated on its second factor').toBe(
      '/admin/super/security',
    );
    await completeSeatFactor(page);
    expect(new URL(page.url()).pathname, 'seat lands on the dashboard').toBe('/dashboard');
    await auditControls(page, 'P1 /dashboard');

    await page.goto('/admin/super', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fleet Dashboard' }).last(),
    ).toBeVisible({ timeout: 15000 });
    await auditControls(page, 'P1 /admin/super');

    await page.goto('/admin/super/centers', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Franchise Centers' }).last(),
    ).toBeVisible({ timeout: 15000 });

    const rows = page.locator('tbody tr');
    await expect.poll(async () => rows.count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    const mhk = rows.filter({ hasText: 'MHK' }).first();
    const rmp = rows.filter({ hasText: 'RMP' }).first();
    await expect(mhk, 'MHK centre row').toBeVisible();
    await expect(rmp, 'RMP centre row').toBeVisible();

    const mhkText = (await mhk.innerText()).replace(/\s+/g, ' ').trim();
    const ownerShown = /Owner:\s*(.+)$/.exec(mhkText)?.[1]?.trim() ?? null;
    record('mhk_row', mhkText);
    record('mhk_owner_shown', ownerShown);

    // Does the configured owner login already work? Probe in a throwaway context
    // so this phase's session stays at aal2.
    const browser = page.context().browser();
    if (!browser) throw new Error('no browser handle');

    async function probeOwner() {
      const probe = await browser!.newContext({ baseURL: ORIGIN });
      const probePage = await probe.newPage();
      const result = await signIn(probePage, ownerEmailInUse, OWNER.password);
      await probe.close();
      return result;
    }

    /** Saves the Edit Center modal for one centre with a known owner login. */
    async function saveOwner(centerCode: string, email: string): Promise<void> {
      const row = page.locator('tbody tr').filter({ hasText: centerCode }).first();
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      const modal = page
        .locator('form')
        .filter({ has: page.getByText('Center Code (Immutable)') })
        .first();
      await expect(modal).toBeVisible({ timeout: 10000 });

      await modal.getByLabel('Center Owner Email').fill(email);
      await modal.getByLabel('Center Owner Name').fill(OWNER.name);
      await modal.getByLabel('Set / Reset Owner Password').fill(OWNER.password);
      await modal.getByRole('button', { name: 'Save Changes' }).click();

      await expect(modal).toBeHidden({ timeout: 20000 });
      await expect(page.getByText(/Failed to update center details/i)).toHaveCount(0);
    }

    let ownerLogin = await probeOwner();
    record('owner_login_probe', {
      ok: ownerLogin.ok,
      error: ownerLogin.error,
      path: ownerLogin.url.replace(ORIGIN, ''),
    });

    if (!ownerLogin.ok) {
      expect(
        MAY_RESET_OWNER_PASSWORD,
        `MHK owner ${OWNER.email} cannot sign in (${ownerLogin.error}) and E2E_LIVE_RESET_OWNER_PASSWORD is off`,
      ).toBe(true);

      // MHK had no owner before this run, so this is the provisioning step: point
      // the centre at the configured login and give it a known password.
      await saveOwner('MHK', ownerEmailInUse);
      ownerLogin = await probeOwner();
      record('owner_login_after_provision', { ok: ownerLogin.ok, error: ownerLogin.error });

      if (!ownerLogin.ok && /not confirmed/i.test(ownerLogin.error)) {
        ownerEmailInUse = OWNER_ALT_EMAIL;
        await saveOwner('MHK', ownerEmailInUse);
        ownerLogin = await probeOwner();
        record('owner_login_after_confirm', {
          ok: ownerLogin.ok,
          error: ownerLogin.error,
          email: ownerEmailInUse,
        });
        note(
          `GoTrue left the invited MHK owner unconfirmed, so it was moved to ${ownerEmailInUse} before it could sign in; rotate that login after the audit.`,
        );
      }

      expect(ownerLogin.ok, `MHK owner still refused: ${ownerLogin.error}`).toBe(true);
    }

    record('owner_email_in_use', ownerEmailInUse);

    await auditControls(page, 'P1 /admin/super/centers');
    reportPageHealth(watch, 'phase1');
  });

  test('Phase 2 — owner sign-in, admin hub, invite the staff cashier', async ({ page }) => {
    test.setTimeout(180_000);

    const watch = watchPage(page);
    const signInResult = await signIn(page, ownerEmailInUse, OWNER.password);
    expect(signInResult.ok, `owner sign-in failed: ${signInResult.error}`).toBe(true);
    expect(new URL(page.url()).pathname, 'owner lands on the dashboard').toBe('/dashboard');
    record('phase2_signin_url', new URL(page.url()).pathname);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Admin Hub' }).last()).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Team Roster & Roles' }).last(),
    ).toBeVisible({ timeout: 15000 });
    await auditControls(page, 'P2 /admin/users');

    await page.getByRole('button', { name: 'Invite Team Member' }).click();
    await expect(page.locator('#invite-email')).toBeVisible({ timeout: 10000 });

    await page.locator('#invite-fullname').fill(STAFF.name);
    await page.locator('#invite-email').fill(STAFF.email);
    await page.locator('#invite-role-select').selectOption('staff');
    await page.getByRole('button', { name: 'Send Invitation' }).click();

    // Either the invitation is sent or the cashier already holds an active
    // account; both are a pass, and which one happened is recorded. Only visible
    // page-level banners count: the ownership-transfer dialog keeps an invisible
    // red warning in the DOM, and matching it was reading the wrong element.
    const successBanner = page.locator('div.mb-6.bg-green-500\\/10:visible');
    const pageErrorBanner = page.locator('div.mb-6.bg-red-500\\/10:visible');
    const modalErrorBanner = page.locator('div.p-3.bg-red-500\\/10:visible');

    await expect
      .poll(
        async () =>
          (await successBanner.count()) > 0 ||
          (await pageErrorBanner.count()) > 0 ||
          (await modalErrorBanner.count()) > 0 ||
          !(await page
            .locator('#invite-email')
            .isVisible()
            .catch(() => false)),
        { timeout: 30000 },
      )
      .toBe(true);

    const invited = (await successBanner.count()) > 0;
    const bannerText = async (locator: Locator): Promise<string> =>
      (
        await locator
          .first()
          .innerText()
          .catch(() => '')
      )
        .replace(/\s+/g, ' ')
        .trim();
    const message = invited
      ? ''
      : (await bannerText(pageErrorBanner)) || (await bannerText(modalErrorBanner));
    record('invite_outcome', { invited, message });

    if (!invited) {
      expect(
        message,
        `invite refused without a banner: ${message || '(modal closed silently)'}`,
      ).toMatch(/already active/i);
      note(
        `${STAFF.email} already holds an active account, so the invite was refused as a duplicate; the roster membership below is what proves the cashier exists.`,
      );
    }

    // Closing the modal reloads the roster; the cashier must be listed.
    await page.keyboard.press('Escape').catch(() => undefined);
    const rosterRow = page.locator('tbody tr').filter({ hasText: STAFF.email });
    await expect.poll(async () => rosterRow.count(), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(rosterRow.first()).toContainText(/STAFF/i);
    record('staff_listed', true);

    await auditControls(page, 'P2 /admin/users (after invite)');
    reportPageHealth(watch, 'phase2');
  });

  test('Phase 3 — every centre screen, form and control', async ({ page }) => {
    test.setTimeout(300_000);

    const watch = watchPage(page);

    // The layout starts the sync runner on mount. Arm this before signing in: the
    // first pull is what fills Dexie with the centre's payment methods, rate
    // profile and payables, and every screen below reads them from the cache.
    const firstPull = page
      .waitForResponse((response) => /\/api\/v1\/sync\/pull/.test(response.url()), {
        timeout: 45000,
      })
      .catch(() => null);

    // A service-worker script fetch is issued by the browser, not by the document,
    // so Playwright's response events never see it. Capture the registration URL
    // the app actually passes instead, and keep it across navigations: with the
    // relative "./sw.js" SvelteKit's build used to produce, a nested route resolves
    // it to `/entries/sw.js` and the worker 404s there.
    await page.addInitScript(() => {
      const container = navigator.serviceWorker;
      if (!container) return;
      const original = container.register.bind(container);
      container.register = ((scriptURL: string | URL, options?: RegistrationOptions) => {
        try {
          const seen: string[] = JSON.parse(sessionStorage.getItem('__swRegisterCalls') ?? '[]');
          seen.push(new URL(String(scriptURL), window.location.href).pathname);
          sessionStorage.setItem('__swRegisterCalls', JSON.stringify(seen));
        } catch {
          // A storage failure must never block the app's own registration.
        }
        return original(scriptURL as string, options);
      }) as typeof container.register;
    });

    const signInResult = await signIn(page, ownerEmailInUse, OWNER.password);
    expect(signInResult.ok, `owner sign-in failed: ${signInResult.error}`).toBe(true);

    const pull = await firstPull;
    record(
      'first_sync_pull',
      pull ? { status: pull.status(), url: pull.url().replace(ORIGIN, '') } : 'no pull response',
    );
    expect(pull?.status(), 'the first /api/v1/sync/pull answered').toBe(200);

    /* /dashboard — the owner's executive summary and quick actions */
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).last()).toContainText(
      /Executive Summary/,
      {
        timeout: 20000,
      },
    );
    await expect(page.getByText('Total Shop Gross (MTD)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month Close Controls' })).toBeVisible();

    // Data-dependent blocks: present only when the centre has open months or
    // variance alerts, so they are recorded rather than required.
    record(
      'dashboard_governance_section',
      await page.getByText('Pending Governance Decisions').count(),
    );
    record(
      'dashboard_variance_alert',
      await page.getByRole('button', { name: /Review Reconciliation/i }).count(),
    );

    const outboxChip = page.getByText(/\d+ Outbox Pending/);
    record('dashboard_outbox_chip', await outboxChip.count());
    if ((await outboxChip.count()) === 0) {
      note(
        'The owner dashboard renders no pending-sync chip; only the staff and admin dashboards do.',
      );
    }
    await auditControls(page, 'P3 /dashboard');

    /* /entries/new — synced metadata, live breakdown, never committed */
    await page.goto('/entries/new', { waitUntil: 'domcontentloaded' });
    const gross = page.locator('#input-gross');
    await expect(gross).toBeVisible({ timeout: 20000 });

    const chips = page.locator('form button[aria-pressed]');
    await expect.poll(async () => chips.count(), { timeout: 30000 }).toBeGreaterThan(0);

    const methodLabels = (await chips.allInnerTexts()).map((label) =>
      label.replace(/\s+/g, ' ').trim(),
    );
    record('payment_methods_on_device', methodLabels.length);
    record('payment_method_labels', methodLabels);

    for (const wanted of EXPECTED_METHODS) {
      expect(
        methodLabels.some((label) => wanted.test(label)),
        `no payment method matching ${wanted} after the first pull (cache holds: ${methodLabels.join(', ') || 'nothing'})`,
      ).toBe(true);
    }

    const breakdown = page.locator('.receipt-breakdown');
    await expect(breakdown.getByText('Live Calculation Breakdown')).toBeVisible();

    const bkash = chips.filter({ hasText: /b\s*kash/i }).first();
    await bkash.click();
    await expect(bkash).toHaveAttribute('aria-pressed', 'true');

    await gross.fill('5000.00');
    await expect(gross).toHaveValue('5000.00');

    const txn = page.locator('#input-txn-ref');
    await txn.fill('TXN123456');
    await expect(txn).toHaveValue('TXN123456');

    const breakdownText = async (): Promise<string> =>
      (await breakdown.innerText()).replace(/\s+/g, ' ').trim();

    // 5,000.00 gross → 42% commission 2,100.00 → 1.15% bKash 57.50 → net 2,842.50.
    await expect.poll(breakdownText, { timeout: 15000 }).toContain('৳2,842.50');
    const receipt = await breakdownText();
    record('breakdown_bkash', receipt);

    expect(receipt, 'commission line uses the 42.00% baseline').toContain('Commission (42.00%)');
    expect(receipt, 'commission is deducted').toContain('-৳2,100.00');
    expect(receipt, 'the bKash line uses the 1.15% method rate').toMatch(/b\s*kash\s*\(1\.15%\)/i);
    expect(receipt, 'the bKash charge is deducted').toContain('-৳57.50');
    expect(receipt, 'net after deductions').toContain('৳2,842.50');

    // Every other cached channel must re-price the same gross independently.
    const nets: string[] = [];
    for (let i = 0; i < methodLabels.length; i++) {
      const chip = chips.nth(i);
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      nets.push((await breakdown.locator('.carbon-nums').first().innerText()).trim());
    }
    record('net_values_seen', nets);
    expect(new Set(nets).size, 'the breakdown re-prices per payment method').toBeGreaterThan(1);
    expect(
      methodLabels.filter((_, i) => nets[i] === '৳0.00'),
      'every method prices the gross instead of staying at zero',
    ).toEqual([]);

    // The committing control is measured and its gate recorded; it is never clicked,
    // so this phase leaves no entry, settlement or audit row behind.
    const stamp = page.locator('#btn-save');
    await expect(stamp).toBeVisible();
    expect((await stamp.boundingBox())?.height ?? 0, 'STAMP & FILE height').toBeGreaterThanOrEqual(
      44,
    );
    record('stamp_disabled', await stamp.isDisabled());
    record('stamp_clicked', false);
    await auditControls(page, 'P3 /entries/new');

    /* /ledger — search, no-match state, filter drawer, day groups */
    await page.goto('/ledger', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Ledger' }).last()).toBeVisible({
      timeout: 20000,
    });
    const search = page.locator('input[type="search"]');
    await search.fill('E2E-LIVE-NO-MATCH-01');
    await expect(page.getByText(/No transactions found matching criteria/i)).toBeVisible({
      timeout: 15000,
    });
    await search.fill('');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByText(/Status/i).first()).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');

    const dayGroups = page.locator('section.day-group');
    const groupCount = await dayGroups.count();
    record('ledger_day_groups', groupCount);
    if (groupCount > 0) {
      await expect(dayGroups.first().locator('h2')).not.toHaveText('');
      await expect(dayGroups.first()).toContainText(/Units:/);
    } else {
      await expect(page.getByText(/No transactions found matching criteria/i)).toBeVisible();
      note('/ledger rendered no day groups: this centre has no entries for the current scope.');
    }
    await auditControls(page, 'P3 /ledger');

    /* /reports — month scope, payables table, drill-down */
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Monthly Reports' }).last(),
    ).toBeVisible({ timeout: 20000 });
    const month = page.locator('input[type="month"]');
    const before = await month.inputValue();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(month).not.toHaveValue(before);
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(month).toHaveValue(before);

    await expect(page.getByText('Payables & Liabilities Summary')).toBeVisible({ timeout: 15000 });
    const viewEntries = page.getByRole('button', { name: /View Entries/ });
    record('report_view_entries_buttons', await viewEntries.count());
    if ((await viewEntries.count()) > 0) {
      await expect(viewEntries.first()).toBeVisible();
      expect(
        (await viewEntries.first().boundingBox())?.height ?? 0,
        'View Entries target height (deployed build)',
      ).toBeGreaterThan(0);
    }
    await auditControls(page, 'P3 /reports');

    /* /settlements — payable cards and status badges */
    await page.goto('/settlements', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Monthly Settlements' }).last(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator('input[type="month"]')).toBeVisible();

    // One card per payable for the month. A payable with no settlement row yet
    // still renders a card, but its wrapper is href="#" rather than a drill-down.
    const settlementCards = page.locator('.settlements-page a.block');
    const cardCount = await settlementCards.count();
    const linkedCount = await page.locator('a[href^="/settlements/"]').count();
    record('settlement_cards', cardCount);
    record('settlement_linked_cards', linkedCount);

    if (cardCount === 0) {
      await expect(page.getByText(/No active settlement payables found/i)).toBeVisible();
      note('/settlements rendered no payable cards for this centre/month.');
    } else {
      await expect(page.getByText(/Expected Liability/i).first()).toBeVisible();
      record(
        'settlement_first_card',
        (await settlementCards.first().innerText()).replace(/\s+/g, ' ').trim(),
      );
      if (linkedCount === 0) {
        note(
          '/settlements lists this month’s payables but no settlement row exists yet, so the cards carry no detail link.',
        );
      }
    }
    await auditControls(page, 'P3 /settlements');

    /* /reconcile — Mode A and Mode B entry points */
    await page.goto('/reconcile', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Statement Reconciliation' }).last(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator('input[type="month"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /New Mode A Statement/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Upload Statement File \(Mode B\)/i }),
    ).toBeVisible();
    await auditControls(page, 'P3 /reconcile');

    /* /months/close — checklist and gate state */
    await page.goto('/months/close', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Month Close Controls' }).last(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Implementation Readiness Checklist for/i)).toBeVisible();
    const closeControl = page.locator('#btn-save, #btn-reopen-modal').first();
    await expect(closeControl).toBeVisible();
    record('close_month_disabled', await closeControl.isDisabled());
    await auditControls(page, 'P3 /months/close');

    /* /admin and every admin tab */
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Admin Hub' }).last()).toBeVisible({
      timeout: 20000,
    });
    await auditControls(page, 'P3 /admin');

    const tabs: [string, string][] = [
      ['/admin/rates', 'Rate Profiles & Rules'],
      ['/admin/methods', 'Payment Methods'],
      ['/admin/payables', 'Payables & Settlement Schedule'],
      ['/admin/settings', 'Application Settings'],
      ['/admin/audit', 'Audit Log Viewer'],
    ];
    for (const [route, title] of tabs) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: title }).last()).toBeVisible({
        timeout: 20000,
      });
      await auditControls(page, `P3 ${route}`);
    }

    const draftRateFields = page.locator('#vat-mode-select');
    await page.goto('/admin/rates', { waitUntil: 'domcontentloaded' });
    if ((await draftRateFields.count()) > 0) {
      await expect(page.getByText(/Draft Rate Profile/i)).toBeVisible({ timeout: 15000 });
    }

    /* The service worker must register at the origin root, never per route */
    const swCalls: string[] = await page.evaluate(() => {
      const raw = sessionStorage.getItem('__swRegisterCalls');
      return raw ? (JSON.parse(raw) as string[]) : [];
    });
    const swRegistrations: { scope: string; script: string | null }[] = await page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
          scope: new URL(registration.scope).pathname,
          script: (registration.active ?? registration.installing ?? registration.waiting)
            ?.scriptURL
            ? new URL(
                (registration.active ?? registration.installing ?? registration.waiting)!.scriptURL,
              ).pathname
            : null,
        })),
    );
    const swConsoleErrors = watch.consoleErrors.filter((line) => /fetching the script/i.test(line));
    const rootScript = await page.request.get(`${ORIGIN}/sw.js`);

    record('sw_register_calls', swCalls);
    record('sw_registrations', swRegistrations);
    record('sw_console_fetch_errors', swConsoleErrors.length);
    record('sw_root_status', rootScript.status());

    // The worker asset itself must be served from the origin root.
    expect(rootScript.status(), 'the deployed build serves /sw.js at the origin root').toBe(200);

    // The fix in apps/web/vite.config.ts (base/scope '/') only reaches a browser in
    // the next release, and the deployed bundle still resolves `./sw.js` per route.
    // While that is the case the per-route calls are recorded as a pending-release
    // gap. Once every call is root-absolute the strict form applies: registration
    // must succeed and no worker fetch may fail.
    if (swCalls.length > 0 && swCalls.every((script) => script === '/sw.js')) {
      expect(swRegistrations.length, 'the worker registered at the origin root').toBeGreaterThan(0);
      expect(
        swRegistrations.map((registration) => registration.scope),
        'the worker controls the whole origin',
      ).toEqual(swRegistrations.map(() => '/'));
      expect(swConsoleErrors, 'no service-worker script fetch failed').toEqual([]);
    } else {
      note(
        `Service worker still registered per route on the deployed bundle: ${[...new Set(swCalls)].join(', ') || '(no call captured)'}. apps/web/vite.config.ts pins base/scope to "/", so this clears with the next release.`,
      );
    }

    reportPageHealth(watch, 'phase3');
  });
});
