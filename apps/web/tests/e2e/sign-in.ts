import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

/**
 * Plan 023 step 6 made TOTP mandatory for the platform seat: after a correct
 * password the login screen sends `super_admin` to `/admin/super/security`, so a
 * spec that waits for `/dashboard` times out. The isolated stack therefore enrols
 * a factor for the seat account (`scripts/e2e/isolated-stack.ts` calls
 * `scripts/e2e/enrol-totp.ts`) and hands the secret to this process as
 * `E2E_SEAT_TOTP_SECRET`; `signIn` proves the factor with a code derived from it.
 *
 * The secret is a throwaway, generated per stack run. Nothing here is used
 * against a real environment.
 */

const SEAT_TOTP_SECRET = process.env.E2E_SEAT_TOTP_SECRET ?? '';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, the encoding GoTrue returns for a TOTP secret. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character in TOTP secret: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** RFC 6238 TOTP: 6 digits, SHA-1, 30-second step — what GoTrue verifies. */
export function totpCode(secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 1_000_000).toString().padStart(6, '0');
}

/**
 * Signs in through the real login form and, when the account is the platform
 * seat, clears the mandatory second factor. Every spec uses this so the seat
 * gate is exercised rather than worked around.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  totpSecret: string = SEAT_TOTP_SECRET,
  timeout = 20000,
): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/(dashboard|admin\/super\/security)/, { timeout });

  if (!page.url().includes('/admin/super/security')) return;

  if (!totpSecret) {
    throw new Error(
      `${email} is the platform seat and needs a second factor, but E2E_SEAT_TOTP_SECRET is not set. ` +
        'Run the suite through `pnpm test:e2e:isolated`, which enrols one for the stack.',
    );
  }

  // Challenge phase: the factor exists, this session has not proven it yet.
  const challenge = page.locator('#totp-challenge');
  await challenge.waitFor({ state: 'visible', timeout: 20000 });
  await challenge.fill(totpCode(totpSecret));
  await page.getByRole('button', { name: /^(continue|verifying)/i }).click();

  // A proven factor with no recovery codes left lands on the codes screen, which
  // must be acknowledged before the dashboard opens.
  const codesHeading = page.getByRole('heading', { name: /save your recovery codes/i });
  const codesVisible = await codesHeading
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (codesVisible) {
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /continue to the dashboard/i }).click();
  }

  await page.waitForURL('**/dashboard', { timeout });
}
