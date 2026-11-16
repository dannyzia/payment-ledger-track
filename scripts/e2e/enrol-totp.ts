#!/usr/bin/env tsx
/**
 * Enrol a TOTP factor for the platform seat in the isolated E2E stack.
 *
 * Plan 023 step 6 makes the seat's second factor mandatory: a `super_admin` that
 * signs in with a password only is sent to `/admin/super/security`, so every
 * owner-authenticated spec would stop at that screen. The stack is rebuilt from
 * `supabase/migrations` on each run, so the factor has to be created per run.
 *
 * The script signs in with the bootstrap owner's password, enrols a factor,
 * verifies a code it computes itself, and prints the secret as JSON on stdout for
 * `scripts/e2e/isolated-stack.ts` to pass to Playwright. Nothing else is printed
 * to stdout; the secret is throwaway and lives only in that child environment.
 */
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
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

function totpCode(secret: string, at: number = Date.now()): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;

  if (!url || !anonKey || !email || !password) {
    throw new Error(
      'SUPABASE_URL, SUPABASE_ANON_KEY, BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD are required.',
    );
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`seat sign-in failed: ${signIn.error.message}`);

  const listed = await client.auth.mfa.listFactors();
  if (listed.error) throw new Error(`factor list failed: ${listed.error.message}`);
  const existing = (listed.data?.totp ?? []).find((factor) => factor.status === 'verified');
  if (existing) {
    // Its secret cannot be read back; a stack rebuilt per run should not hit this.
    throw new Error(
      `the seat already holds a verified TOTP factor (${existing.id}); reset the stack so its secret is minted for this run`,
    );
  }

  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'E2E seat' });
  if (enrolled.error) throw new Error(`enrolment failed: ${enrolled.error.message}`);
  const factorId = enrolled.data.id;
  const secret = enrolled.data.totp.secret;

  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw new Error(`challenge failed: ${challenge.error.message}`);

  const verified = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: totpCode(secret),
  });
  if (verified.error) throw new Error(`verification failed: ${verified.error.message}`);

  // The only stdout output: the stack runner reads it before Playwright starts.
  process.stdout.write(`${JSON.stringify({ secret })}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
