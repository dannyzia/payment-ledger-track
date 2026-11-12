import type { Page } from '@playwright/test';

/**
 * Signs the handset out (when a session exists) and in through the app's own
 * form, then confirms the cached profile updated.
 *
 * Shared by the sign-in CLI and the device journey, which switches accounts
 * automatically when the phone is on the wrong one. The phone's Sign Out control
 * lives in the floating menu's expanded panel and only exists while that panel is
 * open; the same label also appears on the desktop sidebar, hidden at phone
 * width, so everything is driven by id rather than by text.
 */
export interface DeviceCredentials {
  email: string;
  password: string;
  /** Where the password came from (``--password``, an env var name), for guidance. */
  passwordSource?: string;
}

/**
 * Explains a rejected sign-in and points at the value that supplied the password,
 * so a stale fixture variable is fixable without guessing which of the three
 * possible sources was used.
 */
export function signInFailureHelp(params: {
  email: string;
  screen: string;
  passwordSource?: string;
}): string {
  const lines = [
    `Sign-in as ${params.email} did not reach the dashboard. Screen said: ${params.screen.replace(/\s+/g, ' ')}`,
  ];

  if (!params.passwordSource) {
    lines.push('No password source was recorded for this run.');
  } else if (params.passwordSource.startsWith('--')) {
    lines.push(`The password came from ${params.passwordSource}.`);
    lines.push('Check the value you passed on the command line.');
  } else {
    lines.push(`The password came from ${params.passwordSource}.`);
    lines.push(
      `Check that value (it stays in the gitignored .env.local; see docs/runbooks/DEVICE_JOURNEY.md), or override this run with --password=<password>.`,
    );
  }

  return lines.join('\n');
}

export interface CachedProfile {
  email?: string;
  role?: string;
  centerId?: string | null;
  centerCode?: string;
  centerName?: string;
}

/**
 * Explains how to supply credentials for the requested centre instead of just
 * refusing. A fresh checkout has no CLT_DEVICE_* variables, so the run has to
 * name the exact ones to add rather than leave a person guessing.
 */
export function missingPasswordHelp(params: {
  signedInAs: string | null;
  centerCode: string;
  accountEmail: string;
  accountIsDefault: boolean;
}): string {
  const prefix = `CLT_DEVICE_${params.centerCode.toUpperCase()}`;

  // Never hand back the fallback account as the value to configure: it belongs to
  // another centre, so writing it into this centre's variable would trade this
  // message for an "account belongs to center …" failure.
  const lines = params.accountIsDefault
    ? [
        `Phone is signed in as ${params.signedInAs ?? 'nobody'}, and no account is configured for ${params.centerCode}, so the journey fell back to ${params.accountEmail}.`,
        'Add both to .env.local (gitignored):',
        `  ${prefix}_ACCOUNT=<account for ${params.centerCode}>`,
        `  ${prefix}_PASSWORD=<password>`,
      ]
    : [
        `Phone is signed in as ${params.signedInAs ?? 'nobody'}, but this journey targets ${params.accountEmail} (${params.centerCode}).`,
        'No password was supplied for that account, so the handset cannot be switched automatically.',
        'Add both to .env.local (gitignored):',
        `  ${prefix}_ACCOUNT=${params.accountEmail}`,
        `  ${prefix}_PASSWORD=<password>`,
      ];

  lines.push('Or pass --password=<password>, or set CLT_DEVICE_PASSWORD for a one-off run.');
  return lines.join('\n');
}

export async function readCachedProfile(page: Page): Promise<CachedProfile | null> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('clt_cached_profile') ?? 'null') as CachedProfile | null,
  );
}

export async function signInOnDevice(page: Page, credentials: DeviceCredentials): Promise<void> {
  await page.goto('https://localhost/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const toggle = page.locator('button[aria-controls="mobile-nav-panel"]').first();
  if (await toggle.count()) {
    await toggle.click({ timeout: 10_000 }).catch(() => undefined);
    await page
      .locator('#mobile-nav-panel')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);
  }

  const signOut = page.locator('#btn-mobile-sign-out');
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    console.info('Signed out through the mobile menu.');
  } else {
    // No session, or the panel never opened: drop the local session so /login
    // renders the form instead of redirecting to the dashboard. Unlike the menu
    // action this does not revoke the refresh token upstream.
    await page.evaluate(() => localStorage.clear());
    console.info('Mobile menu unavailable; cleared the local session instead.');
  }

  await page.goto('https://localhost/login', { waitUntil: 'domcontentloaded' });
  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.waitFor({ state: 'visible', timeout: 30_000 });

  const emailField = page.locator('#login-email').or(page.locator('input[type="email"]')).first();
  await emailField.fill(credentials.email);
  await passwordField.fill(credentials.password);
  await page.locator('button[type="submit"]').first().click();

  try {
    await page.waitForURL('**/dashboard', { timeout: 45_000 });
  } catch {
    const screen = await page.evaluate(() => document.body.innerText.slice(0, 300));
    throw new Error(
      signInFailureHelp({
        email: credentials.email,
        screen,
        passwordSource: credentials.passwordSource,
      }),
    );
  }

  await page.waitForTimeout(2000);
  const profile = await readCachedProfile(page);
  if (profile?.email?.toLowerCase() !== credentials.email) {
    throw new Error(
      `Signed in as ${profile?.email ?? 'nobody'}, not ${credentials.email}. The cached profile did not update.`,
    );
  }
}
