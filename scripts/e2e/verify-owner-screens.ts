#!/usr/bin/env tsx
/**
 * Check the owner-only screens on the connected handset — from both sides.
 *
 *   pnpm exec tsx scripts/e2e/verify-owner-screens.ts [--expect=owner|staff]
 *                                                     [--fixture=MHK_OWNER]
 *                                                     [--account=<email> --password=<password>]
 *
 * `--expect=owner` (default) signs in as the fixture whose
 * `CLT_DEVICE_<NAME>_ROLE` is `owner`, then asserts /reports, /settlements and
 * /admin each stay on their route and render, and that the mobile menu offers the
 * privileged links.
 *
 * `--expect=staff` is the CLT-R-031 negative check: staff must be kept out. It
 * asserts /reports and /settlements show their "Access Restricted" notice (or
 * redirect away) instead of their content, the menu does not offer the privileged
 * links at all, and the admin APIs refuse the staff token with 403. The admin hub
 * has no route guard — the menu link and those 403s are its only gate — so it is
 * reported as a note when its shell renders for staff.
 *
 * The handset is left on the account it started on when that account's password
 * is configured. Exit code is non-zero if any assertion fails.
 */
import { chromium, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { runDevicePreflight } from './device-preflight';
import { readCachedProfile, signInOnDevice, type CachedProfile } from './device-sign-in-flow';
import { planFixtureChecks, type CenterRow, type FixturePlan } from './device-fixtures';
import {
  ADMIN_API_PROBES,
  OWNER_ROUTES,
  STAFF_GUARDED_ROUTES,
  assessAdminApiRefusals,
  assessOwnerApiAccess,
  assessOwnerNav,
  assessOwnerRoute,
  assessStaffNav,
  assessStaffRoute,
  selectFixtureForRole,
} from './owner-screens';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Pool } = pg;

function readOption(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Waits for a route to finish rendering instead of trusting a fixed delay. */
async function waitForText(page: Page, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.includes(text)) return;
    await page.waitForTimeout(500);
  }
}

/** Stops waiting as soon as Access Restricted renders or the route redirects away. */
async function waitForStaffRouteSettlement(
  page: Page,
  guardedPath: string,
  timeoutMs = 15_000,
): Promise<void> {
  const normalizedTarget = guardedPath.replace(/\/+$/, '');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => ({
        path: location.pathname.replace(/\/+$/, ''),
        text: document.body.innerText,
      }))
      .catch(() => null);
    if (state && (state.text.includes('Access Restricted') || state.path !== normalizedTarget)) {
      return;
    }
    await page.waitForTimeout(300);
  }
}

async function mobileNavLinks(page: Page): Promise<string[]> {
  const toggle = page.locator('button[aria-controls="mobile-nav-panel"]').first();
  if (await toggle.count()) {
    await toggle.click({ timeout: 10_000 }).catch(() => undefined);
    await page
      .locator('#mobile-nav-panel')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);
  }
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#mobile-nav-panel a')).map((link) =>
      link.getAttribute('href'),
    ),
  );
  return links.filter((link): link is string => Boolean(link));
}

/**
 * Probes the admin and owner-only endpoints from inside the app. The page's own
 * fetch is patched on the device to prepend PUBLIC_API_BASE, so a relative path
 * reaches the real backend; the session token comes from the Supabase entry in
 * WebView storage. Write probes carry an empty JSON body, which every one of these
 * routes rejects on its schema, so a missing role gate surfaces as a 400 rather
 * than as a real month close or ownership transfer.
 */
async function probeAdminApis(page: Page): Promise<{
  hasToken: boolean;
  probes: Array<{ path: string; method?: string; status: number }>;
}> {
  return page.evaluate(
    async (declared: Array<{ path: string; method?: string; body?: unknown }>) => {
      const key = Object.keys(localStorage).find((candidate) => candidate.includes('-auth-token'));
      let token: string | undefined;
      try {
        const stored = key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
        token = stored?.access_token ?? stored?.currentSession?.access_token ?? undefined;
      } catch {
        token = undefined;
      }

      const probes: Array<{ path: string; method?: string; status: number }> = [];
      for (const probe of declared) {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (probe.body !== undefined) headers['Content-Type'] = 'application/json';

        try {
          const response = await fetch(probe.path, {
            method: probe.method ?? 'GET',
            headers,
            body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
          });
          probes.push({ path: probe.path, method: probe.method, status: response.status });
        } catch {
          probes.push({ path: probe.path, method: probe.method, status: 0 });
        }
      }

      return { hasToken: Boolean(token), probes };
    },
    ADMIN_API_PROBES,
  );
}

const expectFlag = (readOption('expect') ?? 'owner').toLowerCase();
if (expectFlag !== 'owner' && expectFlag !== 'staff') {
  console.error(`--expect must be "owner" or "staff", not "${expectFlag}".`);
  process.exit(1);
}

const fixtureFlag = readOption('fixture');
const accountFlag = readOption('account')?.trim();
const passwordFlag = readOption('password');

interface Account {
  email: string;
  password: string;
  passwordSource?: string;
  label: string;
}

let account: Account | undefined;
let plan: FixturePlan | undefined;

if (accountFlag) {
  const password = passwordFlag ?? process.env.CLT_DEVICE_PASSWORD ?? '';
  if (!password) {
    console.error(
      `Usage: --account=${accountFlag} also needs --password=<password> (or CLT_DEVICE_PASSWORD).`,
    );
    process.exit(1);
  }
  account = {
    email: accountFlag.toLowerCase(),
    password,
    passwordSource: passwordFlag ? '--password' : 'CLT_DEVICE_PASSWORD',
    label: accountFlag,
  };
}

const preflight = await runDevicePreflight();
for (const note of preflight.notes) console.info(`  • ${note}`);
if (preflight.problems.length > 0) {
  console.error('\n❌ OWNER SCREEN CHECK PREFLIGHT FAILED — no screens were visited:');
  for (const problem of preflight.problems) {
    console.error(`\n  • ${problem.what}\n    Fix: ${problem.fix}`);
  }
  process.exit(1);
}

if (!account) {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  let centers: CenterRow[];
  try {
    centers = (
      await pool.query<CenterRow>('select id, code, name from centers order by center_number')
    ).rows;
  } finally {
    await pool.end();
  }

  plan = planFixtureChecks(centers);
  const selection = selectFixtureForRole(plan, expectFlag, fixtureFlag);
  if (!selection.fixture) {
    console.error(`\n❌ ${selection.problem}`);
    process.exit(1);
  }

  const chosen = plan.ready.find(
    (fixture) => fixture.fixtureName === selection.fixture?.fixtureName,
  );
  if (!chosen) {
    console.error(`\n❌ Fixture ${selection.fixture.fixtureName} could not be resolved.`);
    process.exit(1);
  }

  account = {
    email: chosen.email,
    password: chosen.password,
    passwordSource: chosen.passwordVar,
    label: `${chosen.fixtureName} (${chosen.centerName})`,
  };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const failures: string[] = [];

try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  const initial: CachedProfile | null = await readCachedProfile(page);

  await signInOnDevice(page, {
    email: account.email,
    password: account.password,
    passwordSource: account.passwordSource,
  });

  const profile = await readCachedProfile(page);
  console.info(
    `Signed in: ${profile?.email} (${profile?.role ?? 'unknown role'}, center ${profile?.centerCode ?? profile?.centerId ?? 'none'}) — fixture ${account.label}`,
  );

  if (profile?.role?.toLowerCase() !== expectFlag) {
    failures.push(
      `${account.email} has role ${profile?.role ?? 'unknown'}, but this check needs a ${expectFlag} session.`,
    );
  } else if (expectFlag === 'owner') {
    for (const route of OWNER_ROUTES) {
      await page.goto(`https://localhost${route.path}`, { waitUntil: 'domcontentloaded' });
      await waitForText(page, route.heading);
      const snapshot = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText,
      }));

      const outcome = assessOwnerRoute({
        path: route.path,
        heading: route.heading,
        finalUrl: snapshot.url,
        text: snapshot.text,
      });
      if (!outcome.ok) failures.push(`${route.path}: ${outcome.detail}`);
      console.info(`  ${route.path.padEnd(13)} ${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.detail}`);
    }

    const nav = assessOwnerNav(await mobileNavLinks(page));
    if (!nav.ok) failures.push(`mobile menu: ${nav.detail}`);
    console.info(`  ${'/nav'.padEnd(13)} ${nav.ok ? 'PASS' : 'FAIL'}  ${nav.detail}`);

    const probe = await probeAdminApis(page);
    const api = assessOwnerApiAccess({
      hasToken: probe.hasToken,
      probes: probe.probes.map((result) => ({
        ...result,
        expected:
          ADMIN_API_PROBES.find(
            (declared) =>
              declared.path === result.path &&
              (declared.method ?? 'GET') === (result.method ?? 'GET'),
          )?.expectedOwnerStatus ?? 200,
      })),
    });
    if (!api.ok) failures.push(`owner API access: ${api.detail}`);
    console.info(`  ${'/api'.padEnd(13)} ${api.ok ? 'PASS' : 'FAIL'}  ${api.detail}`);
  } else {
    for (const routePath of STAFF_GUARDED_ROUTES) {
      await page.goto(`https://localhost${routePath}`, { waitUntil: 'domcontentloaded' });
      await waitForStaffRouteSettlement(page, routePath, 15_000);
      const snapshot = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText,
      }));

      const outcome = assessStaffRoute({
        path: routePath,
        finalUrl: snapshot.url,
        text: snapshot.text,
      });
      if (!outcome.ok) failures.push(`${routePath}: ${outcome.detail}`);
      console.info(`  ${routePath.padEnd(13)} ${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.detail}`);
    }

    const nav = assessStaffNav(await mobileNavLinks(page));
    if (!nav.ok) failures.push(`mobile menu: ${nav.detail}`);
    console.info(`  ${'/nav'.padEnd(13)} ${nav.ok ? 'PASS' : 'FAIL'}  ${nav.detail}`);

    const probe = await probeAdminApis(page);
    const api = assessAdminApiRefusals(probe);
    if (!api.ok) failures.push(`admin APIs: ${api.detail}`);
    console.info(`  ${'/admin api'.padEnd(13)} ${api.ok ? 'PASS' : 'FAIL'}  ${api.detail}`);

    // What a staff session sees when it loads /admin by URL: the guard may redirect
    // it, or the hub shell may paint first. Both keep the data out (probed above),
    // but the verdict must come from the settled state, not whichever frame the
    // read happened to catch.
    await page.goto('https://localhost/admin', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        text: document.body.innerText,
      }));
      if (state.path !== '/admin' || state.text.includes('Admin Hub')) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    const settled = await page.evaluate(() => ({
      path: location.pathname.replace(/\/+$/, ''),
      text: document.body.innerText,
    }));
    if (settled.path === '/admin' && settled.text.includes('Admin Hub')) {
      console.info(
        '  note: /admin paints its hub shell for a staff session before anything stops it; its data is refused, so this is UI exposure, not data access.',
      );
    } else if (settled.path !== '/admin') {
      console.info(`  note: /admin sent the staff session to ${settled.path} of its own accord.`);
    }
  }

  // Leave the handset as it was found when that account's password is known.
  const restore = plan?.ready.find(
    (fixture) => fixture.email.toLowerCase() === initial?.email?.toLowerCase(),
  );
  if (restore && initial?.email?.toLowerCase() !== account.email) {
    await signInOnDevice(page, {
      email: restore.email,
      password: restore.password,
      passwordSource: restore.passwordVar,
    });
    console.info(`  Restored session: ${restore.email}`);
  }
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n❌ OWNER SCREEN CHECK FAILED (expect=${expectFlag}):`);
  for (const failure of failures) console.error(`\n  • ${failure}`);
  console.error('\nFixture setup: docs/runbooks/DEVICE_JOURNEY.md §4.');
  process.exitCode = 1;
} else if (expectFlag === 'owner') {
  console.info(
    `\nOwner screens: ${OWNER_ROUTES.length} routes, mobile menu and ${ADMIN_API_PROBES.length} endpoints passed as ${account.email}`,
  );
} else {
  console.info(
    `\nStaff guard: ${STAFF_GUARDED_ROUTES.length} routes, mobile menu and ${ADMIN_API_PROBES.length} admin endpoints passed as ${account.email}`,
  );
}
