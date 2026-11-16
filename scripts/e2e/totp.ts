/**
 * RFC 6238 TOTP for the E2E harness, in one place.
 *
 * Two processes need the same arithmetic. `scripts/e2e/enrol-totp.ts` enrols the
 * platform seat's factor and proves it with a code it computes itself, then hands the
 * secret to Playwright through `E2E_SEAT_TOTP_SECRET`; `apps/web/tests/e2e/sign-in.ts`
 * signs in and answers that factor's challenge with a code derived from the same
 * secret. If the base32 decoding or the dynamic truncation drifted apart, enrolment
 * would verify while the login step failed (or the reverse), and the failure would
 * present as a broken seat gate rather than as a harness bug — the reason both now
 * import this module instead of carrying a copy.
 *
 * The secret is a throwaway minted per isolated-stack run; nothing here is used
 * against a real environment. Both callers are Node processes, so `node:crypto` is
 * fine: this module never reaches the browser bundle.
 */
import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** GoTrue's TOTP step and code length; not configurable through the API. */
const STEP_SECONDS = 30;
const MODULO = 1_000_000;

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
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % MODULO).toString().padStart(6, '0');
}
