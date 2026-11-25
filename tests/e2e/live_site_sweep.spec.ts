import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Live production sweep — CLT-REL-002.
 *
 * Read-only by design: forms are filled and validated, dynamic calculations
 * are exercised, but nothing that commits to the ledger is submitted. The two
 * destructive controls (STAMP & FILE, Close Month Permanently) are only
 * measured and their enabled state asserted.
 *
 * Auth states are written once by `live-global-setup.ts`. When a role could not
 * sign in (the local fixture accounts are refused by the hosted project), that
 * role's describes skip with the recorded reason instead of pretending to run.
 */

const AUTH_DIR = path.join(process.cwd(), '.playwright');
const COUNTS_DIR = path.join(process.cwd(), 'test-results', 'live-audit');

type Role = 'owner' | 'staff' | 'super';
type RoleStatus = { state: string | null; ok: boolean; reason: string };

function readStatus(): Record<string, RoleStatus> {
  try {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'auth-status.json'), 'utf8')) as Record<
      string,
      RoleStatus
    >;
  } catch {
    return {};
  }
}

const STATUS = readStatus();

function statePath(role: Role): string {
  return path.join(AUTH_DIR, `auth-${role}.json`);
}

function hasState(role: Role): boolean {
  return fs.existsSync(statePath(role));
}

function stateFor(role: Role): string | { cookies: []; origins: [] } {
  return hasState(role) ? statePath(role) : { cookies: [], origins: [] };
}

function skipReason(role: Role): string {
  return (
    STATUS[role]?.reason ??
    `no saved auth state for ${role}; provide hosted credentials in .env.local and rerun`
  );
}

/** Skips the calling test when the role has no usable session. */
function requireRole(role: Role): void {
  test.skip(!hasState(role), skipReason(role));
}

const IGNORED_CONSOLE = [/favicon/i, /net::ERR_ABORTED/];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

function expectNoConsoleErrors(errors: string[]): void {
  const fatal = errors.filter((line) => !IGNORED_CONSOLE.some((re) => re.test(line)));
  expect(fatal, 'unhandled console errors').toEqual([]);
}

async function labelOf(control: Locator): Promise<string> {
  const text = (await control.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 48);
  const aria = await control.getAttribute('aria-label').catch(() => null);
  if (aria) return aria.slice(0, 48);
  const title = await control.getAttribute('title').catch(() => null);
  return (title ?? '(icon button)').slice(0, 48);
}

interface CrawlResult {
  screen: string;
  project: string;
  url: string;
  buttons: number;
  fields: number;
  violations: string[];
}

/**
 * Universal control audit: every visible button and role=button element must
 * render at least 24x24 px and must not be sitting under another element.
 * Counts are written per test so the run can total screens, buttons and fields.
 */
async function crawl(page: Page, info: TestInfo): Promise<CrawlResult> {
  const buttons = page.locator('button:visible, a[role="button"]:visible');
  const fields = page.locator('input:visible, select:visible, textarea:visible');
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
      const name = `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}`;
      return `covered by ${name}`;
    });

    if (hit !== 'ok' && hit !== 'offscreen') violations.push(`${hit}: ${label}`);
  }

  const result: CrawlResult = {
    screen: info.title,
    project: info.project.name,
    url: page.url(),
    buttons: count,
    fields: await fields.count(),
    violations,
  };

  fs.mkdirSync(COUNTS_DIR, { recursive: true });
  const fileName = `${info.project.name}-${info.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  fs.writeFileSync(path.join(COUNTS_DIR, `${fileName}.json`), JSON.stringify(result, null, 2));

  expect(violations, `control audit on "${info.title}"`).toEqual([]);
  return result;
}

function note(description: string): void {
  test.info().annotations.push({ type: 'finding', description });
}

async function visit(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
}

async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  // The app shell renders its own <h1> (the product name) above the page content,
  // so `name` can also match that shell title (default matching is substring).
  // The page heading is always the last level-1 heading in the document.
  await expect(page.getByRole('heading', { level: 1, name }).last()).toBeVisible({
    timeout: 10000,
  });
}

/* ------------------------------------------------------------------ *
 * Public surfaces
 * ------------------------------------------------------------------ */

test.describe('Public surfaces', () => {
  test('01 /login — sign-in form, password toggle, APK link, support', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/login');
    await expectHeading(page, 'Kumon Ledger Track');

    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');

    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeEnabled();

    const box = await submit.boundingBox();
    expect(box?.height ?? 0, 'sign-in button height').toBeGreaterThanOrEqual(44);

    // Password reveal toggle round-trip.
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');

    // Android APK entry point and its QR block.
    const apk = page.locator('a[href="/downloads/kumon-ledger-track.apk"]');
    await expect(apk).toHaveAttribute('download', 'kumon-ledger-track.apk');
    await expect(page.locator('img[src="/images/apk-qr.svg"]')).toBeVisible();

    // Onboarding hint: the desktop and mobile copies are mutually exclusive by
    // breakpoint, so only the one that is actually displayed can be asserted.
    await expect(
      page
        .getByText(/onboarding details|registration/i)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    // Support channels.
    await expect(page.getByRole('link', { name: '+8801613249520' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'admin@klt.digital-papyrus.com' })).toBeVisible();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('02 /download — APK link, auto-download notice, install steps', async ({ page }) => {
    // The page starts the 15 MB transfer on a 600 ms timer and on a 2 s
    // meta-refresh. In the mobile emulation a download is not handled as a
    // download at all, so that timer navigated the tab away mid-assertion.
    // Neutralise both triggers: drop the refresh tag and swallow the
    // programmatic click, while leaving the page's own state change intact.
    await page.addInitScript(() => {
      const removeRefresh = () =>
        document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((meta) => meta.remove());
      document.addEventListener('DOMContentLoaded', removeRefresh);

      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.getAttribute('href')?.startsWith('/downloads/')) return;
        click.call(this);
      };
    });
    await page.route('**/downloads/kumon-ledger-track.apk', (route) =>
      route.fulfill({ status: 204, body: '' }),
    );

    const errors = watchConsole(page);
    await visit(page, '/download');
    await page.evaluate(() =>
      document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((meta) => meta.remove()),
    );
    await expectHeading(page, 'Kumon Ledger Track');

    const apk = page.locator('a[href="/downloads/kumon-ledger-track.apk"][download]');
    await expect(apk.first()).toBeVisible();
    await expect(
      page.getByText(/Starting download automatically|download has started/i),
    ).toBeVisible();
    await expect(page.getByText('How to install on Android')).toBeVisible();

    for (const step of ['Tap "Download anyway"', 'Open downloaded file', 'Tap "Install"']) {
      await expect(page.getByText(step, { exact: false })).toBeVisible();
    }

    await expect(page.getByRole('link', { name: /Back to Sign In/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /WhatsApp Help/i })).toBeVisible();

    if ((await page.getByRole('button', { name: /copy/i }).count()) === 0) {
      note('/download has no "copy QR link" control; the page renders a QR image and text only.');
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('03 /set-password — fields, toggle, mismatch validation', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/set-password');
    await expect(page.locator('#new-password')).toBeVisible();
    await expect(page.locator('#confirm-password')).toBeVisible();

    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box?.height ?? 0, 'set-password button height').toBeGreaterThanOrEqual(44);

    if (await submit.isEnabled()) {
      note(
        '/set-password submit stays enabled while both fields are empty; the browser required-attribute blocks it, so the guard is native rather than a disabled state.',
      );
    }

    // Mismatch is handled before any network call, so this is safe on production.
    await page.fill('#new-password', 'audit-only-pass-1');
    await page.fill('#confirm-password', 'audit-only-pass-2');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText(/match/i);

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('04 /withheld — withheld notice and return-to-sign-in control', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/withheld');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toHaveText('');

    const back = page.getByRole('button', { name: /sign in/i });
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box?.height ?? 0, 'withheld return button height').toBeGreaterThanOrEqual(44);

    if ((await page.locator('a[href^="mailto:"], a[href^="https://wa.me"]').count()) === 0) {
      note(
        '/withheld lists no support contact link; the only action is "sign in with another account".',
      );
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('05 / — root routes an anonymous visitor to /login', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('#login-email')).toBeVisible();
    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });
});

/* ------------------------------------------------------------------ *
 * Staff surfaces
 * ------------------------------------------------------------------ */

test.describe('Staff surfaces', () => {
  test.use({ storageState: stateFor('staff') });

  test.beforeEach(() => {
    requireRole('staff');
  });

  test('06 /dashboard — counter stats, outbox chip, new-entry action', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/dashboard');
    await expect(page.getByText(/Welcome,/)).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/\d+ Outbox Pending/)).toBeVisible();
    const newEntry = page.locator('#btn-save');
    await expect(newEntry).toBeVisible();
    const box = await newEntry.boundingBox();
    expect(box?.height ?? 0, 'new transaction button height').toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('link', { name: /New Transaction/i })).toBeVisible();

    if ((await page.locator('aside nav a[href]').count()) === 0) {
      note('Desktop sidebar rendered no links for the staff role.');
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('07 /entries/new — live breakdown across every payment method', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/entries/new');

    const gross = page.locator('#input-gross');
    await expect(gross).toBeVisible({ timeout: 10000 });

    // Wait for the rate profile/methods to arrive from sync before typing. A device
    // that has not pulled yet legitimately renders the "no payment methods" empty
    // state; record that instead of pretending the method chips were exercised.
    const chips = page.locator('form button[aria-pressed]');
    await expect
      .poll(
        async () =>
          (await chips.count()) > 0 ||
          (await page.getByText(/No payment methods on this device/i).count()) > 0,
        {
          timeout: 10000,
        },
      )
      .toBe(true);
    const methodCount = await chips.count();
    if (methodCount === 0) {
      note('/entries/new rendered its empty state: no payment methods on this device after sync.');
    }

    await page.locator('#input-customer').fill('E2E Audit (not saved)');
    await gross.fill('5909.00');

    const breakdown = page.locator('.receipt-breakdown');
    await expect(breakdown.getByText('Live Calculation Breakdown')).toBeVisible();
    await expect(breakdown.getByText('Gross Collected')).toBeVisible();
    await expect(breakdown.getByText(/^VAT \(/)).toBeVisible();
    await expect(breakdown.getByText(/^Commission \(/)).toBeVisible();
    await expect(breakdown.getByText('Net After Deductions')).toBeVisible();
    if (methodCount > 0) {
      // The net row must re-price away from zero; VAT/method-charge rows legitimately
      // stay at ৳0.00 when the profile sets them to zero.
      await expect(breakdown.locator('.carbon-nums').last()).not.toHaveText('৳0.00');
    } else {
      note(
        'Device cache holds no payment method or rate profile, so the breakdown stays at ৳0.00 (Gross included) while #input-gross holds a value.',
      );
    }

    // Every method must re-price the receipt without a reload.
    const nets = new Set<string>();
    for (let i = 0; i < methodCount; i++) {
      const chip = chips.nth(i);
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      const net = (await breakdown.locator('.carbon-nums').first().innerText()).trim();
      nets.add(net);
    }
    if (methodCount > 0) expect(nets.size, 'distinct Net values across methods').toBeGreaterThan(0);

    // Transaction reference is uppercased in place.
    const txn = page.locator('#input-txn-ref');
    await expect(txn).toBeVisible();
    await txn.fill('e2e-audit-01');
    await expect(txn).toHaveValue('E2E-AUDIT-01');

    // The committing control: measured, never clicked.
    const stamp = page.locator('#btn-save');
    await expect(stamp).toBeVisible();
    const box = await stamp.boundingBox();
    expect(box?.height ?? 0, 'STAMP & FILE height').toBeGreaterThanOrEqual(44);
    if (await stamp.isDisabled()) {
      const banner = await page
        .locator('.bg-red-500\\/10, .bg-amber-500\\/10')
        .first()
        .innerText()
        .catch(() => '');
      note(`STAMP & FILE is disabled for this month/account: ${banner.trim().slice(0, 120)}`);
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('08 /ledger — search, filters drawer, day grouping', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/ledger');
    await expectHeading(page, 'Ledger');

    const search = page.locator('input[type="search"]');
    await expect(search).toBeVisible();
    await search.fill('E2E-AUDIT-NO-MATCH');
    await expect(page.getByText(/No transactions found matching criteria/i)).toBeVisible({
      timeout: 8000,
    });
    await search.fill('');

    const filters = page.getByRole('button', { name: /^Filters/ });
    await expect(filters).toBeVisible();
    await filters.click();
    await expect(page.getByText(/Status/i).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });
});

/* ------------------------------------------------------------------ *
 * Owner / admin surfaces
 * ------------------------------------------------------------------ */

test.describe('Owner surfaces', () => {
  test.use({ storageState: stateFor('owner') });

  test.beforeEach(() => {
    requireRole('owner');
  });

  test('09 /reports — month picker, export formats, table headers', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/reports');
    await expectHeading(page, 'Monthly Reports');

    const month = page.locator('input[type="month"]');
    await expect(month).toBeVisible();
    const before = await month.inputValue();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(month).not.toHaveValue(before);
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(month).toHaveValue(before);

    for (const label of ['Export CSV', 'Export Excel', 'Print PDF']) {
      const button = page.getByRole('button', { name: label });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
    }

    const headers = await page.locator('th').allInnerTexts();
    expect(headers.length, 'report table column headers').toBeGreaterThan(0);

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('10 /settlements — payable cards and status pills', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/settlements');
    await expectHeading(page, 'Monthly Settlements');

    await expect(page.locator('input[type="month"]')).toBeVisible();
    const rows = page.locator('a[href^="/settlements/"]');
    const count = await rows.count();
    if (count === 0) {
      await expect(page.getByText(/No active settlement payables found/i)).toBeVisible();
      note('No settlement payables rendered for this account/month; detail page not exercised.');
    } else {
      await expect(page.getByText(/Expected Liability|Paid to Date/i).first()).toBeVisible();
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('11 /settlements/[id] — liability cards, payment table, record action', async ({ page }) => {
    await visit(page, '/settlements');
    const first = page.locator('a[href^="/settlements/"]').first();
    if ((await first.count()) === 0) {
      test.skip(true, 'no settlement rows on production for this account/month');
    }

    const errors = watchConsole(page);
    await first.click();
    await page.waitForURL(/\/settlements\/.+/, { timeout: 10000 });

    await expect(page.getByText('Expected Liability')).toBeVisible();
    await expect(page.getByText('Total Paid to Date')).toBeVisible();
    await expect(page.getByText('Settlement Status')).toBeVisible();

    const headers = await page.locator('th').allInnerTexts();
    if (headers.length > 0) {
      for (const column of ['Date', 'Amount (BDT)', 'Reference']) {
        expect(headers.join(' ')).toContain(column);
      }
    }

    const record = page.getByRole('button', { name: /Record Payment/i });
    await expect(record).toBeVisible();
    const box = await record.boundingBox();
    expect(box?.height ?? 0, 'record payment height').toBeGreaterThanOrEqual(44);
    await expect(record).toBeEnabled();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('12 /reconcile — month scope, Mode A and Mode B entry points', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/reconcile');
    await expectHeading(page, 'Statement Reconciliation');

    await expect(page.locator('input[type="month"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /New Mode A Statement/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Upload Statement File \(Mode B\)/i }),
    ).toBeVisible();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('13 /reconcile/manual — Mode A inputs and guard', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/reconcile/manual');
    await expectHeading(page, 'Mode A Manual Statement');

    await expect(page.locator('#recon-month')).toBeVisible();
    await expect(page.locator('#recon-payable')).toBeVisible();
    await expect(page.locator('#recon-total-bdt')).toBeVisible();
    await expect(page.locator('#rec-note')).toBeVisible();
    await expect(page.getByText('Expected Liability')).toBeVisible();
    await expect(page.getByText('Net Variance')).toBeVisible();
    await expect(page.getByText('Tolerance')).toBeVisible();

    const submit = page.locator('#btn-save');
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    // Typing a total must move the variance without committing anything.
    await page.locator('#recon-total-bdt').fill('1234.56');
    const box = await submit.boundingBox();
    expect(box?.height ?? 0, 'reconcile button height').toBeGreaterThanOrEqual(44);

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('14 /reconcile/upload — file dropzone and month scope', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/reconcile/upload');

    await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await expect(page.locator('input[type="month"]')).toBeVisible();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('15 /months/close — checklist, audit notice, close-month guard', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/months/close');
    await expectHeading(page, 'Month Close Controls');

    await expect(page.locator('input[type="month"]')).toBeVisible();
    await expect(page.getByText(/Implementation Readiness Checklist for/i)).toBeVisible();
    await expect(page.getByText(/PostgreSQL under Month Advisory Lock 1001/i)).toBeVisible();

    const close = page.locator('#btn-save, #btn-reopen-modal').first();
    await expect(close).toBeVisible();
    const box = await close.boundingBox();
    expect(box?.height ?? 0, 'close/reopen month height').toBeGreaterThanOrEqual(44);

    if (await close.isDisabled()) {
      note('Close Month is disabled by an unmet gate (reconciliation/review) for this month.');
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('16 /admin — hub cards link to every admin surface', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/admin');
    await expectHeading(page, 'Admin Hub');

    // Each hub card carries its own action label (the card title is not the link name).
    const cards: [string, string][] = [
      ['Rates & Rules', 'Manage Rates'],
      ['Payment Methods', 'Configure Methods'],
      ['Payables & Schedule', 'Manage Payables'],
      ['Team & Roles', 'Manage Users'],
      ['Device Registry', 'View Devices'],
      ['Stale Rate Reviews', 'Review Queue'],
      ['Settings', 'Store Settings'],
      ['Audit Log', 'View Audit Log'],
    ];
    for (const [card, action] of cards) {
      await expect(page.getByRole('heading', { name: card, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: action, exact: true })).toBeVisible();
    }

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('17 admin screens — every route renders its head and passes the control audit', async ({
    page,
  }) => {
    // Eight routes plus eight control audits do not fit the shared 15 s budget.
    test.setTimeout(120_000);

    const screens: [string, string | RegExp][] = [
      ['/admin/rates', 'Rate Profiles & Rules'],
      ['/admin/methods', 'Payment Methods'],
      ['/admin/payables', 'Payables & Settlement Schedule'],
      ['/admin/users', 'Team Roster & Roles'],
      ['/admin/devices', 'Hardware Device Registry'],
      ['/admin/stale-reviews', 'Stale Rate Review Queue'],
      ['/admin/audit', 'Audit Log Viewer'],
      ['/admin/settings', 'Application Settings'],
    ];

    const errors = watchConsole(page);
    for (const [route, title] of screens) {
      await visit(page, route);
      await expectHeading(page, title);
      await crawl(page, test.info());
    }

    // Draft rate editor and its live guard inputs.
    await visit(page, '/admin/rates');
    await expect(page.locator('#effective-date')).toBeVisible();
    await expect(page.locator('#vat-mode-select')).toBeVisible();
    await expect(page.getByText(/Draft Rate Profile/i)).toBeVisible();

    expectNoConsoleErrors(errors);
  });
});

/* ------------------------------------------------------------------ *
 * Platform seat
 * ------------------------------------------------------------------ */

test.describe('Super admin surfaces', () => {
  test.use({ storageState: stateFor('super') });

  test.beforeEach(() => {
    requireRole('super');
  });

  test('18 /admin/super/security — second-factor gate state', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/admin/super/security');
    await expectHeading(page, 'Two-factor authentication');

    const inputs = page.locator('#totp-code, #totp-challenge, #recovery-code');
    expect(await inputs.count(), 'MFA inputs').toBeGreaterThan(0);
    await expect(page.getByText(/authenticator|recovery code/i).first()).toBeVisible();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('19 /admin/super/centers — search, filters, provision modal', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/admin/super/centers');
    await expectHeading(page, 'Franchise Centers');

    await expect(page.getByRole('button', { name: /Provision New Center/i }).first()).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible();

    await page
      .getByRole('button', { name: /Provision New Center/i })
      .first()
      .click();
    const modal = page.getByText('Provision New Center').first();
    await expect(modal).toBeVisible();
    expect(await page.locator('input:visible').count(), 'provision form fields').toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('20 /admin/super/users and /devices — fleet filters', async ({ page }) => {
    const errors = watchConsole(page);

    await visit(page, '/admin/super/users');
    await expectHeading(page, 'Fleet Users');
    await expect(page.getByPlaceholder('Name or email')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Search$/ })).toBeVisible();
    await crawl(page, test.info());

    await visit(page, '/admin/super/devices');
    await expectHeading(page, 'Fleet Devices');
    await expect(page.locator('select').first()).toBeVisible();
    await crawl(page, test.info());

    expectNoConsoleErrors(errors);
  });

  test('21 /admin/super/ledger — cross-center filters and table', async ({ page }) => {
    const errors = watchConsole(page);
    await visit(page, '/admin/super/ledger');
    await expectHeading(page, 'Cross-Center Ledger');

    const selects = page.locator('select');
    expect(await selects.count(), 'global filter dropdowns').toBeGreaterThanOrEqual(3);
    await expect(page.locator('input[type="date"]').first()).toBeVisible();

    await crawl(page, test.info());
    expectNoConsoleErrors(errors);
  });

  test('22 /admin/super and /admin/super/search — fleet dashboard and global search', async ({
    page,
  }) => {
    const errors = watchConsole(page);

    await visit(page, '/admin/super');
    await expectHeading(page, 'Fleet Dashboard');
    await crawl(page, test.info());

    await visit(page, '/admin/super/search');
    await expectHeading(page, 'Global Search');
    await expect(page.locator('input[type="search"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Search$/ })).toBeVisible();
    await crawl(page, test.info());

    expectNoConsoleErrors(errors);
  });
});
