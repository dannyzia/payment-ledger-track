#!/usr/bin/env tsx
/**
 * Sign the connected handset into a named account over CDP.
 *
 *   pnpm exec tsx scripts/e2e/device-sign-in.ts --email=<email> --password=<password>
 *
 * On a phone the app's Sign Out control lives in the floating menu's expanded
 * panel (`#btn-mobile-sign-out`), which only exists while that panel is open; the
 * same label also appears on the desktop sidebar, which is hidden at phone width.
 * Matching by text therefore finds the invisible one, so this drives the menu by
 * id. Switching by hand is a multi-step dance that is easy to get wrong — a stale
 * session turns /login into a redirect back to the dashboard. This signs out,
 * signs in through the same form a person uses, then prints the profile the app
 * cached and the center chips the entry form renders, which is what tells you the
 * switch actually took.
 *
 * Credentials may instead come from CLT_DEVICE_EMAIL / CLT_DEVICE_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { runDevicePreflight } from './device-preflight';
import { readCachedProfile, signInOnDevice } from './device-sign-in-flow';

function readOption(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = (readOption('email') ?? process.env.CLT_DEVICE_EMAIL ?? '').trim().toLowerCase();
const passwordFlag = readOption('password');
const password = passwordFlag ?? process.env.CLT_DEVICE_PASSWORD ?? '';
const passwordSource = passwordFlag ? '--password' : 'CLT_DEVICE_PASSWORD';

if (!email || !password) {
  console.error(
    'Usage: device-sign-in.ts --email=<email> --password=<password> (or CLT_DEVICE_EMAIL / CLT_DEVICE_PASSWORD)',
  );
  process.exit(1);
}

const preflight = await runDevicePreflight();
for (const note of preflight.notes) console.info(`  • ${note}`);
if (preflight.problems.length > 0) {
  console.error('\n❌ DEVICE SIGN-IN PREFLIGHT FAILED — nothing was changed:');
  for (const problem of preflight.problems) {
    console.error(`\n  • ${problem.what}\n    Fix: ${problem.fix}`);
  }
  process.exit(1);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  await signInOnDevice(page, { email, password, passwordSource });

  const profile = await readCachedProfile(page);
  console.info(
    `Signed in: ${profile?.email} (${profile?.role ?? 'unknown role'}, center ${profile?.centerCode ?? profile?.centerId ?? 'none'})`,
  );

  await page.goto('https://localhost/entries/new', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#input-customer', { timeout: 30_000 });
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.clt-chip, [class*="chip"], [class*="Chip"]')).map((el) =>
      el.textContent?.trim(),
    ),
  );
  console.info('Center chips:', JSON.stringify(chips));
} catch (err) {
  console.error(`\n❌ DEVICE SIGN-IN FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
