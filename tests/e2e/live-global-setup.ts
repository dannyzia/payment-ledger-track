import { chromium, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { totpCode } from '../../scripts/e2e/totp';

/**
 * One sign-in per role for the live sweep.
 *
 * The accounts come from the same untracked root env as `db:bootstrap`:
 * owner and staff from the device fixtures, the platform seat from
 * BOOTSTRAP_OWNER_*. Hosted credentials have to be present there; the local
 * Supabase fixtures are refused by the production project ("Invalid login
 * credentials"), which is recorded in `.playwright/auth-status.json` so the
 * spec can skip those surfaces with a reason instead of pretending they ran.
 *
 * Nothing secret is written to the status file or printed: only the role key
 * and the login form's own error text.
 */

const ROOT = process.cwd();
const AUTH_DIR = path.join(ROOT, '.playwright');
const STATUS_FILE = path.join(AUTH_DIR, 'auth-status.json');
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'https://payment-ledger-track.vercel.app';

for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(ROOT, envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

interface RoleSpec {
  key: 'owner' | 'staff' | 'super';
  email: string;
  password: string;
}

interface RoleStatus {
  state: string | null;
  ok: boolean;
  reason: string;
}

const roles: RoleSpec[] = [
  {
    key: 'owner',
    email: process.env.CLT_DEVICE_MHK_OWNER_ACCOUNT ?? '',
    password: process.env.CLT_DEVICE_MHK_OWNER_PASSWORD ?? '',
  },
  {
    key: 'staff',
    email: process.env.CLT_DEVICE_MHK_ACCOUNT ?? '',
    password: process.env.CLT_DEVICE_MHK_PASSWORD ?? '',
  },
  {
    key: 'super',
    email: process.env.BOOTSTRAP_OWNER_EMAIL ?? '',
    password: process.env.BOOTSTRAP_OWNER_PASSWORD ?? '',
  },
];

/** Clears the mandatory platform second factor when a throwaway secret is supplied. */
async function clearSecondFactor(page: Page): Promise<void> {
  const secret = process.env.E2E_SEAT_TOTP_SECRET;
  if (!secret) return;

  const challenge = page.locator('#totp-challenge');
  if (!(await challenge.isVisible().catch(() => false))) return;

  await challenge.fill(totpCode(secret));
  await page.getByRole('button', { name: /^(continue|verifying)/i }).click();

  const codesHeading = page.getByRole('heading', { name: /save your recovery codes/i });
  const codesVisible = await codesHeading
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (codesVisible) {
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /continue to the dashboard/i }).click();
  }

  await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => undefined);
}

async function signIn(role: RoleSpec): Promise<RoleStatus> {
  const stateName = `auth-${role.key}.json`;
  const statePath = path.join(AUTH_DIR, stateName);

  if (!role.email || !role.password) {
    return { state: null, ok: false, reason: 'credentials missing from .env.local' };
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#login-email', role.email);
    await page.fill('#login-password', role.password);
    await page.click('button[type="submit"]');

    await page
      .waitForURL(/\/(dashboard|admin\/super\/security)/, { timeout: 15000 })
      .catch(() => undefined);

    if (page.url().includes('/admin/super/security')) {
      await clearSecondFactor(page);
    }

    if (!page.url().includes('/dashboard')) {
      const alert = await page
        .locator('[role="alert"]')
        .first()
        .innerText()
        .catch(() => '');
      const reason = page.url().includes('/admin/super/security')
        ? 'password accepted but the platform seat requires an authenticator code (set E2E_SEAT_TOTP_SECRET)'
        : alert.trim() || `no signed-in screen reached (ended on ${new URL(page.url()).pathname})`;
      return { state: null, ok: false, reason };
    }

    await context.storageState({ path: statePath });
    return { state: stateName, ok: true, reason: 'signed in' };
  } catch (error) {
    return {
      state: null,
      ok: false,
      reason:
        error instanceof Error ? (error.message.split('\n')[0] ?? 'login failed') : 'login failed',
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  // A stale snapshot would look authenticated while its refresh token is dead.
  for (const name of fs.readdirSync(AUTH_DIR)) {
    if (/^auth-.*\.json$/.test(name)) fs.rmSync(path.join(AUTH_DIR, name));
  }

  const status: Record<string, RoleStatus> = {};
  for (const role of roles) {
    status[role.key] = await signIn(role);
    const result = status[role.key];
    console.info(
      result.ok
        ? `[live-audit] ${role.key}: signed in, state saved to .playwright/${result.state}`
        : `[live-audit] ${role.key}: NOT authenticated — ${result.reason}`,
    );
  }

  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`);
}
